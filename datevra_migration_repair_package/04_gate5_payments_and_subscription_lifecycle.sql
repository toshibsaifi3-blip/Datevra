-- ============================================================================
-- DATEVRA REPAIR PACKAGE — GATE 5: Payment & Subscription Lifecycle Repairs
-- File: datevra_migration_repair_package/04_gate5_payments_and_subscription_lifecycle.sql
--
-- PURPOSE:
--   Safely replace Migrations 021 and 024 (and permanently bypass broken 022)
--   with hardened atomic payment/subscription operations:
--     1. Adds public.subscriptions.payment_id (nullable FK ON DELETE SET NULL)
--        and non-unique index idx_subscriptions_payment_id (supports extensions,
--        migrations, and multi-row history cleanly).
--     2. Installs fail-closed public.admin_verify_payment(uuid):
--        - NEVER fabricates fake 'pay_' || gen_random_uuid() gateway IDs.
--        - Rejects pending Razorpay payments lacking genuine gateway evidence
--          (real razorpay_payment_id LIKE 'pay_%' and non-placeholder order ID).
--        - Validates plan price matches payments.amount.
--        - Uses canonical lock order: payments -> profiles -> subscriptions.
--     3. Installs exact-linked public.admin_refund_payment(uuid, text):
--        - Ledger-only refund transition (does NOT call Razorpay Refund API).
--        - Eliminates dangerous fallback OR (user_id=... AND plan_id=...) sweep:
--          only cancels a subscription strictly linked via payment_id = p_payment_id.
--        - Handles anonymized payments (user_id IS NULL) cleanly.
--     4. Installs hardened public.admin_cancel_subscription(uuid, text) and
--        public.admin_extend_subscription(uuid, integer, text) with canonical
--        lock order (profiles -> subscriptions) and NO null plan_update_intents insert.
--     5. Upgrades public.redeem_membership_pass(text) to record subscriptions.payment_id.
--
-- PREREQUISITES:
--   - Gate 2 applied (subscriptions.auto_renew, created_at, updated_at; payments timestamps).
--   - Gate 4 applied (datevra_internal.plan_update_intents, membership_passes,
--     9-column protect_profile_fields trigger).
--
-- NOTE ON GATE 5B (ONLINE RAZORPAY EDGE FUNCTIONS — STILL BLOCKED):
--   supabase/functions/verify-payment/index.ts and razorpay-webhook/index.ts
--   currently write to a nonexistent payments.verified_at column, and
--   _shared/supabase.ts omits subscriptions.payment_id. Do NOT deploy live
--   Razorpay Edge Functions until that code/schema mismatch is resolved.
--
-- RERUN / TRANSACTION SAFETY:
--   Wrapped in BEGIN ... COMMIT. Uses canonical lock hierarchy:
--   payments -> profiles -> subscriptions -> (attempts -> membership_passes).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'auto_renew'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'created_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'GATE5_PRECONDITION_FAILED: subscriptions lacks auto_renew/created_at/updated_at. Run Gate 2 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'GATE5_PRECONDITION_FAILED: public.payments.updated_at is missing. Run Gate 2 first.';
  END IF;

  IF to_regclass('datevra_internal.plan_update_intents') IS NULL
     OR to_regclass('public.membership_passes') IS NULL THEN
    RAISE EXCEPTION 'GATE5_PRECONDITION_FAILED: Gate 4 objects (datevra_internal / membership_passes) missing. Run Gate 4 first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Link public.subscriptions.payment_id -> public.payments(id)
