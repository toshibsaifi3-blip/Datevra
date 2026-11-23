-- ============================================================================
-- DATEVRA Migration 030: Automatic Date Offers (One-Time 100-Match Batch),
-- Manual Date Offers (Admin-to-Pair), and Invitation Dates (Admin-to-Member/Group)
--
-- Requirements covered:
--   - Requirement 1 & 2: Additive schema, strict RLS, SECURITY DEFINER RPCs
--   - Requirement 3: Automatic Date System (one-time initial batch of up to 10
--     offers when platform reaches 100 eligible mutual matches >= 75% compat,
--     evaluated both on Migration 030 installation and on subsequent match inserts)
--   - Requirement 4: Manual Date Offers (separate from match_proposals and
--     separate from automatic_date_offers)
--   - Requirement 5: Invitation Dates (separate from match_proposals and
--     manual_date_offers; strict invitee privacy; individual/group accept does
--     NOT auto-create a 2-person date_booking; pair mode requires dual accept
--     and a valid experience_id)
--
-- Transaction & concurrency guarantees:
--   - Expiry and pair-block transitions persist cleanly by returning the updated
--     row instead of raising an exception in the same transaction.
--   - Canonical lock order: advisory pair lock (lock_matchmaking_pair) is always
--     acquired before row-level FOR UPDATE locks to prevent deadlocks and
--     duplicate bookings under concurrent requests.
--   - Stale pending offers are expired before candidate selection and replacement
--     checks so expired offers never permanently block future valid offers.
--
-- Non-destructive & idempotent: safe to run on existing Datevra databases.
-- ============================================================================

-- ============================================================================
-- 1. AUTOMATIC DATE OFFER BATCHES & AUTOMATIC DATE OFFERS (Requirement 3)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.auto_date_offer_batches (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_key            text NOT NULL UNIQUE,
  threshold_target     integer NOT NULL DEFAULT 100 CHECK (threshold_target > 0),
  target_offer_count   integer NOT NULL DEFAULT 10 CHECK (target_offer_count > 0),
  eligible_match_count integer NOT NULL DEFAULT 0 CHECK (eligible_match_count >= 0),
  created_offer_count  integer NOT NULL DEFAULT 0 CHECK (created_offer_count >= 0),
  shortfall_count      integer NOT NULL DEFAULT 0 CHECK (shortfall_count >= 0),
  status               text NOT NULL DEFAULT 'processing'
                       CHECK (status IN ('processing', 'completed', 'failed')),
  error_detail         text,
  triggered_by         text NOT NULL DEFAULT 'system',
  created_at           timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz
);

COMMENT ON TABLE public.auto_date_offer_batches IS
  'Tracks the one-time initial automatic date offer batch triggered when Datevra reaches 100 eligible mutual matches (>= 75% compatibility).';

CREATE TABLE IF NOT EXISTS public.automatic_date_offers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id            uuid NOT NULL REFERENCES public.auto_date_offer_batches(id) ON DELETE RESTRICT,
  match_id            uuid NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  user_a              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  experience_id       text NOT NULL REFERENCES public.experiences(id) ON DELETE RESTRICT,
  cafe_id             text REFERENCES public.cafes(id) ON DELETE SET NULL,
  suggested_date      text NOT NULL,
  suggested_time      text NOT NULL,
  venue               text NOT NULL DEFAULT '',
  message             text,
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  user_a_response     boolean,
  user_b_response     boolean,
  user_a_responded_at timestamptz,
  user_b_responded_at timestamptz,
  expires_at          timestamptz NOT NULL,
  booking_id          uuid REFERENCES public.date_bookings(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT automatic_date_offers_canonical_pair CHECK (user_a < user_b)
);

COMMENT ON TABLE public.automatic_date_offers IS
  'System-generated automatic date offers (separate from manual_date_offers and match_proposals). Dual acceptance required before creating a booking.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_date_offers_unique_batch_pair
  ON public.automatic_date_offers (batch_id, user_a, user_b);

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_date_offers_active_pair
  ON public.automatic_date_offers (user_a, user_b)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_auto_date_offers_unique_booking_id
  ON public.automatic_date_offers (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auto_date_offers_users
  ON public.automatic_date_offers (user_a, user_b, status);

CREATE INDEX IF NOT EXISTS idx_auto_date_offers_status_expires
  ON public.automatic_date_offers (status, expires_at);

-- ============================================================================
-- 2. MANUAL DATE OFFERS & AUDIT EVENTS (Requirement 4)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.manual_date_offers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b                uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  match_id              uuid REFERENCES public.matches(id) ON DELETE SET NULL,
  experience_id         text NOT NULL REFERENCES public.experiences(id) ON DELETE RESTRICT,
  cafe_id               text REFERENCES public.cafes(id) ON DELETE SET NULL,
  suggested_date        text NOT NULL,
  suggested_time        text NOT NULL,
  venue                 text NOT NULL DEFAULT '',
  message               text,
  status                text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
  user_a_response       boolean,
  user_b_response       boolean,
  user_a_responded_at   timestamptz,
  user_b_responded_at   timestamptz,
  expires_at            timestamptz NOT NULL,
  booking_id            uuid REFERENCES public.date_bookings(id) ON DELETE SET NULL,
  created_by_admin_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancelled_by_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  cancel_reason         text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT manual_date_offers_canonical_pair CHECK (user_a < user_b)
);

COMMENT ON TABLE public.manual_date_offers IS
  'Admin-curated manual date offers sent to a specific pair (separate from match_proposals and automatic_date_offers). Dual acceptance required before creating a booking.';

-- Prevent duplicate active manual offers for the same pair on the same date.
-- Stale pending rows are transitioned to 'expired' prior to replacement inserts
-- so expired offers never permanently block new offers.
CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_date_offers_active_pair_date
  ON public.manual_date_offers (user_a, user_b, suggested_date)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS idx_manual_date_offers_unique_booking_id
  ON public.manual_date_offers (booking_id)
  WHERE booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manual_date_offers_users
  ON public.manual_date_offers (user_a, user_b, status);

CREATE INDEX IF NOT EXISTS idx_manual_date_offers_status_expires
  ON public.manual_date_offers (status, expires_at);

CREATE TABLE IF NOT EXISTS public.date_offer_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_source text NOT NULL CHECK (offer_source IN ('automatic', 'manual')),
  offer_id     uuid NOT NULL,
  actor_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role   text NOT NULL DEFAULT 'system' CHECK (actor_role IN ('system', 'admin', 'user')),
  event_type   text NOT NULL,
  detail       text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_date_offer_events_lookup
  ON public.date_offer_events (offer_source, offer_id, created_at DESC);

-- ============================================================================
-- 3. INVITATION DATES & PRIVATE RECIPIENT RESPONSES (Requirement 5)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.date_invitations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_mode     text NOT NULL DEFAULT 'individual'
                      CHECK (invitation_mode IN ('individual', 'group', 'pair')),
  title               text NOT NULL,
  experience_id       text REFERENCES public.experiences(id) ON DELETE SET NULL,
  cafe_id             text REFERENCES public.cafes(id) ON DELETE SET NULL,
  date                text NOT NULL,
  time                text NOT NULL,
  venue               text NOT NULL DEFAULT '',
  message             text,
  expires_at          timestamptz NOT NULL,
  status              text NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'cancelled', 'expired', 'completed')),
  created_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  cancelled_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT date_invitations_pair_requires_experience
    CHECK (invitation_mode <> 'pair' OR experience_id IS NOT NULL)
);

-- Ensure constraint exists idempotently if table pre-existed without it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'date_invitations_pair_requires_experience'
      AND conrelid = 'public.date_invitations'::regclass
  ) THEN
    ALTER TABLE public.date_invitations
      ADD CONSTRAINT date_invitations_pair_requires_experience
      CHECK (invitation_mode <> 'pair' OR experience_id IS NOT NULL);
  END IF;
END;
$$;

COMMENT ON TABLE public.date_invitations IS
  'Admin-issued date/event invitations to an individual member, group of members, or explicit pair (separate from match_proposals and manual_date_offers).';

CREATE TABLE IF NOT EXISTS public.date_invitation_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id   uuid NOT NULL REFERENCES public.date_invitations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  response        text NOT NULL DEFAULT 'pending'
                  CHECK (response IN ('pending', 'accepted', 'declined', 'expired')),
  responded_at    timestamptz,
  booking_id      uuid REFERENCES public.date_bookings(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invitation_id, user_id),
  CONSTRAINT date_invitation_recipients_distinct_partner
    CHECK (partner_user_id IS NULL OR partner_user_id <> user_id)
);

COMMENT ON TABLE public.date_invitation_recipients IS
  'Per-invitee response records. Strictly private: members can only view their own recipient row, never other invitees.';

