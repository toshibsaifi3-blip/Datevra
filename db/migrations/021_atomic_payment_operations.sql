-- ============================================================================
-- DATEVRA Migration 021: Atomic Payment Verification, Refund Reconciliation & Entitlement Integrity (Phase 7.2)
--
-- GOAL:
--   1. Add payment_id column to public.subscriptions to establish a 1:1 trace
--      between a financial transaction and the membership entitlement it created.
--   2. Implement public.admin_verify_payment(p_payment_id uuid):
--      - Single-transaction atomic verification replacing the 5-step client cascade.
--      - Enforces auth.uid() authentication and public.is_admin() server-side.
--      - Locks the payment and profile rows FOR UPDATE.
--      - Optimistically transitions status from 'pending' to 'verified'.
--      - Expires previous active subscriptions and provisions new subscription linked to payment_id.
--      - Updates profile plan_id/expires_at, inserts notification, and logs activity in one commit.
--   3. Implement public.admin_refund_payment(p_payment_id uuid, p_reason text):
--      - Validates administrator authorization server-side.
--      - Validates payment status is 'verified' (rejecting duplicate refunds, pending, or failed payments).
--      - Locks payment row FOR UPDATE and transitions status to 'refunded'.
--      - Reconciles subscription entitlement: identifies the linked subscription,
--        and if still active and not superseded by a newer verified payment, marks it 'cancelled'.
--      - Resets profile plan_id/plan_expires_at only if no other active subscription exists.
--      - Records activity_logs audit event and sends in-app notification.
--   4. Strictly follows SECURITY DEFINER best practices with fixed search_path = public, pg_temp.
--   5. Execution revoked from PUBLIC/anon and granted only to authenticated admins.
-- ============================================================================

-- Step 1: Add payment_id trace column to subscriptions table
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_subscriptions_payment_id
  ON public.subscriptions (payment_id);

