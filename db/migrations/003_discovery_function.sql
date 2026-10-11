-- =====================================================================
-- DATEVRA migration 003 — secure discovery reads
--
-- PROBLEM (found in audit):
--   db/schema.sql created a `profiles_public` view intended to give members
--   a safe, email-free, block-aware view of other profiles. But PostgreSQL
--   views cannot be SECURITY DEFINER: the view runs with the *caller's*
--   privileges, so the underlying `profiles` RLS policy
--   (`profiles_select_own`: auth.uid() = id) still applies. A member
--   querying the view therefore sees ONLY their own row — discovery and
--   profile lookups for other members return nothing.
--
-- FIX (additive — no tables altered, no data deleted, the old view is left
-- in place for compatibility):
--   Two SECURITY DEFINER functions that read `profiles` with elevated
--   table privileges (bypassing the own-row RLS) while still filtering by
--   the *caller's* auth.uid() for block pairs. They return only the safe
--   columns: email and plan_expires_at are never exposed.
--     - discovery_profiles()          → all discoverable profiles
--     - discovery_profile(p_id uuid)  → one discoverable profile or none
--   Execute is granted to `authenticated` only (revoked from PUBLIC/anon).
--
-- Apply AFTER db/schema.sql and db/migrations/002_client_parity.sql.
-- Re-runnable: CREATE OR REPLACE + explicit REVOKE/GRANT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- All discoverable profiles for the caller
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.discovery_profiles()
RETURNS TABLE (
  id                uuid,
  first_name        text,
  age               int,
  gender            text,
  interested_in     text,
  city              text,
  bio               text,
  interests         text[],
  hobbies           text[],
  relationship_intent text,
  lifestyle         text[],
  photos            text[],
  verified          boolean,
  online            boolean,
  last_active       timestamptz,
  profile_complete  int,
  plan_id           text,
  created_at        timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id, p.first_name, p.age, p.gender, p.interested_in,
    p.city, p.bio, p.interests, p.hobbies, p.relationship_intent,
    p.lifestyle, p.photos, p.verified, p.online, p.last_active,
    p.profile_complete, p.plan_id, p.created_at
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id)
         OR (b.blocker_id = p.id AND b.blocked_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.discovery_profiles() IS
  'Member-safe discovery set. SECURITY DEFINER bypasses the own-row profiles RLS; block filtering still uses the caller''s auth.uid(). Email and plan_expires_at are never returned.';

REVOKE ALL ON FUNCTION public.discovery_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discovery_profiles() TO authenticated;

-- ---------------------------------------------------------------------
-- Single discoverable profile for the caller (null when blocked/hidden)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.discovery_profile(p_id uuid)
RETURNS TABLE (
  id                uuid,
  first_name        text,
  age               int,
  gender            text,
  interested_in     text,
  city              text,
  bio               text,
  interests         text[],
  hobbies           text[],
  relationship_intent text,
  lifestyle         text[],
  photos            text[],
  verified          boolean,
  online            boolean,
  last_active       timestamptz,
  profile_complete  int,
  plan_id           text,
  created_at        timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id, p.first_name, p.age, p.gender, p.interested_in,
    p.city, p.bio, p.interests, p.hobbies, p.relationship_intent,
    p.lifestyle, p.photos, p.verified, p.online, p.last_active,
    p.profile_complete, p.plan_id, p.created_at
  FROM public.profiles p
  WHERE p.id = p_id
    AND auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id)
         OR (b.blocker_id = p.id AND b.blocked_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.discovery_profile(uuid) IS
  'Single member-safe profile lookup. Returns zero rows when the profile is blocked in either direction or does not exist.';

REVOKE ALL ON FUNCTION public.discovery_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discovery_profile(uuid) TO authenticated;