--    (Non-unique index: multiple subscription lifecycle rows may reference a
--     payment or remain NULL for legacy/manual rows.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_id
  ON public.subscriptions (payment_id);

-- ----------------------------------------------------------------------------
-- 2. Fail-Closed Administrator Payment Verification RPC
--    NEVER fabricates mock pay_ IDs or activates unpaid pending orders.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_verify_payment(
  p_payment_id uuid
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := auth.uid();
  v_payment    public.payments%ROWTYPE;
  v_plan_price integer;
  v_start      timestamptz := now();
  v_end        timestamptz := now() + interval '1 month';
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- Canonical Lock Order Step 1: Lock payment row
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

  -- Reject verification if payment lacks authentic Razorpay gateway evidence
  IF v_payment.kind <> 'cash' THEN
    IF v_payment.razorpay_order_id IS NULL
       OR pg_catalog.btrim(v_payment.razorpay_order_id) = ''
       OR v_payment.razorpay_order_id LIKE 'order_pending_%' THEN
      RAISE EXCEPTION 'GATEWAY_VERIFICATION_REQUIRED: Payment % has placeholder or missing razorpay_order_id (%). Cannot verify without a real Razorpay order and capture.',
        p_payment_id, COALESCE(v_payment.razorpay_order_id, 'NULL');
    END IF;

    IF v_payment.razorpay_payment_id IS NULL
       OR pg_catalog.btrim(v_payment.razorpay_payment_id) = ''
       OR v_payment.razorpay_payment_id NOT LIKE 'pay_%' THEN
      RAISE EXCEPTION 'GATEWAY_VERIFICATION_REQUIRED: Payment % lacks a verified Razorpay payment ID (razorpay_payment_id). Gate 5 prohibits fabricating gateway IDs or granting unpaid entitlements.',
        p_payment_id;
    END IF;
  END IF;

  -- Validate membership amount against authoritative membership_plans price
  IF v_payment.kind = 'membership' AND v_payment.plan_id IS NOT NULL THEN
    SELECT price INTO v_plan_price
    FROM public.membership_plans
    WHERE id = v_payment.plan_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INVALID_PLAN: Membership plan % not found.', v_payment.plan_id;
    END IF;
    IF v_payment.amount <> v_plan_price THEN
      RAISE EXCEPTION 'AMOUNT_MISMATCH: Payment % amount (₹%) does not match plan % price (₹%).',
        p_payment_id, v_payment.amount, v_payment.plan_id, v_plan_price;
    END IF;
  END IF;

  UPDATE public.payments
     SET status = 'verified',
         updated_at = now()
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  IF v_payment.kind = 'membership' AND v_payment.plan_id IS NOT NULL AND v_payment.user_id IS NOT NULL THEN
    -- Canonical Lock Order Step 2: Lock profile row
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

    -- Canonical Lock Order Step 3: Lock active subscription rows before expiring
    PERFORM 1 FROM public.subscriptions
    WHERE user_id = v_payment.user_id AND status = 'active'
    FOR UPDATE;

    UPDATE public.subscriptions
       SET status = 'expired',
           updated_at = now()
     WHERE user_id = v_payment.user_id
       AND status = 'active';

    INSERT INTO public.subscriptions (
      user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
    ) VALUES (
      v_payment.user_id, v_payment.plan_id, p_payment_id, 'active', v_start, v_end, true
    );

    UPDATE public.profiles
       SET plan_id = v_payment.plan_id,
           plan_expires_at = v_end
     WHERE id = v_payment.user_id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_payment.user_id, 'membership', 'Membership activated',
      'Your ' || v_payment.plan_id || ' plan is now active. Enjoy priority matchmaking.',
      '/membership'
    );
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'payment.verify',
    'Verified payment ' || p_payment_id || ' (₹' || v_payment.amount || ', gateway_ref=' || COALESCE(v_payment.razorpay_payment_id, 'cash') || ')'
  );

  RETURN v_payment;
END;
$$;

COMMENT ON FUNCTION public.admin_verify_payment(uuid) IS
  'Fail-closed payment verification RPC requiring genuine Razorpay order & payment IDs. Prohibits mock ID fabrication.';

