-- ============================================================================
-- DATEVRA Migration 033: Razorpay Payments verified_at Reconciliation,
-- Idempotent Webhook Tracking & Service-Role Atomic Activation/Refund RPCs
--
-- Phase 10 safeguards:
--   1. Adds missing public.payments.verified_at column expected by
--      supabase/functions/verify-payment and razorpay-webhook WITHOUT altering
--      any existing or historical placeholder payment rows.
--   2. Adds UNIQUE partial index on public.subscriptions(payment_id) WHERE
--      payment_id IS NOT NULL so a single verified payment can never activate
--      duplicate subscriptions even under concurrent verify + webhook races.
--   3. Adds public.payment_webhook_events for idempotent Razorpay webhook
--      deduplication (service_role only, zero client access).
--   4. Provides atomic service_role RPCs:
--      - public.service_activate_verified_payment()
--      - public.service_reconcile_refunded_payment()
--      so Razorpay verification & webhooks properly link subscriptions.payment_id,
--      issue datevra_internal.plan_update_intents for protect_profile_fields(),
--      set payments.verified_at, and emit /membership notifications cleanly.
--   5. Updates public.admin_verify_payment() to populate verified_at = now().
-- ============================================================================

-- 1. Reconcile payments.verified_at (additive only; historical rows untouched)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

COMMENT ON COLUMN public.payments.verified_at IS
  'Timestamp when payment verification succeeded via Razorpay signature/webhook or admin verification.';

-- 2. Prevent duplicate subscriptions for the same verified payment
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_payment_id
  ON public.subscriptions (payment_id)
  WHERE payment_id IS NOT NULL;

