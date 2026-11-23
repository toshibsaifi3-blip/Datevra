-- ============================================================================
-- DATEVRA REPAIR PACKAGE — GATE 3: Matchmaking Serialization & Complimentary Passes
-- File: datevra_migration_repair_package/02_gate3_matchmaking_and_passes.sql
--
-- PURPOSE:
--   Consolidate Migrations 010, 014, 015, and 016 into one ordered, deadlock-free,
--   block-safe deployment (replacing draft 012 and 013 which must NEVER run).
--
-- PREREQUISITES:
--   - Gate 2 (01_gate2_schema_compatibility_repairs.sql) applied.
--   - public.blocked_pair(uuid, uuid) (Migration 004) exists.
--   - public.matches enforces UNIQUE (user_a, user_b) and public.conversations
--     enforces UNIQUE (match_id).
--
-- EXPECTED EFFECTS:
--   1. Creates public.complimentary_passes, indexes, strict RLS, and
--      public.redeem_pass(text) RPC.
--   2. Creates public.match_proposals, indexes, partial unique index
--      idx_match_proposals_unique_pending_pair, and strict RLS.
--   3. Creates public.lock_matchmaking_pair(uuid, uuid) with EXECUTE revoked
--      from PUBLIC, anon, and authenticated (prevents pair-lock squatting DoS).
--   4. Installs trg_check_match_proposal_integrity (BEFORE INSERT) enforcing
--      Advisory Pair Lock -> self-match -> blocked_pair -> existing match ->
--      duplicate pending checks.
--   5. Updates public.handle_mutual_like() to acquire the canonical advisory
--      lock first, check for the reciprocal like and blocked_pair under that
--      lock, create match/conversation/notifications, and decline any pending
--      proposals for the newly matched pair.
--   6. Installs hardened public.respond_to_proposal(uuid, boolean) enforcing:
--      - Canonical Lock Order: Advisory Pair Lock -> match_proposals Row Lock -> matches
--      - Explicit p_accept IS NULL rejection
--      - One-time response semantics (cannot flip an already-recorded vote)
--      - Non-throwing 'declined' persistence if blocked or already matched
--
-- POSTCONDITIONS:
--   complimentary_passes, match_proposals, unique pending index, triggers, and
--   all matchmaking RPCs/grants exist cleanly with fixed search_path.
--
-- RERUN / TRANSACTION SAFETY:
--   Wrapped in BEGIN ... COMMIT. Additive and idempotent once conflicts = 0.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_dup_count            integer;
  v_match_conflict_count integer;
BEGIN
  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'GATE3_PRECONDITION_FAILED: public.is_admin() does not exist.';
  END IF;

  IF to_regprocedure('public.blocked_pair(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'GATE3_PRECONDITION_FAILED: public.blocked_pair(uuid, uuid) from Migration 004 is missing. Gate 3 is BLOCKED until 004 is verified/installed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cafes' AND column_name = 'menu'
  ) THEN
    RAISE EXCEPTION 'GATE3_PRECONDITION_FAILED: public.cafes.menu does not exist. Run Gate 2 first.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'matches'
      AND con.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'GATE3_PRECONDITION_FAILED: public.matches lacks a unique pair constraint.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'conversations'
      AND con.contype = 'u'
  ) THEN
    RAISE EXCEPTION 'GATE3_PRECONDITION_FAILED: public.conversations lacks a unique constraint on match_id.';
  END IF;

  -- Validate existing match_proposals rows if table already existed
  IF to_regclass('public.match_proposals') IS NOT NULL THEN
    SELECT count(*) INTO v_dup_count
    FROM (
      SELECT LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)
      FROM public.match_proposals
      WHERE status = 'pending'
      GROUP BY 1, 2
      HAVING count(*) > 1
    ) d;

    IF v_dup_count > 0 THEN
      RAISE EXCEPTION 'GATE3_PRECONDITION_FAILED: % duplicate pending proposal pair(s) found in public.match_proposals.', v_dup_count;
    END IF;

    SELECT count(*) INTO v_match_conflict_count
    FROM public.match_proposals p
    JOIN public.matches m
      ON m.user_a = LEAST(p.user_a_id, p.user_b_id)
     AND m.user_b = GREATEST(p.user_a_id, p.user_b_id)
    WHERE p.status = 'pending';

    IF v_match_conflict_count > 0 THEN
      RAISE EXCEPTION 'GATE3_PRECONDITION_FAILED: % pending proposal(s) already have a confirmed match.', v_match_conflict_count;
    END IF;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Complimentary Café Passes Table & RLS (from 010)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.complimentary_passes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,
  cafe_id            text NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE,
  issued_to_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  issued_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','redeemed','expired','revoked')),
  note               text,
  expires_at         timestamptz,
  redeemed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_complimentary_passes_code
  ON public.complimentary_passes(code);
