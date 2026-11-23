-- ============================================================================
-- DATEVRA Migration 029: Safe Reciprocal Like Match Retry & Notification Dedup
--
-- GOAL:
--   Resolve the edge case where BOTH like rows already exist in public.likes
--   (e.g., from a concurrent insert while compatibility was < 75%) and
--   compatibility later improves to >= 75%. Previously, retrying the like hit
--   unique constraint 23505 on public.likes, so AFTER INSERT trg_mutual_like
--   never re-fired and the eligible match remained locked.
--
-- DESIGN:
--   1. public.retry_mutual_like_match(p_target_user_id uuid) -> jsonb
--      - SECURITY DEFINER, SET search_path = pg_catalog, public, pg_temp
--      - Caller is derived strictly from auth.uid() (never trusted as param)
--      - Revoked from PUBLIC and anon; granted ONLY to authenticated
--      - NEVER inserts a like row (cannot bypass daily limits or forge likes)
--      - Acquires canonical pair advisory lock FIRST:
--          PERFORM public.lock_matchmaking_pair(a, b)
--      - Verifies NOT public.blocked_pair(a, b) immediately under the pair lock
--        (so a blocked pair with a pre-existing match row can never trigger
--        conversation creation or return 'already_matched')
--      - Idempotent: if match already exists, ensures conversation exists and
--        returns status = 'already_matched' WITHOUT creating duplicate
--        conversations or duplicate match notifications
--      - Verifies BOTH likes already exist under the pair lock
--      - Re-evaluates server-side compatibility via
--        public.calculate_pair_compatibility(v_caller, p_target_user_id)
--        and enforces public.is_compatibility_eligible(v_compat) (>= 75%)
--      - Creates match, conversation, notifications, and declines pending
--        proposals ONLY when a brand-new match row is actually inserted
--        (m_id IS NOT NULL)
--   2. Hardens public.handle_mutual_like() with the same early existing-match
--      check and m_id IS NOT NULL guard so concurrent trigger executions can
--      never insert duplicate match notifications.
--   3. Preserves separate manual Admin curated proposals (respond_to_proposal)
--      and all existing RLS policies, triggers, and constraints untouched.
--
-- Apply AFTER 028_minimum_compatibility_threshold.sql. Re-runnable.
-- DO NOT run automatically from app code; review and apply via Supabase SQL.
-- ============================================================================

BEGIN;

