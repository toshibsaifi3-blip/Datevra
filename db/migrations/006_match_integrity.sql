-- =====================================================================
-- DATEVRA migration 006 — match integrity hardening (audit fix)
--
-- PROBLEM:
--   The matches_update_participants policy (002) lets either participant
--   UPDATE a match row, but only checks that the caller is still *a*
--   participant in the new row. A malicious client could therefore:
--     - swap the OTHER participant (user_a/user_b) to a different user,
--       hijacking the match and its conversation, or
--     - rewrite the compatibility score / factors shown in the UI.
--
-- FIX (additive — no data changes):
--   freeze_match_participants trigger: user_a and user_b become immutable
--   after insert. The legitimate compatibility write-back (002) only ever
--   touches compatibility/factors, so no working feature is affected.
--   Unmatch still works via matches_delete_participants (DELETE policy).
--
-- Apply AFTER 001–005. Re-runnable.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.freeze_match_participants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.user_a IS DISTINCT FROM NEW.user_a
     OR OLD.user_b IS DISTINCT FROM NEW.user_b THEN
    RAISE EXCEPTION 'Match participants cannot be changed after creation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_match_participants ON public.matches;
CREATE TRIGGER trg_freeze_match_participants
  BEFORE UPDATE OF user_a, user_b ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.freeze_match_participants();

COMMENT ON FUNCTION public.freeze_match_participants() IS
  'Match participant swap / hijack prevention. Compatibility and factor write-backs are unaffected; unmatch uses the DELETE policy.';
