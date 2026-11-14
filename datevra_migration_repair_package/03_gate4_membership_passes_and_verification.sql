-- ============================================================================
-- DATEVRA REPAIR PACKAGE — GATE 4: Membership Passes & Verification Integrity
-- File: datevra_migration_repair_package/03_gate4_membership_passes_and_verification.sql
--
-- PURPOSE:
--   Safely install Migration 011 (membership_passes + datevra_internal) AND
--   Migrations 018 + 019 (profile verification status + RPC + sync constraint)
--   together in one conflict-free, forward-only repair so:
--     1. The 31-char vs % 32 pass code defect is eliminated using unbiased
--        rejection sampling (< 248 -> % 31 + 1) matching Membership.tsx regex.
--     2. pgcrypto works cleanly with fixed search_path including extensions.
--     3. protect_profile_fields() AND trg_protect_profile_fields cover ALL 9
--        sensitive columns (is_admin, plan_id, plan_expires_at, verified,
--        verification_status, verification_reviewed_at, verification_reviewed_by,
--        verification_note, email) and are NEVER overwritten back to 5 columns.
--     4. plan_update_intents consumption requires a fresh (< 5 minute) intent.
--     5. Verification backfill and chk_profiles_verified_status_sync abort cleanly
--        if pre-existing verification mismatches exist.
--
-- PREREQUISITES:
--   - Gate 2 applied (public.subscriptions.auto_renew, created_at, updated_at).
--   - pgcrypto installed in schema extensions or public.
--   - public.is_admin() and base tables exist.
--
-- POSTCONDITIONS:
--   - datevra_internal schema/tables revoked from client roles.
--   - membership_passes + 3 RPCs active with unbiased 19-char pass code format.
--   - 4 verification_* columns + sync CHECK constraint + set_user_verified active.
--   - trg_protect_profile_fields bound to all 9 protected columns.
--
-- RERUN / TRANSACTION SAFETY:
--   Wrapped in BEGIN ... COMMIT. Uses canonical billing lock order
--   (profiles -> subscriptions -> attempts -> membership_passes).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_pgcrypto_schema text;
  v_has_ver_status  boolean;
  v_mismatch_count  integer;
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'GATE4_PRECONDITION_FAILED: public.is_admin() does not exist.';
  END IF;

  SELECT n.nspname INTO v_pgcrypto_schema
  FROM pg_extension e
  JOIN pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_pgcrypto_schema IS NULL OR v_pgcrypto_schema NOT IN ('extensions', 'public') THEN
    RAISE EXCEPTION 'GATE4_PRECONDITION_FAILED: pgcrypto extension must exist in schema extensions or public (found: %).', COALESCE(v_pgcrypto_schema, 'ABSENT');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'auto_renew'
  ) THEN
    RAISE EXCEPTION 'GATE4_PRECONDITION_FAILED: public.subscriptions.auto_renew is missing. Run Gate 2 first.';
  END IF;

  -- Check if verification_status already exists; if so, ensure 0 mismatches before touching constraint
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_status'
  ) INTO v_has_ver_status;

  IF v_has_ver_status THEN
    EXECUTE $q$
      SELECT count(*)
      FROM public.profiles
      WHERE NOT (
        (verified = true AND verification_status = 'verified')
        OR
        (verified = false AND verification_status IN ('pending', 'declined'))
      )
    $q$ INTO v_mismatch_count;

    IF v_mismatch_count > 0 THEN
      RAISE EXCEPTION 'GATE4_PRECONDITION_FAILED: % profile row(s) already have conflicting verified vs verification_status values. Inspect before proceeding.', v_mismatch_count;
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. public.membership_passes Table, Indexes & Least-Privilege RLS (from 011)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.membership_passes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  plan_id            text NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
  duration_days      integer NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  issued_to_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','redeemed','expired','revoked')),
  note               text,
  expires_at         timestamptz NOT NULL,
  redeemed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.membership_passes IS
  'Promotional and complimentary membership passes granting ₹0 access to Connect, Plus, or Elite tiers.';

CREATE INDEX IF NOT EXISTS idx_membership_passes_code
  ON public.membership_passes (code);
CREATE INDEX IF NOT EXISTS idx_membership_passes_issued_to
  ON public.membership_passes (issued_to_user_id);
CREATE INDEX IF NOT EXISTS idx_membership_passes_status_expires
  ON public.membership_passes (status, expires_at);