CREATE INDEX IF NOT EXISTS idx_complimentary_passes_user
  ON public.complimentary_passes(issued_to_user_id);
CREATE INDEX IF NOT EXISTS idx_complimentary_passes_cafe
  ON public.complimentary_passes(cafe_id);

ALTER TABLE public.complimentary_passes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.complimentary_passes
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.complimentary_passes
TO authenticated;
DROP POLICY IF EXISTS "passes_admin_all" ON public.complimentary_passes;
CREATE POLICY "passes_admin_all" ON public.complimentary_passes
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "passes_user_read_own" ON public.complimentary_passes;
CREATE POLICY "passes_user_read_own" ON public.complimentary_passes
  FOR SELECT TO authenticated
  USING (issued_to_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 2. Match Proposals Table, Partial Unique Index & RLS (from 010 + 014)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.match_proposals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  proposed_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  message              text,
  status               text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','accepted','declined','expired')),
  user_a_response      boolean,
  user_b_response      boolean,
  created_at           timestamptz NOT NULL DEFAULT now(),
  responded_at         timestamptz,
  CHECK (user_a_id <> user_b_id)
);

CREATE INDEX IF NOT EXISTS idx_match_proposals_users
  ON public.match_proposals(user_a_id, user_b_id);
CREATE INDEX IF NOT EXISTS idx_match_proposals_status
  ON public.match_proposals(status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_match_proposals_unique_pending_pair
  ON public.match_proposals (
    LEAST(user_a_id, user_b_id),
    GREATEST(user_a_id, user_b_id)
  )
  WHERE status = 'pending';

COMMENT ON INDEX public.idx_match_proposals_unique_pending_pair IS
  'Guarantees at most one pending proposal exists per member pair regardless of A/B ordering.';

ALTER TABLE public.match_proposals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.match_proposals
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.match_proposals
TO authenticated;
DROP POLICY IF EXISTS "proposals_admin_all" ON public.match_proposals;
CREATE POLICY "proposals_admin_all" ON public.match_proposals
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "proposals_user_read" ON public.match_proposals;
CREATE POLICY "proposals_user_read" ON public.match_proposals
  FOR SELECT TO authenticated
  USING (user_a_id = auth.uid() OR user_b_id = auth.uid());

DROP POLICY IF EXISTS "proposals_user_respond" ON public.match_proposals;

-- ----------------------------------------------------------------------------
-- 3. Complimentary Pass Redemption RPC (from 010 + fixed search_path)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_pass(p_code text)
RETURNS public.complimentary_passes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_pass public.complimentary_passes%ROWTYPE;
  v_uid  uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;
  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RAISE EXCEPTION 'A pass code is required.';
  END IF;

  SELECT * INTO v_pass
  FROM public.complimentary_passes
  WHERE code = btrim(p_code)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid pass code.';
  END IF;
  IF v_pass.status = 'redeemed' THEN
    RAISE EXCEPTION 'This pass has already been redeemed.';
  END IF;
  IF v_pass.status = 'revoked' THEN
    RAISE EXCEPTION 'This pass has been revoked.';
  END IF;
  IF v_pass.status = 'expired'
     OR (v_pass.expires_at IS NOT NULL AND v_pass.expires_at < now()) THEN
    RAISE EXCEPTION 'This pass has expired.';
  END IF;
  IF v_pass.issued_to_user_id IS NOT NULL
     AND v_pass.issued_to_user_id <> v_uid THEN
    RAISE EXCEPTION 'This pass was issued to a different account.';
  END IF;

  UPDATE public.complimentary_passes
     SET status = 'redeemed',
         redeemed_at = now(),
         issued_to_user_id = COALESCE(issued_to_user_id, v_uid)
   WHERE id = v_pass.id
  RETURNING * INTO v_pass;

  RETURN v_pass;
END;
$$;

COMMENT ON FUNCTION public.redeem_pass(text) IS
  'Redeem a complimentary café pass code atomically with FOR UPDATE row lock.';

REVOKE ALL ON FUNCTION public.redeem_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_pass(text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Internal Pair Advisory Lock Helper (Revoked from All Client Roles)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_matchmaking_pair(p_user_a uuid, p_user_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_u1 uuid := LEAST(p_user_a, p_user_b);
  v_u2 uuid := GREATEST(p_user_a, p_user_b);
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(v_u1::text),
    pg_catalog.hashtext(v_u2::text)
  );
END;
$$;

COMMENT ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) IS
  'Internal pair advisory lock helper. Revoked from PUBLIC, anon, and authenticated to prevent lock-squatting DoS.';

REVOKE ALL ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;
-- Serialize block changes with matchmaking operations for the same user pair.
CREATE OR REPLACE FUNCTION public.lock_block_pair_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.lock_matchmaking_pair(NEW.blocker_id, NEW.blocked_id);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.lock_matchmaking_pair(OLD.blocker_id, OLD.blocked_id);
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.blocker_id IS DISTINCT FROM NEW.blocker_id
       OR OLD.blocked_id IS DISTINCT FROM NEW.blocked_id THEN
      RAISE EXCEPTION 'Block pair endpoints cannot be changed. Delete and insert instead.';
    END IF;

    PERFORM public.lock_matchmaking_pair(NEW.blocker_id, NEW.blocked_id);
    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.lock_block_pair_changes()
FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_lock_block_pair_changes ON public.blocks;

CREATE TRIGGER trg_lock_block_pair_changes
BEFORE INSERT OR UPDATE OR DELETE ON public.blocks
FOR EACH ROW
EXECUTE FUNCTION public.lock_block_pair_changes();
-- ----------------------------------------------------------------------------
-- 5. Proposal Integrity Trigger Function & Trigger (from 014 + 015)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_match_proposal_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_u1 uuid := LEAST(NEW.user_a_id, NEW.user_b_id);
  v_u2 uuid := GREATEST(NEW.user_a_id, NEW.user_b_id);
BEGIN
  IF NEW.user_a_id = NEW.user_b_id THEN
    RAISE EXCEPTION 'Cannot create match proposal with the same person.';
  END IF;

  -- Canonical Lock Hierarchy Step 1: Advisory Pair Lock
  PERFORM public.lock_matchmaking_pair(v_u1, v_u2);

  IF public.blocked_pair(NEW.user_a_id, NEW.user_b_id) THEN
    RAISE EXCEPTION 'This introduction cannot be created because a blocking restriction exists.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE user_a = v_u1 AND user_b = v_u2
  ) THEN
    RAISE EXCEPTION 'These members are already matched.';
  END IF;

  IF NEW.status = 'pending' AND EXISTS (
    SELECT 1 FROM public.match_proposals
    WHERE LEAST(user_a_id, user_b_id) = v_u1
      AND GREATEST(user_a_id, user_b_id) = v_u2
      AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'A proposal is already pending between these members.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_proposal_not_blocked ON public.match_proposals;
DROP TRIGGER IF EXISTS trg_check_match_proposal_integrity ON public.match_proposals;

CREATE TRIGGER trg_check_match_proposal_integrity
  BEFORE INSERT ON public.match_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.check_match_proposal_integrity();

COMMENT ON FUNCTION public.check_match_proposal_integrity() IS
  'Rejects self-match, blocked pairs, already-matched pairs, and duplicate pending proposals under canonical pair advisory lock.';

-- ----------------------------------------------------------------------------
-- 6. Hardened Respond-to-Proposal RPC (Canonical Lock Order + One-Time Vote)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.respond_to_proposal(
  p_proposal_id uuid,
  p_accept      boolean
)
RETURNS public.match_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_prop  public.match_proposals%ROWTYPE;
  v_uid   uuid := auth.uid();
  v_is_a  boolean;
  v_raw_a uuid;
  v_raw_b uuid;
  v_u1    uuid;
  v_u2    uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'A boolean response (p_accept) is required.';
  END IF;

  -- Non-locking lookup to canonicalize pair BEFORE locking rows
  SELECT user_a_id, user_b_id INTO v_raw_a, v_raw_b
  FROM public.match_proposals
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found.';
  END IF;

  v_u1 := LEAST(v_raw_a, v_raw_b);
  v_u2 := GREATEST(v_raw_a, v_raw_b);

  -- Canonical Lock Order Step 1: Advisory Pair Lock BEFORE Proposal Row Lock
  PERFORM public.lock_matchmaking_pair(v_u1, v_u2);

  -- Canonical Lock Order Step 2: Proposal Row Lock
  SELECT * INTO v_prop
  FROM public.match_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found.';
  END IF;
  IF v_prop.status <> 'pending' THEN
    RAISE EXCEPTION 'This proposal is no longer pending.';
  END IF;
  IF v_uid <> v_prop.user_a_id AND v_uid <> v_prop.user_b_id THEN
    RAISE EXCEPTION 'Not authorized for this proposal.';
  END IF;

  v_u1 := LEAST(v_prop.user_a_id, v_prop.user_b_id);
  v_u2 := GREATEST(v_prop.user_a_id, v_prop.user_b_id);

  -- Check block under pair lock; persist 'declined' without rollback
  IF public.blocked_pair(v_prop.user_a_id, v_prop.user_b_id) THEN
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
  END IF;

  -- Check existing match under pair lock
  IF EXISTS (SELECT 1 FROM public.matches WHERE user_a = v_u1 AND user_b = v_u2) THEN
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
  END IF;

  v_is_a := (v_uid = v_prop.user_a_id);

  -- One-time response semantics: prevent flipping an already-recorded vote
  IF (v_is_a AND v_prop.user_a_response IS NOT NULL)
     OR (NOT v_is_a AND v_prop.user_b_response IS NOT NULL) THEN
    RAISE EXCEPTION 'You have already responded to this proposal.';
  END IF;

  IF v_is_a THEN
    v_prop.user_a_response := p_accept;
  ELSE
    v_prop.user_b_response := p_accept;
  END IF;

  IF NOT p_accept THEN
    UPDATE public.match_proposals
       SET user_a_response = v_prop.user_a_response,
           user_b_response = v_prop.user_b_response,
           status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
  END IF;

  IF v_prop.user_a_response IS TRUE AND v_prop.user_b_response IS TRUE THEN
    -- Canonical Lock Order Step 3: Insert/lock match row
    INSERT INTO public.matches (user_a, user_b)
    VALUES (v_u1, v_u2)
    ON CONFLICT (user_a, user_b) DO NOTHING;

    INSERT INTO public.conversations (match_id, participant_ids)
    SELECT m.id, ARRAY[v_prop.user_a_id, v_prop.user_b_id]
    FROM public.matches m
    WHERE m.user_a = v_u1 AND m.user_b = v_u2
    ON CONFLICT (match_id) DO NOTHING;

    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES
      (v_prop.user_a_id, 'match', 'Proposal accepted!',
       'You both accepted the curated match proposal. Say hello!', '/matches'),
      (v_prop.user_b_id, 'match', 'Proposal accepted!',
       'You both accepted the curated match proposal. Say hello!', '/matches')
    ON CONFLICT DO NOTHING;

    UPDATE public.match_proposals
       SET user_a_response = v_prop.user_a_response,
           user_b_response = v_prop.user_b_response,
           status = 'accepted',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;

    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE LEAST(user_a_id, user_b_id) = v_u1
       AND GREATEST(user_a_id, user_b_id) = v_u2
       AND status = 'pending'
       AND id <> v_prop.id;
  ELSE
    UPDATE public.match_proposals
       SET user_a_response = v_prop.user_a_response,
           user_b_response = v_prop.user_b_response
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
  END IF;

  RETURN v_prop;
END;
$$;

COMMENT ON FUNCTION public.respond_to_proposal(uuid, boolean) IS
  'Responds to a curated match proposal under canonical lock ordering with null/repeat-vote guards and persistent block decline.';

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Serialized Mutual-Like Trigger Function (from 015 + block guard + search_path)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_mutual_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  a    uuid := LEAST(NEW.from_user_id, NEW.to_user_id);
  b    uuid := GREATEST(NEW.from_user_id, NEW.to_user_id);
  m_id uuid;
BEGIN
  -- Canonical Lock Order Step 1: Advisory Pair Lock MUST precede reciprocal-like check
  -- so concurrent reciprocal inserts serialize and observe committed peer likes.
  PERFORM public.lock_matchmaking_pair(a, b);

  -- Check reciprocal like while holding the pair advisory lock
  IF NOT EXISTS (
    SELECT 1 FROM public.likes
    WHERE from_user_id = NEW.to_user_id AND to_user_id = NEW.from_user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- Check bidirectional block while still holding the same pair advisory lock
  IF public.blocked_pair(a, b) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.matches (user_a, user_b)
  VALUES (a, b)
  ON CONFLICT (user_a, user_b) DO NOTHING
  RETURNING id INTO m_id;

  IF m_id IS NULL THEN
    SELECT id INTO m_id FROM public.matches WHERE user_a = a AND user_b = b;
  END IF;

  INSERT INTO public.conversations (match_id, participant_ids)
  VALUES (m_id, ARRAY[a, b])
  ON CONFLICT (match_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES
    (NEW.from_user_id, 'match', 'It''s a match!',
     'You and your new match liked each other. Say hello!', '/matches'),
    (NEW.to_user_id, 'match', 'It''s a match!',
     'You and your new match liked each other. Say hello!', '/matches')
  ON CONFLICT DO NOTHING;

  UPDATE public.match_proposals
     SET status = 'declined',
         responded_at = now()
   WHERE LEAST(user_a_id, user_b_id) = a
     AND GREATEST(user_a_id, user_b_id) = b
     AND status = 'pending';

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mutual_like ON public.likes;
CREATE TRIGGER trg_mutual_like
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.handle_mutual_like();

COMMIT;
