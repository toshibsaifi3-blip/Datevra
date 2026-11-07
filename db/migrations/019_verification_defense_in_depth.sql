-- ============================================================================
-- DATEVRA Migration 019: Verification Defense-in-Depth Corrections (Phase 6.3)
--
-- Primary Goals:
--   1. Database-Level Status Consistency:
--      Enforces a table-level CHECK constraint on public.profiles ensuring that:
--        - verified = true strictly requires verification_status = 'verified'
--        - verified = false strictly permits only verification_status IN ('pending', 'declined')
--      This prevents desynchronization from any direct SQL mutations.
--
--   2. Backend Self-Verification Protection:
--      Updates public.set_user_verified(p_user_id, p_verified, p_note) to reject
--      any invocation where p_user_id matches auth.uid(). Administrators may not
--      approve, decline, or alter their own verification status.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Database-Level Status Consistency Constraint
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_profiles_verified_status_sync'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profiles_verified_status_sync
      CHECK (
        (verified = true AND verification_status = 'verified')
        OR
        (verified = false AND verification_status IN ('pending', 'declined'))
      );
  END IF;
END $$;

COMMENT ON CONSTRAINT chk_profiles_verified_status_sync ON public.profiles IS
  'Ensures boolean verified flag and verification_status lifecycle state cannot become desynchronized.';


-- ----------------------------------------------------------------------------
-- 2. Updated Atomic Verification RPC with Self-Verification Guard
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.set_user_verified(
  p_user_id  uuid,
  p_verified boolean,
  p_note     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := auth.uid();
  v_profile    public.profiles%ROWTYPE;
  v_new_status text;
  v_clean_note text;
  v_log_detail text;
  v_notif_body text;
BEGIN
  -- 1. Authentication check: caller must have a valid authenticated JWT session
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Admin authorization check: caller must possess is_admin = true
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Administrator privileges required.';
  END IF;

  -- 3. Parameter validation: target user ID cannot be null
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_USER_ID: Target user ID is required.';
  END IF;

  -- 4. Backend Self-Verification Guard (Defense-in-Depth):
  --    Administrators cannot approve, decline, or re-verify their own profile.
  IF p_user_id = v_admin_id THEN
    RAISE EXCEPTION 'CANNOT_VERIFY_SELF: Administrators cannot verify or decline their own profile.';
  END IF;

  -- 5. Exclusively lock the target profile row to serialize concurrent administrative reviews
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: User % does not exist.', p_user_id;
  END IF;

  v_new_status := CASE WHEN p_verified THEN 'verified' ELSE 'declined' END;
  v_clean_note := NULLIF(trim(p_note), '');

  -- 6. Atomically update verification status and review metadata
  UPDATE public.profiles
  SET
    verified                 = p_verified,
    verification_status      = v_new_status,
    verification_reviewed_at = clock_timestamp(),
    verification_reviewed_by = v_admin_id,
    verification_note        = v_clean_note
  WHERE id = p_user_id;

  -- 7. Atomically insert activity audit log
  v_log_detail := format(
    '%s (%s) verification → %s%s',
    COALESCE(v_profile.first_name, 'Member'),
    p_user_id,
    v_new_status,
    CASE WHEN v_clean_note IS NOT NULL THEN ': ' || v_clean_note ELSE '' END
  );

  INSERT INTO public.activity_logs (
    actor_id,
    actor_role,
    action,
    detail
  ) VALUES (
    v_admin_id,
    'admin',
    'user.verify',
    v_log_detail
  );

  -- 8. Atomically insert member in-app safety notification
  IF p_verified THEN
    v_notif_body := 'Your Datevra profile has been officially verified. Your trust badge is now visible to other members.';
  ELSE
    v_notif_body := COALESCE(
      v_clean_note,
      'Your profile verification could not be approved at this time. Please update your profile photos with clear face portraits.'
    );
  END IF;

  INSERT INTO public.notifications (
    user_id,
    kind,
    title,
    body,
    link,
    read
  ) VALUES (
    p_user_id,
    'safety',
    CASE WHEN p_verified THEN 'Profile Verified' ELSE 'Verification Update' END,
    v_notif_body,
    '/profile',
    false
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3. Explicit Function Permissions
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.set_user_verified(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_verified(uuid, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.set_user_verified(uuid, boolean, text) IS
  'Atomically updates member verification status, records review audit trail, issues safety notification under admin authorization, and strictly prohibits self-verification.';
