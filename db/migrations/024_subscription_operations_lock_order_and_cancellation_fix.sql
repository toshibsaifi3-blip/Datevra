-- ============================================================================
-- DATEVRA Migration 024: Subscription Lock-Order Hardening & Cancellation Fix (Phase 7.5)
--
-- GOAL:
--   1. Fix fatal NOT NULL constraint violation in public.admin_cancel_subscription():
--      Migration 022 attempted to insert (v_sub.user_id, NULL, NULL) into
--      datevra_internal.plan_update_intents, violating the plan_id NOT NULL constraint.
--      Because public.is_admin() satisfies protect_profile_fields(), administrative profile
--      updates do not require intent tokens. Remove this invalid insert.
--   2. Establish consistent hierarchical row-lock acquisition order:
--      Unify lock acquisition across all administrative payment and subscription RPCs to:
--        payments -> profiles -> subscriptions
--      In Migration 022, admin_cancel_subscription and admin_extend_subscription locked
--      subscriptions first, then updated profiles, creating a potential deadlock cycle
--      against admin_verify_payment and admin_refund_payment (which lock profiles first).
--      Both functions now query target user_id, lock public.profiles FOR UPDATE first,
--      then lock public.subscriptions FOR UPDATE.
--   3. Ensure pass-redeemed subscriptions trace to ledger payments:
--      Update public.redeem_membership_pass() to insert payment_id into public.subscriptions.
--   4. Strictly follow SECURITY DEFINER best practices with search_path = public, pg_temp.
--   5. Maintain restricted execution privileges: REVOKE from PUBLIC/anon, GRANT to authenticated.
-- ============================================================================

-- Step 1: Administrator Subscription Cancellation RPC (Hardened Lock-Order & No Null Plan Intent)
CREATE OR REPLACE FUNCTION public.admin_cancel_subscription(
  p_subscription_id uuid,
  p_reason          text DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id         uuid := auth.uid();
  v_target_user_id   uuid;
  v_sub              public.subscriptions%ROWTYPE;
  v_other_sub        public.subscriptions%ROWTYPE;
BEGIN
  -- 1. Authentication check
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- 3. Lookup target subscription's user_id without lock
  SELECT user_id INTO v_target_user_id
  FROM public.subscriptions
  WHERE id = p_subscription_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Subscription % not found.', p_subscription_id;
  END IF;

  -- 4. Hierarchical Lock Order: Lock member profile row FIRST
  PERFORM 1 FROM public.profiles
  WHERE id = v_target_user_id
  FOR UPDATE;

  -- 5. Hierarchical Lock Order: Lock subscription row SECOND
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  -- 6. Status validation
  IF v_sub.status <> 'active' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Only active subscriptions can be cancelled (current status: %).', v_sub.status;
  END IF;

  -- 7. Mark subscription cancelled
  UPDATE public.subscriptions
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = p_subscription_id
  RETURNING * INTO v_sub;

  -- 8. Check for any surviving active subscription
  SELECT * INTO v_other_sub
  FROM public.subscriptions
  WHERE user_id = v_target_user_id
    AND id <> p_subscription_id
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY expires_at DESC NULLS FIRST
  LIMIT 1;

  -- 9. Reconcile user profile entitlement
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

  -- 10. In-app Member Notification
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_target_user_id,
    'membership',
    'Subscription Cancelled',
    CASE
      WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN
        'Your subscription was cancelled: ' || trim(p_reason)
      ELSE
        'Your membership subscription has been cancelled by administration.'
    END,
    '/membership'
  );

  -- 11. Immutable Audit Logging
  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'subscription.cancel',
    'Cancelled subscription ' || p_subscription_id::text || ' for user ' || v_target_user_id::text ||
    CASE
      WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ': ' || trim(p_reason)
      ELSE ''
    END
  );

  RETURN v_sub;
END;
$$;

COMMENT ON FUNCTION public.admin_cancel_subscription(uuid, text) IS
  'Admin-only atomic cancellation RPC with hierarchical lock order (profiles -> subscriptions) and profile entitlement reconciliation.';

-- Step 2: Administrator Subscription Extension RPC (Hardened Lock-Order)
CREATE OR REPLACE FUNCTION public.admin_extend_subscription(
  p_subscription_id uuid,
  p_extension_days  integer,
  p_reason          text DEFAULT NULL
)
RETURNS public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id       uuid := auth.uid();
  v_target_user_id uuid;
  v_sub            public.subscriptions%ROWTYPE;
  v_base_time      timestamptz;
  v_new_expires_at timestamptz;
