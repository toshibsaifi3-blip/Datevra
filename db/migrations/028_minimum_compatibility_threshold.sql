-- ============================================================================
-- DATEVRA Migration 028: 75% Minimum Compatibility Requirement for Matchmaking
--
-- GOAL:
--   Enforce the authoritative business rule at the database layer:
--   A mutual-like match can ONLY be formed when compatibility >= 75%.
--     - Compatibility >= 75% : Eligible for matchmaking.
--     - Compatibility <  75% : Not eligible; match, conversation, and match
--                              notifications are NOT created.
--     - NULL / unavailable   : Fails closed (blocked safely).
--
-- DESIGN:
--   1. Centralized threshold constant function:
--      public.min_match_compatibility() -> integer (75)
--      public.is_compatibility_eligible(p_score integer) -> boolean
--   2. Server-side compatibility calculation:
--      public.calculate_pair_compatibility(p_from_user_id uuid, p_to_user_id uuid)
--      mirrors Datevra's transparent 6-factor computeCompatibility() formula
--      using public.profiles and public.match_preferences:
--        - Shared interests + hobbies (max 35)
--        - Relationship intent alignment (max 25)
--        - Age preference fit (max 15)
--        - City / location (max 10)
--        - Lifestyle overlap (max 10)
--        - Other profile completeness (max 5)
--      Revoked from PUBLIC, anon, authenticated (internal SECURITY DEFINER helper).
--   3. Authoritative enforcement inside public.handle_mutual_like():
--      Preserves all Migration 015/016 & Gate 3 concurrency and security guarantees:
--        - Canonical pair advisory lock FIRST (public.lock_matchmaking_pair(a, b))
--        - Reciprocal like check under advisory lock
--        - Bidirectional block check (public.blocked_pair(a, b)) under lock
--        - Minimum compatibility threshold check (75%) under lock
--        - Only if eligible: creates match (with compatibility score),
--          conversation, match notifications, and declines pending proposals.
--   4. Preserves manual curator match proposals (respond_to_proposal) as a
--      separate dual-consent admin workflow without altering RLS or lock order.
--
-- Apply AFTER 027_seed_curated_experiences.sql (and Gate 3 / 016). Re-runnable.
-- ============================================================================

BEGIN;

-- 1. Centralized minimum compatibility threshold constant (75%)
CREATE OR REPLACE FUNCTION public.min_match_compatibility()
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT 75;
$$;

COMMENT ON FUNCTION public.min_match_compatibility() IS
  'Authoritative minimum compatibility percentage (75%) required for automatic matchmaking.';

REVOKE ALL ON FUNCTION public.min_match_compatibility() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.min_match_compatibility() TO authenticated;

-- 2. Strict threshold predicate (NULL / < 75 fails closed)
CREATE OR REPLACE FUNCTION public.is_compatibility_eligible(p_score integer)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p_score IS NOT NULL AND p_score >= public.min_match_compatibility();
$$;

COMMENT ON FUNCTION public.is_compatibility_eligible(integer) IS
  'Returns true only when p_score is non-null and >= min_match_compatibility() (75).';