-- 1. Safe authenticated RPC to retry/unlock an already-existing reciprocal like
CREATE OR REPLACE FUNCTION public.retry_mutual_like_match(
  p_target_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  a             uuid;
  b             uuid;
  v_existing    record;
  v_compat      integer;
  m_id          uuid;
  v_min_compat  integer := public.min_match_compatibility();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL OR p_target_user_id = v_caller THEN
    RETURN jsonb_build_object(
      'status', 'no_mutual_like',
      'match_id', NULL,
      'compatibility', NULL,
      'min_compatibility', v_min_compat
    );
  END IF;

  a := LEAST(v_caller, p_target_user_id);
  b := GREATEST(v_caller, p_target_user_id);

  -- Canonical Lock Order Step 1: Advisory Pair Lock MUST precede all checks
  PERFORM public.lock_matchmaking_pair(a, b);

  -- Enforce bidirectional block immediately under the pair advisory lock
  -- so a blocked pair can never return 'already_matched' or create a conversation
  IF public.blocked_pair(a, b) THEN
    RETURN jsonb_build_object(
      'status', 'blocked',
      'match_id', NULL,
      'compatibility', NULL,
      'min_compatibility', v_min_compat
    );
  END IF;

  -- Idempotency check: if a match already exists, return it without duplicate side effects
  SELECT id, compatibility
    INTO v_existing
    FROM public.matches
   WHERE user_a = a AND user_b = b;

  IF FOUND THEN
    -- Ensure conversation exists (idempotent via UNIQUE(match_id)), never emit duplicate notifications
    INSERT INTO public.conversations (match_id, participant_ids)
    VALUES (v_existing.id, ARRAY[a, b])
    ON CONFLICT (match_id) DO NOTHING;

    RETURN jsonb_build_object(
      'status', 'already_matched',
      'match_id', v_existing.id,
      'compatibility', v_existing.compatibility,
      'min_compatibility', v_min_compat
    );
  END IF;

  -- Require BOTH directional like rows to already exist (never inserts a like)
  IF NOT EXISTS (
    SELECT 1 FROM public.likes
    WHERE from_user_id = v_caller AND to_user_id = p_target_user_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.likes
    WHERE from_user_id = p_target_user_id AND to_user_id = v_caller
  ) THEN
    RETURN jsonb_build_object(
      'status', 'no_mutual_like',
      'match_id', NULL,
      'compatibility', NULL,
      'min_compatibility', v_min_compat
    );
  END IF;

  -- Authoritative server-side 75% compatibility gate (NULL / < 75 fails closed)
  v_compat := public.calculate_pair_compatibility(v_caller, p_target_user_id);
  IF NOT public.is_compatibility_eligible(v_compat) THEN
    RETURN jsonb_build_object(
      'status', 'compatibility_blocked',
      'match_id', NULL,
      'compatibility', v_compat,
      'min_compatibility', v_min_compat
    );
  END IF;

  -- Atomic match creation; m_id is non-null ONLY when this statement inserted the new row
  INSERT INTO public.matches (user_a, user_b, compatibility)
  VALUES (a, b, v_compat)
  ON CONFLICT (user_a, user_b) DO NOTHING
  RETURNING id INTO m_id;

  IF m_id IS NULL THEN
    SELECT id, compatibility
      INTO v_existing
      FROM public.matches
     WHERE user_a = a AND user_b = b;

    IF FOUND THEN
      INSERT INTO public.conversations (match_id, participant_ids)
      VALUES (v_existing.id, ARRAY[a, b])
      ON CONFLICT (match_id) DO NOTHING;

      RETURN jsonb_build_object(
        'status', 'already_matched',
        'match_id', v_existing.id,
        'compatibility', v_existing.compatibility,
        'min_compatibility', v_min_compat
      );
    END IF;

    RETURN jsonb_build_object(
      'status', 'no_mutual_like',
      'match_id', NULL,
      'compatibility', NULL,
      'min_compatibility', v_min_compat
    );
  END IF;

  -- Create conversation, match notifications, and decline pending proposals ONCE for the new match
  INSERT INTO public.conversations (match_id, participant_ids)
  VALUES (m_id, ARRAY[a, b])
  ON CONFLICT (match_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES
    (v_caller, 'match', 'It''s a match!',
     'You and your new match liked each other. Say hello!', '/matches'),
    (p_target_user_id, 'match', 'It''s a match!',
     'You and your new match liked each other. Say hello!', '/matches');

  UPDATE public.match_proposals
     SET status = 'declined',
         responded_at = now()
   WHERE LEAST(user_a_id, user_b_id) = a
     AND GREATEST(user_a_id, user_b_id) = b
     AND status = 'pending';

  RETURN jsonb_build_object(
    'status', 'matched',
    'match_id', m_id,
    'compatibility', v_compat,
    'min_compatibility', v_min_compat
  );
END;
$$;

COMMENT ON FUNCTION public.retry_mutual_like_match(uuid) IS
  'Safely re-evaluates compatibility for an already-existing reciprocal like pair under canonical pair lock, creating a single match/conversation/notification set only when eligible (>= 75%) and not blocked.';

REVOKE ALL ON FUNCTION public.retry_mutual_like_match(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.retry_mutual_like_match(uuid) TO authenticated;

-- 2. Harden handle_mutual_like() so duplicate notifications can never be emitted
--    if a match row already existed under concurrent execution.
CREATE OR REPLACE FUNCTION public.handle_mutual_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  a        uuid := LEAST(NEW.from_user_id, NEW.to_user_id);
  b        uuid := GREATEST(NEW.from_user_id, NEW.to_user_id);
  m_id     uuid;
  v_compat integer;
BEGIN
  -- Canonical Lock Order Step 1: Advisory Pair Lock MUST precede reciprocal-like check
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

  -- Fast-path idempotency: if a match already exists, ensure conversation and exit without duplicate notifications
  SELECT id INTO m_id FROM public.matches WHERE user_a = a AND user_b = b;
  IF m_id IS NOT NULL THEN
    INSERT INTO public.conversations (match_id, participant_ids)
    VALUES (m_id, ARRAY[a, b])
    ON CONFLICT (match_id) DO NOTHING;
    RETURN NEW;
  END IF;

  -- Authoritative 75% compatibility gate: block match, conversation & match notifications if < 75 or NULL
  v_compat := public.calculate_pair_compatibility(NEW.from_user_id, NEW.to_user_id);
  IF NOT public.is_compatibility_eligible(v_compat) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.matches (user_a, user_b, compatibility)
  VALUES (a, b, v_compat)
  ON CONFLICT (user_a, user_b) DO NOTHING
  RETURNING id INTO m_id;

  -- Emit conversation, notifications, and proposal cleanup ONLY when this call created the match
  IF m_id IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.conversations (match_id, participant_ids)
  VALUES (m_id, ARRAY[a, b])
  ON CONFLICT (match_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES
    (NEW.from_user_id, 'match', 'It''s a match!',
     'You and your new match liked each other. Say hello!', '/matches'),
    (NEW.to_user_id, 'match', 'It''s a match!',
     'You and your new match liked each other. Say hello!', '/matches');

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
  'Creates match, conversation, and notifications once on mutual like ONLY when compatibility >= 75% and not blocked, under canonical pair advisory lock.';

DROP TRIGGER IF EXISTS trg_mutual_like ON public.likes;
CREATE TRIGGER trg_mutual_like
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.handle_mutual_like();

COMMIT;
