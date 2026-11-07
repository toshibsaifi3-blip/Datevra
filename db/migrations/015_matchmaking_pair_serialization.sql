-- ============================================================================
-- DATEVRA Migration 015: Matchmaking Pair Serialization & Concurrency Protection (Phase 3.1)
--
-- PROBLEM:
--   Under PostgreSQL default READ COMMITTED isolation, a concurrency race exists
--   between:
--     Transaction A: Admin inserting a new curated proposal (BEFORE INSERT trigger
--                    checks public.matches, finds no row, and proceeds).
--     Transaction B: User B accepting an existing proposal (or completing mutual likes),
--                    which inserts a confirmed match into public.matches and commits.
--
--   Because the proposal insert trigger only queried public.matches without an exclusive
--   serialization mechanism on the unordered member pair, both transactions could pass
--   their checks concurrently, leaving an active pending proposal for an already matched pair.
--
-- SOLUTION:
--   1. Deterministic Two-Key Advisory Lock Protocol:
--      Every state-changing operation involving an unordered pair (u1, u2) acquires
--      a transaction-scoped advisory lock using PostgreSQL's 64-bit pair locking function:
--        pg_advisory_xact_lock(hashtext(u1::text), hashtext(u2::text))
--      where u1 := LEAST(a, b) and u2 := GREATEST(a, b).
--      Because the keys are sorted canonically (LEAST, GREATEST), the locking order
--      is strictly deterministic across all callers, completely preventing deadlocks.
--
--   2. Synchronized Serialization Across Match & Proposal Workflows:
--      a) check_match_proposal_integrity() (BEFORE INSERT ON public.match_proposals):
--         Acquires the pair advisory lock before querying public.matches, public.blocks,
--         and public.match_proposals.
--      b) respond_to_proposal() (Dual-accept match confirmation path):
--         Acquires the exact same pair advisory lock before inserting into public.matches.
--      c) handle_mutual_like() (Organic mutual like match formation path):
--         Acquires the exact same pair advisory lock before inserting into public.matches.
--
--   3. Cross-Workflow Cancellation:
--      When a match is confirmed between (u1, u2) via respond_to_proposal() or mutual likes,
--      any other pending proposals between that exact pair are automatically transitioned
--      to 'declined' with responded_at = now(), guaranteeing no orphan pending proposals remain.
--
--   4. Preserves:
--      - Partial unique index idx_match_proposals_unique_pending_pair
--      - Phase 1 bidirectional block protection (public.blocked_pair)
--      - Migration 013 non-throwing persistent decline contract
--      - Dual independent consent, notifications, conversations, and RLS
--      - Exact function signatures, return types, and grants
-- ============================================================================

-- 1. Helper function for acquiring deterministic pair advisory lock
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
  -- Acquire 64-bit pair advisory transaction lock. Released automatically on commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext(v_u1::text), hashtext(v_u2::text));
END;
$$;

COMMENT ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) IS
  'Acquires a deterministic, transaction-scoped advisory lock on an unordered user pair to serialize match and proposal operations.';

REVOKE ALL ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) TO authenticated;

-- 2. Update Proposal Integrity Trigger with Pair Serialization
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

  -- Guard 2: Deterministic pair serialization
  -- Serializes against concurrent match confirmations and proposal creations for this exact pair.
  PERFORM public.lock_matchmaking_pair(v_u1, v_u2);

  -- Guard 3: Bidirectional block check
  IF public.blocked_pair(NEW.user_a_id, NEW.user_b_id) THEN
    RAISE EXCEPTION 'This introduction cannot be created because a blocking restriction exists.';
  END IF;

  -- Guard 4: Confirmed match check (rechecked under lock)
  IF EXISTS (
    SELECT 1 FROM public.matches
    WHERE user_a = v_u1 AND user_b = v_u2
  ) THEN
    RAISE EXCEPTION 'These members are already matched.';
  END IF;

  -- Guard 5: Duplicate pending proposal check (rechecked under lock)
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

-- 3. Update respond_to_proposal() with Pair Serialization & Open Proposal Cleanup
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

  -- Acquire pair advisory lock to serialize against concurrent proposal creation and match formation
  PERFORM public.lock_matchmaking_pair(v_u1, v_u2);

  -- Block protection: if a block was created after proposal creation,
  -- transition the proposal to declined and return the persisted row normally
  IF public.blocked_pair(v_prop.user_a_id, v_prop.user_b_id) THEN
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
  END IF;

  -- Recheck whether a confirmed match already exists for this pair
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
    VALUES (v_u1, v_u2)
    ON CONFLICT (user_a, user_b) DO NOTHING;

    -- Mirror the like-trigger: ensure a conversation row + notifications exist
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

    -- Clean up any other pending proposals between this exact pair
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE LEAST(user_a_id, user_b_id) = v_u1
       AND GREATEST(user_a_id, user_b_id) = v_u2
       AND status = 'pending'
       AND id <> v_prop.id;
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
  'Record a user response to a match proposal with pair serialization and persistent block protection.';

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;

-- 4. Update handle_mutual_like() with Pair Serialization & Open Proposal Cleanup
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
  -- Only proceed if the reciprocal like exists (mutual interest).
  IF NOT EXISTS (
    SELECT 1 FROM public.likes
    WHERE from_user_id = NEW.to_user_id AND to_user_id = NEW.from_user_id
  ) THEN
    RETURN NEW;
  END IF;

  -- Acquire pair advisory lock to serialize against concurrent proposal creation
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

  -- Close any open curated proposals between this pair now that they have matched
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