REVOKE ALL ON FUNCTION public.admin_verify_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Exact-Linked Administrator Payment Refund Reconciliation RPC (Ledger Only)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_refund_payment(
  p_payment_id uuid,
  p_reason     text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id    uuid := auth.uid();
  v_payment     public.payments%ROWTYPE;
  v_sub         public.subscriptions%ROWTYPE;
  v_other_sub   public.subscriptions%ROWTYPE;
  v_has_newer   boolean := false;
  v_sub_revoked boolean := false;
  v_clean_reason text := COALESCE(pg_catalog.btrim(p_reason), '');
  v_detail      text;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- Canonical Lock Order Step 1: Lock payment row
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Payment % not found.', p_payment_id;
  END IF;
  IF v_payment.status = 'refunded' THEN
    RAISE EXCEPTION 'ALREADY_REFUNDED: Payment % has already been refunded.', p_payment_id;
  END IF;
  IF v_payment.status <> 'verified' THEN
    RAISE EXCEPTION 'INVALID_REFUND_STATUS: Only verified payments can be refunded (current: %).', v_payment.status;
  END IF;

  -- Ledger status transition only (does NOT invoke external Razorpay Refund API)
  UPDATE public.payments
     SET status = 'refunded',
         updated_at = now()
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  IF v_payment.kind = 'membership' AND v_payment.user_id IS NOT NULL THEN
    -- Canonical Lock Order Step 2: Lock profile row
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

    -- Canonical Lock Order Step 3: Lock ONLY subscriptions strictly linked via payment_id
    SELECT * INTO v_sub
    FROM public.subscriptions
    WHERE payment_id = p_payment_id
      AND user_id = v_payment.user_id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_sub.id IS NOT NULL AND v_sub.status = 'active' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE user_id = v_payment.user_id
          AND kind = 'membership'
          AND status = 'verified'
          AND created_at > v_payment.created_at
      ) INTO v_has_newer;

      IF NOT v_has_newer THEN
        UPDATE public.subscriptions
           SET status = 'cancelled',
               updated_at = now()
         WHERE id = v_sub.id;
        v_sub_revoked := true;

        SELECT * INTO v_other_sub
        FROM public.subscriptions
        WHERE user_id = v_payment.user_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY expires_at DESC NULLS FIRST
        LIMIT 1
        FOR UPDATE;

        IF v_other_sub.id IS NOT NULL THEN
          UPDATE public.profiles
             SET plan_id = v_other_sub.plan_id,
                 plan_expires_at = v_other_sub.expires_at
           WHERE id = v_payment.user_id;
        ELSE
          UPDATE public.profiles
             SET plan_id = NULL,
                 plan_expires_at = NULL
           WHERE id = v_payment.user_id;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_payment.user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_payment.user_id, 'payment', 'Payment Refunded',
      'Your payment of ₹' || v_payment.amount || ' has been recorded as refunded in the ledger.' ||
        CASE WHEN v_sub_revoked THEN ' Associated membership privileges have been revoked.' ELSE '' END,
      '/membership'
    );
  END IF;

  v_detail := 'Refunded payment ' || p_payment_id || ' (₹' || v_payment.amount || ', ledger-only)' ||
              CASE
                WHEN v_sub_revoked THEN ' [linked subscription cancelled]'
                WHEN v_payment.kind = 'membership' THEN ' [no linked active subscription revoked]'
                ELSE ''
              END ||
              CASE WHEN v_clean_reason <> '' THEN ' — ' || v_clean_reason ELSE '' END;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'payment.refund', v_detail);

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment.id,
    'amount', v_payment.amount,
    'subscription_revoked', v_sub_revoked
  );
END;
$$;

COMMENT ON FUNCTION public.admin_refund_payment(uuid, text) IS
  'Ledger-only refund reconciliation RPC. Only cancels subscriptions strictly linked via subscriptions.payment_id.';

