-- ============================================================================
-- DATEVRA Migration 018: Verification Status Model, Protection, & Atomic RPC
--
-- Phase 6.1: Verification Management Completion
--
-- Summary of Changes:
--   1. Adds verification lifecycle columns to public.profiles:
--        - verification_status (text NOT NULL DEFAULT 'pending', CHECK IN ('pending', 'verified', 'declined'))
--        - verification_reviewed_at (timestamptz)
--        - verification_reviewed_by (uuid)
--        - verification_note (text)
--   2. Creates index idx_profiles_verification_status for rapid queue filtering.
--   3. Safely backfills existing rows to ensure verified = true maps to 'verified'.
--   4. Updates public.protect_profile_fields() trigger to guard all verification
--      columns from unauthorized client-side tampering.
--   5. Creates atomic public.set_user_verified(p_user_id, p_verified, p_note) RPC:
--        - Derives actor identity strictly from auth.uid()
--        - Enforces admin check via public.is_admin()
--        - Acquires FOR UPDATE exclusive row lock on public.profiles
--        - Atomically mutates verification fields
--        - Atomically inserts audit log into public.activity_logs
--        - Atomically inserts in-app notification into public.notifications
--        - Rolls back entirely on any error
--   6. Configures explicit security permissions (REVOKE PUBLIC/anon, GRANT authenticated).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Schema Alterations on public.profiles
-- ----------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN verification_status text NOT NULL DEFAULT 'pending'
      CONSTRAINT chk_profiles_verification_status CHECK (verification_status IN ('pending', 'verified', 'declined'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_reviewed_at'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN verification_reviewed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_reviewed_by'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN verification_reviewed_by uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_note'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN verification_note text;
  END IF;
END $$;

-- Fast index for administrative queues
CREATE INDEX IF NOT EXISTS idx_profiles_verification_status
  ON public.profiles(verification_status);

-- Safe idempotent backfill for existing profiles
UPDATE public.profiles
SET verification_status = CASE
  WHEN verified = true THEN 'verified'
  ELSE 'pending'
END
WHERE verification_status IS NULL OR verification_status = 'pending';


-- ----------------------------------------------------------------------------
-- 2. Update Profile Field Protection Trigger (protect_profile_fields)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, datevra_internal, pg_temp
AS $$
DECLARE
  v_consumed boolean := false;
  v_jwt_role text;
BEGIN
  -- Check if any protected administrative, verification, or sensitive field has changed
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.plan_id IS DISTINCT FROM NEW.plan_id
     OR OLD.plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
     OR OLD.verified IS DISTINCT FROM NEW.verified
     OR OLD.verification_status IS DISTINCT FROM NEW.verification_status
     OR OLD.verification_reviewed_at IS DISTINCT FROM NEW.verification_reviewed_at
     OR OLD.verification_reviewed_by IS DISTINCT FROM NEW.verification_reviewed_by
     OR OLD.verification_note IS DISTINCT FROM NEW.verification_note
     OR OLD.email IS DISTINCT FROM NEW.email THEN

    -- Extract JWT claim role safely
    v_jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');

    -- 1. Authorized callers unconditionally allowed:
    --    a) Authenticated Datevra admins (public.is_admin() = true)
    --    b) Verified Supabase service-role (Edge Functions / Webhooks)
    --    c) Direct SQL Editor / maintenance scripts with no JWT context running under session_user
    IF public.is_admin()
       OR v_jwt_role = 'service_role'
       OR (v_jwt_role = '' AND auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin')) THEN
      RETURN NEW;
    END IF;

    -- 2. If caller is an ordinary authenticated member, verify whether this is an
    -- authorized internal plan update (admin, verified, verification fields, and email MUST be untouched)
    IF OLD.is_admin IS NOT DISTINCT FROM NEW.is_admin
       AND OLD.verified IS NOT DISTINCT FROM NEW.verified
       AND OLD.verification_status IS NOT DISTINCT FROM NEW.verification_status
       AND OLD.verification_reviewed_at IS NOT DISTINCT FROM NEW.verification_reviewed_at
       AND OLD.verification_reviewed_by IS NOT DISTINCT FROM NEW.verification_reviewed_by
       AND OLD.verification_note IS NOT DISTINCT FROM NEW.verification_note
       AND OLD.email IS NOT DISTINCT FROM NEW.email THEN

      -- Atomically verify and consume the intent from the private schema
      DELETE FROM datevra_internal.plan_update_intents
       WHERE user_id = NEW.id
         AND plan_id = NEW.plan_id
         AND expires_at IS NOT DISTINCT FROM NEW.plan_expires_at
      RETURNING true INTO v_consumed;

      IF v_consumed IS TRUE THEN
        RETURN NEW; -- Authorized internal membership update: allow
      END IF;
    END IF;

    -- All other unauthorized direct mutations are rejected
    RAISE EXCEPTION 'Only Datevra admins may change admin, plan, verification, or email fields';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_profile_fields() IS
  'Prevents client privilege escalation. Protects verification, plan, and admin fields.';


-- ----------------------------------------------------------------------------
-- 3. Atomic Verification RPC: public.set_user_verified
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
  -- 1. Authentication check
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Admin authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Administrator privileges required.';
  END IF;

  -- 3. Parameter validation
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_USER_ID: Target user ID is required.';
  END IF;

  -- 4. Exclusively lock the profile row to serialize concurrent administrative reviews
  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: User % does not exist.', p_user_id;
  END IF;

  v_new_status := CASE WHEN p_verified THEN 'verified' ELSE 'declined' END;
  v_clean_note := NULLIF(trim(p_note), '');

  -- 5. Atomically update verification status and review metadata
  UPDATE public.profiles
  SET
    verified                 = p_verified,
    verification_status      = v_new_status,
    verification_reviewed_at = clock_timestamp(),
    verification_reviewed_by = v_admin_id,
    verification_note        = v_clean_note
  WHERE id = p_user_id;

  -- 6. Atomically insert activity audit log
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

  -- 7. Atomically insert member in-app safety notification
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
-- 4. Function Permissions
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.set_user_verified(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_verified(uuid, boolean, text) TO authenticated;

COMMENT ON FUNCTION public.set_user_verified(uuid, boolean, text) IS
  'Atomically updates member verification status, records review audit trail, and issues safety notification under admin authorization.';
