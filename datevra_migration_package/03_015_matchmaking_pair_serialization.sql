-- ============================================================================
-- DATEVRA Execution Package File 03 (from 015_matchmaking_pair_serialization.sql)
-- RUN ONLY AFTER File 02 (014) AND PREFLIGHT QUERY 3 REVIEW OF handle_mutual_like().
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.match_proposals') IS NULL
     OR to_regclass('public.matches') IS NULL
     OR to_regclass('public.likes') IS NULL THEN
    RAISE EXCEPTION 'Package 03 Aborted: Required matchmaking tables do not exist.';
  END IF;

  IF to_regprocedure('public.blocked_pair(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'Package 03 Aborted: public.blocked_pair(uuid,uuid) is missing.';
  END IF;

  IF to_regprocedure('public.check_match_proposal_integrity()') IS NULL THEN
    RAISE EXCEPTION 'Package 03 Aborted: public.check_match_proposal_integrity() is missing. Run File 02 first.';
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
  'Acquires a deterministic, transaction-scoped advisory lock on an unordered user pair to serialize match and proposal operations.';

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
  v_u1    uuid;
  v_u2    uuid;
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

  v_u1 := LEAST(v_prop.user_a_id, v_prop.user_b_id);
  v_u2 := GREATEST(v_prop.user_a_id, v_prop.user_b_id);

  PERFORM public.lock_matchmaking_pair(v_u1, v_u2);

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

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_mutual_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a    uuid := LEAST(NEW.from_user_id, NEW.to_user_id);
  b    uuid := GREATEST(NEW.from_user_id, NEW.to_user_id);
  m_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.likes
    WHERE from_user_id = NEW.to_user_id AND to_user_id = NEW.from_user_id
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.lock_matchmaking_pair(a, b);

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

COMMENT ON FUNCTION public.handle_mutual_like() IS
  'Creates match, conversation and notifications on mutual like, serializing against proposals and declining pending proposals.';

COMMIT;