CREATE INDEX IF NOT EXISTS idx_date_invitations_status_expires
  ON public.date_invitations (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_date_invitation_recipients_user
  ON public.date_invitation_recipients (user_id, response);

CREATE INDEX IF NOT EXISTS idx_date_invitation_recipients_inv
  ON public.date_invitation_recipients (invitation_id, response);

-- ============================================================================
-- 4. ROW LEVEL SECURITY POLICIES & LEAST-PRIVILEGE TABLE GRANTS
-- ============================================================================

ALTER TABLE public.auto_date_offer_batches    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automatic_date_offers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.manual_date_offers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_offer_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_invitations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_invitation_recipients ENABLE ROW LEVEL SECURITY;

-- Explicitly revoke all table privileges from PUBLIC, anon, and authenticated first,
-- then grant strictly SELECT to authenticated (all mutations go through RPCs).
REVOKE ALL ON TABLE public.auto_date_offer_batches    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.automatic_date_offers      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.manual_date_offers         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.date_offer_events          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.date_invitations           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.date_invitation_recipients FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.auto_date_offer_batches    TO authenticated;
GRANT SELECT ON TABLE public.automatic_date_offers      TO authenticated;
GRANT SELECT ON TABLE public.manual_date_offers         TO authenticated;
GRANT SELECT ON TABLE public.date_offer_events          TO authenticated;
GRANT SELECT ON TABLE public.date_invitations           TO authenticated;
GRANT SELECT ON TABLE public.date_invitation_recipients TO authenticated;

GRANT ALL ON TABLE public.auto_date_offer_batches    TO postgres, service_role;
GRANT ALL ON TABLE public.automatic_date_offers      TO postgres, service_role;
GRANT ALL ON TABLE public.manual_date_offers         TO postgres, service_role;
GRANT ALL ON TABLE public.date_offer_events          TO postgres, service_role;
GRANT ALL ON TABLE public.date_invitations           TO postgres, service_role;
GRANT ALL ON TABLE public.date_invitation_recipients TO postgres, service_role;

-- auto_date_offer_batches: Admin read only; writes via SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "auto_date_offer_batches_admin_select" ON public.auto_date_offer_batches;
CREATE POLICY "auto_date_offer_batches_admin_select"
  ON public.auto_date_offer_batches FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- automatic_date_offers: Participants or Admins read only; writes via RPCs
DROP POLICY IF EXISTS "automatic_date_offers_participant_or_admin_select" ON public.automatic_date_offers;
CREATE POLICY "automatic_date_offers_participant_or_admin_select"
  ON public.automatic_date_offers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b OR public.is_admin());

-- manual_date_offers: Participants or Admins read only; writes via RPCs
DROP POLICY IF EXISTS "manual_date_offers_participant_or_admin_select" ON public.manual_date_offers;
CREATE POLICY "manual_date_offers_participant_or_admin_select"
  ON public.manual_date_offers FOR SELECT
  TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b OR public.is_admin());

-- date_offer_events: Admin read only
DROP POLICY IF EXISTS "date_offer_events_admin_select" ON public.date_offer_events;
CREATE POLICY "date_offer_events_admin_select"
  ON public.date_offer_events FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- date_invitations: Admins or members who have a recipient row for that invitation
DROP POLICY IF EXISTS "date_invitations_recipient_or_admin_select" ON public.date_invitations;
CREATE POLICY "date_invitations_recipient_or_admin_select"
  ON public.date_invitations FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.date_invitation_recipients r
      WHERE r.invitation_id = date_invitations.id
        AND r.user_id = auth.uid()
    )
  );

-- date_invitation_recipients: STRICT PRIVACY — member sees ONLY their own row; admin sees all
DROP POLICY IF EXISTS "date_invitation_recipients_own_or_admin_select" ON public.date_invitation_recipients;
CREATE POLICY "date_invitation_recipients_own_or_admin_select"
  ON public.date_invitation_recipients FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

-- ============================================================================
-- 5. SHARED VALIDATION, EXPIRY & ELIGIBILITY HELPERS
-- ============================================================================

-- Safe date/time validation helper:
-- Validates real YYYY-MM-DD calendar date, valid 24h/12h clock time,
-- and rejects past dates as well as past times on the current UTC date.
CREATE OR REPLACE FUNCTION public.validate_date_offer_schedule(
  p_date text,
  p_time text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_date     text := btrim(COALESCE(p_date, ''));
  v_time     text := btrim(COALESCE(p_time, ''));
  v_parsed   date;
  v_time_val time;
  v_now_utc  timestamp without time zone;
BEGIN
  IF v_date = '' OR v_time = '' THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Date and time are required.';
  END IF;

  IF v_date !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Date must use YYYY-MM-DD format.';
  END IF;

  BEGIN
    v_parsed := v_date::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Date "%" is not a valid calendar date.', v_date;
  END;

  IF to_char(v_parsed, 'YYYY-MM-DD') <> v_date THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Date "%" is not a valid calendar date.', v_date;
  END IF;

  IF length(v_time) > 20 OR NOT (
    v_time ~ '^([01]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$'
    OR v_time ~ '^(0?[1-9]|1[0-2]):[0-5][0-9]\s*(AM|PM|am|pm)$'
  ) THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Time "%" must be a valid time (e.g. 19:30 or 7:30 PM).', v_time;
  END IF;

  BEGIN
    v_time_val := v_time::time;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Time "%" is not a valid clock time.', v_time;
  END;

  v_now_utc := (now() AT TIME ZONE 'UTC');

  IF v_parsed < v_now_utc::date THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Date "%" cannot be in the past.', v_date;
  END IF;

  IF v_parsed = v_now_utc::date AND v_time_val <= v_now_utc::time THEN
    RAISE EXCEPTION 'INVALID_SCHEDULE: Time "%" on today''s date cannot be in the past.', v_time;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_date_offer_schedule(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_date_offer_schedule(text, text) TO service_role;

-- Sweeps overdue pending automatic/manual offers and active invitations so stale rows
-- never block replacement offers under partial unique indexes.
CREATE OR REPLACE FUNCTION public.expire_stale_date_offers()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  FOR v_id IN
    UPDATE public.automatic_date_offers
       SET status = 'expired',
           updated_at = now()
     WHERE status = 'pending'
       AND expires_at <= now()
    RETURNING id
  LOOP
    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_role, event_type, detail)
    VALUES ('automatic', v_id, 'system', 'expired', 'Automatic date offer expired past expires_at.');
  END LOOP;

  FOR v_id IN
    UPDATE public.manual_date_offers
       SET status = 'expired',
           updated_at = now()
     WHERE status = 'pending'
       AND expires_at <= now()
    RETURNING id
  LOOP
    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_role, event_type, detail)
    VALUES ('manual', v_id, 'system', 'expired', 'Manual date offer expired past expires_at.');
  END LOOP;

  FOR v_id IN
    UPDATE public.date_invitations
       SET status = 'expired',
           updated_at = now()
     WHERE status = 'active'
       AND expires_at <= now()
    RETURNING id
  LOOP
    UPDATE public.date_invitation_recipients
       SET response = 'expired',
           updated_at = now()
     WHERE invitation_id = v_id
       AND response = 'pending';
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_date_offers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_date_offers() TO service_role;

