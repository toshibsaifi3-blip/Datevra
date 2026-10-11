-- =====================================================================
-- DATEVRA migration 004 — security hardening (audit findings)
--
-- Closes gaps found in the pre-launch audit. All changes are additive or
-- policy-tightening: no tables altered, no data deleted or modified.
--
--   1. blocked_pair(a, b) helper (SECURITY DEFINER): true when a block
--      exists in either direction. RLS hides the "blocked" side's row from
--      the victim, so checks must run elevated.
--   2. likes_insert_own: blocked users can no longer like the blocker.
--   3. messages_insert_participant: blocked users can no longer message
--      the blocker (defense in depth — the app deletes the conversation
--      on block, but the API is now airtight too).
--   4. protect_profile_fields trigger: members cannot self-grant a plan,
--      self-verify, change plan expiry, or change their profile email via
--      direct API calls. Admins (is_admin) are exempt so the verification
--      and membership-activation flows keep working.
--   5. freeze_message_content trigger: message text / sender / conversation
--      are immutable after insert (only read/delivered flags change).
--   6. enforce_application_rules trigger: non-admin application inserts
--      are forced to status 'submitted', and elite-only experiences reject
--      non-elite applicants at the database level (admins exempt — manual
--      selection workflow is the control for edge cases).
--
-- Apply AFTER 001–003. Re-runnable: DROP IF EXISTS / CREATE OR REPLACE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. blocked_pair helper
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.blocked_pair(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = a AND blocked_id = b)
       OR (blocker_id = b AND blocked_id = a)
  );
$$;

COMMENT ON FUNCTION public.blocked_pair(uuid, uuid) IS
  'True when a block exists in either direction. SECURITY DEFINER because RLS hides the victim''s side of the row.';

REVOKE ALL ON FUNCTION public.blocked_pair(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blocked_pair(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. likes: no likes across a block
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "likes_insert_own" ON public.likes;
CREATE POLICY "likes_insert_own" ON public.likes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = from_user_id
    AND NOT public.blocked_pair(auth.uid(), to_user_id)
  );

-- ---------------------------------------------------------------------
-- 3. messages: no messages across a block
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "messages_insert_participant" ON public.messages;
CREATE POLICY "messages_insert_participant" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.participant_ids @> ARRAY[auth.uid()]::uuid[]) AND
    NOT EXISTS (
      SELECT 1 FROM public.conversations c
      CROSS JOIN unnest(c.participant_ids) AS other_id
      WHERE c.id = messages.conversation_id
        AND other_id <> auth.uid()
        AND public.blocked_pair(auth.uid(), other_id)
    )
  );

-- ---------------------------------------------------------------------
-- 4. profiles: members cannot touch plan / verification / email fields
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bulletproof privilege guard: OLD/NEW row comparison has no RLS
  -- snapshot subtlety (unlike a WITH CHECK subquery). Members can never
  -- change these; admins and the service role (Edge Functions) can.
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.plan_id IS DISTINCT FROM NEW.plan_id
     OR OLD.plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
     OR OLD.verified IS DISTINCT FROM NEW.verified
     OR OLD.email IS DISTINCT FROM NEW.email THEN
    -- Admins may change these fields; so may the service role (Edge
    -- Functions), which presents no JWT and therefore no auth.uid().
    -- Regular members calling the API directly are rejected.
    IF NOT public.is_admin() AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Only Datevra admins may change admin, plan, verification, or email fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields
  BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

COMMENT ON FUNCTION public.protect_profile_fields() IS
  'Prevents privilege escalation via direct API calls (self-granted admin/Elite, self-verification). Admin flows (membership activation, verification queue) are exempt via is_admin().';

-- ---------------------------------------------------------------------
-- 5. messages: content immutable after insert
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.freeze_message_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.text IS DISTINCT FROM NEW.text
     OR OLD.sender_id IS DISTINCT FROM NEW.sender_id
     OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id THEN
    RAISE EXCEPTION 'Message content is immutable; only read/delivered flags may change';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_message_content ON public.messages;
CREATE TRIGGER trg_freeze_message_content
  BEFORE UPDATE OF text, sender_id, conversation_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.freeze_message_content();

-- ---------------------------------------------------------------------
-- 6. applications: force submitted + enforce elite eligibility
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_application_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_elite_only boolean;
  v_has_elite  boolean;
BEGIN
  IF TG_OP = 'INSERT' AND NOT public.is_admin() THEN
    -- Members can only ever create fresh applications.
    NEW.status := 'submitted';

    SELECT elite_only INTO v_elite_only
    FROM public.experiences WHERE id = NEW.experience_id;

    IF coalesce(v_elite_only, false) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = NEW.user_id
          AND plan_id = 'elite'
          AND (plan_expires_at IS NULL OR plan_expires_at > now())
      ) INTO v_has_elite;
      IF NOT v_has_elite THEN
        RAISE EXCEPTION 'This experience requires an active Elite membership';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_application_rules ON public.date_applications;
CREATE TRIGGER trg_enforce_application_rules
  BEFORE INSERT ON public.date_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_application_rules();

COMMENT ON FUNCTION public.enforce_application_rules() IS
  'Database-level guard for the curated-experience workflow: members cannot forge statuses or bypass Elite eligibility. Admins are exempt; manual review remains the control for edge cases.';