-- 3. Idempotent Razorpay Webhook Event Ledger (service_role only)
CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  event_id            text PRIMARY KEY,
  event_type          text NOT NULL,
  razorpay_order_id   text,
  razorpay_payment_id text,
  status              text NOT NULL DEFAULT 'processed'
                      CHECK (status IN ('processed', 'ignored', 'failed')),
  detail              text,
  processed_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order
  ON public.payment_webhook_events (razorpay_order_id, processed_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.payment_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payment_webhook_events TO postgres, service_role;

-- 4. Atomic Service-Role Payment Activation RPC (used by verify-payment & razorpay-webhook)
CREATE OR REPLACE FUNCTION public.service_activate_verified_payment(
  p_payment_id          uuid,
  p_razorpay_payment_id text,
  p_method              text DEFAULT 'razorpay'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_payment      public.payments%ROWTYPE;
  v_existing_sub uuid;
  v_sub_id       uuid;
  v_start        timestamptz := now();
  v_end          timestamptz := now() + interval '1 month';
  v_clean_method text := COALESCE(NULLIF(btrim(COALESCE(p_method, '')), ''), 'razorpay');
BEGIN
  -- Lock payment row exclusively to serialize concurrent verify-payment + webhook calls
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Payment % not found.', p_payment_id;
  END IF;

  -- Idempotent exit if already verified
  IF v_payment.status = 'verified' THEN
    SELECT id INTO v_existing_sub
    FROM public.subscriptions
    WHERE payment_id = p_payment_id
    LIMIT 1;

    RETURN jsonb_build_object(
      'already_verified', true,
      'payment_id', v_payment.id,
      'subscription_id', v_existing_sub,
      'plan_id', v_payment.plan_id,
      'verified_at', v_payment.verified_at,
      'expires_at', (SELECT expires_at FROM public.subscriptions WHERE id = v_existing_sub)
    );
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: Cannot verify payment in status %.', v_payment.status;
  END IF;

  IF p_razorpay_payment_id IS NULL OR btrim(p_razorpay_payment_id) = '' THEN
    RAISE EXCEPTION 'MISSING_GATEWAY_PAYMENT_ID: Verified gateway payment ID is required.';
  END IF;

  -- Transition payment atomically to verified
  UPDATE public.payments
     SET status = 'verified',
         razorpay_payment_id = btrim(p_razorpay_payment_id),
         method = v_clean_method,
         verified_at = v_start,
         updated_at = v_start
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  -- Activate membership subscription linked 1:1 with payment_id
  IF v_payment.kind = 'membership' AND v_payment.plan_id IS NOT NULL AND v_payment.user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

    -- Expire prior active subscriptions for this member
    UPDATE public.subscriptions
       SET status = 'expired',
           updated_at = v_start
     WHERE user_id = v_payment.user_id
       AND status = 'active';

    INSERT INTO public.subscriptions (
      user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
    ) VALUES (
      v_payment.user_id, v_payment.plan_id, v_payment.id, 'active', v_start, v_end, false
    )
    ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
    RETURNING id INTO v_sub_id;

    -- Issue plan_update_intent for protect_profile_fields() compatibility
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'datevra_internal' AND table_name = 'plan_update_intents'
    ) THEN
      INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
      VALUES (v_payment.user_id, v_payment.plan_id, now() + interval '5 minutes');
    END IF;

    UPDATE public.profiles
       SET plan_id = v_payment.plan_id,
           plan_expires_at = v_end
     WHERE id = v_payment.user_id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_payment.user_id,
      'membership',
      'Membership activated',
      'Your ' || v_payment.plan_id || ' membership is now active for 30 days.',
      '/membership'
    );
  END IF;

  INSERT INTO public.activity_logs (actor_role, action, detail)
  VALUES (
    'system',
    'payment.verified',
    'Verified Razorpay payment ' || btrim(p_razorpay_payment_id) || ' for payment ' || v_payment.id::text || ' (₹' || v_payment.amount::text || ')'
  );

  RETURN jsonb_build_object(
    'already_verified', false,
    'payment_id', v_payment.id,
    'subscription_id', v_sub_id,
    'plan_id', v_payment.plan_id,
    'verified_at', v_start,
    'expires_at', v_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_activate_verified_payment(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_activate_verified_payment(uuid, text, text) TO service_role;

-- 5. Atomic Service-Role Refund Reconciliation RPC (used by razorpay-webhook refund events)
CREATE OR REPLACE FUNCTION public.service_reconcile_refunded_payment(
  p_razorpay_payment_id text,
  p_reason              text DEFAULT 'Razorpay refund processed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_payment      public.payments%ROWTYPE;
  v_other_active public.subscriptions%ROWTYPE;
BEGIN
  SELECT * INTO v_payment
  FROM public.payments
  WHERE razorpay_payment_id = btrim(COALESCE(p_razorpay_payment_id, ''))
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('reconciled', false, 'reason', 'payment_not_found');
  END IF;

  IF v_payment.status = 'refunded' THEN
    RETURN jsonb_build_object('reconciled', true, 'already_refunded', true, 'payment_id', v_payment.id);
  END IF;

  UPDATE public.payments
     SET status = 'refunded',
         updated_at = now()
   WHERE id = v_payment.id;

  IF v_payment.user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

    -- Cancel subscription linked to this refunded payment
    UPDATE public.subscriptions
       SET status = 'cancelled',
           updated_at = now()
     WHERE payment_id = v_payment.id
       AND status = 'active';

    -- Re-evaluate profile entitlement from any remaining active subscription
    SELECT * INTO v_other_active
    FROM public.subscriptions
    WHERE user_id = v_payment.user_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at DESC NULLS FIRST
    LIMIT 1;

    IF FOUND THEN
      IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'datevra_internal' AND table_name = 'plan_update_intents'
      ) THEN
        INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
        VALUES (v_payment.user_id, v_other_active.plan_id, now() + interval '5 minutes');
      END IF;

      UPDATE public.profiles
         SET plan_id = v_other_active.plan_id,
             plan_expires_at = v_other_active.expires_at
       WHERE id = v_payment.user_id;
    ELSE
      UPDATE public.profiles
         SET plan_id = NULL,
             plan_expires_at = NULL
       WHERE id = v_payment.user_id;
    END IF;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_payment.user_id,
      'payment',
      'Payment refunded',
      'Your payment of ₹' || v_payment.amount::text || ' has been refunded and your membership status updated.',
      '/membership'
    );
  END IF;

  INSERT INTO public.activity_logs (actor_role, action, detail)
  VALUES (
    'system',
    'payment.refunded_webhook',
    'Reconciled refunded Razorpay payment ' || p_razorpay_payment_id || ': ' || COALESCE(p_reason, 'refund')
  );

  RETURN jsonb_build_object('reconciled', true, 'already_refunded', false, 'payment_id', v_payment.id);
END;
$$;

REVOKE ALL ON FUNCTION public.service_reconcile_refunded_payment(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_reconcile_refunded_payment(text, text) TO service_role;

-- 6. Keep admin_verify_payment aligned with payments.verified_at
CREATE OR REPLACE FUNCTION public.admin_verify_payment(
  p_payment_id uuid
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_payment  public.payments%ROWTYPE;
  v_start    timestamptz := now();
  v_end      timestamptz := now() + interval '1 month';
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Payment % not found.', p_payment_id;
  END IF;

  IF v_payment.status <> 'pending' THEN
    IF v_payment.status = 'verified' THEN
      RETURN v_payment;
    END IF;
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: Payment % is in status %, cannot verify.', p_payment_id, v_payment.status;
  END IF;

  -- Preserve real razorpay_payment_id if present; do NOT fabricate fake Razorpay IDs
  UPDATE public.payments
     SET status = 'verified',
         verified_at = v_start,
         updated_at = v_start
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  IF v_payment.kind = 'membership' AND v_payment.plan_id IS NOT NULL AND v_payment.user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

    UPDATE public.subscriptions
       SET status = 'expired',
           updated_at = v_start
     WHERE user_id = v_payment.user_id
       AND status = 'active';

    INSERT INTO public.subscriptions (
      user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
    ) VALUES (
      v_payment.user_id, v_payment.plan_id, p_payment_id, 'active', v_start, v_end, false
    )
    ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING;

    UPDATE public.profiles
       SET plan_id = v_payment.plan_id,
           plan_expires_at = v_end
     WHERE id = v_payment.user_id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_payment.user_id,
      'membership',
      'Membership activated',
      'Your ' || v_payment.plan_id || ' plan is now active. Enjoy priority matchmaking.',
      '/membership'
    );
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'payment.verify',
    'Verified payment ' || p_payment_id::text || ' (₹' || v_payment.amount::text || ')'
  );

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(uuid) TO authenticated;
