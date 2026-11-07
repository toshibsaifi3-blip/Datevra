-- =====================================================================
-- DATEVRA migration 012 — Matchmaking Proposal Block Protection (Phase 1)
--
-- GOAL:
--   1. Prevent admins from creating proposals between members when an active
--      block exists in either direction (A blocked B, or B blocked A).
--   2. Prevent proposal confirmation in respond_to_proposal() if a block
--      was added between members after the proposal was originally created.
--   3. Preserve existing row-locking, admin RLS, dual-consent, and self-match
--      protection.
--
-- Re-runnable and additive.
-- =====================================================================

-- 1. Trigger to reject proposals on insert if a blocking restriction exists
CREATE OR REPLACE FUNCTION public.check_proposal_not_blocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.blocked_pair(NEW.user_a_id, NEW.user_b_id) THEN
    RAISE EXCEPTION 'This introduction cannot be created because a blocking restriction exists.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_proposal_not_blocked ON public.match_proposals;
CREATE TRIGGER trg_check_proposal_not_blocked
  BEFORE INSERT ON public.match_proposals
  FOR EACH ROW EXECUTE FUNCTION public.check_proposal_not_blocked();

COMMENT ON FUNCTION public.check_proposal_not_blocked() IS
  'Rejects match proposal creation if a bidirectional block exists between the members.';

-- 2. Update respond_to_proposal() to verify block protection before confirmation
CREATE OR REPLACE FUNCTION public.respond_to_proposal(
  p_proposal_id uuid,
  p_accept      boolean
)
RETURNS public.match_proposals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop  public.match_proposals%ROWTYPE;
  v_uid   uuid := auth.uid();
  v_is_a  boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

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

  -- Block protection: if a block was created after proposal creation,
  -- abort confirmation and transition the proposal to declined.
  IF public.blocked_pair(v_prop.user_a_id, v_prop.user_b_id) THEN
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RAISE EXCEPTION 'This match cannot be confirmed because a blocking restriction exists.';
  END IF;

  v_is_a := (v_uid = v_prop.user_a_id);

  IF v_is_a THEN
    v_prop.user_a_response := p_accept;
  ELSE
    v_prop.user_b_response := p_accept;
  END IF;

  IF NOT p_accept THEN
    -- Either party declining closes the proposal; no match is created.
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
    -- Dual accept: create the match atomically (duplicate-safe).
    INSERT INTO public.matches (user_a, user_b)
    VALUES (
      LEAST(v_prop.user_a_id, v_prop.user_b_id),
      GREATEST(v_prop.user_a_id, v_prop.user_b_id)
    )
    ON CONFLICT (user_a, user_b) DO NOTHING;

    -- Mirror the like-trigger: ensure a conversation row + notifications exist
    INSERT INTO public.conversations (match_id, participant_ids)
    SELECT m.id, ARRAY[v_prop.user_a_id, v_prop.user_b_id]
    FROM public.matches m
    WHERE m.user_a = LEAST(v_prop.user_a_id, v_prop.user_b_id)
      AND m.user_b = GREATEST(v_prop.user_a_id, v_prop.user_b_id)
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
  ELSE
    -- First acceptance recorded; still pending the other party.
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
  'Record a user response to a match proposal with bidirectional block protection; creates match on dual accept.';

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;
