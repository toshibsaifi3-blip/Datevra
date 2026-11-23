-- ============================================================================
-- DATEVRA Migration 031: Membership Pass Revocation Fields & Verified
-- Membership Purchase Celebration Idempotency
--
-- Requirements covered:
--   - Requirement 6: Reconcile missing revoked_at / revocation_reason columns
--     on public.membership_passes (already expected by frontend mappers/types)
--     and update revoke_membership_pass() to persist them cleanly.
--   - Requirement 7: Persist celebration_shown_at on public.payments + member
--     RPC acknowledge_membership_celebration() so the full-screen membership
--     purchase celebration triggers ONLY for verified membership payments and
--     never repeats on page refresh.
--
-- Non-destructive & idempotent.
-- ============================================================================

-- 1. Membership Pass Revocation Metadata Columns (Requirement 6)
ALTER TABLE public.membership_passes
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

COMMENT ON COLUMN public.membership_passes.revoked_at IS
  'Timestamp when an administrator revoked this membership pass.';
COMMENT ON COLUMN public.membership_passes.revocation_reason IS
  'Optional administrator reason recorded at pass revocation.';

CREATE OR REPLACE FUNCTION public.revoke_membership_pass(
  p_pass_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS public.membership_passes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_pass     public.membership_passes%ROWTYPE;
  v_reason   text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  SELECT * INTO v_pass
  FROM public.membership_passes
  WHERE id = p_pass_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PASS_NOT_FOUND: Membership pass not found.';
  END IF;

  IF v_pass.status <> 'active' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Only active passes may be revoked. Current status: %', v_pass.status;
  END IF;

  UPDATE public.membership_passes
     SET status = 'revoked',
         revoked_at = now(),
         revocation_reason = v_reason,
         updated_at = now()
   WHERE id = p_pass_id
  RETURNING * INTO v_pass;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id,
    'admin',
    'membership_pass.revoke',
    'Revoked membership pass ' || v_pass.code || COALESCE(' (' || v_reason || ')', '')
  );

  RETURN v_pass;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_membership_pass(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_membership_pass(uuid, text) TO authenticated;

-- 2. Verified Membership Celebration Idempotency (Requirement 7)
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS celebration_shown_at timestamptz;

COMMENT ON COLUMN public.payments.celebration_shown_at IS
  'Timestamp when the full-screen verified membership purchase celebration was shown to the member. Prevents replaying on refresh.';

CREATE OR REPLACE FUNCTION public.acknowledge_membership_celebration(
  p_payment_id uuid
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_shown timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  UPDATE public.payments
     SET celebration_shown_at = COALESCE(celebration_shown_at, now())
   WHERE id = p_payment_id
     AND user_id = v_uid
     AND kind = 'membership'
     AND status = 'verified'
  RETURNING celebration_shown_at INTO v_shown;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PAYMENT_NOT_ELIGIBLE: Verified membership payment not found for caller.';
  END IF;

  RETURN v_shown;
END;
$$;

REVOKE ALL ON FUNCTION public.acknowledge_membership_celebration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.acknowledge_membership_celebration(uuid) TO authenticated;