ALTER TABLE public.membership_passes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.membership_passes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.membership_passes FROM authenticated;
GRANT SELECT ON public.membership_passes TO authenticated;

DROP POLICY IF EXISTS "membership_passes_admin_all" ON public.membership_passes;
CREATE POLICY "membership_passes_admin_all" ON public.membership_passes
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "membership_passes_user_read" ON public.membership_passes;
CREATE POLICY "membership_passes_user_read" ON public.membership_passes
  FOR SELECT TO authenticated
  USING (issued_to_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. Private Internal Schema (datevra_internal)
-- ----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS datevra_internal;
REVOKE ALL ON SCHEMA datevra_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA datevra_internal TO postgres, service_role;

CREATE TABLE IF NOT EXISTS datevra_internal.plan_update_intents (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id    text NOT NULL REFERENCES public.membership_plans(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE datevra_internal.plan_update_intents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE datevra_internal.plan_update_intents TO postgres, service_role;

CREATE TABLE IF NOT EXISTS datevra_internal.pass_redemption_attempts (
  user_id         uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  window_start    timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE datevra_internal.pass_redemption_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE datevra_internal.pass_redemption_attempts TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 3. Verification Columns, Idempotent Backfill & Sync CHECK (from 018 + 019)
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_added_ver_status boolean := false;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_status'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN verification_status text NOT NULL DEFAULT 'pending'
      CONSTRAINT chk_profiles_verification_status CHECK (verification_status IN ('pending', 'verified', 'declined'));
    v_added_ver_status := true;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_reviewed_at'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN verification_reviewed_at timestamptz;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_reviewed_by'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN verification_reviewed_by uuid;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_note'
  ) THEN
    ALTER TABLE public.profiles ADD COLUMN verification_note text;
  END IF;

  IF v_added_ver_status THEN
    UPDATE public.profiles
       SET verification_status = CASE WHEN verified = true THEN 'verified' ELSE 'pending' END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_verification_status
  ON public.profiles(verification_status);

DO $$
DECLARE
  v_condef text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_condef
  FROM pg_constraint
  WHERE conname = 'chk_profiles_verified_status_sync'
    AND conrelid = 'public.profiles'::regclass;

  IF v_condef IS NULL THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT chk_profiles_verified_status_sync
      CHECK (
        (verified = true AND verification_status = 'verified')
        OR
        (verified = false AND verification_status IN ('pending', 'declined'))
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Unified 9-Column Profile Protection Function & Trigger
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_consumed boolean := false;
  v_jwt_role text;
BEGIN
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.plan_id IS DISTINCT FROM NEW.plan_id
     OR OLD.plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
     OR OLD.verified IS DISTINCT FROM NEW.verified
     OR OLD.verification_status IS DISTINCT FROM NEW.verification_status
     OR OLD.verification_reviewed_at IS DISTINCT FROM NEW.verification_reviewed_at
     OR OLD.verification_reviewed_by IS DISTINCT FROM NEW.verification_reviewed_by
     OR OLD.verification_note IS DISTINCT FROM NEW.verification_note
     OR OLD.email IS DISTINCT FROM NEW.email THEN

    v_jwt_role := coalesce(pg_catalog.current_setting('request.jwt.claim.role', true), '');

    IF public.is_admin()
       OR v_jwt_role = 'service_role'
       OR (v_jwt_role = '' AND auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin')) THEN
      RETURN NEW;
    END IF;

    -- Non-admin members can update plan_id/plan_expires_at ONLY with a fresh (< 5m) internal intent
    IF OLD.is_admin IS NOT DISTINCT FROM NEW.is_admin
       AND OLD.verified IS NOT DISTINCT FROM NEW.verified
       AND OLD.verification_status IS NOT DISTINCT FROM NEW.verification_status
       AND OLD.verification_reviewed_at IS NOT DISTINCT FROM NEW.verification_reviewed_at
       AND OLD.verification_reviewed_by IS NOT DISTINCT FROM NEW.verification_reviewed_by
       AND OLD.verification_note IS NOT DISTINCT FROM NEW.verification_note
       AND OLD.email IS NOT DISTINCT FROM NEW.email THEN

      DELETE FROM datevra_internal.plan_update_intents
       WHERE user_id = NEW.id
         AND plan_id = NEW.plan_id
         AND expires_at IS NOT DISTINCT FROM NEW.plan_expires_at
         AND created_at >= now() - interval '5 minutes'
      RETURNING true INTO v_consumed;

      IF v_consumed IS TRUE THEN
        RETURN NEW;
      END IF;
    END IF;

    RAISE EXCEPTION 'Only Datevra admins may change admin, plan, verification, or email fields';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_profile_fields() IS
  'Protects all 9 sensitive profile columns (admin, plan, verification, email). Permits non-admin plan updates only via fresh internal intent tokens.';

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields
  BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified,
    verification_status, verification_reviewed_at, verification_reviewed_by,
    verification_note, email
  ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- ----------------------------------------------------------------------------
-- 5. Hardened Atomic Verification RPC (from 019 + explicit NULL p_verified guard)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_user_verified(
  p_user_id  uuid,
  p_verified boolean,
  p_note     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := auth.uid();
  v_profile    public.profiles%ROWTYPE;
  v_new_status text;
  v_clean_note text;
  v_log_detail text;
  v_notif_body text;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'ACCESS_DENIED: Administrator privileges required.';
  END IF;
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'MISSING_USER_ID: Target user ID is required.';
  END IF;
  IF p_verified IS NULL THEN
    RAISE EXCEPTION 'MISSING_VERIFIED_FLAG: Verification decision boolean is required.';
  END IF;
  IF p_user_id = v_admin_id THEN
    RAISE EXCEPTION 'CANNOT_VERIFY_SELF: Administrators cannot verify or decline their own profile.';
  END IF;

  SELECT * INTO v_profile
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'USER_NOT_FOUND: User % does not exist.', p_user_id;
  END IF;

  v_new_status := CASE WHEN p_verified THEN 'verified' ELSE 'declined' END;
  v_clean_note := NULLIF(pg_catalog.btrim(p_note), '');

  UPDATE public.profiles
  SET
    verified                 = p_verified,
    verification_status      = v_new_status,
    verification_reviewed_at = pg_catalog.clock_timestamp(),
    verification_reviewed_by = v_admin_id,
    verification_note        = v_clean_note
  WHERE id = p_user_id;

  v_log_detail := format(
    '%s (%s) verification → %s%s',
    COALESCE(v_profile.first_name, 'Member'),
    p_user_id,
    v_new_status,
    CASE WHEN v_clean_note IS NOT NULL THEN ': ' || v_clean_note ELSE '' END
  );

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'user.verify', v_log_detail);

  IF p_verified THEN
    v_notif_body := 'Your Datevra profile has been officially verified. Your trust badge is now visible to other members.';
  ELSE
    v_notif_body := COALESCE(
      v_clean_note,
      'Your profile verification could not be approved at this time. Please update your profile photos with clear face portraits.'
    );
  END IF;

  INSERT INTO public.notifications (user_id, kind, title, body, link, read)
  VALUES (
    p_user_id,
    'safety',
    CASE WHEN p_verified THEN 'Profile Verified' ELSE 'Verification Update' END,
    v_notif_body,
    '/profile',
    false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_user_verified(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_verified(uuid, boolean, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 6. Mathematically Unbiased Pass Code Generator (Rejection Sampling < 248)
--    Fixes 31-char v_chars vs % 32 bug: 248 = 31 * 8 guarantees exact uniform
--        1/31 probability per character and 100% 18-char MEM-XXXX-XXXX-XXXX output.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION datevra_internal.generate_secure_pass_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions, pg_temp
AS $$
DECLARE
  v_chars CONSTANT text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- exact length = 31
  v_bytes bytea;
  v_byte  integer;
  v_code  text := '';
  i       integer;
BEGIN
  WHILE pg_catalog.length(v_code) < 12 LOOP
    v_bytes := gen_random_bytes(32);
    FOR i IN 0..31 LOOP
      EXIT WHEN pg_catalog.length(v_code) >= 12;
      v_byte := pg_catalog.get_byte(v_bytes, i);
      -- Rejection sampling: discard values >= 248 (8 * 31) to eliminate modulo bias
      -- and prevent out-of-range substr indexing.
      IF v_byte < 248 THEN
        v_code := v_code || pg_catalog.substr(v_chars, (v_byte % 31) + 1, 1);
      END IF;
    END LOOP;
  END LOOP;

  RETURN 'MEM-' || pg_catalog.substr(v_code, 1, 4) || '-' || pg_catalog.substr(v_code, 5, 4) || '-' || pg_catalog.substr(v_code, 9, 4);
END;
$$;

COMMENT ON FUNCTION datevra_internal.generate_secure_pass_code() IS
  'Generates an 18-character unambiguous membership pass code (31^12 ~59.45 bits) using unbiased rejection sampling (< 248).';

REVOKE ALL ON FUNCTION datevra_internal.generate_secure_pass_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION datevra_internal.generate_secure_pass_code() TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 7. Admin Pass Creation & Revocation RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_membership_pass(
  p_plan_id            text,
  p_duration_days      integer DEFAULT 30,
  p_expires_at         timestamptz DEFAULT (now() + interval '90 days'),
  p_issued_to_user_id  uuid DEFAULT NULL,
  p_note               text DEFAULT NULL
)
RETURNS public.membership_passes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_pass     public.membership_passes%ROWTYPE;
  v_code     text;
  v_attempts integer := 0;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.';
  END IF;
  IF p_plan_id NOT IN ('connect', 'plus', 'elite') THEN
    RAISE EXCEPTION 'Invalid plan ID. Must be connect, plus, or elite.';
  END IF;
  IF p_duration_days IS NULL OR p_duration_days <= 0 THEN
    RAISE EXCEPTION 'Duration days must be greater than zero.';
  END IF;
  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Pass expiration date must be in the future.';
  END IF;
  IF p_issued_to_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_issued_to_user_id) THEN
      RAISE EXCEPTION 'Assigned user does not exist.';
    END IF;
  END IF;

  LOOP
    v_attempts := v_attempts + 1;
    v_code := datevra_internal.generate_secure_pass_code();

    BEGIN
      INSERT INTO public.membership_passes (
        code, plan_id, duration_days, issued_to_user_id,
        issued_by_admin_id, status, note, expires_at
      ) VALUES (
        v_code, p_plan_id, p_duration_days, p_issued_to_user_id,
        v_admin_id, 'active', NULLIF(pg_catalog.btrim(p_note), ''), p_expires_at
      ) RETURNING * INTO v_pass;
      EXIT;
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempts >= 10 THEN
          RAISE EXCEPTION 'Failed to generate a unique pass code after % attempts.', v_attempts;
        END IF;
    END;
  END LOOP;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'membership_pass.create',
    'Created ' || p_plan_id || ' membership pass ' || v_code || ' valid for ' || p_duration_days || ' days'
  );

  RETURN v_pass;
END;
$$;

REVOKE ALL ON FUNCTION public.create_membership_pass(text, integer, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_membership_pass(text, integer, timestamptz, uuid, text) TO authenticated;

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
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.';
  END IF;

  SELECT * INTO v_pass
  FROM public.membership_passes
  WHERE id = p_pass_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership pass not found.';
  END IF;
  IF v_pass.status <> 'active' THEN
    RAISE EXCEPTION 'Only active passes may be revoked. Current status: %', v_pass.status;
  END IF;

  UPDATE public.membership_passes
     SET status = 'revoked',
         note = CASE
                  WHEN p_reason IS NOT NULL AND pg_catalog.btrim(p_reason) <> '' THEN
                    COALESCE(note || ' | ', '') || 'Revoked: ' || pg_catalog.btrim(p_reason)
                  ELSE note
                END
   WHERE id = p_pass_id
  RETURNING * INTO v_pass;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'membership_pass.revoke',
    'Revoked membership pass ' || v_pass.code || COALESCE(' (' || p_reason || ')', '')
  );

  RETURN v_pass;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_membership_pass(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_membership_pass(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Authenticated Member Pass Redemption RPC (Gate 4 Version)
--    Canonical lock order: profiles -> subscriptions -> attempts -> membership_passes
--    (Gate 5 upgrades this function cleanly to also record subscriptions.payment_id)
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

  -- Lock Hierarchy Step 1: Lock member profile FIRST
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;

  -- Lock Hierarchy Step 2: Lock active subscription row (if any) BEFORE attempts/passes
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

  -- Lock Hierarchy Step 3: Lock rate-limit row
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

  -- Lock Hierarchy Step 4: Lock pass row
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
    user_id, plan_id, status, started_at, expires_at, auto_renew
  ) VALUES (
    v_uid, v_pass.plan_id, 'active', v_start_at, v_expires_at, false
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
