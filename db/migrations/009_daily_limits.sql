-- =====================================================================
-- 009_daily_limits.sql — Strict daily action limits for FREE users
--
-- Rules enforced here (server-side, bypass-proof):
--   * Free users: max 20 likes/day AND max 20 profile-interest views/day,
--     tracked as two independent counters.
--   * Paid members (active subscription or active plan): exempt, unlimited.
--   * Daily reset: IST midnight, computed from the DATABASE clock —
--     (now() AT TIME ZONE 'Asia/Kolkata')::date. Clients can never shift it.
--   * Likes are gated by a BEFORE INSERT trigger on public.likes, so EVERY
--     insert path (app, direct API, SQL) is limited. Refreshing, logging
--     out/in, or firing parallel requests cannot bypass it: the counter
--     upsert takes a row lock and the increment is conditional
--     (used_count < 20), evaluated atomically per transaction.
--   * Profile-interest views are gated by the record_profile_interest()
--     RPC, which checks + increments atomically as the caller (SECURITY
--     DEFINER) using auth.uid() — the caller can never act as another user.
--   * Matches RECEIVED are never limited by anything in this file.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Counter table: one row per (user, action, IST day)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.daily_action_limits (
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  action     text NOT NULL CHECK (action IN ('like', 'interest')),
  day        date NOT NULL,
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, action, day)
);

COMMENT ON TABLE public.daily_action_limits IS
  'Per-day action counters for free-user limits. day is the IST calendar date, '
  'always derived from the database clock — never from client input.';

-- ---------------------------------------------------------------------
-- 2. Helper: is this user currently a paid member?
--    (SECURITY DEFINER so RLS on subscriptions cannot hide rows from the check.
--     Called only from other privileged routines / the likes trigger.)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._has_active_membership(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Active subscription row (NULL expiry = lifetime membership) …
  IF EXISTS (
    SELECT 1 FROM public.subscriptions
    WHERE user_id = p_user_id
      AND status = 'active'
      AND (expires_at IS NULL OR expires_at > now())
  ) THEN
    RETURN true;
  END IF;
  -- … or an active plan stamped on the profile (NULL expiry = lifetime).
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = p_user_id
      AND plan_id IS NOT NULL
      AND (plan_expires_at IS NULL OR plan_expires_at > now())
  ) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public._has_active_membership(uuid) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Helper: today's IST date + next IST midnight (single source of truth)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._ist_today()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$ SELECT (now() AT TIME ZONE 'Asia/Kolkata')::date $$;

CREATE OR REPLACE FUNCTION public._next_ist_midnight()
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ((public._ist_today() + 1) AT TIME ZONE 'Asia/Kolkata')::timestamptz
$$;

