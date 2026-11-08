-- ============================================================================
-- DATEVRA Migration 022: Subscription Administration Operations & Lifecycle Integrity (Phase 7.3)
--
-- GOAL:
--   1. Implement public.admin_cancel_subscription(p_subscription_id uuid, p_reason text):
--      - Enforces auth.uid() authentication and public.is_admin() server-side.
--      - Locks the subscription row FOR UPDATE to prevent race conditions.
--      - Validates that the subscription is currently 'active'.
--      - Transitions status to 'cancelled' and reconciles the user's profile entitlements
--        (resets plan_id and plan_expires_at only if no other active subscription exists).
--      - Sends in-app member notification explaining cancellation and logs audit trail.
--   2. Implement public.admin_extend_subscription(p_subscription_id uuid, p_extension_days integer, p_reason text):
--      - Enforces auth.uid() authentication and public.is_admin() server-side.
--      - Validates that extension days is a positive integer (> 0).
--      - Locks the subscription row FOR UPDATE.
--      - Protects against extending cancelled, pending, or lifetime memberships.
--      - Extends expiration date from the later of (current expires_at, now()), reactivating
--        expired subscriptions safely without creating phantom payment records.
--      - Reconciles user profile entitlements, sends notification, and logs audit trail.
--   3. Strictly follows SECURITY DEFINER best practices with fixed search_path = public, pg_temp.
--   4. Execution revoked from PUBLIC/anon and granted only to authenticated users.
-- ============================================================================

-- Step 1: Administrator Subscription Cancellation RPC
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
  v_sub              public.subscriptions%ROWTYPE;
  v_has_other_active boolean := false;
BEGIN
  -- 1. Authentication check
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- 3. Lock subscription row for update
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Subscription % not found.', p_subscription_id;
  END IF;

  -- 4. Status validation
  IF v_sub.status <> 'active' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Only active subscriptions can be cancelled (current status: %).', v_sub.status;
  END IF;

  -- 5. Mark subscription cancelled
  UPDATE public.subscriptions
     SET status = 'cancelled',
         updated_at = now()
   WHERE id = p_subscription_id
  RETURNING * INTO v_sub;

  -- 6. Check if user holds any other active subscriptions
  SELECT EXISTS (
    SELECT 1
    FROM public.subscriptions
    WHERE user_id = v_sub.user_id
      AND id <> p_subscription_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) INTO v_has_other_active;

  -- 7. Reconcile user profile if no other active subscription exists
  IF NOT v_has_other_active THEN
    -- Authorize profile trigger intent
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'datevra_internal' AND table_name = 'plan_update_intents'
    ) THEN
      INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
      VALUES (v_sub.user_id, NULL, NULL)
      ON CONFLICT (user_id) DO UPDATE
        SET plan_id = EXCLUDED.plan_id,
            expires_at = EXCLUDED.expires_at;
    END IF;

    UPDATE public.profiles
       SET plan_id = NULL,
           plan_expires_at = NULL
     WHERE id = v_sub.user_id;
  END IF;

  -- 8. Member notification
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_sub.user_id,
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

  -- 9. Audit logging
  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'subscription.cancel',
    'Cancelled subscription ' || p_subscription_id::text || ' for user ' || v_sub.user_id::text ||
    CASE
      WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ': ' || trim(p_reason)
      ELSE ''
    END
  );

  RETURN v_sub;
END;
$$;

-- Step 2: Administrator Subscription Extension RPC
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

  -- 4. Lock subscription row for update
  SELECT * INTO v_sub
  FROM public.subscriptions
  WHERE id = p_subscription_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUBSCRIPTION_NOT_FOUND: Subscription % not found.', p_subscription_id;
  END IF;

  -- 5. Status and eligibility validations
  IF v_sub.status = 'cancelled' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Cancelled subscriptions cannot be extended.';
  END IF;

  IF v_sub.status = 'pending' THEN
    RAISE EXCEPTION 'INVALID_SUBSCRIPTION_STATUS: Pending subscriptions cannot be extended before activation.';
  END IF;

  IF v_sub.expires_at IS NULL THEN
    RAISE EXCEPTION 'LIFETIME_ACTIVE: Lifetime subscriptions do not have an expiration date to extend.';
  END IF;

  -- 6. Calculate new expiration (append to current expiry if future, or append to now() if expired)
  v_base_time := GREATEST(v_sub.expires_at, now());
  v_new_expires_at := v_base_time + (p_extension_days || ' days')::interval;

  -- 7. Update subscription record
  UPDATE public.subscriptions
     SET expires_at = v_new_expires_at,
         status = 'active',
         updated_at = now()
   WHERE id = p_subscription_id
  RETURNING * INTO v_sub;

  -- 8. Reconcile user profile plan and plan_expires_at
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'datevra_internal' AND table_name = 'plan_update_intents'
  ) THEN
    INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
    VALUES (v_sub.user_id, v_sub.plan_id, v_new_expires_at)
    ON CONFLICT (user_id) DO UPDATE
      SET plan_id = EXCLUDED.plan_id,
          expires_at = EXCLUDED.expires_at;
  END IF;

  UPDATE public.profiles
     SET plan_id = v_sub.plan_id,
         plan_expires_at = v_new_expires_at
   WHERE id = v_sub.user_id;

  -- 9. Member notification
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_sub.user_id,
    'membership',
    'Membership Extended',
    'Your ' || v_sub.plan_id || ' membership has been extended by ' || p_extension_days::text || ' days.' ||
    CASE
      WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ' (' || trim(p_reason) || ')'
      ELSE ''
    END,
    '/membership'
  );

  -- 10. Audit logging
  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'subscription.extend',
    'Extended subscription ' || p_subscription_id::text || ' by ' || p_extension_days::text || ' days for user ' || v_sub.user_id::text ||
    CASE
      WHEN p_reason IS NOT NULL AND trim(p_reason) <> '' THEN ': ' || trim(p_reason)
      ELSE ''
    END
  );

  RETURN v_sub;
END;
$$;

-- Step 3: Security & Permissions Hardening
REVOKE EXECUTE ON FUNCTION public.admin_cancel_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_subscription(uuid, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_extend_subscription(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_subscription(uuid, integer, text) TO authenticated;
