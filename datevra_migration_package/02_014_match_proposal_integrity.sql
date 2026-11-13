-- ============================================================================
-- DATEVRA Execution Package File 02 (from 014_match_proposal_integrity.sql)
-- RUN ONLY AFTER File 01 (010) AND PREFLIGHT QUERY 1 CONFIRMING blocked_pair().
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_dup_count int;
  v_match_conflict_count int;
BEGIN
  IF to_regclass('public.match_proposals') IS NULL
     OR to_regclass('public.matches') IS NULL THEN
    RAISE EXCEPTION 'Package 02 Aborted: public.match_proposals or public.matches does not exist. Run File 01 first.';
  END IF;

  IF to_regprocedure('public.blocked_pair(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Package 02 Aborted: public.blocked_pair(uuid,uuid) from Migration 004 is missing.';
  END IF;

  SELECT count(*) INTO v_dup_count
  FROM (
    SELECT LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)
    FROM public.match_proposals
    WHERE status = 'pending'
    GROUP BY LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id)
    HAVING count(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION 'Package 02 Aborted: % duplicate pending proposal pair(s) found.', v_dup_count;
  END IF;

  SELECT count(*) INTO v_match_conflict_count
  FROM public.match_proposals p
  JOIN public.matches m
    ON m.user_a = LEAST(p.user_a_id, p.user_b_id)
   AND m.user_b = GREATEST(p.user_a_id, p.user_b_id)
  WHERE p.status = 'pending';

  IF v_match_conflict_count > 0 THEN
    RAISE EXCEPTION 'Package 02 Aborted: % pending proposal(s) exist for already matched pairs.', v_match_conflict_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_match_proposals_unique_pending_pair
  ON public.match_proposals (
    LEAST(user_a_id, user_b_id),
    GREATEST(user_a_id, user_b_id)
  )
  WHERE status = 'pending';

COMMENT ON INDEX public.idx_match_proposals_unique_pending_pair IS
  'Guarantees at most one pending proposal exists per member pair regardless of A/B ordering.';

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
  IF NEW.user_a_id = NEW.user_b_id THEN
    RAISE EXCEPTION 'Cannot create match proposal with the same person.';
  END IF;

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
  'Rejects proposals violating self-match, active blocks, existing matches, or duplicate pending proposals.';

COMMIT;
