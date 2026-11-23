-- DATEVRA Migration 033: Razorpay payment reconciliation and retry-safe webhooks.
-- Additive and idempotent. Does not modify existing payment rows or placeholder orders.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS verified_at timestamptz;

COMMENT ON COLUMN public.payments.verified_at IS
  'Timestamp when payment verification succeeded via Razorpay or admin verification.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_unique_payment_id
  ON public.subscriptions (payment_id)
  WHERE payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.payment_webhook_events (
  event_id text PRIMARY KEY,
  event_type text NOT NULL,
  razorpay_order_id text,
  razorpay_payment_id text,
  status text NOT NULL DEFAULT 'processing',
  detail text,
  processed_at timestamptz NOT NULL DEFAULT now(),
  claim_token uuid,
  processing_started_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0
);

ALTER TABLE public.payment_webhook_events
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS processing_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE public.payment_webhook_events
  ALTER COLUMN status SET DEFAULT 'processing';

DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.payment_webhook_events'::regclass
      AND conname = 'payment_webhook_events_status_check'
  ) THEN
    ALTER TABLE public.payment_webhook_events
      DROP CONSTRAINT payment_webhook_events_status_check;
  END IF;
  ALTER TABLE public.payment_webhook_events
    ADD CONSTRAINT payment_webhook_events_status_check
    CHECK (status IN ('processing', 'processed', 'ignored', 'failed'));
END
$migration$;

CREATE INDEX IF NOT EXISTS idx_payment_webhook_events_order
  ON public.payment_webhook_events (razorpay_order_id, processed_at DESC);

ALTER TABLE public.payment_webhook_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.payment_webhook_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.payment_webhook_events TO postgres, service_role;

