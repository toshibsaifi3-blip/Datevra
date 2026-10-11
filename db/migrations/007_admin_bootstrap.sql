-- =====================================================================
-- DATEVRA migration 007 — first-admin bootstrap, SQL-Editor-only
--
-- SECURITY MODEL — there is intentionally NO client-callable path:
--   * bootstrap_first_admin() can only run as a database role with direct
--     SQL access: the Supabase project owner via the SQL Editor (the
--     postgres role), or the service_role. EXECUTE is revoked from
--     PUBLIC, anon, and authenticated, and NO grant is ever issued.
--   * Defense in depth: the function refuses any call that carries a JWT
--     (auth.uid() IS NOT NULL), so even an accidental future grant cannot
--     turn it into a self-promotion API.
--   * One-time: serialized by an advisory lock and permanently disabled
--     once any admin exists.
--   * The strict protect_profile_fields() trigger from migration 004 is
--     left untouched — it already blocks every non-admin is_admin change,
--     and SQL-Editor/service_role updates (auth.uid() IS NULL) bypass it
--     by design, which is exactly what the bootstrap uses.
--
-- OWNER PROCEDURE (Supabase dashboard → SQL Editor, as project owner):
--   1. Sign up in the Datevra app with the owner account (this creates
--      the auth.users row and the matching public.profiles row).
--   2. Immediately run:
--        SELECT public.bootstrap_first_admin('owner@example.com');
--   3. Verify:
--        SELECT email, is_admin FROM public.profiles WHERE is_admin;
--   Run step 2 promptly after the base setup: until the first admin
--   exists, the slot is open — whoever the owner bootstraps first wins,
--   and only the owner can reach the SQL Editor.
--
-- Apply AFTER 001–006. Re-runnable (re-running after bootstrap raises,
-- which is the intended closed state).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: does any admin exist? (SECURITY DEFINER so the guard cannot be
-- fooled by RLS. No client grants — owner/service tooling only.)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE is_admin);
$$;

COMMENT ON FUNCTION public.admin_exists() IS
  'True when any profile has is_admin. SECURITY DEFINER so the bootstrap guard cannot be fooled by RLS. No client grants.';

REVOKE ALL ON FUNCTION public.admin_exists() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- bootstrap_first_admin(target_email) — SQL-Editor-only, one-time
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(target_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- Hard block on API use: SQL Editor calls carry no JWT. If this ever
  -- fires, someone is calling through PostgREST — refuse unconditionally.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'bootstrap_first_admin() must be run from the Supabase SQL Editor by the project owner, never through the API.';
  END IF;

  -- Serialize concurrent bootstrap attempts.
  PERFORM pg_advisory_xact_lock(hashtext('datevra_first_admin'));

  IF public.admin_exists() THEN
    RAISE EXCEPTION 'An admin already exists — bootstrap is permanently disabled.';
  END IF;

  IF target_email IS NULL OR target_email = '' THEN
    RAISE EXCEPTION 'Provide the owner account email, e.g. SELECT public.bootstrap_first_admin(''you@example.com'');';
  END IF;

  SELECT au.id INTO v_uid FROM auth.users au WHERE au.email = target_email;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No account found with that email. The owner must sign up in the app first.';
  END IF;

  UPDATE public.profiles SET is_admin = true WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile row found for that account.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_first_admin(text) IS
  'One-time first-admin bootstrap for the project owner via the Supabase SQL Editor: SELECT public.bootstrap_first_admin(''owner@example.com''); No client grants; refuses JWT callers; permanently disabled once any admin exists.';

-- No EXECUTE grant is issued to any client role, ever. Only the postgres
-- owner role (SQL Editor) and service_role can run this function.
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(text) FROM PUBLIC, anon, authenticated;