REVOKE ALL ON FUNCTION public.admin_refund_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_payment(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Administrator Subscription Cancellation & Extension RPCs (from 024)
--    Canonical Lock Order: profiles -> subscriptions
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_cancel_subscription(
  p_subscription_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id       uuid := auth.uid();
  v_target_user_id uuid;
  v_sub            public.subscriptions%ROWTYPE;
  v_other_sub      public.subscriptions%ROWTYPE;
  v_clean_reason   text := NULLIF(pg_catalog.btrim(p_reason), '');
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM public.subscriptions
  WHERE id = p_subscription_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Subscription % not found.', p_subscription_id;
  END IF;

  -- Canonical Lock Order Step 2: Lock member profile FIRST
  IF v_target_user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_target_user_id FOR UPDATE;
  END IF;

  -- Canonical Lock Order Step 3: Lock subscription row SECOND
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF v_sub.status <> 'active' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Only active subscriptions can be cancelled (current status: %).', v_sub.status;
  END IF;

  UPDATE public.subscriptions
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = p_subscription_id
  RETURNING * INTO v_sub;

  IF v_target_user_id IS NOT NULL THEN
    SELECT * INTO v_other_sub
    FROM public.subscriptions
    WHERE user_id = v_target_user_id
      AND id <> p_subscription_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY expires_at DESC NULLS FIRST
    LIMIT 1
    FOR UPDATE;

    IF v_other_sub.id IS NOT NULL THEN
      UPDATE public.profiles
         SET plan_id = v_other_sub.plan_id,
             plan_expires_at = v_other_sub.expires_at
       WHERE id = v_target_user_id;
    ELSE
      UPDATE public.profiles
         SET plan_id = NULL,
             plan_expires_at = NULL
       WHERE id = v_target_user_id;
    END IF;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_target_user_id, 'membership', 'Subscription Cancelled',
      CASE
        WHEN v_clean_reason IS NOT NULL THEN 'Your subscription was cancelled: ' || v_clean_reason
        ELSE 'Your membership subscription has been cancelled by administration.'
      END,
      '/membership'
    );
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'subscription.cancel',
    'Cancelled subscription ' || p_subscription_id::text || ' for user ' || COALESCE(v_target_user_id::text, 'deleted_user') ||
    CASE WHEN v_clean_reason IS NOT NULL THEN ': ' || v_clean_reason ELSE '' END
  );

  RETURN v_sub;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_subscription(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_extend_subscription(
  p_subscription_id uuid,
  p_extension_days  integer,
  p_reason          text DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id       uuid := auth.uid();
  v_target_user_id uuid;
  v_sub            public.subscriptions%ROWTYPE;
  v_base_time      timestamptz;
  v_new_expires_at timestamptz;
  v_clean_reason   text := NULLIF(pg_catalog.btrim(p_reason), '');
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;
  IF p_extension_days IS NULL OR p_extension_days <= 0 THEN
    RAISE EXCEPTION 'INVALID_EXTENSION_DAYS: Extension duration must be a positive integer number of days.';
  END IF;

  SELECT user_id INTO v_target_user_id
  FROM public.subscriptions
  WHERE id = p_subscription_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Subscription % not found.', p_subscription_id;
  END IF;

  -- Canonical Lock Order Step 2: Lock member profile FIRST
  IF v_target_user_id IS NOT NULL THEN
    PERFORM 1 FROM public.profiles WHERE id = v_target_user_id FOR UPDATE;
  END IF;

  -- Canonical Lock Order Step 3: Lock subscription SECOND
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF v_sub.status = 'cancelled' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Cancelled subscriptions cannot be extended.';
  END IF;
  IF v_sub.status = 'pending' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Pending subscriptions cannot be extended before activation.';
  END IF;
  IF v_sub.expires_at IS NULL THEN
    RAISE EXCEPTION 'LIFETIME_ACTIVE: Lifetime subscriptions do not have an expiration date to extend.';
  END IF;

  v_base_time := GREATEST(v_sub.expires_at, now());
  v_new_expires_at := v_base_time + (p_extension_days || ' days')::interval;

  UPDATE public.subscriptions
     SET expires_at = v_new_expires_at,
         status = 'active',
         updated_at = now()
   WHERE id = p_subscription_id
  RETURNING * INTO v_sub;

  IF v_target_user_id IS NOT NULL THEN
    UPDATE public.profiles
       SET plan_id = v_sub.plan_id,
           plan_expires_at = v_new_expires_at
     WHERE id = v_target_user_id;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      v_target_user_id, 'membership', 'Membership Extended',
      'Your ' || v_sub.plan_id || ' membership has been extended by ' || p_extension_days::text || ' days.' ||
      CASE WHEN v_clean_reason IS NOT NULL THEN ' (' || v_clean_reason || ')' ELSE '' END,
      '/membership'
    );
  END IF;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'subscription.extend',
    'Extended subscription ' || p_subscription_id::text || ' by ' || p_extension_days::text || ' days for user ' || COALESCE(v_target_user_id::text, 'deleted_user') ||
    CASE WHEN v_clean_reason IS NOT NULL THEN ': ' || v_clean_reason ELSE '' END
  );

  RETURN v_sub;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_extend_subscription(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_subscription(uuid, integer, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Upgrade redeem_membership_pass() to Populate subscriptions.payment_id
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_membership_pass(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_clean_code    text;
  v_pass          public.membership_passes%ROWTYPE;
  v_current_sub   public.subscriptions%ROWTYPE;
  v_sub_priority  integer := 0;
  v_pass_priority integer := 0;
  v_attempts      datevra_internal.pass_redemption_attempts%ROWTYPE;
  v_start_at      timestamptz := now();
  v_expires_at    timestamptz;
  v_payment_id    uuid;
  v_sub_id        uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'UNAUTHORIZED', 'message', 'You must be signed in to redeem a membership pass.');
  END IF;
  IF p_code IS NULL OR pg_catalog.btrim(p_code) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'MISSING_CODE', 'message', 'A pass code is required.');
  END IF;

  v_clean_code := upper(pg_catalog.btrim(p_code));

  -- Canonical Lock Order: profiles -> subscriptions -> attempts -> membership_passes
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;

  SELECT * INTO v_current_sub
  FROM public.subscriptions
  WHERE user_id = v_uid
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY
    CASE plan_id WHEN 'elite' THEN 3 WHEN 'plus' THEN 2 ELSE 1 END DESC,
    (expires_at IS NULL) DESC,
    expires_at DESC NULLS LAST
  LIMIT 1
  FOR UPDATE;

  SELECT * INTO v_attempts
  FROM datevra_internal.pass_redemption_attempts
  WHERE user_id = v_uid
  FOR UPDATE;

  IF FOUND THEN
    IF v_attempts.window_start > (now() - interval '1 hour') AND v_attempts.failed_attempts >= 10 THEN
      RETURN jsonb_build_object('success', false, 'error', 'RATE_LIMITED', 'message', 'Too many invalid attempts. Please try again in an hour.');
    ELSIF v_attempts.window_start <= (now() - interval '1 hour') THEN
      UPDATE datevra_internal.pass_redemption_attempts
         SET failed_attempts = 0, window_start = now(), last_attempt_at = now()
       WHERE user_id = v_uid;
    END IF;
  ELSE
    INSERT INTO datevra_internal.pass_redemption_attempts (user_id, failed_attempts, window_start, last_attempt_at)
    VALUES (v_uid, 0, now(), now())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  SELECT * INTO v_pass
  FROM public.membership_passes
  WHERE code = v_clean_code
  FOR UPDATE;

  IF NOT FOUND THEN
    UPDATE datevra_internal.pass_redemption_attempts SET failed_attempts = failed_attempts + 1, last_attempt_at = now() WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'INVALID_CODE', 'message', 'Invalid membership pass code.');
  END IF;

  IF v_pass.status = 'redeemed' THEN
    UPDATE datevra_internal.pass_redemption_attempts SET failed_attempts = failed_attempts + 1, last_attempt_at = now() WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'ALREADY_REDEEMED', 'message', 'This membership pass has already been redeemed.');
  END IF;

  IF v_pass.status = 'revoked' THEN
    UPDATE datevra_internal.pass_redemption_attempts SET failed_attempts = failed_attempts + 1, last_attempt_at = now() WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'PASS_REVOKED', 'message', 'This membership pass has been revoked.');
  END IF;

  IF v_pass.status = 'expired' OR (v_pass.expires_at IS NOT NULL AND v_pass.expires_at < now()) THEN
    UPDATE public.membership_passes SET status = 'expired' WHERE id = v_pass.id;
    UPDATE datevra_internal.pass_redemption_attempts SET failed_attempts = failed_attempts + 1, last_attempt_at = now() WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'PASS_EXPIRED', 'message', 'This membership pass has expired.');
  END IF;

  IF v_pass.issued_to_user_id IS NOT NULL AND v_pass.issued_to_user_id <> v_uid THEN
    UPDATE datevra_internal.pass_redemption_attempts SET failed_attempts = failed_attempts + 1, last_attempt_at = now() WHERE user_id = v_uid;
    RETURN jsonb_build_object('success', false, 'error', 'NOT_ASSIGNED_TO_CALLER', 'message', 'This membership pass was issued to a different account.');
  END IF;

  v_pass_priority := CASE v_pass.plan_id WHEN 'elite' THEN 3 WHEN 'plus' THEN 2 ELSE 1 END;

  IF v_current_sub.id IS NOT NULL THEN
    v_sub_priority := CASE v_current_sub.plan_id WHEN 'elite' THEN 3 WHEN 'plus' THEN 2 ELSE 1 END;
    IF v_current_sub.expires_at IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'LIFETIME_ACTIVE', 'message', 'You currently hold an active lifetime ' || v_current_sub.plan_id || ' membership. Passes cannot be applied to lifetime memberships.');
    END IF;
    IF v_pass_priority < v_sub_priority THEN
      RETURN jsonb_build_object('success', false, 'error', 'DOWNGRADE_NOT_PERMITTED', 'message', 'You currently have an active higher-tier membership (' || v_current_sub.plan_id || '). You cannot apply a lower-tier pass while it is active.');
    END IF;
    IF v_current_sub.plan_id = v_pass.plan_id THEN
      v_expires_at := v_current_sub.expires_at + (v_pass.duration_days || ' days')::interval;
    ELSE
      v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
    END IF;
  ELSE
    v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
  END IF;

  UPDATE public.subscriptions SET status = 'expired', updated_at = now() WHERE user_id = v_uid AND status = 'active';

  UPDATE public.membership_passes
     SET status = 'redeemed', redeemed_at = now(), issued_to_user_id = COALESCE(issued_to_user_id, v_uid)
   WHERE id = v_pass.id;

  INSERT INTO public.payments (
    user_id, kind, amount, plan_id, status, razorpay_order_id, razorpay_payment_id, method
  ) VALUES (
    v_uid, 'membership', 0, v_pass.plan_id, 'verified',
    'pass_ord_' || v_pass.code, 'pass_pay_' || gen_random_uuid()::text, 'membership_pass'
  ) RETURNING id INTO v_payment_id;

  INSERT INTO public.subscriptions (
    user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
  ) VALUES (
    v_uid, v_pass.plan_id, v_payment_id, 'active', v_start_at, v_expires_at, false
  ) RETURNING id INTO v_sub_id;

  INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at, created_at)
  VALUES (v_uid, v_pass.plan_id, v_expires_at, now())
  ON CONFLICT (user_id) DO UPDATE
    SET plan_id = EXCLUDED.plan_id,
        expires_at = EXCLUDED.expires_at,
        created_at = now();

  UPDATE public.profiles
     SET plan_id = v_pass.plan_id,
         plan_expires_at = v_expires_at
   WHERE id = v_uid;

  UPDATE datevra_internal.pass_redemption_attempts
     SET failed_attempts = 0, last_attempt_at = now()
   WHERE user_id = v_uid;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_uid, 'membership', 'Membership pass activated',
    'Your ' || v_pass.plan_id || ' membership has been activated for ' || v_pass.duration_days || ' days.',
    '/membership'
  );

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_uid, 'user', 'membership_pass.redeem',
    'Redeemed pass ' || v_pass.code || ' for plan ' || v_pass.plan_id || ' (' || v_pass.duration_days || ' days)'
  );

  RETURN jsonb_build_object(
    'success', true,
    'code', v_pass.code,
    'plan_id', v_pass.plan_id,
    'duration_days', v_pass.duration_days,
    'expires_at', v_expires_at,
    'payment_id', v_payment_id,
    'subscription_id', v_sub_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_membership_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_membership_pass(text) TO authenticated;

COMMIT;
