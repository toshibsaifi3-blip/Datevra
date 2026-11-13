-- ============================================================================
-- DATEVRA Execution Package File 04 (from 016_matchmaking_lock_order_hardening.sql)
-- RUN ONLY AFTER File 03 (015).
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.match_proposals') IS NULL THEN
    RAISE EXCEPTION 'Package 04 Aborted: public.match_proposals does not exist. Run File 01 first.';
  END IF;
  IF to_regprocedure('public.lock_matchmaking_pair(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Package 04 Aborted: public.lock_matchmaking_pair(uuid,uuid) does not exist. Run File 03 first.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.lock_matchmaking_pair(p_user_a uuid, p_user_b uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_u1 uuid := LEAST(p_user_a, p_user_b);
  v_u2 uuid := GREATEST(p_user_a, p_user_b);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(v_u1::text), hashtext(v_u2::text));
END;
$$;

COMMENT ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) IS
  'Acquires a deterministic, transaction-scoped advisory lock on an unordered user pair to serialize match and proposal operations. Internal use only.';

REVOKE ALL ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;

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
  v_prop    public.match_proposals%ROWTYPE;
  v_uid     uuid := auth.uid();
  v_is_a    boolean;
  v_raw_a   uuid;
  v_raw_b   uuid;
  v_u1      uuid;
  v_u2      uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  SELECT user_a_id, user_b_id INTO v_raw_a, v_raw_b
  FROM public.match_proposals
  WHERE id = p_proposal_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found.';
  END IF;

  v_u1 := LEAST(v_raw_a, v_raw_b);
  v_u2 := GREATEST(v_raw_a, v_raw_b);

  -- Acquire advisory pair lock FIRST before row lock
  PERFORM public.lock_matchmaking_pair(v_u1, v_u2);

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

  IF public.blocked_pair(v_prop.user_a_id, v_prop.user_b_id) THEN
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
  END IF;

  IF EXISTS (SELECT 1 FROM public.matches WHERE user_a = v_u1 AND user_b = v_u2) THEN
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
  'Record a user response to a match proposal with hardened lock ordering (advisory before row lock) and persistent block protection.';

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;

COMMIT;