-- Step 2: Atomic Administrator Payment Verification RPC
CREATE OR REPLACE FUNCTION public.admin_verify_payment(
  p_payment_id uuid
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_payment  public.payments%ROWTYPE;
  v_start    timestamptz := now();
  v_end      timestamptz := now() + interval '1 month';
  v_pay_id   text;
BEGIN
  -- 1. Authentication check
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- 3. Lock payment row to serialize concurrent verifications
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Payment % not found.', p_payment_id;
  END IF;

  -- 4. Guard against re-verifying non-pending payments
  IF v_payment.status <> 'pending' THEN
    -- If already verified, return current state idempotently
    IF v_payment.status = 'verified' THEN
      RETURN v_payment;
    END IF;
    RAISE EXCEPTION 'INVALID_PAYMENT_STATUS: Payment % is in status %, cannot verify.', p_payment_id, v_payment.status;
  END IF;

  -- 5. Generate mock gateway reference if not present
  v_pay_id := COALESCE(v_payment.razorpay_payment_id, 'pay_' || replace(gen_random_uuid()::text, '-', ''));

  -- 6. Update payment status to verified
  UPDATE public.payments
     SET status = 'verified',
         razorpay_payment_id = v_pay_id,
         updated_at = now()
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  -- 7. Provision membership if payment kind is 'membership'
  IF v_payment.kind = 'membership' AND v_payment.plan_id IS NOT NULL THEN
    -- Lock profile row
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

    -- Expire previous active subscriptions
    UPDATE public.subscriptions
       SET status = 'expired',
           updated_at = now()
     WHERE user_id = v_payment.user_id
       AND status = 'active';

    -- Insert new active subscription linked with payment_id
    INSERT INTO public.subscriptions (
      user_id,
      plan_id,
      payment_id,
      status,
      started_at,
      expires_at,
      auto_renew
    ) VALUES (
      v_payment.user_id,
      v_payment.plan_id,
      p_payment_id,
      'active',
      v_start,
      v_end,
      true
    );

    -- Update member profile
    UPDATE public.profiles
       SET plan_id = v_payment.plan_id,
           plan_expires_at = v_end
     WHERE id = v_payment.user_id;

    -- Send in-app notification
    INSERT INTO public.notifications (
      user_id,
      kind,
      title,
      body,
      link
    ) VALUES (
      v_payment.user_id,
      'membership',
      'Membership activated',
      'Your ' || v_payment.plan_id || ' plan is now active. Enjoy priority matchmaking.',
      '/membership'
    );
  END IF;

  -- 8. Record audit log event
  INSERT INTO public.activity_logs (
    actor_id,
    actor_role,
    action,
    detail
  ) VALUES (
    v_admin_id,
    'admin',
    'payment.verify',
    'Verified payment ' || p_payment_id || ' (₹' || v_payment.amount || ')'
  );

  RETURN v_payment;
END;
$$;

-- Step 3: Atomic Administrator Payment Refund & Entitlement Reconciliation RPC
CREATE OR REPLACE FUNCTION public.admin_refund_payment(
  p_payment_id uuid,
  p_reason     text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id         uuid := auth.uid();
  v_payment          public.payments%ROWTYPE;
  v_sub              public.subscriptions%ROWTYPE;
  v_other_sub        public.subscriptions%ROWTYPE;
  v_has_newer        boolean := false;
  v_sub_revoked      boolean := false;
  v_detail           text;
BEGIN
  -- 1. Authentication check
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- 3. Lock payment row to prevent concurrent refund mutations
  SELECT * INTO v_payment
  FROM public.payments
  WHERE id = p_payment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_FOUND: Payment % not found.', p_payment_id;
  END IF;

  -- 4. Status eligibility check
  IF v_payment.status = 'refunded' THEN
    RAISE EXCEPTION 'ALREADY_REFUNDED: Payment % has already been refunded.', p_payment_id;
  END IF;

  IF v_payment.status <> 'verified' THEN
    RAISE EXCEPTION 'INVALID_REFUND_STATUS: Only verified payments can be refunded (current: %).', v_payment.status;
  END IF;

  -- 5. Mark payment as refunded in the ledger
  UPDATE public.payments
     SET status = 'refunded',
         updated_at = now()
   WHERE id = p_payment_id
  RETURNING * INTO v_payment;

  -- 6. Subscription Entitlement Reconciliation
  IF v_payment.kind = 'membership' THEN
    -- Lock profile row
    PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;

    -- Find the subscription linked to this payment
    SELECT * INTO v_sub
    FROM public.subscriptions
    WHERE (payment_id = p_payment_id OR (user_id = v_payment.user_id AND plan_id = v_payment.plan_id AND status = 'active'))
      AND user_id = v_payment.user_id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    -- If this subscription is currently active, verify it is not superseded by a newer verified payment
    IF v_sub.id IS NOT NULL AND v_sub.status = 'active' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.payments
        WHERE user_id = v_payment.user_id
          AND kind = 'membership'
          AND status = 'verified'
          AND created_at > v_payment.created_at
      ) INTO v_has_newer;

      IF NOT v_has_newer THEN
        -- Safely cancel the subscription funded by this refunded payment
        UPDATE public.subscriptions
           SET status = 'cancelled',
               updated_at = now()
         WHERE id = v_sub.id;
        v_sub_revoked := true;

        -- Check if user has ANY other valid active subscription
        SELECT * INTO v_other_sub
        FROM public.subscriptions
        WHERE user_id = v_payment.user_id
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > now())
        ORDER BY expires_at DESC NULLS FIRST
        LIMIT 1;

        IF v_other_sub.id IS NOT NULL THEN
          UPDATE public.profiles
             SET plan_id = v_other_sub.plan_id,
                 plan_expires_at = v_other_sub.expires_at
           WHERE id = v_payment.user_id;
        ELSE
          UPDATE public.profiles
             SET plan_id = null,
                 plan_expires_at = null
           WHERE id = v_payment.user_id;
        END IF;
      END IF;
    END IF;
  END IF;

  -- 7. Send in-app notification to member
  INSERT INTO public.notifications (
    user_id,
    kind,
    title,
    body,
    link
  ) VALUES (
    v_payment.user_id,
    'payment',
    'Payment Refunded',
    'Your payment of ₹' || v_payment.amount || ' has been recorded as refunded in the ledger.' ||
      CASE WHEN v_sub_revoked THEN ' Associated membership privileges have been revoked.' ELSE '' END,
    '/membership'
  );

  -- 8. Audit logging
  v_detail := 'Refunded payment ' || p_payment_id || ' (₹' || v_payment.amount || ')' ||
              CASE WHEN v_sub_revoked THEN ' [membership subscription cancelled]' ELSE '' END ||
              CASE WHEN p_reason <> '' THEN ' — ' || p_reason ELSE '' END;

  INSERT INTO public.activity_logs (
    actor_id,
    actor_role,
    action,
    detail
  ) VALUES (
    v_admin_id,
    'admin',
    'payment.refund',
    v_detail
  );

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment.id,
    'amount', v_payment.amount,
    'subscription_revoked', v_sub_revoked
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.admin_verify_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_refund_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_payment(uuid, text) TO authenticated;