REVOKE ALL ON FUNCTION public.is_compatibility_eligible(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_compatibility_eligible(integer) TO authenticated;

-- 3. Internal server-side compatibility score helper (mirrors src/lib/compat.ts)
CREATE OR REPLACE FUNCTION public.calculate_pair_compatibility(
  p_from_user_id uuid,
  p_to_user_id   uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_me           public.profiles%ROWTYPE;
  v_them         public.profiles%ROWTYPE;
  v_prefs        public.match_preferences%ROWTYPE;
  v_has_prefs    boolean := false;
  v_score        integer := 0;
  v_interest_pts integer := 0;
  v_life_pts     integer := 0;
BEGIN
  IF p_from_user_id IS NULL OR p_to_user_id IS NULL OR p_from_user_id = p_to_user_id THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_me FROM public.profiles WHERE id = p_from_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_them FROM public.profiles WHERE id = p_to_user_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_me.age IS NULL OR v_them.age IS NULL OR v_them.profile_complete IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_prefs FROM public.match_preferences WHERE user_id = p_from_user_id;
  v_has_prefs := FOUND;

  -- 1. Shared interests + hobbies (max 35)
  WITH mine AS (
    SELECT DISTINCT lower(x) AS k
    FROM unnest(COALESCE(v_me.interests, '{}'::text[]) || COALESCE(v_me.hobbies, '{}'::text[])) AS x
    WHERE x IS NOT NULL AND x <> ''
  ),
  shared AS (
    SELECT DISTINCT lower(x) AS k
    FROM unnest(COALESCE(v_them.interests, '{}'::text[]) || COALESCE(v_them.hobbies, '{}'::text[])) AS x
    WHERE x IS NOT NULL AND x <> '' AND lower(x) IN (SELECT k FROM mine)
  )
  SELECT LEAST(35, COUNT(*)::integer * 9) INTO v_interest_pts FROM shared;
  v_score := v_score + COALESCE(v_interest_pts, 0);

  -- 2. Relationship intent alignment (max 25)
  IF COALESCE(v_me.relationship_intent, '') <> ''
     AND COALESCE(v_them.relationship_intent, '') <> '' THEN
    IF v_me.relationship_intent = v_them.relationship_intent THEN
      v_score := v_score + 25;
    ELSE
      v_score := v_score + 8;
    END IF;
  END IF;

  -- 3. Age preference fit (max 15)
  IF v_has_prefs THEN
    IF v_them.age >= v_prefs.age_min AND v_them.age <= v_prefs.age_max THEN
      v_score := v_score + 15;
    END IF;
  ELSE
    v_score := v_score + GREATEST(0, 15 - abs(v_me.age - v_them.age) * 2);
  END IF;

  -- 4. City / location (max 10)
  IF COALESCE(v_me.city, '') <> '' AND v_me.city = v_them.city THEN
    v_score := v_score + 10;
  ELSIF v_has_prefs AND v_them.city = ANY(COALESCE(v_prefs.cities, '{}'::text[])) THEN
    v_score := v_score + 6;
  END IF;

  -- 5. Lifestyle overlap (max 10)
  WITH my_life AS (
    SELECT DISTINCT lower(x) AS k
    FROM unnest(COALESCE(v_me.lifestyle, '{}'::text[])) AS x
    WHERE x IS NOT NULL AND x <> ''
  ),
  shared_life AS (
    SELECT x
    FROM unnest(COALESCE(v_them.lifestyle, '{}'::text[])) AS x
    WHERE x IS NOT NULL AND x <> '' AND lower(x) IN (SELECT k FROM my_life)
  )
  SELECT LEAST(10, COUNT(*)::integer * 4) INTO v_life_pts FROM shared_life;
  v_score := v_score + COALESCE(v_life_pts, 0);

  -- 6. Profile completeness of the other person (max 5)
  v_score := v_score + ROUND((v_them.profile_complete::numeric / 100.0) * 5.0)::integer;

  RETURN LEAST(100, GREATEST(0, v_score));
END;
$$;

COMMENT ON FUNCTION public.calculate_pair_compatibility(uuid, uuid) IS
  'Internal helper computing 0-100 compatibility score from real profile/preference factors; returns NULL when unavailable.';

REVOKE ALL ON FUNCTION public.calculate_pair_compatibility(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 4. Authoritative Mutual-Like Matchmaking Trigger with 75% Compatibility Gate
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

  -- Authoritative 75% compatibility gate: block match, conversation & match notifications if < 75 or NULL
  v_compat := public.calculate_pair_compatibility(NEW.from_user_id, NEW.to_user_id);
  IF NOT public.is_compatibility_eligible(v_compat) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.matches (user_a, user_b, compatibility)
  VALUES (a, b, v_compat)
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
  'Creates match, conversation, and notifications on mutual like ONLY when compatibility >= 75%, under canonical pair advisory lock.';

DROP TRIGGER IF EXISTS trg_mutual_like ON public.likes;
CREATE TRIGGER trg_mutual_like
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.handle_mutual_like();

COMMIT;
