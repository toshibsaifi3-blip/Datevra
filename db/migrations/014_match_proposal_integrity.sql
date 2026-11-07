-- ============================================================================
-- DATEVRA Migration 014: Match Proposal Integrity & Duplicate Protection (Phase 3)
--
-- GOAL:
--   1. Enforce at the database level that duplicate pending proposals cannot be
--      created between the same two members, regardless of submission order (A-B or B-A).
--   2. Enforce at the database level that a new proposal cannot be created between
--      members who already have an active/confirmed match, regardless of order.
--   3. Validate existing database records first: if conflicting duplicate pending
--      proposals or matched pending proposals exist, safely abort with a detailed
--      error report without deleting or mutating existing user records.
--   4. Preserve Phase 1 block protection, independent dual consent, and terminal
--      proposal status workflows (declined/expired proposals do not block future proposals).
--
-- Re-runnable and additive.
-- ============================================================================

-- 1. Pre-constraint Data Integrity Check
-- Ensures no existing rows violate the unique pending proposal rule before
-- adding constraints or triggers. Aborts safely if conflicts are detected.
DO $$
DECLARE
  v_dup_count int;
  v_match_conflict_count int;
BEGIN
  -- Check for existing duplicate pending proposals between the same pair
  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)
    FROM public.match_proposals
    WHERE status = 'pending'
    GROUP BY LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)
    HAVING count(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Migration 014 aborted: % duplicate pending proposal pair(s) found in public.match_proposals. Manual review required.', v_dup_count;
  END IF;

  -- Check for existing pending proposals where a confirmed match already exists
  SELECT count(*) INTO v_match_conflict_count
  FROM public.match_proposals p
  JOIN public.matches m
    ON m.user_a = LEAST(p.user_a_id, p.user_b_id)
   AND m.user_b = GREATEST(p.user_a_id, p.user_b_id)
  WHERE p.status = 'pending';

  IF v_match_conflict_count > 0 THEN
    RAISE EXCEPTION 'Migration 014 aborted: % pending proposal(s) exist for members who already have a confirmed match. Manual review required.', v_match_conflict_count;
  END IF;
END $$;

-- 2. Unique Partial Index on Pending Proposals
-- Enforces at the database level that at most ONE pending proposal can exist
-- between any two users, regardless of who is user_a_id vs user_b_id.
-- Terminal proposals ('declined', 'accepted', 'expired') are excluded from the
-- index filter, allowing legitimate subsequent proposals in the future.
CREATE UNIQUE INDEX IF NOT EXISTS idx_match_proposals_unique_pending_pair
  ON public.match_proposals (
    LEAST(user_a_id, user_b_id),
    GREATEST(user_a_id, user_b_id)
  )
  WHERE status = 'pending';

COMMENT ON INDEX public.idx_match_proposals_unique_pending_pair IS
  'Guarantees at most one pending proposal exists per member pair regardless of A/B ordering.';

-- 3. Comprehensive Proposal Integrity Trigger on INSERT
-- Replaces/enhances check_proposal_not_blocked() to enforce all integrity rules:
--   a) Self-proposal rejection (user_a_id <> user_b_id)
--   b) Existing confirmed match rejection (bidirectional)
--   c) Duplicate pending proposal rejection (bidirectional)
--   d) Bidirectional block protection (public.blocked_pair)
CREATE OR REPLACE FUNCTION public.check_match_proposal_integrity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_u1 uuid := LEAST(NEW.user_a_id, NEW.user_b_id);
  v_u2 uuid := GREATEST(NEW.user_a_id, NEW.user_b_id);
BEGIN
  -- Guard 1: Self-match protection
  IF NEW.user_a_id = NEW.user_b_id THEN
    RAISE EXCEPTION 'Cannot create match proposal with the same person.';
  END IF;

  -- Guard 2: Bidirectional block check
  IF public.blocked_pair(NEW.user_a_id, NEW.user_b_id) THEN
    RAISE EXCEPTION 'This introduction cannot be created because a blocking restriction exists.';
  END IF;

  -- Guard 3: Existing confirmed match check (matches table stores user_a < user_b canonical order)
  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE user_a = v_u1 AND user_b = v_u2
  ) THEN
    RAISE EXCEPTION 'These members are already matched.';
  END IF;

  -- Guard 4: Duplicate pending proposal check (defensive application-level error before index violation)
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

-- Replace the previous block-only trigger with the unified integrity trigger
DROP TRIGGER IF EXISTS trg_check_proposal_not_blocked ON public.match_proposals;
DROP TRIGGER IF EXISTS trg_check_match_proposal_integrity ON public.match_proposals;

CREATE TRIGGER trg_check_match_proposal_integrity
  BEFORE INSERT ON public.match_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.check_match_proposal_integrity();

COMMENT ON FUNCTION public.check_match_proposal_integrity() IS
  'Rejects proposals violating self-match, active blocks, existing matches, or duplicate pending proposals.';