CREATE OR REPLACE FUNCTION public.is_eligible_mutual_match_row(
  p_match_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_m public.matches%ROWTYPE;
BEGIN
  SELECT * INTO v_m FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_m.user_a IS NULL OR v_m.user_b IS NULL OR v_m.user_a = v_m.user_b THEN
    RETURN false;
  END IF;

  -- Must meet strict >= 75% compatibility threshold
  IF COALESCE(v_m.compatibility, 0) < 75 THEN
    RETURN false;
  END IF;

  -- Must not be blocked
  IF public.blocked_pair(v_m.user_a, v_m.user_b) THEN
    RETURN false;
  END IF;

  -- Both member profiles must exist (active/non-deleted)
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_m.user_a)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_m.user_b) THEN
    RETURN false;
  END IF;

  -- Must be a genuine mutual match (both directional likes exist)
  IF NOT EXISTS (
    SELECT 1 FROM public.likes WHERE from_user_id = v_m.user_a AND to_user_id = v_m.user_b
  ) OR NOT EXISTS (
    SELECT 1 FROM public.likes WHERE from_user_id = v_m.user_b AND to_user_id = v_m.user_a
  ) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.is_eligible_mutual_match_row(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_eligible_mutual_match_row(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.pair_has_active_offer_or_booking(
  p_user_a uuid,
  p_user_b uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT
    EXISTS (
      SELECT 1 FROM public.automatic_date_offers o
      WHERE o.user_a = LEAST(p_user_a, p_user_b)
        AND o.user_b = GREATEST(p_user_a, p_user_b)
        AND o.status = 'pending'
        AND o.expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM public.manual_date_offers o
      WHERE o.user_a = LEAST(p_user_a, p_user_b)
        AND o.user_b = GREATEST(p_user_a, p_user_b)
        AND o.status = 'pending'
        AND o.expires_at > now()
    )
    OR EXISTS (
      SELECT 1 FROM public.date_bookings b
      WHERE b.status IN ('pending', 'confirmed', 'upcoming')
        AND (
          (b.user_id = p_user_a AND b.partner_id = p_user_b)
          OR (b.user_id = p_user_b AND b.partner_id = p_user_a)
        )
    );
$$;

REVOKE ALL ON FUNCTION public.pair_has_active_offer_or_booking(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_has_active_offer_or_booking(uuid, uuid) TO service_role;

-- ============================================================================
-- 6. ONE-TIME INITIAL AUTOMATIC DATE OFFER BATCH (Requirement 3)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.evaluate_initial_auto_date_offers(
  p_triggered_by text DEFAULT 'system'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_batch_key       constant text := 'initial_100_match_batch';
  v_threshold       constant integer := 100;
  v_target_offers   constant integer := 10;
  v_existing        public.auto_date_offer_batches%ROWTYPE;
  v_has_existing    boolean := false;
  v_batch_id        uuid;
  v_eligible_count  integer := 0;
  v_created_count   integer := 0;
  v_remaining_quota integer := 0;
  v_shortfall       integer := 0;
  v_exp             RECORD;
  v_has_exp         boolean := false;
  v_cafe            RECORD;
  v_has_cafe        boolean := false;
  v_match           RECORD;
  v_offer_id        uuid;
  v_suggested_date  text;
  v_suggested_time  text := '19:30';
  v_venue           text;
  v_expires_at      timestamptz := now() + interval '7 days';
  v_clean_trigger   text := COALESCE(NULLIF(btrim(COALESCE(p_triggered_by, '')), ''), 'system');
BEGIN
  -- Serialize all concurrent evaluations across the entire database
  PERFORM pg_advisory_xact_lock(hashtext('datevra:initial_auto_date_offer_batch'));

  -- Expire stale pending offers before checking batch state or selecting candidates
  PERFORM public.expire_stale_date_offers();

  -- Lookup singleton batch record and persist existence immediately in v_has_existing
  SELECT * INTO v_existing
  FROM public.auto_date_offer_batches
  WHERE batch_key = v_batch_key
  FOR UPDATE;
  v_has_existing := FOUND;

  -- One-time batch already completed: never re-run
  IF v_has_existing AND v_existing.status = 'completed' THEN
    RETURN jsonb_build_object(
      'triggered', false,
      'already_completed', true,
      'batch_id', v_existing.id,
      'eligible_matches', v_existing.eligible_match_count,
      'created_offers', v_existing.created_offer_count,
      'shortfall', v_existing.shortfall_count
    );
  END IF;

  -- Existing processing batch: never attempt a duplicate singleton INSERT
  IF v_has_existing AND v_existing.status = 'processing' THEN
    RETURN jsonb_build_object(
      'triggered', false,
      'already_completed', false,
      'in_progress', true,
      'batch_id', v_existing.id,
      'eligible_matches', v_existing.eligible_match_count,
      'created_offers', v_existing.created_offer_count,
      'shortfall', v_existing.shortfall_count
    );
  END IF;

  -- Count distinct genuine, eligible mutual pairs (>= 75% compatibility, non-blocked, existing profiles, reciprocal likes)
  SELECT count(DISTINCT (LEAST(m.user_a, m.user_b), GREATEST(m.user_a, m.user_b)))::integer INTO v_eligible_count
  FROM public.matches m
  WHERE m.user_a <> m.user_b
    AND COALESCE(m.compatibility, 0) >= 75
    AND NOT public.blocked_pair(m.user_a, m.user_b)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_a)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_b)
    AND EXISTS (SELECT 1 FROM public.likes l1 WHERE l1.from_user_id = m.user_a AND l1.to_user_id = m.user_b)
    AND EXISTS (SELECT 1 FROM public.likes l2 WHERE l2.from_user_id = m.user_b AND l2.to_user_id = m.user_a);

  -- Threshold check: must reach 100 eligible mutual matches before firing
  IF v_eligible_count < v_threshold THEN
    RETURN jsonb_build_object(
      'triggered', false,
      'already_completed', false,
      'threshold_target', v_threshold,
      'eligible_matches', v_eligible_count,
      'remaining_to_threshold', v_threshold - v_eligible_count
    );
  END IF;

  -- Acquire singleton batch record or safely recover a prior failed batch using v_has_existing
  IF v_has_existing AND v_existing.status = 'failed' THEN
    UPDATE public.auto_date_offer_batches
       SET status = 'processing',
           eligible_match_count = v_eligible_count,
           error_detail = NULL,
           triggered_by = v_clean_trigger
     WHERE id = v_existing.id
    RETURNING id INTO v_batch_id;
  ELSE
    INSERT INTO public.auto_date_offer_batches (
      batch_key, threshold_target, target_offer_count, eligible_match_count,
      status, triggered_by
    ) VALUES (
      v_batch_key, v_threshold, v_target_offers, v_eligible_count,
      'processing', v_clean_trigger
    )
    RETURNING id INTO v_batch_id;
  END IF;

  -- Count any offers already attached to this batch (protects cap <= 10 on failed-batch recovery)
  SELECT count(*)::integer INTO v_created_count
  FROM public.automatic_date_offers
  WHERE batch_id = v_batch_id;

  v_remaining_quota := GREATEST(0, v_target_offers - v_created_count);

  -- Select a default curated experience (non-elite preferred)
  SELECT id, title INTO v_exp
  FROM public.experiences
  ORDER BY elite_only ASC, price_from ASC, id ASC
  LIMIT 1;
  v_has_exp := FOUND;

  IF NOT v_has_exp THEN
    UPDATE public.auto_date_offer_batches
       SET status = 'failed',
           eligible_match_count = v_eligible_count,
           created_offer_count = v_created_count,
           shortfall_count = GREATEST(0, v_target_offers - v_created_count),
           error_detail = 'No curated experience configured in public.experiences.'
     WHERE id = v_batch_id;

    RETURN jsonb_build_object(
      'triggered', false,
      'already_completed', false,
      'error', 'NO_EXPERIENCE_CONFIGURED',
      'batch_id', v_batch_id
    );
  END IF;

  -- Suggest a date 5 days ahead
  v_suggested_date := to_char((now() AT TIME ZONE 'UTC') + interval '5 days', 'YYYY-MM-DD');

  -- Iterate distinct eligible canonical pairs in priority order WITHOUT premature LIMIT so
  -- avoidable per-pair conflicts never silently cut the batch short of 10 offers.
  IF v_remaining_quota > 0 THEN
    FOR v_match IN
      SELECT cand.id, cand.ua, cand.ub, cand.compatibility, cand.created_at
      FROM (
        SELECT DISTINCT ON (LEAST(m.user_a, m.user_b), GREATEST(m.user_a, m.user_b))
          m.id,
          LEAST(m.user_a, m.user_b) AS ua,
          GREATEST(m.user_a, m.user_b) AS ub,
          m.compatibility,
          m.created_at
        FROM public.matches m
        WHERE m.user_a <> m.user_b
          AND COALESCE(m.compatibility, 0) >= 75
          AND NOT public.blocked_pair(m.user_a, m.user_b)
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_a)
          AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_b)
          AND EXISTS (SELECT 1 FROM public.likes l1 WHERE l1.from_user_id = m.user_a AND l1.to_user_id = m.user_b)
          AND EXISTS (SELECT 1 FROM public.likes l2 WHERE l2.from_user_id = m.user_b AND l2.to_user_id = m.user_a)
          AND NOT public.pair_has_active_offer_or_booking(m.user_a, m.user_b)
          AND NOT EXISTS (
            SELECT 1 FROM public.automatic_date_offers ao
            WHERE ao.user_a = LEAST(m.user_a, m.user_b)
              AND ao.user_b = GREATEST(m.user_a, m.user_b)
              AND (
                ao.batch_id = v_batch_id
                OR ao.status IN ('pending', 'accepted')
              )
          )
        ORDER BY LEAST(m.user_a, m.user_b), GREATEST(m.user_a, m.user_b), m.compatibility DESC, m.created_at ASC, m.id ASC
      ) AS cand
      ORDER BY cand.compatibility DESC, cand.created_at ASC, cand.id ASC
    LOOP
      EXIT WHEN v_created_count >= v_target_offers;

      -- Acquire canonical pair advisory lock and re-verify eligibility under the lock
      PERFORM public.lock_matchmaking_pair(v_match.ua, v_match.ub);

      IF public.blocked_pair(v_match.ua, v_match.ub)
         OR public.pair_has_active_offer_or_booking(v_match.ua, v_match.ub)
         OR EXISTS (
           SELECT 1 FROM public.automatic_date_offers ao
           WHERE ao.user_a = v_match.ua
             AND ao.user_b = v_match.ub
             AND (ao.batch_id = v_batch_id OR ao.status IN ('pending', 'accepted'))
         ) THEN
        CONTINUE;
      END IF;

      -- Pick a partner cafe matching member A's city if available, else best rated partner cafe
      SELECT c.id, c.name, c.city INTO v_cafe
      FROM public.cafes c
      LEFT JOIN public.profiles pa ON pa.id = v_match.ua
      ORDER BY (lower(btrim(c.city)) = lower(btrim(COALESCE(pa.city, '')))) DESC, c.partner DESC, c.rating DESC NULLS LAST, c.id ASC
      LIMIT 1;
      v_has_cafe := FOUND;

      v_venue := CASE
        WHEN v_has_cafe THEN v_cafe.name || ', ' || v_cafe.city
        ELSE 'Curated Partner Venue'
      END;

      v_offer_id := NULL;
      INSERT INTO public.automatic_date_offers (
        batch_id, match_id, user_a, user_b, experience_id, cafe_id,
        suggested_date, suggested_time, venue, message,
        status, expires_at
      ) VALUES (
        v_batch_id, v_match.id, v_match.ua, v_match.ub, v_exp.id,
        CASE WHEN v_has_cafe THEN v_cafe.id ELSE NULL END,
        v_suggested_date, v_suggested_time, v_venue,
        'Congratulations on being selected in Datevra''s milestone 100-match curated date celebration. Both partners must accept to confirm.',
        'pending', v_expires_at
      )
      ON CONFLICT DO NOTHING
      RETURNING id INTO v_offer_id;

      IF v_offer_id IS NOT NULL THEN
        v_created_count := v_created_count + 1;

        INSERT INTO public.date_offer_events (offer_source, offer_id, actor_role, event_type, detail)
        VALUES ('automatic', v_offer_id, 'system', 'created', 'Created in initial 100-match automatic date offer batch.');

        INSERT INTO public.notifications (user_id, kind, title, body, link, read)
        VALUES
          (v_match.ua, 'date_offer', 'You received a Curated Date Offer', 'You and your match were selected for an exclusive Datevra date offer at ' || v_venue || '. Accept before it expires.', '/bookings', false),
          (v_match.ub, 'date_offer', 'You received a Curated Date Offer', 'You and your match were selected for an exclusive Datevra date offer at ' || v_venue || '. Accept before it expires.', '/bookings', false);
      END IF;
    END LOOP;
  END IF;

  v_shortfall := GREATEST(0, v_target_offers - v_created_count);

  UPDATE public.auto_date_offer_batches
     SET status = 'completed',
         eligible_match_count = v_eligible_count,
         created_offer_count = v_created_count,
         shortfall_count = v_shortfall,
         error_detail = NULL,
         completed_at = now()
   WHERE id = v_batch_id;

  INSERT INTO public.activity_logs (actor_role, action, detail)
  VALUES (
    'system',
    'auto_date_offers.initial_batch_completed',
    'One-time 100-match automatic date offer batch completed: ' || v_created_count || ' offers created (shortfall ' || v_shortfall || ') from ' || v_eligible_count || ' eligible matches.'
  );

  RETURN jsonb_build_object(
    'triggered', true,
    'already_completed', false,
    'batch_id', v_batch_id,
    'eligible_matches', v_eligible_count,
    'created_offers', v_created_count,
    'shortfall', v_shortfall
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_initial_auto_date_offers(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_initial_auto_date_offers(text) TO service_role;

-- Admin wrapper to trigger/recheck threshold safely from Admin UI
CREATE OR REPLACE FUNCTION public.admin_evaluate_initial_auto_date_offers()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;
  RETURN public.evaluate_initial_auto_date_offers('admin:' || auth.uid()::text);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_evaluate_initial_auto_date_offers() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_evaluate_initial_auto_date_offers() TO authenticated;

-- Trigger on matches insert: evaluates one-time 100-match batch automatically
CREATE OR REPLACE FUNCTION public.trg_check_auto_date_offer_threshold()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Fast path: if initial batch already completed, do nothing immediately
  IF EXISTS (
    SELECT 1 FROM public.auto_date_offer_batches
    WHERE batch_key = 'initial_100_match_batch' AND status = 'completed'
  ) THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM public.evaluate_initial_auto_date_offers('match_trigger');
  EXCEPTION WHEN OTHERS THEN
    -- Never break match creation if batch evaluation encounters a transient error
    NULL;
  END;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_check_auto_date_offer_threshold() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_matches_auto_date_offer_threshold ON public.matches;
CREATE TRIGGER trg_matches_auto_date_offer_threshold
  AFTER INSERT ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.trg_check_auto_date_offer_threshold();

-- Admin summary RPC for Automatic Date Offer System
CREATE OR REPLACE FUNCTION public.get_auto_date_offer_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_batch           public.auto_date_offer_batches%ROWTYPE;
  v_has_batch       boolean := false;
  v_eligible_total  integer := 0;
  v_remaining_pairs integer := 0;
  v_created         integer := 0;
  v_pending         integer := 0;
  v_accepted        integer := 0;
  v_declined        integer := 0;
  v_expired         integer := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- Expire any overdue pending offers cleanly before aggregating
  PERFORM public.expire_stale_date_offers();

  SELECT * INTO v_batch
  FROM public.auto_date_offer_batches
  WHERE batch_key = 'initial_100_match_batch'
  LIMIT 1;
  v_has_batch := FOUND;

  SELECT count(DISTINCT (LEAST(m.user_a, m.user_b), GREATEST(m.user_a, m.user_b)))::integer INTO v_eligible_total
  FROM public.matches m
  WHERE m.user_a <> m.user_b
    AND COALESCE(m.compatibility, 0) >= 75
    AND NOT public.blocked_pair(m.user_a, m.user_b)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_a)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_b)
    AND EXISTS (SELECT 1 FROM public.likes l1 WHERE l1.from_user_id = m.user_a AND l1.to_user_id = m.user_b)
    AND EXISTS (SELECT 1 FROM public.likes l2 WHERE l2.from_user_id = m.user_b AND l2.to_user_id = m.user_a);

  SELECT count(DISTINCT (LEAST(m.user_a, m.user_b), GREATEST(m.user_a, m.user_b)))::integer INTO v_remaining_pairs
  FROM public.matches m
  WHERE m.user_a <> m.user_b
    AND COALESCE(m.compatibility, 0) >= 75
    AND NOT public.blocked_pair(m.user_a, m.user_b)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_a)
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = m.user_b)
    AND EXISTS (SELECT 1 FROM public.likes l1 WHERE l1.from_user_id = m.user_a AND l1.to_user_id = m.user_b)
    AND EXISTS (SELECT 1 FROM public.likes l2 WHERE l2.from_user_id = m.user_b AND l2.to_user_id = m.user_a)
    AND NOT public.pair_has_active_offer_or_booking(m.user_a, m.user_b)
    AND NOT EXISTS (
      SELECT 1 FROM public.automatic_date_offers ao
      WHERE ao.user_a = LEAST(m.user_a, m.user_b)
        AND ao.user_b = GREATEST(m.user_a, m.user_b)
        AND (
          ao.status = 'accepted'
          OR (ao.status = 'pending' AND ao.expires_at > now())
        )
    );

  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE status = 'pending')::integer,
    count(*) FILTER (WHERE status = 'accepted')::integer,
    count(*) FILTER (WHERE status = 'declined')::integer,
    count(*) FILTER (WHERE status = 'expired')::integer
  INTO v_created, v_pending, v_accepted, v_declined, v_expired
  FROM public.automatic_date_offers;

  RETURN jsonb_build_object(
    'thresholdTarget', 100,
    'targetOfferCount', 10,
    'totalEligibleMatches', v_eligible_total,
    'remainingEligiblePairs', v_remaining_pairs,
    'batchStatus', CASE WHEN v_has_batch THEN v_batch.status ELSE 'not_triggered' END,
    'batchId', CASE WHEN v_has_batch THEN v_batch.id ELSE NULL END,
    'batchCompletedAt', CASE WHEN v_has_batch THEN v_batch.completed_at ELSE NULL END,
    'shortfallCount', CASE WHEN v_has_batch THEN v_batch.shortfall_count ELSE 0 END,
    'offersCreated', v_created,
    'offersPending', v_pending,
    'offersAccepted', v_accepted,
    'offersDeclined', v_declined,
    'offersExpired', v_expired
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_auto_date_offer_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_auto_date_offer_summary() TO authenticated;

-- Member response RPC for Automatic Date Offers (dual acceptance -> single booking)
-- Expiry and pair-block transitions persist and return the updated row (never rolled back).
CREATE OR REPLACE FUNCTION public.respond_to_automatic_date_offer(
  p_offer_id uuid,
  p_accept   boolean
)
RETURNS public.automatic_date_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid                 uuid := auth.uid();
  v_a                   uuid;
  v_b                   uuid;
  v_offer               public.automatic_date_offers%ROWTYPE;
  v_booking_id          uuid;
  v_existing_booking_id uuid;
  v_other_id            uuid;
  v_venue               text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'INVALID_RESPONSE: Acceptance decision is required.';
  END IF;

  -- Lightweight lookup for canonical pair lock ordering
  SELECT user_a, user_b INTO v_a, v_b
  FROM public.automatic_date_offers
  WHERE id = p_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: Automatic date offer not found.';
  END IF;

  IF v_uid <> v_a AND v_uid <> v_b THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only participants may respond to this date offer.';
  END IF;

  -- Canonical Lock Order Step 1: advisory pair lock precedes row FOR UPDATE lock
  PERFORM public.lock_matchmaking_pair(v_a, v_b);

  -- Canonical Lock Order Step 2: row-level lock on offer
  SELECT * INTO v_offer
  FROM public.automatic_date_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: Automatic date offer not found.';
  END IF;

  -- Transaction-safe expiry: persist expired state + audit event and return updated row
  IF v_offer.status = 'pending' AND v_offer.expires_at <= now() THEN
    UPDATE public.automatic_date_offers
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('automatic', v_offer.id, v_uid, 'system', 'expired', 'Offer expired before response.');

    RETURN v_offer;
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'OFFER_NOT_PENDING: Offer is already %.', v_offer.status;
  END IF;

  -- Transaction-safe pair-block handling: block prevents acceptance, persists cancelled state & audit event
  IF p_accept AND public.blocked_pair(v_offer.user_a, v_offer.user_b) THEN
    UPDATE public.automatic_date_offers
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('automatic', v_offer.id, v_uid, 'system', 'cancelled_blocked', 'Offer cancelled due to an active block between participants.');

    RETURN v_offer;
  END IF;

  -- Guard against duplicate response by the same participant
  IF v_uid = v_offer.user_a AND v_offer.user_a_response IS NOT NULL THEN
    IF v_offer.user_a_response = p_accept THEN
      RETURN v_offer;
    END IF;
    RAISE EXCEPTION 'ALREADY_RESPONDED: You have already responded to this date offer.';
  END IF;
  IF v_uid = v_offer.user_b AND v_offer.user_b_response IS NOT NULL THEN
    IF v_offer.user_b_response = p_accept THEN
      RETURN v_offer;
    END IF;
    RAISE EXCEPTION 'ALREADY_RESPONDED: You have already responded to this date offer.';
  END IF;

  v_other_id := CASE WHEN v_uid = v_offer.user_a THEN v_offer.user_b ELSE v_offer.user_a END;
  v_venue := COALESCE(NULLIF(btrim(COALESCE(v_offer.venue, '')), ''), 'Curated Partner Venue');

  -- Record caller's response
  IF v_uid = v_offer.user_a THEN
    v_offer.user_a_response := p_accept;
    v_offer.user_a_responded_at := now();
  ELSE
    v_offer.user_b_response := p_accept;
    v_offer.user_b_responded_at := now();
  END IF;

  IF NOT p_accept THEN
    UPDATE public.automatic_date_offers
       SET user_a_response = v_offer.user_a_response,
           user_b_response = v_offer.user_b_response,
           user_a_responded_at = v_offer.user_a_responded_at,
           user_b_responded_at = v_offer.user_b_responded_at,
           status = 'declined',
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('automatic', v_offer.id, v_uid, 'user', 'declined', 'Participant declined automatic date offer.');

    RETURN v_offer;
  END IF;

  -- If BOTH accepted, verify under the canonical pair lock that no active booking already exists
  -- (status IN ('pending', 'confirmed', 'upcoming')) before creating strictly one booking.
  IF COALESCE(v_offer.user_a_response, false) AND COALESCE(v_offer.user_b_response, false) THEN
    IF v_offer.booking_id IS NULL THEN
      SELECT b.id INTO v_existing_booking_id
      FROM public.date_bookings b
      WHERE b.status IN ('pending', 'confirmed', 'upcoming')
        AND (
          (b.user_id = v_offer.user_a AND b.partner_id = v_offer.user_b)
          OR (b.user_id = v_offer.user_b AND b.partner_id = v_offer.user_a)
        )
      ORDER BY b.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_existing_booking_id IS NOT NULL THEN
        UPDATE public.automatic_date_offers
           SET user_a_response = v_offer.user_a_response,
               user_b_response = v_offer.user_b_response,
               user_a_responded_at = v_offer.user_a_responded_at,
               user_b_responded_at = v_offer.user_b_responded_at,
               status = 'cancelled',
               updated_at = now()
         WHERE id = v_offer.id
        RETURNING * INTO v_offer;

        INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
        VALUES (
          'automatic',
          v_offer.id,
          v_uid,
          'system',
          'cancelled_active_booking_exists',
          'Active booking ' || v_existing_booking_id::text || ' already exists for this pair; duplicate booking prevented.'
        );

        RETURN v_offer;
      END IF;

      INSERT INTO public.date_bookings (
        user_id, partner_id, experience_id, cafe_id,
        date, time, venue, status, amount, payment_status
      ) VALUES (
        v_offer.user_a, v_offer.user_b, v_offer.experience_id, v_offer.cafe_id,
        v_offer.suggested_date, v_offer.suggested_time, v_venue,
        'upcoming', 0, 'pending'
      )
      RETURNING id INTO v_booking_id;
    ELSE
      v_booking_id := v_offer.booking_id;
    END IF;

    UPDATE public.automatic_date_offers
       SET user_a_response = v_offer.user_a_response,
           user_b_response = v_offer.user_b_response,
           user_a_responded_at = v_offer.user_a_responded_at,
           user_b_responded_at = v_offer.user_b_responded_at,
           status = 'accepted',
           booking_id = v_booking_id,
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('automatic', v_offer.id, v_uid, 'user', 'accepted_booking_created', 'Both participants accepted; booking ' || v_booking_id::text || ' confirmed.');

    INSERT INTO public.notifications (user_id, kind, title, body, link, read)
    VALUES
      (v_offer.user_a, 'booking', 'Curated Date Confirmed', 'Both partners accepted! Your date at ' || v_venue || ' on ' || v_offer.suggested_date || ' is confirmed.', '/bookings', false),
      (v_offer.user_b, 'booking', 'Curated Date Confirmed', 'Both partners accepted! Your date at ' || v_venue || ' on ' || v_offer.suggested_date || ' is confirmed.', '/bookings', false);
  ELSE
    UPDATE public.automatic_date_offers
       SET user_a_response = v_offer.user_a_response,
           user_b_response = v_offer.user_b_response,
           user_a_responded_at = v_offer.user_a_responded_at,
           user_b_responded_at = v_offer.user_b_responded_at,
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('automatic', v_offer.id, v_uid, 'user', 'accepted_partial', 'First participant accepted; waiting for partner.');

    INSERT INTO public.notifications (user_id, kind, title, body, link, read)
    VALUES (
      v_other_id, 'date_offer', 'Your match accepted the Date Offer',
      'Your match accepted the curated date offer at ' || v_venue || '. Respond before it expires to confirm.', '/bookings', false
    );
  END IF;

  RETURN v_offer;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_automatic_date_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_automatic_date_offer(uuid, boolean) TO authenticated;

-- ============================================================================
-- 7. MANUAL DATE OFFER RPCs (Requirement 4 — Admin-to-Pair)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_manual_date_offer(
  p_user_a_id     uuid,
  p_user_b_id     uuid,
  p_experience_id text,
  p_cafe_id       text DEFAULT NULL,
  p_date          text DEFAULT NULL,
  p_time          text DEFAULT NULL,
  p_venue         text DEFAULT '',
  p_message       text DEFAULT NULL,
  p_expires_at    timestamptz DEFAULT NULL
)
RETURNS public.manual_date_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id   uuid := auth.uid();
  v_a          uuid;
  v_b          uuid;
  v_exp_id     text := NULLIF(btrim(COALESCE(p_experience_id, '')), '');
  v_cafe_id    text := NULLIF(btrim(COALESCE(p_cafe_id, '')), '');
  v_date       text := btrim(COALESCE(p_date, ''));
  v_time       text := btrim(COALESCE(p_time, ''));
  v_match_id   uuid;
  v_venue      text;
  v_expires    timestamptz;
  v_expired_id uuid;
  v_offer      public.manual_date_offers%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  IF p_user_a_id IS NULL OR p_user_b_id IS NULL OR p_user_a_id = p_user_b_id THEN
    RAISE EXCEPTION 'INVALID_PAIR: Two distinct members must be selected.';
  END IF;

  PERFORM public.validate_date_offer_schedule(v_date, v_time);

  IF v_exp_id IS NULL THEN
    RAISE EXCEPTION 'EXPERIENCE_REQUIRED: A valid curated experience is required.';
  END IF;

  v_a := LEAST(p_user_a_id, p_user_b_id);
  v_b := GREATEST(p_user_a_id, p_user_b_id);

  -- Canonical Lock Order Step 1: advisory pair lock precedes row-level checks/writes
  PERFORM public.lock_matchmaking_pair(v_a, v_b);

  -- Verify both profiles exist
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_a)
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_b) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: Both selected members must exist.';
  END IF;

  -- Verify no block exists between the pair
  IF public.blocked_pair(v_a, v_b) THEN
    RAISE EXCEPTION 'PAIR_BLOCKED: Cannot create a manual date offer between blocked members.';
  END IF;

  -- Verify experience exists
  IF NOT EXISTS (SELECT 1 FROM public.experiences WHERE id = v_exp_id) THEN
    RAISE EXCEPTION 'EXPERIENCE_NOT_FOUND: Selected experience does not exist.';
  END IF;

  -- Verify optional cafe exists
  IF v_cafe_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cafes WHERE id = v_cafe_id) THEN
    RAISE EXCEPTION 'CAFE_NOT_FOUND: Selected café does not exist.';
  END IF;

  -- Resolve venue from cafe if omitted
  v_venue := NULLIF(btrim(COALESCE(p_venue, '')), '');
  IF v_venue IS NULL AND v_cafe_id IS NOT NULL THEN
    SELECT name || ', ' || city INTO v_venue FROM public.cafes WHERE id = v_cafe_id;
  END IF;
  v_venue := COALESCE(v_venue, 'Curated Partner Venue');

  v_expires := COALESCE(p_expires_at, now() + interval '5 days');
  IF v_expires <= now() THEN
    RAISE EXCEPTION 'INVALID_EXPIRY: Offer expiry must be in the future.';
  END IF;

  -- Expire any stale pending manual offers for this pair so expired rows never block replacements
  FOR v_expired_id IN
    UPDATE public.manual_date_offers
       SET status = 'expired',
           updated_at = now()
     WHERE user_a = v_a
       AND user_b = v_b
       AND status = 'pending'
       AND expires_at <= now()
    RETURNING id
  LOOP
    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_role, event_type, detail)
    VALUES ('manual', v_expired_id, 'system', 'expired', 'Stale manual date offer expired prior to replacement creation.');
  END LOOP;

  -- Prevent duplicate active offer for same pair and date
  IF EXISTS (
    SELECT 1 FROM public.manual_date_offers
    WHERE user_a = v_a
      AND user_b = v_b
      AND suggested_date = v_date
      AND status = 'pending'
      AND expires_at > now()
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_ACTIVE_OFFER: An active manual date offer already exists for this pair on %.', v_date;
  END IF;

  SELECT id INTO v_match_id
  FROM public.matches
  WHERE user_a = v_a AND user_b = v_b
  LIMIT 1;

  INSERT INTO public.manual_date_offers (
    user_a, user_b, match_id, experience_id, cafe_id,
    suggested_date, suggested_time, venue, message,
    status, expires_at, created_by_admin_id
  ) VALUES (
    v_a, v_b, v_match_id, v_exp_id, v_cafe_id,
    v_date, v_time, v_venue, NULLIF(btrim(COALESCE(p_message, '')), ''),
    'pending', v_expires, v_admin_id
  )
  RETURNING * INTO v_offer;

  INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
  VALUES ('manual', v_offer.id, v_admin_id, 'admin', 'created', 'Admin created manual date offer for ' || v_venue || ' on ' || v_offer.suggested_date || '.');

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'manual_date_offer.create', 'Created manual date offer ' || v_offer.id::text || ' at ' || v_venue || ' on ' || v_offer.suggested_date);

  INSERT INTO public.notifications (user_id, kind, title, body, link, read)
  VALUES
    (v_a, 'date_offer', 'Concierge Date Offer Received', 'Datevra concierge curated a date for you at ' || v_venue || ' on ' || v_offer.suggested_date || '. Review and respond.', '/bookings', false),
    (v_b, 'date_offer', 'Concierge Date Offer Received', 'Datevra concierge curated a date for you at ' || v_venue || ' on ' || v_offer.suggested_date || '. Review and respond.', '/bookings', false);

  RETURN v_offer;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_manual_date_offer(uuid, uuid, text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_manual_date_offer(uuid, uuid, text, text, text, text, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_manual_date_offer(
  p_offer_id uuid,
  p_reason   text DEFAULT NULL
)
RETURNS public.manual_date_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_a        uuid;
  v_b        uuid;
  v_offer    public.manual_date_offers%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  SELECT user_a, user_b INTO v_a, v_b
  FROM public.manual_date_offers
  WHERE id = p_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: Manual date offer not found.';
  END IF;

  PERFORM public.lock_matchmaking_pair(v_a, v_b);

  SELECT * INTO v_offer
  FROM public.manual_date_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: Manual date offer not found.';
  END IF;

  -- Transaction-safe expiry: if already past expires_at, persist expired state and return
  IF v_offer.status = 'pending' AND v_offer.expires_at <= now() THEN
    UPDATE public.manual_date_offers
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('manual', v_offer.id, v_admin_id, 'system', 'expired', 'Manual offer had already expired before admin cancellation.');

    RETURN v_offer;
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Only pending offers may be cancelled (current: %).', v_offer.status;
  END IF;

  UPDATE public.manual_date_offers
     SET status = 'cancelled',
         cancelled_by_admin_id = v_admin_id,
         cancel_reason = NULLIF(btrim(COALESCE(p_reason, '')), ''),
         updated_at = now()
   WHERE id = v_offer.id
  RETURNING * INTO v_offer;

  INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
  VALUES ('manual', v_offer.id, v_admin_id, 'admin', 'cancelled', COALESCE(NULLIF(btrim(COALESCE(p_reason, '')), ''), 'Cancelled by administrator.'));

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'manual_date_offer.cancel', 'Cancelled manual date offer ' || v_offer.id::text);

  RETURN v_offer;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_manual_date_offer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_manual_date_offer(uuid, text) TO authenticated;

-- Member response RPC for Manual Date Offers (dual acceptance -> single zero-charge booking)
-- Expiry and pair-block transitions persist and return the updated row (never rolled back).
CREATE OR REPLACE FUNCTION public.respond_to_manual_date_offer(
  p_offer_id uuid,
  p_accept   boolean
)
RETURNS public.manual_date_offers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid                 uuid := auth.uid();
  v_a                   uuid;
  v_b                   uuid;
  v_offer               public.manual_date_offers%ROWTYPE;
  v_booking_id          uuid;
  v_existing_booking_id uuid;
  v_other_id            uuid;
  v_venue               text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'INVALID_RESPONSE: Acceptance decision is required.';
  END IF;

  -- Lightweight lookup for canonical pair lock ordering
  SELECT user_a, user_b INTO v_a, v_b
  FROM public.manual_date_offers
  WHERE id = p_offer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: Manual date offer not found.';
  END IF;

  IF v_uid <> v_a AND v_uid <> v_b THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Only participants may respond to this date offer.';
  END IF;

  -- Canonical Lock Order Step 1: advisory pair lock precedes row FOR UPDATE lock
  PERFORM public.lock_matchmaking_pair(v_a, v_b);

  -- Canonical Lock Order Step 2: row-level lock on offer
  SELECT * INTO v_offer
  FROM public.manual_date_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_NOT_FOUND: Manual date offer not found.';
  END IF;

  -- Transaction-safe expiry: persist expired state + audit event and return updated row
  IF v_offer.status = 'pending' AND v_offer.expires_at <= now() THEN
    UPDATE public.manual_date_offers
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('manual', v_offer.id, v_uid, 'system', 'expired', 'Manual offer expired before response.');

    RETURN v_offer;
  END IF;

  IF v_offer.status <> 'pending' THEN
    RAISE EXCEPTION 'OFFER_NOT_PENDING: Offer is already %.', v_offer.status;
  END IF;

  -- Transaction-safe pair-block handling: block prevents acceptance, persists cancelled state & audit event
  IF p_accept AND public.blocked_pair(v_offer.user_a, v_offer.user_b) THEN
    UPDATE public.manual_date_offers
       SET status = 'cancelled',
           cancel_reason = 'Blocked pair',
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('manual', v_offer.id, v_uid, 'system', 'cancelled_blocked', 'Cancelled due to active block between participants.');

    RETURN v_offer;
  END IF;

  -- Guard against duplicate response by the same participant
  IF v_uid = v_offer.user_a AND v_offer.user_a_response IS NOT NULL THEN
    IF v_offer.user_a_response = p_accept THEN
      RETURN v_offer;
    END IF;
    RAISE EXCEPTION 'ALREADY_RESPONDED: You have already responded to this date offer.';
  END IF;
  IF v_uid = v_offer.user_b AND v_offer.user_b_response IS NOT NULL THEN
    IF v_offer.user_b_response = p_accept THEN
      RETURN v_offer;
    END IF;
    RAISE EXCEPTION 'ALREADY_RESPONDED: You have already responded to this date offer.';
  END IF;

  v_other_id := CASE WHEN v_uid = v_offer.user_a THEN v_offer.user_b ELSE v_offer.user_a END;
  v_venue := COALESCE(NULLIF(btrim(COALESCE(v_offer.venue, '')), ''), 'Curated Partner Venue');

  IF v_uid = v_offer.user_a THEN
    v_offer.user_a_response := p_accept;
    v_offer.user_a_responded_at := now();
  ELSE
    v_offer.user_b_response := p_accept;
    v_offer.user_b_responded_at := now();
  END IF;

  IF NOT p_accept THEN
    UPDATE public.manual_date_offers
       SET user_a_response = v_offer.user_a_response,
           user_b_response = v_offer.user_b_response,
           user_a_responded_at = v_offer.user_a_responded_at,
           user_b_responded_at = v_offer.user_b_responded_at,
           status = 'declined',
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('manual', v_offer.id, v_uid, 'user', 'declined', 'Participant declined manual date offer.');

    RETURN v_offer;
  END IF;

  -- If BOTH accepted, verify under the canonical pair lock that no active booking already exists
  -- (status IN ('pending', 'confirmed', 'upcoming')) before creating strictly one zero-charge booking.
  IF COALESCE(v_offer.user_a_response, false) AND COALESCE(v_offer.user_b_response, false) THEN
    IF v_offer.booking_id IS NULL THEN
      SELECT b.id INTO v_existing_booking_id
      FROM public.date_bookings b
      WHERE b.status IN ('pending', 'confirmed', 'upcoming')
        AND (
          (b.user_id = v_offer.user_a AND b.partner_id = v_offer.user_b)
          OR (b.user_id = v_offer.user_b AND b.partner_id = v_offer.user_a)
        )
      ORDER BY b.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_existing_booking_id IS NOT NULL THEN
        UPDATE public.manual_date_offers
           SET user_a_response = v_offer.user_a_response,
               user_b_response = v_offer.user_b_response,
               user_a_responded_at = v_offer.user_a_responded_at,
               user_b_responded_at = v_offer.user_b_responded_at,
               status = 'cancelled',
               cancel_reason = 'Active booking already exists for this pair',
               updated_at = now()
         WHERE id = v_offer.id
        RETURNING * INTO v_offer;

        INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
        VALUES (
          'manual',
          v_offer.id,
          v_uid,
          'system',
          'cancelled_active_booking_exists',
          'Active booking ' || v_existing_booking_id::text || ' already exists for this pair; duplicate booking prevented.'
        );

        RETURN v_offer;
      END IF;

      INSERT INTO public.date_bookings (
        user_id, partner_id, experience_id, cafe_id,
        date, time, venue, status, amount, payment_status
      ) VALUES (
        v_offer.user_a, v_offer.user_b, v_offer.experience_id, v_offer.cafe_id,
        v_offer.suggested_date, v_offer.suggested_time, v_venue,
        'upcoming', 0, 'pending'
      )
      RETURNING id INTO v_booking_id;
    ELSE
      v_booking_id := v_offer.booking_id;
    END IF;

    UPDATE public.manual_date_offers
       SET user_a_response = v_offer.user_a_response,
           user_b_response = v_offer.user_b_response,
           user_a_responded_at = v_offer.user_a_responded_at,
           user_b_responded_at = v_offer.user_b_responded_at,
           status = 'accepted',
           booking_id = v_booking_id,
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('manual', v_offer.id, v_uid, 'user', 'accepted_booking_created', 'Both participants accepted; booking ' || v_booking_id::text || ' confirmed.');

    INSERT INTO public.notifications (user_id, kind, title, body, link, read)
    VALUES
      (v_offer.user_a, 'booking', 'Concierge Date Confirmed', 'Both partners accepted! Your date at ' || v_venue || ' on ' || v_offer.suggested_date || ' is confirmed.', '/bookings', false),
      (v_offer.user_b, 'booking', 'Concierge Date Confirmed', 'Both partners accepted! Your date at ' || v_venue || ' on ' || v_offer.suggested_date || ' is confirmed.', '/bookings', false);
  ELSE
    UPDATE public.manual_date_offers
       SET user_a_response = v_offer.user_a_response,
           user_b_response = v_offer.user_b_response,
           user_a_responded_at = v_offer.user_a_responded_at,
           user_b_responded_at = v_offer.user_b_responded_at,
           updated_at = now()
     WHERE id = v_offer.id
    RETURNING * INTO v_offer;

    INSERT INTO public.date_offer_events (offer_source, offer_id, actor_id, actor_role, event_type, detail)
    VALUES ('manual', v_offer.id, v_uid, 'user', 'accepted_partial', 'First participant accepted; waiting for partner.');

    INSERT INTO public.notifications (user_id, kind, title, body, link, read)
    VALUES (
      v_other_id, 'date_offer', 'Partner accepted your Concierge Date Offer',
      'Your partner accepted the date offer at ' || v_venue || '. Respond before it expires to confirm.', '/bookings', false
    );
  END IF;

  RETURN v_offer;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_manual_date_offer(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_manual_date_offer(uuid, boolean) TO authenticated;

-- ============================================================================
-- 8. INVITATION DATE RPCs (Requirement 5 — Individual / Group / Pair)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_date_invitation(
  p_title           text,
  p_invitation_mode text,
  p_user_ids        uuid[],
  p_experience_id   text DEFAULT NULL,
  p_cafe_id         text DEFAULT NULL,
  p_date            text DEFAULT NULL,
  p_time            text DEFAULT NULL,
  p_venue           text DEFAULT '',
  p_message         text DEFAULT NULL,
  p_expires_at      timestamptz DEFAULT NULL
)
RETURNS public.date_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id      uuid := auth.uid();
  v_clean_ids     uuid[];
  v_profile_count integer := 0;
  v_exp_id        text := NULLIF(btrim(COALESCE(p_experience_id, '')), '');
  v_cafe_id       text := NULLIF(btrim(COALESCE(p_cafe_id, '')), '');
  v_date          text := btrim(COALESCE(p_date, ''));
  v_time          text := btrim(COALESCE(p_time, ''));
  v_inv           public.date_invitations%ROWTYPE;
  v_venue         text;
  v_expires       timestamptz;
  v_expired_inv   uuid;
  v_uid           uuid;
  v_partner       uuid;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  -- Explicitly reject NULL or invalid invitation modes
  IF p_invitation_mode IS NULL OR p_invitation_mode NOT IN ('individual', 'group', 'pair') THEN
    RAISE EXCEPTION 'INVALID_MODE: Invitation mode must be individual, group, or pair.';
  END IF;

  IF p_title IS NULL OR btrim(p_title) = '' THEN
    RAISE EXCEPTION 'INVALID_TITLE: Invitation title is required.';
  END IF;

  -- Validate calendar date and time format safely
  PERFORM public.validate_date_offer_schedule(v_date, v_time);

  -- Validate experience: mandatory for pair invitations (date_bookings.experience_id is NOT NULL)
  IF p_invitation_mode = 'pair' AND v_exp_id IS NULL THEN
    RAISE EXCEPTION 'EXPERIENCE_REQUIRED: Paired invitations must specify a valid experience.';
  END IF;

  IF v_exp_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.experiences WHERE id = v_exp_id) THEN
    RAISE EXCEPTION 'EXPERIENCE_NOT_FOUND: Selected experience does not exist.';
  END IF;

  -- Validate optional cafe ID
  IF v_cafe_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.cafes WHERE id = v_cafe_id) THEN
    RAISE EXCEPTION 'CAFE_NOT_FOUND: Selected café does not exist.';
  END IF;

  -- Validate invitee list and reject NULL elements
  IF p_user_ids IS NULL OR array_length(p_user_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_INVITEES: Select at least one member to invite.';
  END IF;

  IF EXISTS (SELECT 1 FROM unnest(p_user_ids) AS u WHERE u IS NULL) THEN
    RAISE EXCEPTION 'INVALID_INVITEES: Invitee list must not contain null member IDs.';
  END IF;

  SELECT array_agg(DISTINCT u ORDER BY u) INTO v_clean_ids
  FROM unnest(p_user_ids) AS u;

  IF v_clean_ids IS NULL OR array_length(v_clean_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'NO_INVITEES: Select at least one member to invite.';
  END IF;

  IF p_invitation_mode = 'individual' AND array_length(v_clean_ids, 1) <> 1 THEN
    RAISE EXCEPTION 'INVALID_INVITEE_COUNT: Individual invitation must target exactly 1 member.';
  END IF;

  v_expires := COALESCE(p_expires_at, now() + interval '7 days');
  IF v_expires <= now() THEN
    RAISE EXCEPTION 'INVALID_EXPIRY: Invitation expiry must be in the future.';
  END IF;

  IF p_invitation_mode = 'pair' THEN
    IF array_length(v_clean_ids, 1) <> 2 THEN
      RAISE EXCEPTION 'INVALID_INVITEE_COUNT: Paired invitation must target exactly 2 distinct members.';
    END IF;

    -- Acquire canonical pair advisory lock before checking/creating paired invitation
    PERFORM public.lock_matchmaking_pair(v_clean_ids[1], v_clean_ids[2]);

    IF public.blocked_pair(v_clean_ids[1], v_clean_ids[2]) THEN
      RAISE EXCEPTION 'PAIR_BLOCKED: Cannot send a paired invitation to blocked members.';
    END IF;

    -- Expire any stale overdue active paired invitations for this pair (strict lock order: invitations -> recipients)
    FOR v_expired_inv IN
      UPDATE public.date_invitations i
         SET status = 'expired',
             updated_at = now()
       WHERE i.invitation_mode = 'pair'
         AND i.status = 'active'
         AND i.expires_at <= now()
         AND EXISTS (
           SELECT 1 FROM public.date_invitation_recipients r
           WHERE r.invitation_id = i.id
             AND r.user_id = v_clean_ids[1]
             AND r.partner_user_id = v_clean_ids[2]
         )
      RETURNING i.id
    LOOP
      UPDATE public.date_invitation_recipients
         SET response = 'expired',
             updated_at = now()
       WHERE invitation_id = v_expired_inv
         AND response = 'pending';
    END LOOP;

    -- Prevent duplicate active paired invitation for the same pair and date
    IF EXISTS (
      SELECT 1
      FROM public.date_invitations i
      JOIN public.date_invitation_recipients r
        ON r.invitation_id = i.id
      WHERE i.invitation_mode = 'pair'
        AND i.status = 'active'
        AND i.expires_at > now()
        AND i.date = v_date
        AND r.user_id = v_clean_ids[1]
        AND r.partner_user_id = v_clean_ids[2]
    ) THEN
      RAISE EXCEPTION 'DUPLICATE_ACTIVE_INVITATION: An active paired invitation already exists for this pair on %.', v_date;
    END IF;
  END IF;

  -- Validate ALL invitee profiles exist BEFORE inserting the invitation
  SELECT count(*)::integer INTO v_profile_count
  FROM public.profiles
  WHERE id = ANY(v_clean_ids);

  IF v_profile_count <> array_length(v_clean_ids, 1) THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: One or more selected invitees do not exist.';
  END IF;

  v_venue := NULLIF(btrim(COALESCE(p_venue, '')), '');
  IF v_venue IS NULL AND v_cafe_id IS NOT NULL THEN
    SELECT name || ', ' || city INTO v_venue FROM public.cafes WHERE id = v_cafe_id;
  END IF;
  v_venue := COALESCE(v_venue, 'Curated Venue');

  INSERT INTO public.date_invitations (
    invitation_mode, title, experience_id, cafe_id,
    date, time, venue, message, expires_at,
    status, created_by_admin_id
  ) VALUES (
    p_invitation_mode, btrim(p_title), v_exp_id, v_cafe_id,
    v_date, v_time, v_venue, NULLIF(btrim(COALESCE(p_message, '')), ''),
    v_expires, 'active', v_admin_id
  )
  RETURNING * INTO v_inv;

  -- Create private per-invitee recipient rows
  FOREACH v_uid IN ARRAY v_clean_ids LOOP
    v_partner := CASE
      WHEN p_invitation_mode = 'pair' THEN
        CASE WHEN v_uid = v_clean_ids[1] THEN v_clean_ids[2] ELSE v_clean_ids[1] END
      ELSE NULL
    END;

    INSERT INTO public.date_invitation_recipients (
      invitation_id, user_id, partner_user_id, response
    ) VALUES (
      v_inv.id, v_uid, v_partner, 'pending'
    );

    INSERT INTO public.notifications (user_id, kind, title, body, link, read)
    VALUES (
      v_uid, 'date_invitation', 'You''re Invited: ' || v_inv.title,
      'You received a personal Datevra invitation for ' || v_inv.date || ' at ' || v_inv.venue || '.', '/bookings', false
    );
  END LOOP;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'date_invitation.create',
    'Created ' || p_invitation_mode || ' invitation "' || v_inv.title || '" for ' || array_length(v_clean_ids, 1)::text || ' member(s).'
  );

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_date_invitation(text, text, uuid[], text, text, text, text, text, text, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_date_invitation(text, text, uuid[], text, text, text, text, text, text, timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_cancel_date_invitation(
  p_invitation_id uuid
)
RETURNS public.date_invitations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_inv      public.date_invitations%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  SELECT * INTO v_inv
  FROM public.date_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACTIVE: Active invitation not found.';
  END IF;

  -- Transaction-safe expiry: persist expired state if already overdue
  IF v_inv.status = 'active' AND v_inv.expires_at <= now() THEN
    UPDATE public.date_invitations
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_inv.id
    RETURNING * INTO v_inv;

    UPDATE public.date_invitation_recipients
       SET response = 'expired',
           updated_at = now()
     WHERE invitation_id = v_inv.id
       AND response = 'pending';

    RETURN v_inv;
  END IF;

  IF v_inv.status <> 'active' THEN
    RAISE EXCEPTION 'INVITATION_NOT_ACTIVE: Active invitation not found.';
  END IF;

  UPDATE public.date_invitations
     SET status = 'cancelled',
         cancelled_at = now(),
         updated_at = now()
   WHERE id = v_inv.id
  RETURNING * INTO v_inv;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'date_invitation.cancel', 'Cancelled invitation ' || v_inv.id::text || ' (' || v_inv.title || ')');

  RETURN v_inv;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_cancel_date_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_date_invitation(uuid) TO authenticated;

-- Member response RPC for Invitation Dates.
-- - Expiry persists on both date_invitations and pending date_invitation_recipients
--   and returns the updated recipient row (no rollback).
-- - Individual/group invitations record response only and NEVER create a 2-person booking.
-- - Pair invitations acquire canonical pair lock + row locks so concurrent dual acceptance
--   creates strictly one zero-charge booking.
CREATE OR REPLACE FUNCTION public.respond_to_date_invitation(
  p_invitation_id uuid,
  p_accept        boolean
)
RETURNS public.date_invitation_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid                 uuid := auth.uid();
  v_mode                text;
  v_partner_id          uuid;
  v_inv                 public.date_invitations%ROWTYPE;
  v_rec                 public.date_invitation_recipients%ROWTYPE;
  v_partner_rec         public.date_invitation_recipients%ROWTYPE;
  v_booking_id          uuid;
  v_existing_booking_id uuid;
  v_venue               text;
  v_a                   uuid;
  v_b                   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  IF p_accept IS NULL THEN
    RAISE EXCEPTION 'INVALID_RESPONSE: Acceptance decision is required.';
  END IF;

  -- Lightweight pre-lookup for canonical lock ordering on pair invitations
  SELECT i.invitation_mode, r.partner_user_id
    INTO v_mode, v_partner_id
  FROM public.date_invitations i
  LEFT JOIN public.date_invitation_recipients r
    ON r.invitation_id = i.id AND r.user_id = v_uid
  WHERE i.id = p_invitation_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: Invitation not found.';
  END IF;

  -- Canonical Lock Order Step 1: for pair invitations, lock canonical pair BEFORE row locks
  IF v_mode = 'pair' AND v_partner_id IS NOT NULL THEN
    PERFORM public.lock_matchmaking_pair(v_uid, v_partner_id);
  END IF;

  -- Canonical Lock Order Step 2: lock invitation row
  SELECT * INTO v_inv
  FROM public.date_invitations
  WHERE id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITATION_NOT_FOUND: Invitation not found.';
  END IF;

  -- Canonical Lock Order Step 3: lock recipient rows in deterministic user_id order
  IF v_inv.invitation_mode = 'pair' THEN
    PERFORM 1
    FROM public.date_invitation_recipients
    WHERE invitation_id = p_invitation_id
    ORDER BY user_id ASC
    FOR UPDATE;
  END IF;

  SELECT * INTO v_rec
  FROM public.date_invitation_recipients
  WHERE invitation_id = p_invitation_id AND user_id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: You are not an invitee for this invitation.';
  END IF;

  -- Transaction-safe expiry: persist expired state on invitation & pending recipients and return v_rec
  IF v_inv.status = 'active' AND v_inv.expires_at <= now() THEN
    UPDATE public.date_invitations
       SET status = 'expired',
           updated_at = now()
     WHERE id = v_inv.id;

    UPDATE public.date_invitation_recipients
       SET response = 'expired',
           updated_at = now()
     WHERE invitation_id = v_inv.id
       AND response = 'pending';

    SELECT * INTO v_rec
    FROM public.date_invitation_recipients
    WHERE id = v_rec.id;

    RETURN v_rec;
  END IF;

  IF v_inv.status <> 'active' THEN
    RAISE EXCEPTION 'INVITATION_CLOSED: This invitation is %.', v_inv.status;
  END IF;

  IF v_rec.response <> 'pending' THEN
    RAISE EXCEPTION 'ALREADY_RESPONDED: You have already responded (%) to this invitation.', v_rec.response;
  END IF;

  -- Transaction-safe pair-block handling: block prevents acceptance and persists cancelled state
  IF v_inv.invitation_mode = 'pair' AND p_accept AND v_rec.partner_user_id IS NOT NULL
     AND public.blocked_pair(v_uid, v_rec.partner_user_id) THEN
    UPDATE public.date_invitations
       SET status = 'cancelled',
           cancelled_at = now(),
           updated_at = now()
     WHERE id = v_inv.id;

    UPDATE public.date_invitation_recipients
       SET response = 'declined',
           responded_at = COALESCE(responded_at, now()),
           updated_at = now()
     WHERE invitation_id = v_inv.id
       AND response = 'pending';

    INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
    VALUES (
      v_uid,
      'system',
      'date_invitation.cancelled_blocked',
      'Cancelled paired invitation ' || v_inv.id::text || ' due to active block between invitees.'
    );

    SELECT * INTO v_rec
    FROM public.date_invitation_recipients
    WHERE id = v_rec.id;

    RETURN v_rec;
  END IF;

  UPDATE public.date_invitation_recipients
     SET response = CASE WHEN p_accept THEN 'accepted' ELSE 'declined' END,
         responded_at = now(),
         updated_at = now()
   WHERE id = v_rec.id
  RETURNING * INTO v_rec;

  -- CRITICAL BOOKING RULE (Requirement 5):
  -- Individual or group invitations NEVER auto-create a two-person date_booking.
  -- Only an explicit 'pair' invitation creates strictly one paired booking once BOTH invitees accept.
  IF v_inv.invitation_mode = 'pair' AND p_accept AND v_rec.partner_user_id IS NOT NULL THEN
    SELECT * INTO v_partner_rec
    FROM public.date_invitation_recipients
    WHERE invitation_id = p_invitation_id AND user_id = v_rec.partner_user_id;

    IF FOUND
       AND v_partner_rec.response = 'accepted'
       AND v_rec.booking_id IS NULL
       AND v_partner_rec.booking_id IS NULL THEN
      IF v_inv.experience_id IS NULL THEN
        RAISE EXCEPTION 'EXPERIENCE_REQUIRED: Paired invitation is missing a valid experience.';
      END IF;

      v_a := LEAST(v_uid, v_rec.partner_user_id);
      v_b := GREATEST(v_uid, v_rec.partner_user_id);
      v_venue := COALESCE(NULLIF(btrim(COALESCE(v_inv.venue, '')), ''), 'Curated Venue');

      -- Under the canonical pair advisory lock, check for an existing active booking
      -- (status IN ('pending', 'confirmed', 'upcoming')) before inserting a new one.
      SELECT b.id INTO v_existing_booking_id
      FROM public.date_bookings b
      WHERE b.status IN ('pending', 'confirmed', 'upcoming')
        AND (
          (b.user_id = v_a AND b.partner_id = v_b)
          OR (b.user_id = v_b AND b.partner_id = v_a)
        )
      ORDER BY b.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_existing_booking_id IS NOT NULL THEN
        UPDATE public.date_invitations
           SET status = 'cancelled',
               cancelled_at = now(),
               updated_at = now()
         WHERE id = v_inv.id;

        UPDATE public.date_invitation_recipients
           SET response = 'declined',
               booking_id = NULL,
               updated_at = now()
         WHERE id = v_rec.id;

        INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
        VALUES (
          v_uid,
          'system',
          'date_invitation.cancelled_active_booking_exists',
          'Cancelled paired invitation ' || v_inv.id::text || ' because active booking ' || v_existing_booking_id::text || ' already exists for this pair.'
        );

        SELECT * INTO v_rec
        FROM public.date_invitation_recipients
        WHERE id = v_rec.id;

        RETURN v_rec;
      END IF;

      INSERT INTO public.date_bookings (
        user_id, partner_id, experience_id, cafe_id,
        date, time, venue, status, amount, payment_status
      ) VALUES (
        v_a, v_b, v_inv.experience_id, v_inv.cafe_id,
        v_inv.date, v_inv.time, v_venue,
        'upcoming', 0, 'pending'
      )
      RETURNING id INTO v_booking_id;

      UPDATE public.date_invitation_recipients
         SET booking_id = v_booking_id,
             updated_at = now()
       WHERE invitation_id = p_invitation_id;

      UPDATE public.date_invitations
         SET status = 'completed',
             updated_at = now()
       WHERE id = p_invitation_id;

      INSERT INTO public.notifications (user_id, kind, title, body, link, read)
      VALUES
        (v_a, 'booking', 'Paired Invitation Confirmed', 'Both invitees accepted! Your date for ' || v_inv.title || ' at ' || v_venue || ' on ' || v_inv.date || ' is confirmed.', '/bookings', false),
        (v_b, 'booking', 'Paired Invitation Confirmed', 'Both invitees accepted! Your date for ' || v_inv.title || ' at ' || v_venue || ' on ' || v_inv.date || ' is confirmed.', '/bookings', false);

      SELECT * INTO v_rec
      FROM public.date_invitation_recipients
      WHERE id = v_rec.id;
    END IF;
  END IF;

  RETURN v_rec;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_date_invitation(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_date_invitation(uuid, boolean) TO authenticated;

-- ============================================================================
-- 9. INSTALLATION-TIME EVALUATION OF EXISTING 100+ ELIGIBLE MATCHES
-- ============================================================================
-- Ensures that if 100+ eligible mutual matches already exist when Migration 030
-- is installed, the one-time initial batch is evaluated immediately instead of
-- waiting for a future match INSERT trigger.
DO $$
BEGIN
  PERFORM public.evaluate_initial_auto_date_offers('migration_030_install');
END;
$$;