REVOKE ALL ON FUNCTION public._ist_today() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._next_ist_midnight() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Core gate: atomically consume one unit of a daily action.
--    Returns true when the action is allowed (and was counted),
--    false when the free limit is already exhausted.
--    Paid members always return true and are never counted.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._consume_daily_action(p_user_id uuid, p_action text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_day date := public._ist_today();
  v_updated integer;
BEGIN
  IF p_action NOT IN ('like', 'interest') THEN
    RAISE EXCEPTION 'Unknown daily action: %', p_action USING ERRCODE = 'P0001';
  END IF;

  -- Paid members: unlimited, never counted.
  IF public._has_active_membership(p_user_id) THEN
    RETURN true;
  END IF;

  -- Atomic upsert: insert the day row, or increment only while under 20.
  -- Concurrent callers serialize on the row lock; the WHERE is re-evaluated
  -- after the lock is acquired, so the counter can never exceed 20.
  INSERT INTO public.daily_action_limits (user_id, action, day, used_count, updated_at)
  VALUES (p_user_id, p_action, v_day, 1, now())
  ON CONFLICT (user_id, action, day)
  DO UPDATE SET
    used_count = public.daily_action_limits.used_count + 1,
    updated_at = now()
  WHERE public.daily_action_limits.used_count < 20;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public._consume_daily_action(uuid, text) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Hard enforcement for LIKES: BEFORE INSERT trigger on public.likes.
--    Runs inside the insert transaction — if the like insert later fails
--    (e.g. duplicate like), the counter increment rolls back with it, so
--    failed/duplicate likes never consume the daily allowance.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_like_limit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._consume_daily_action(NEW.from_user_id, 'like') THEN
    RAISE EXCEPTION 'DAILY_LIKE_LIMIT_REACHED'
      USING ERRCODE = 'P0001',
            HINT = 'Free accounts are limited to 20 likes per day. Upgrade for unlimited likes.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_like_limit ON public.likes;
CREATE TRIGGER trg_enforce_like_limit
  BEFORE INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.enforce_like_limit();

COMMENT ON TRIGGER trg_enforce_like_limit ON public.likes IS
  'Server-side daily like cap for free users (20/day, IST reset). Paid members bypass.';

-- ---------------------------------------------------------------------
-- 6. RPC: record a profile-interest view (the "show interest" action).
--    The caller is identified by auth.uid() — never by a client argument.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_profile_interest(p_viewed_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_viewer uuid := auth.uid();
  v_allowed boolean;
  v_used integer;
  v_paid boolean;
BEGIN
  IF v_viewer IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF p_viewed_user_id IS NULL OR p_viewed_user_id = v_viewer THEN
    RAISE EXCEPTION 'Invalid profile' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_viewed_user_id) THEN
    RAISE EXCEPTION 'Profile not found' USING ERRCODE = 'P0001';
  END IF;

  v_paid := public._has_active_membership(v_viewer);
  v_allowed := public._consume_daily_action(v_viewer, 'interest');

  SELECT used_count INTO v_used
  FROM public.daily_action_limits
  WHERE user_id = v_viewer AND action = 'interest' AND day = public._ist_today();

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'used', COALESCE(v_used, 0),
    'limit', 20,
    'is_paid', v_paid,
    'resets_at', public._next_ist_midnight()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_profile_interest(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_profile_interest(uuid) TO authenticated;

COMMENT ON FUNCTION public.record_profile_interest(uuid) IS
  'Records one profile-interest view for the caller, enforcing the free 20/day cap.';

-- ---------------------------------------------------------------------
-- 7. RPC: read today's usage counters for the caller (drives the UI).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_daily_usage()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_day date := public._ist_today();
  v_likes integer := 0;
  v_interests integer := 0;
  v_paid boolean;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  v_paid := public._has_active_membership(v_user);

  SELECT used_count INTO v_likes FROM public.daily_action_limits
  WHERE user_id = v_user AND action = 'like' AND day = v_day;
  SELECT used_count INTO v_interests FROM public.daily_action_limits
  WHERE user_id = v_user AND action = 'interest' AND day = v_day;

  RETURN jsonb_build_object(
    'likes_used', COALESCE(v_likes, 0),
    'interests_used', COALESCE(v_interests, 0),
    'like_limit', 20,
    'interest_limit', 20,
    'is_paid', v_paid,
    'resets_at', public._next_ist_midnight()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_daily_usage() TO authenticated;

COMMENT ON FUNCTION public.get_daily_usage() IS
  'Today''s like/interest usage for the caller (IST day). Paid members report is_paid=true.';

-- ---------------------------------------------------------------------
-- 8. RLS: users may read ONLY their own counters; all writes go through
--    the privileged trigger / RPCs above. No direct insert/update/delete.
-- ---------------------------------------------------------------------
ALTER TABLE public.daily_action_limits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_limits_select_own ON public.daily_action_limits;
CREATE POLICY daily_limits_select_own
  ON public.daily_action_limits FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT / UPDATE / DELETE policies: only the SECURITY DEFINER routines
-- (trigger + RPCs) may write. Service role bypasses RLS as usual.

-- ---------------------------------------------------------------------
-- 9. Retention hygiene: counters are tiny; prune rows older than 90 days.
--    Run manually or via pg_cron/scheduled job — never blocks the app.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_daily_action_limits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.daily_action_limits WHERE day < CURRENT_DATE - INTERVAL '90 days';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.prune_daily_action_limits() FROM PUBLIC, anon, authenticated;

-- =====================================================================
-- Verification queries (run after applying):
--   SELECT * FROM public.daily_action_limits LIMIT 5;
--   SELECT public.get_daily_usage();  -- as an authenticated user
-- =====================================================================