BEGIN
  -- 1. Authentication check
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- 3. Parameter validation
  IF p_extension_days IS NULL OR p_extension_days <= 0 THEN
    RAISE EXCEPTION 'INVALID_EXTENSION_DAYS: Extension duration must be a positive integer number of days.';
  END IF;

  -- 4. Lookup target subscription user_id without lock
  SELECT user_id INTO v_target_user_id
  FROM public.subscriptions
  WHERE id = p_subscription_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Subscription % not found.', p_subscription_id;
  END IF;

  -- 5. Hierarchical Lock Order: Lock member profile row FIRST
  PERFORM 1 FROM public.profiles
  WHERE id = v_target_user_id
  FOR UPDATE;

  -- 6. Hierarchical Lock Order: Lock subscription row SECOND
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  -- 7. Status and eligibility validations
  IF v_sub.status = 'cancelled' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Cancelled subscriptions cannot be extended.';
  END IF;

  IF v_sub.status = 'pending' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Pending subscriptions cannot be extended before activation.';
  END IF;

  IF v_sub.expires_at IS NULL THEN
    RAISE EXCEPTION 'LIFETIME_ACTIVE: Lifetime subscriptions do not have an expiration date to extend.';
  END IF;

  -- 8. Calculate new expiration (append to current expiry if future, or append to now() if expired)
  v_base_time := GREATEST(v_sub.expires_at, now());
  v_new_expires_at := v_base_time + (p_extension_days || ' days')::interval;

  -- 9. Update subscription record
  UPDATE public.subscriptions
     SET expires_at = v_new_expires_at,
         status = 'active',
         updated_at = now()
   WHERE id = p_subscription_id
  RETURNING * INTO v_sub;

  -- 10. Update member profile entitlement
  UPDATE public.profiles
     SET plan_id = v_sub.plan_id,
         plan_expires_at = v_new_expires_at
   WHERE id = v_target_user_id;

  -- 11. In-app Member notification
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_target_user_id,
    'membership',
    'Membership Extended',
    'Your ' || v_sub.plan_id || ' membership has been extended by ' || p_extension_days::text || ' days.' ||
    CASE
      WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ' (' || trim(p_reason) || ')'
      ELSE ''
    END,
    '/membership'
  );

  -- 12. Immutable Audit logging
  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'subscription.extend',
    'Extended subscription ' || p_subscription_id::text || ' by ' || p_extension_days::text || ' days for user ' || v_target_user_id::text ||
    CASE
      WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ': ' || trim(p_reason)
      ELSE ''
    END
  );

  RETURN v_sub;
END;
$$;

COMMENT ON FUNCTION public.admin_extend_subscription(uuid, integer, text) IS
  'Admin-only atomic extension RPC with hierarchical lock order (profiles -> subscriptions) and profile entitlement reconciliation.';

