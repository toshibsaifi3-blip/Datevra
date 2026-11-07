-- ============================================================================
-- DATEVRA Migration 013: Proposal Block Decline Persistence
--
-- Corrects the PostgreSQL transaction rollback defect in Migration 012's
-- public.respond_to_proposal() function.
--
-- Defect: In Migration 012, when a block was detected on a pending proposal,
-- the function updated status to 'declined' and immediately raised an
-- uncaught exception. In PostgreSQL, uncaught exceptions abort the transaction
-- and roll back all mutations, leaving the proposal pending in the database.
--
-- Correction: Safely replaces public.respond_to_proposal(). In the blocked-pair
-- branch, updates status to 'declined', sets responded_at = now(), and returns
-- the updated proposal row normally without raising an uncaught rollback exception.
--
-- Preserves:
-- - Exact function signature: respond_to_proposal(p_proposal_id uuid, p_accept boolean)
-- - Return type: public.match_proposals
-- - SECURITY DEFINER with SET search_path = public
-- - auth.uid() authentication and participant authorization
-- - FOR UPDATE row locking on public.match_proposals
-- - Bidirectional public.blocked_pair() safety check
-- - Dual consent requirement for mutual match and conversation creation
-- - REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated;
-- ============================================================================

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
  -- transition the proposal to declined and return the persisted row normally
  -- without raising an uncaught exception (which would roll back the decline).
  IF public.blocked_pair(v_prop.user_a_id, v_prop.user_b_id) THEN
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
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
  'Record a user response to a match proposal with persistent bidirectional block protection; creates match on dual accept.';

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;