-- Atomic event claim. Completed events are immutable; failed or abandoned claims
-- can be retried. The claim token prevents an old worker completing a newer claim.
CREATE OR REPLACE FUNCTION public.service_claim_payment_webhook_event(
  p_event_id text,
  p_event_type text,
  p_order_id text,
  p_payment_id text,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_claimed boolean := false;
BEGIN
  INSERT INTO public.payment_webhook_events (
    event_id, event_type, razorpay_order_id, razorpay_payment_id,
    status, claim_token, processing_started_at, attempt_count, processed_at
  ) VALUES (
    p_event_id, p_event_type, NULLIF(p_order_id, ''), NULLIF(p_payment_id, ''),
    'processing', p_claim_token, now(), 1, now()
  )
  ON CONFLICT (event_id) DO UPDATE
    SET event_type = EXCLUDED.event_type,
        razorpay_order_id = COALESCE(EXCLUDED.razorpay_order_id, payment_webhook_events.razorpay_order_id),
        razorpay_payment_id = COALESCE(EXCLUDED.razorpay_payment_id, payment_webhook_events.razorpay_payment_id),
        status = 'processing',
        detail = NULL,
        claim_token = EXCLUDED.claim_token,
        processing_started_at = now(),
        attempt_count = payment_webhook_events.attempt_count + 1,
        processed_at = now()
    WHERE payment_webhook_events.status = 'failed'
       OR (
         payment_webhook_events.status = 'processing'
         AND payment_webhook_events.processing_started_at < now() - interval '5 minutes'
       )
  RETURNING true INTO v_claimed;

  RETURN COALESCE(v_claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.service_finish_payment_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_status text,
  p_detail text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_updated boolean := false;
BEGIN
  IF p_status NOT IN ('processed', 'ignored', 'failed') THEN
    RAISE EXCEPTION 'INVALID_WEBHOOK_FINAL_STATUS';
  END IF;

  UPDATE public.payment_webhook_events
     SET status = p_status,
         detail = left(p_detail, 2000),
         processing_started_at = NULL,
         processed_at = now()
   WHERE event_id = p_event_id
     AND claim_token = p_claim_token
     AND status = 'processing'
  RETURNING true INTO v_updated;

  RETURN COALESCE(v_updated, false);
END;
$$;

REVOKE ALL ON FUNCTION public.service_claim_payment_webhook_event(text,text,text,text,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.service_finish_payment_webhook_event(text,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_claim_payment_webhook_event(text,text,text,text,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.service_finish_payment_webhook_event(text,uuid,text,text) TO service_role;

-- The database is the final authority: never activate a non-membership payment,
-- invalid Razorpay IDs/order, or a payment whose amount differs from its plan.
CREATE OR REPLACE FUNCTION public.service_activate_verified_payment(
  p_payment_id uuid,
  p_razorpay_payment_id text,
  p_method text DEFAULT 'razorpay'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
  v_plan_price integer;
  v_sub_id uuid;
  v_start timestamptz := now();
  v_end timestamptz := now() + interval '1 month';
  v_clean_method text := COALESCE(NULLIF(btrim(COALESCE(p_method, '')), ''), 'razorpay');
BEGIN
  SELECT * INTO v_payment
  FROM public.payments WHERE id = p_payment_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND';
  END IF;

  IF v_payment.kind <> 'membership' OR v_payment.plan_id IS NULL OR v_payment.user_id IS NULL THEN
    RAISE EXCEPTION 'INVALID_MEMBERSHIP_PAYMENT';
  END IF;

  IF v_payment.razorpay_order_id IS NULL
     OR btrim(v_payment.razorpay_order_id) = ''
     OR v_payment.razorpay_order_id LIKE 'order_pending_%' THEN
    RAISE EXCEPTION 'INVALID_RAZORPAY_ORDER_ID';
  END IF;

  IF p_razorpay_payment_id IS NULL
     OR btrim(p_razorpay_payment_id) = ''
     OR p_razorpay_payment_id NOT LIKE 'pay_%' THEN
    RAISE EXCEPTION 'INVALID_RAZORPAY_PAYMENT_ID';
  END IF;

  IF v_payment.status = 'verified' THEN
    IF v_payment.razorpay_payment_id IS DISTINCT FROM btrim(p_razorpay_payment_id) THEN
      RAISE EXCEPTION 'VERIFIED_PAYMENT_ID_MISMATCH';
    END IF;

    SELECT id INTO v_sub_id
    FROM public.subscriptions
    WHERE payment_id = p_payment_id
    LIMIT 1;

    IF v_sub_id IS NULL THEN
      RAISE EXCEPTION 'VERIFIED_PAYMENT_MISSING_SUBSCRIPTION: payment % requires reconciliation', p_payment_id;
    END IF;

    RETURN jsonb_build_object(
      'already_verified', true,
      'payment_id', v_payment.id,
      'subscription_id', v_sub_id,
      'plan_id', v_payment.plan_id,
      'verified_at', v_payment.verified_at,
      'expires_at', (SELECT expires_at FROM public.subscriptions WHERE id = v_sub_id)
    );
  END IF;

  IF v_payment.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: %', v_payment.status;
  END IF;

  -- Current plan pricing is enforced for new activations. Existing verified
  -- payments remain idempotent even if the published plan price later changes.
  SELECT price INTO v_plan_price
  FROM public.membership_plans WHERE id = v_payment.plan_id;

  IF NOT FOUND OR v_payment.amount IS DISTINCT FROM v_plan_price THEN
    RAISE EXCEPTION 'PAYMENT_PLAN_AMOUNT_MISMATCH';
  END IF;

  UPDATE public.payments
     SET status = 'verified',
         razorpay_payment_id = btrim(p_razorpay_payment_id),
         method = v_clean_method,
         verified_at = v_start,
         updated_at = v_start
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

  UPDATE public.subscriptions
     SET status = 'expired', updated_at = v_start
   WHERE user_id = v_payment.user_id AND status = 'active';

  INSERT INTO public.subscriptions (
    user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
  ) VALUES (
    v_payment.user_id, v_payment.plan_id, v_payment.id, 'active', v_start, v_end, true
  )
  ON CONFLICT (payment_id) WHERE payment_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_sub_id;

  IF v_sub_id IS NULL THEN
    SELECT id INTO v_sub_id FROM public.subscriptions WHERE payment_id = p_payment_id;
  END IF;
  IF v_sub_id IS NULL THEN
    RAISE EXCEPTION 'SUBSCRIPTION_ACTIVATION_FAILED';
  END IF;

  INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
  VALUES (v_payment.user_id, v_payment.plan_id, v_end);

  UPDATE public.profiles
     SET plan_id = v_payment.plan_id, plan_expires_at = v_end
   WHERE id = v_payment.user_id;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_payment.user_id, 'membership', 'Membership activated',
    'Your ' || v_payment.plan_id || ' membership is now active for 30 days.',
    '/membership'
  );

  INSERT INTO public.activity_logs (actor_role, action, detail)
  VALUES (
    'system', 'payment.verified',
    'Verified Razorpay payment ' || btrim(p_razorpay_payment_id) ||
    ' for payment ' || v_payment.id::text || ' (₹' || v_payment.amount::text || ')'
  );

  RETURN jsonb_build_object(
    'already_verified', false, 'payment_id', v_payment.id,
    'subscription_id', v_sub_id, 'plan_id', v_payment.plan_id,
    'verified_at', v_start, 'expires_at', v_end
  );
END;
$$;

REVOKE ALL ON FUNCTION public.service_activate_verified_payment(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_activate_verified_payment(uuid,text,text) TO service_role;

-- Refund reconciliation remains idempotent and service-role-only.
CREATE OR REPLACE FUNCTION public.service_reconcile_refunded_payment(
  p_razorpay_payment_id text,
  p_reason text DEFAULT 'Razorpay refund processed'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_payment public.payments%ROWTYPE;
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

  UPDATE public.payments SET status = 'refunded', updated_at = now()
  WHERE id = v_payment.id;

  -- Only membership refunds affect subscription/profile entitlements.
  IF v_payment.kind = 'membership' AND v_payment.user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;
    UPDATE public.subscriptions SET status = 'cancelled', updated_at = now()
    WHERE payment_id = v_payment.id AND status = 'active';

    SELECT * INTO v_other_active
    FROM public.subscriptions
    WHERE user_id = v_payment.user_id AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at DESC NULLS FIRST LIMIT 1;

    IF FOUND THEN
      INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
      VALUES (v_payment.user_id, v_other_active.plan_id, v_other_active.expires_at);
      UPDATE public.profiles SET plan_id = v_other_active.plan_id,
        plan_expires_at = v_other_active.expires_at
      WHERE id = v_payment.user_id;
    ELSE
      UPDATE public.profiles SET plan_id = NULL, plan_expires_at = NULL
      WHERE id = v_payment.user_id;
    END IF;
  END IF;

  IF v_payment.user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_payment.user_id, 'payment', 'Payment refunded',
      'Your payment of ₹' || v_payment.amount::text || ' has been refunded.',
      CASE WHEN v_payment.kind = 'membership' THEN '/membership' ELSE NULL END
    );
  END IF;

  INSERT INTO public.activity_logs (actor_role, action, detail)
  VALUES ('system', 'payment.refunded_webhook',
    'Reconciled refunded Razorpay payment ' || p_razorpay_payment_id || ': ' || COALESCE(p_reason, 'refund'));

  RETURN jsonb_build_object('reconciled', true, 'already_refunded', false, 'payment_id', v_payment.id);
END;
$$;

REVOKE ALL ON FUNCTION public.service_reconcile_refunded_payment(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_reconcile_refunded_payment(text,text) TO service_role;

-- Keep the existing admin verification safeguards intact while recording verified_at.
CREATE OR REPLACE FUNCTION public.admin_verify_payment(p_payment_id uuid)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_payment public.payments%ROWTYPE;
  v_plan_price integer;
  v_start timestamptz := now();
  v_end timestamptz := now() + interval '1 month';
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Payment % not found.', p_payment_id; END IF;

  IF v_payment.status <> 'pending' THEN
    IF v_payment.status = 'verified' THEN RETURN v_payment; END IF;
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: Payment % is in status %, cannot verify.', p_payment_id, v_payment.status;
  END IF;

  IF v_payment.kind <> 'cash' THEN
    IF v_payment.razorpay_order_id IS NULL OR btrim(v_payment.razorpay_order_id) = ''
       OR v_payment.razorpay_order_id LIKE 'order_pending_%' THEN
      RAISE EXCEPTION 'GATEWAY_VERIFICATION_REQUIRED: Cannot manually verify a Razorpay payment without a real order ID.';
    END IF;
    IF v_payment.razorpay_payment_id IS NULL OR btrim(v_payment.razorpay_payment_id) = ''
       OR v_payment.razorpay_payment_id NOT LIKE 'pay_%' THEN
      RAISE EXCEPTION 'GATEWAY_VERIFICATION_REQUIRED: Cannot manually verify a Razorpay payment without a real payment ID.';
    END IF;
  END IF;

  IF v_payment.kind = 'membership' AND v_payment.plan_id IS NOT NULL THEN
    SELECT price INTO v_plan_price FROM public.membership_plans WHERE id = v_payment.plan_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'INVALID_PLAN: Membership plan % does not exist.', v_payment.plan_id; END IF;
    IF v_payment.amount IS DISTINCT FROM v_plan_price THEN
      RAISE EXCEPTION 'PAYMENT_AMOUNT_MISMATCH: Payment amount does not match the membership plan price.';
    END IF;
  END IF;

  UPDATE public.payments
     SET status = 'verified', verified_at = v_start, updated_at = v_start
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  IF v_payment.kind = 'membership' AND v_payment.plan_id IS NOT NULL AND v_payment.user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;
    PERFORM 1 FROM public.subscriptions
    WHERE user_id = v_payment.user_id AND status = 'active'
    FOR UPDATE;
    UPDATE public.subscriptions SET status = 'expired', updated_at = v_start
    WHERE user_id = v_payment.user_id AND status = 'active';

    INSERT INTO public.subscriptions (
      user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
    ) VALUES (
      v_payment.user_id, v_payment.plan_id, v_payment.id, 'active', v_start, v_end, true
    );

    -- Admins bypass protect_profile_fields(); no internal member intent is needed.
    UPDATE public.profiles SET plan_id = v_payment.plan_id, plan_expires_at = v_end
    WHERE id = v_payment.user_id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (v_payment.user_id, 'membership', 'Membership activated',
      'Your ' || v_payment.plan_id || ' membership is now active for 30 days.', '/membership');
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'payment.verify',
    'Verified payment ' || p_payment_id::text || ' (₹' || v_payment.amount::text || ')');

  RETURN v_payment;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_verify_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(uuid) TO authenticated;
