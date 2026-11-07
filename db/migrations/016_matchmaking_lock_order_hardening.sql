-- ============================================================================
-- DATEVRA Migration 016: Matchmaking Lock Order Hardening & Permission Hardening (Phase 3.2)
--
-- GOAL:
--   1. Fix lock-order inversion between public.respond_to_proposal() and
--      public.handle_mutual_like():
--      - Previous behavior: respond_to_proposal() acquired a row lock on
--        match_proposals (FOR UPDATE) BEFORE acquiring the advisory pair lock.
--        handle_mutual_like() acquired the advisory pair lock BEFORE updating
--        match_proposals (which requires an exclusive row lock).
--        Under concurrent execution, this could lead to a deadlock.
--      - Hardened behavior: respond_to_proposal() first performs a non-locking
--        SELECT to resolve user_a_id and user_b_id, canonicalizes the pair with
--        LEAST() and GREATEST(), acquires public.lock_matchmaking_pair() FIRST,
--        and only then acquires the SELECT ... FOR UPDATE row lock.
--        This establishes a uniform lock hierarchy across all matchmaking paths:
--          Advisory Pair Lock -> Proposal Row Lock -> Match Row Lock
--
--   2. Harden public.lock_matchmaking_pair(uuid, uuid) execution permissions:
--      - Revoke EXECUTE from PUBLIC, anon, and authenticated.
--      - The helper remains callable internally by owning SECURITY DEFINER
--        functions (check_match_proposal_integrity, respond_to_proposal, handle_mutual_like).
--      - Prevents authenticated clients from directly calling the lock RPC to
--        arbitrarily squat on user pairs (Denial-of-Service vector).
--
--   3. Preserve:
--      - Exact respond_to_proposal() signature and return contract (public.match_proposals)
--      - Authentication and participant authorization checks
--      - Migration 013 non-throwing persistent decline on post-creation blocks
--      - Recheck of confirmed matches under lock
--      - Dual consent requirement for match confirmation
--      - Atomic match, conversation, and notification creation
--      - Cleanup of other pending proposals for the pair
--      - REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated on respond_to_proposal()
-- ============================================================================

-- 1. Harden Advisory-Lock Helper Permissions
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
  'Acquires a deterministic, transaction-scoped advisory lock on an unordered user pair to serialize match and proposal operations. Internal use only.';

-- Explicitly revoke execution privileges from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 2. Update respond_to_proposal() with Hardened Lock Order (Advisory Lock BEFORE Row Lock)
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
  -- 1. Authentication check
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Read user_a_id and user_b_id using a non-locking SELECT
  SELECT user_a_id, user_b_id INTO v_raw_a, v_raw_b
  FROM public.match_proposals
  WHERE id = p_proposal_id;

  -- If the proposal does not exist, return the existing appropriate error
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found.';
  END IF;

  -- 3. Canonicalize the pair using LEAST() and GREATEST()
  v_u1 := LEAST(v_raw_a, v_raw_b);
  v_u2 := GREATEST(v_raw_a, v_raw_b);

  -- 4. Acquire advisory pair lock FIRST before acquiring any proposal row lock
  -- Guarantees uniform lock hierarchy: Advisory Pair Lock -> Row Lock across all workflows
  PERFORM public.lock_matchmaking_pair(v_u1, v_u2);

  -- 5. Re-read the proposal using SELECT ... FOR UPDATE under the advisory lock
  SELECT * INTO v_prop
  FROM public.match_proposals
  WHERE id = p_proposal_id
  FOR UPDATE;

  -- 6. Revalidate current status and perform authorization and business checks against locked row
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Proposal not found.';
  END IF;
  IF v_prop.status <> 'pending' THEN
    RAISE EXCEPTION 'This proposal is no longer pending.';
  END IF;
  IF v_uid <> v_prop.user_a_id AND v_uid <> v_prop.user_b_id THEN
    RAISE EXCEPTION 'Not authorized for this proposal.';
  END IF;

  -- Ensure v_u1 / v_u2 reflect the locked row
  v_u1 := LEAST(v_prop.user_a_id, v_prop.user_b_id);
  v_u2 := GREATEST(v_prop.user_a_id, v_prop.user_b_id);

  -- 7. Block protection: if a block was created after proposal creation,
  -- transition the proposal to declined and return the persisted row normally (Migration 013 contract)
  IF public.blocked_pair(v_prop.user_a_id, v_prop.user_b_id) THEN
    UPDATE public.match_proposals
       SET status = 'declined',
           responded_at = now()
     WHERE id = v_prop.id
    RETURNING * INTO v_prop;
    RETURN v_prop;
  END IF;

  -- 8. Confirmed match check (rechecked under lock): if already matched, close proposal cleanly
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
  'Record a user response to a match proposal with hardened lock ordering (advisory before row lock) and persistent block protection.';

REVOKE ALL ON FUNCTION public.respond_to_proposal(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid, boolean) TO authenticated;