-- Step 3: Pass Redemption RPC Traceability Hardening (Links payment_id to subscription)
CREATE OR REPLACE FUNCTION public.redeem_membership_pass(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, datevra_internal, pg_temp
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
  -- 1. Enforce authenticated caller
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'You must be signed in to redeem a membership pass.'
    );
  END IF;

  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'MISSING_CODE',
      'message', 'A pass code is required.'
    );
  END IF;

  -- Normalize pass code format
  v_clean_code := upper(btrim(p_code));

  -- 2. Concurrency Guard 1: Lock caller's profile row first
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;

  -- 3. Rate-Limiting / Anti-Brute-Force Guard
  SELECT * INTO v_attempts
  FROM datevra_internal.pass_redemption_attempts
  WHERE user_id = v_uid
  FOR UPDATE;

  IF FOUND THEN
    IF v_attempts.window_start > (now() - interval '1 hour') AND v_attempts.failed_attempts >= 10 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'RATE_LIMITED',
        'message', 'Too many invalid attempts. Please try again in an hour.'
      );
    ELSIF v_attempts.window_start <= (now() - interval '1 hour') THEN
      UPDATE datevra_internal.pass_redemption_attempts
         SET failed_attempts = 0,
             window_start = now(),
             last_attempt_at = now()
       WHERE user_id = v_uid;
    END IF;
  ELSE
    INSERT INTO datevra_internal.pass_redemption_attempts (user_id, failed_attempts, window_start, last_attempt_at)
    VALUES (v_uid, 0, now(), now())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- 4. Concurrency Guard 2: Lock the pass row exclusively
  SELECT * INTO v_pass
  FROM public.membership_passes
  WHERE code = v_clean_code
  FOR UPDATE;

  -- 5. Validation
  IF NOT FOUND THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid membership pass code.'
    );
  END IF;

  IF v_pass.status = 'redeemed' THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_REDEEMED',
      'message', 'This membership pass has already been redeemed.'
    );
  END IF;

  IF v_pass.status = 'revoked' THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PASS_REVOKED',
      'message', 'This membership pass has been revoked.'
    );
  END IF;

  IF v_pass.status = 'expired' OR (v_pass.expires_at IS NOT NULL AND v_pass.expires_at < now()) THEN
    UPDATE public.membership_passes
       SET status = 'expired'
     WHERE id = v_pass.id;

    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'PASS_EXPIRED',
      'message', 'This membership pass has expired.'
    );
  END IF;

  IF v_pass.issued_to_user_id IS NOT NULL AND v_pass.issued_to_user_id <> v_uid THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ASSIGNED_TO_CALLER',
      'message', 'This membership pass was issued to a different account.'
    );
  END IF;

  -- 6. Subscription State & Downgrade / Lifetime Protection
  SELECT * INTO v_current_sub
  FROM public.subscriptions
  WHERE user_id = v_uid
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY
    CASE plan_id
      WHEN 'elite' THEN 3
      WHEN 'plus' THEN 2
      ELSE 1
    END DESC,
    (expires_at IS NULL) DESC,
    expires_at DESC NULLS LAST
  LIMIT 1;

  v_pass_priority := CASE v_pass.plan_id
                       WHEN 'elite' THEN 3
                       WHEN 'plus' THEN 2
                       ELSE 1
                     END;

  IF FOUND THEN
    v_sub_priority := CASE v_current_sub.plan_id
                        WHEN 'elite' THEN 3
                        WHEN 'plus' THEN 2
                        ELSE 1
                      END;

    IF v_current_sub.expires_at IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'LIFETIME_ACTIVE',
        'message', 'You currently hold an active lifetime ' || v_current_sub.plan_id || ' membership. Passes cannot be applied to lifetime memberships.'
      );
    END IF;

    IF v_pass_priority < v_sub_priority THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'DOWNGRADE_NOT_PERMITTED',
        'message', 'You currently have an active higher-tier membership (' || v_current_sub.plan_id || '). You cannot apply a lower-tier pass while it is active.'
      );
    END IF;

    IF v_current_sub.plan_id = v_pass.plan_id AND v_current_sub.expires_at IS NOT NULL THEN
      v_expires_at := v_current_sub.expires_at + (v_pass.duration_days || ' days')::interval;
    ELSE
      v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
    END IF;
  ELSE
    v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
  END IF;

  -- 7. Expire pre-existing active subscriptions
  UPDATE public.subscriptions
     SET status = 'expired'
   WHERE user_id = v_uid
     AND status = 'active';

  -- 8. Mark pass as redeemed
  UPDATE public.membership_passes
     SET status = 'redeemed',
         redeemed_at = now(),
         issued_to_user_id = COALESCE(issued_to_user_id, v_uid)
   WHERE id = v_pass.id;

  -- 9. Record ₹0 verified payment record for accounting and revenue tracking
  INSERT INTO public.payments (
    user_id, kind, amount, plan_id, status,
    razorpay_order_id, razorpay_payment_id, method
  ) VALUES (
    v_uid, 'membership', 0, v_pass.plan_id, 'verified',
    'pass_ord_' || v_pass.code, 'pass_pay_' || gen_random_uuid()::text, 'membership_pass'
  ) RETURNING id INTO v_payment_id;

  -- 10. Insert new active subscription with payment_id linked!
  INSERT INTO public.subscriptions (
    user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
  ) VALUES (
    v_uid, v_pass.plan_id, v_payment_id, 'active', v_start_at, v_expires_at, false
  ) RETURNING id INTO v_sub_id;

  -- 11. Register private authorization intent & update user profile
  INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
  VALUES (v_uid, v_pass.plan_id, v_expires_at)
  ON CONFLICT (user_id) DO UPDATE
    SET plan_id = EXCLUDED.plan_id,
        expires_at = EXCLUDED.expires_at;

  UPDATE public.profiles
     SET plan_id = v_pass.plan_id,
         plan_expires_at = v_expires_at
   WHERE id = v_uid;

  -- 12. Reset rate-limit attempt counter
  UPDATE datevra_internal.pass_redemption_attempts
     SET failed_attempts = 0,
         last_attempt_at = now()
   WHERE user_id = v_uid;

  -- 13. Send in-app notification
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_uid, 'membership', 'Membership pass activated',
    'Your ' || v_pass.plan_id || ' membership has been activated for ' || v_pass.duration_days || ' days.',
    '/membership'
  );

  -- 14. Audit logging
  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_uid, 'user', 'membership_pass.redeem',
    'Redeemed pass ' || v_pass.code || ' for plan ' || v_pass.plan_id || ' (' || v_pass.duration_days || ' days)'
  );

  -- 15. Return structured confirmation
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

COMMENT ON FUNCTION public.redeem_membership_pass(text) IS
  'Redeem a digital membership pass. Atomic double row lock, lifetime & downgrade protection, persisted rate-limiting, and single active subscription guarantee with payment_id traceability.';

-- Step 4: Security & Permissions
REVOKE ALL ON FUNCTION public.admin_cancel_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_subscription(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_extend_subscription(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_subscription(uuid, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.redeem_membership_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_membership_pass(text) TO authenticated;
