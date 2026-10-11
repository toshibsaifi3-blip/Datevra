-- =====================================================================
-- DATEVRA — complete database setup (single-file)
-- Generated 2026-10-04 (security audit fixes included). Order:
--   001 schema → 002 client parity → 003 discovery → 004 hardening →
--   005 account deletion → 006 match integrity → 007 admin bootstrap →
--   008 payment retention → realtime setup.
-- Fully re-runnable: IF NOT EXISTS / OR REPLACE / DROP IF EXISTS guards.
-- Paste the entire file into Supabase → SQL Editor → New query → Run.
-- After running, bootstrap the first admin (SQL Editor, project owner):
--   SELECT public.bootstrap_first_admin('you@example.com');
-- There is NO client/API bootstrap path by design.
-- =====================================================================


-- #####################################################################
-- FILE: db/schema.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA — Supabase / PostgreSQL production schema
-- =====================================================================
-- Run this file in the Supabase SQL editor (or via `supabase db push`
-- if you adopt the Supabase CLI workflow). It is idempotent where
-- practical (IF NOT EXISTS / ON CONFLICT guards on seeds).
--
-- Sections:
--   1. Extensions & helper functions
--   2. Core tables (profiles, preferences, matching)
--   3. Chat tables
--   4. Curated dates, cafés
--   5. Money: plans, subscriptions, payments, investors
--   6. Ops: reports, blocks, notifications, CMS, settings, logs
--   7. updated_at triggers + mutual-like trigger
--   8. Indexes
--   9. Row Level Security policies
--  10. Storage buckets + policies
--  11. Seed data
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. EXTENSIONS & HELPERS
-- ---------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS "pgcrypto";  -- gen_random_uuid()

-- Returns true when the calling user is a Datevra admin.
-- SECURITY DEFINER so policies can call it without RLS recursion.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND is_admin = true
  );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  'Helper for RLS policies: true when auth.uid() belongs to a profile with is_admin = true.';

-- Generic updated_at maintenance trigger.
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =====================================================================
-- 2. CORE: PROFILES, PREFERENCES, MATCHING
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
                  REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text UNIQUE NOT NULL,
  first_name      text NOT NULL,
  age             int  NOT NULL CHECK (age >= 18),
  gender          text NOT NULL CHECK (gender IN ('woman','man','nonbinary')),
  interested_in   text NOT NULL DEFAULT 'everyone'
                  CHECK (interested_in IN ('women','men','everyone')),
  city            text NOT NULL,
  bio             text DEFAULT '',
  interests       text[] NOT NULL DEFAULT '{}',
  hobbies         text[] NOT NULL DEFAULT '{}',
  relationship_intent text,
  lifestyle       text[] NOT NULL DEFAULT '{}',
  photos          text[] NOT NULL DEFAULT '{}',  -- storage paths in profile-photos bucket
  verified        boolean NOT NULL DEFAULT false,
  online          boolean NOT NULL DEFAULT false,
  last_active     timestamptz,
  profile_complete int NOT NULL DEFAULT 0 CHECK (profile_complete BETWEEN 0 AND 100),
  plan_id         text,  -- FK to membership_plans added below (created later in this file)
  plan_expires_at timestamptz,
  is_admin        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS
  'Member profiles. email is never exposed to other members (see profiles_public view).';
COMMENT ON COLUMN public.profiles.age IS 'Enforced >= 18 at the database level.';

CREATE TABLE IF NOT EXISTS public.match_preferences (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  age_min              int NOT NULL DEFAULT 18 CHECK (age_min >= 18),
  age_max              int NOT NULL DEFAULT 60,
  interested_in        text NOT NULL DEFAULT 'everyone'
                       CHECK (interested_in IN ('women','men','everyone')),
  cities               text[] NOT NULL DEFAULT '{}',
  max_distance_km      int,
  relationship_intents text[] NOT NULL DEFAULT '{}',
  min_shared_interests int NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  CHECK (age_min <= age_max)
);

-- A "like" from one user to another. A match is created automatically
-- (see handle_mutual_like trigger) when the reverse like exists.
CREATE TABLE IF NOT EXISTS public.likes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);

CREATE TABLE IF NOT EXISTS public.passes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  to_user_id   uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_user_id, to_user_id),
  CHECK (from_user_id <> to_user_id)
);

-- Mutual matches. user_a/user_b are always stored in UUID order
-- (least first) via the order_match_pair trigger, so each pair is unique.
CREATE TABLE IF NOT EXISTS public.matches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_b        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  compatibility int CHECK (compatibility BETWEEN 0 AND 100),
  factors       text[] NOT NULL DEFAULT '{}',  -- human-readable score reasons
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_a, user_b),
  CHECK (user_a <> user_b)
);

COMMENT ON TABLE public.matches IS
  'Created only on mutual likes. compatibility is a transparent 0-100 score from real shared factors — never fabricated, never a guarantee.';

CREATE TABLE IF NOT EXISTS public.saved_profiles (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, profile_id),
  CHECK (user_id <> profile_id)
);

-- =====================================================================
-- 3. CHAT
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        uuid UNIQUE NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  participant_ids uuid[] NOT NULL,  -- exactly the two matched user ids
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.conversations IS
  'One conversation per mutual match. Only listed participants may read/write messages.';

CREATE TABLE IF NOT EXISTS public.messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  text            text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 2000),
  delivered       boolean NOT NULL DEFAULT false,
  read            boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- =====================================================================
-- 4. CURATED DATE EXPERIENCES & CAFES
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.experiences (
  id           text PRIMARY KEY,  -- stable seed ids like 'e-golden-hour'
  title        text NOT NULL,
  kind         text NOT NULL,     -- 'Coffee Date' | 'Romantic Café' | 'Premium Dining' | 'Casual First Date'
  city         text NOT NULL,
  description  text NOT NULL,
  image        text DEFAULT '',   -- storage path in experience-media bucket
  price_from   int NOT NULL CHECK (price_from >= 0),
  duration_mins int NOT NULL CHECK (duration_mins > 0),
  eligibility  text[] NOT NULL DEFAULT '{}',
  slots        jsonb NOT NULL DEFAULT '[]',  -- [{date, time, seats}]
  elite_only   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.experiences IS
  'Curated date experiences. Selection of participants is ALWAYS manual by admins — never automated.';

CREATE TABLE IF NOT EXISTS public.date_applications (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  experience_id text NOT NULL REFERENCES public.experiences(id) ON DELETE RESTRICT,
  slot_date     text,
  slot_time     text,
  note          text DEFAULT '',
  status        text NOT NULL DEFAULT 'submitted'
                CHECK (status IN ('submitted','under_review','eligible','selected',
                                  'confirmed','completed','declined','cancelled')),
  admin_note    text DEFAULT '',
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.date_applications.status IS
  'Admin-driven workflow: submitted → under_review → eligible → selected → confirmed → completed (or declined/cancelled). Selection is never guaranteed.';

CREATE TABLE IF NOT EXISTS public.cafes (
  id             text PRIMARY KEY,  -- stable seed ids like 'c-roastery-mum'
  name           text NOT NULL,
  city           text NOT NULL,
  address        text NOT NULL,
  description    text NOT NULL,
  image          text DEFAULT '',   -- storage path in cafe-media bucket
  price_range    text NOT NULL DEFAULT '₹₹',
  opening_hours  text NOT NULL DEFAULT '',
  experiences    text[] NOT NULL DEFAULT '{}',
  booking_info   text NOT NULL DEFAULT '',
  rating         numeric CHECK (rating BETWEEN 0 AND 5),
  partner        boolean NOT NULL DEFAULT false,
  commission_pct numeric NOT NULL DEFAULT 0 CHECK (commission_pct BETWEEN 0 AND 100),
  agreement_ref  text,
  total_bookings int NOT NULL DEFAULT 0,
  revenue        int NOT NULL DEFAULT 0,  -- paise-free: integer rupees
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.saved_cafes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  cafe_id    text NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, cafe_id)
);

CREATE TABLE IF NOT EXISTS public.date_bookings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  experience_id  text NOT NULL REFERENCES public.experiences(id) ON DELETE RESTRICT,
  cafe_id        text REFERENCES public.cafes(id) ON DELETE SET NULL,
  date           text NOT NULL,
  time           text NOT NULL,
  venue          text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','confirmed','upcoming','completed','cancelled')),
  amount         int NOT NULL DEFAULT 0 CHECK (amount >= 0),
  payment_status text NOT NULL DEFAULT 'pending'
                 CHECK (payment_status IN ('pending','verified','failed','refunded')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.date_bookings IS
  'Booking details are shared ONLY with the participants and authorized staff — never publicly.';

-- =====================================================================
-- 5. MONEY: PLANS, SUBSCRIPTIONS, PAYMENTS, INVESTORS
-- =====================================================================

-- NOTE: Connect / Plus / Elite are the ONLY membership plans.
-- Legacy names (Marigold, Sunflower, Rose) were permanently removed from
-- the product and must never be reintroduced in seeds, UI or billing.
CREATE TABLE IF NOT EXISTS public.membership_plans (
  id        text PRIMARY KEY CHECK (id IN ('connect','plus','elite')),
  name      text NOT NULL,
  price     int  NOT NULL CHECK (price >= 0),  -- INR, monthly billing
  tagline   text NOT NULL DEFAULT '',
  features  text[] NOT NULL DEFAULT '{}',
  priority  int  NOT NULL,   -- matchmaking priority tier, higher = more
  badge     text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.membership_plans IS
  'Membership enhances visibility and priority. It NEVER guarantees a match, a relationship, commitment, a date, or any particular romantic outcome.';

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id    text NOT NULL REFERENCES public.membership_plans(id),
  status     text NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending','active','expired','cancelled')),
  started_at timestamptz,
  expires_at timestamptz,
  auto_renew boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Every payment is recorded with verification status. A payment is only
-- treated as successful after Razorpay verification — never before.
CREATE TABLE IF NOT EXISTS public.payments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind                text NOT NULL CHECK (kind IN ('membership','experience','cash')),
  amount              int  NOT NULL CHECK (amount >= 0),  -- INR
  plan_id             text REFERENCES public.membership_plans(id),
  status              text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','verified','failed','refunded')),
  razorpay_order_id   text,
  razorpay_payment_id text,
  method              text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.payments IS
  'Inserts are performed server-side only (Edge Function) after Razorpay verification. kind=''cash'' covers admin-recorded offline payments.';

-- Investor arrangements are tracking records only — not promises of
-- guaranteed investment returns.
CREATE TABLE IF NOT EXISTS public.investors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  agreement_ref text,
  share_pct     numeric CHECK (share_pct BETWEEN 0 AND 100),
  schedule      text,
  paid_out      int NOT NULL DEFAULT 0,
  pending       int NOT NULL DEFAULT 0,
  notes         text DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Now that membership_plans exists, wire up the deferred FK.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_plan_id_fkey'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_plan_id_fkey
      FOREIGN KEY (plan_id) REFERENCES public.membership_plans(id);
  END IF;
END $$;

-- =====================================================================
-- 6. OPS: REPORTS, BLOCKS, NOTIFICATIONS, CMS, SETTINGS, LOGS
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reported_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  details     text DEFAULT '',
  status      text NOT NULL DEFAULT 'open'
              CHECK (status IN ('open','reviewing','resolved','dismissed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (reporter_id <> reported_id)
);

CREATE TABLE IF NOT EXISTS public.blocks (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);

COMMENT ON TABLE public.blocks IS
  'Blocked users are excluded from discovery (profiles_public view) and messaging.';

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kind       text NOT NULL,  -- 'match' | 'like' | 'message' | 'membership' | 'payment' | 'application' | 'booking' | 'safety'
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  link       text DEFAULT '',  -- in-app route, e.g. '/matches'
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'Inserted server-side (triggers / Edge Functions). No automated messages pretending to be a user.';

CREATE TABLE IF NOT EXISTS public.cms_pages (
  slug       text PRIMARY KEY,
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cms_pages IS 'Legal & editorial content (privacy, terms, refund policy, about, FAQs). Public read; admin write.';

CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                 int PRIMARY KEY CHECK (id = 1),  -- singleton row
  maintenance_mode   boolean NOT NULL DEFAULT false,
  min_age            int NOT NULL DEFAULT 18 CHECK (min_age >= 18),
  razorpay_test_mode boolean NOT NULL DEFAULT true,
  support_email      text NOT NULL DEFAULT 'support@datevra.in',
  announcements      jsonb NOT NULL DEFAULT '[]',
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Audit trail for sensitive changes. Historical financial records must
-- never be silently altered — log before/after in detail.
CREATE TABLE IF NOT EXISTS public.activity_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid,  -- may be null for system actions
  actor_role text NOT NULL DEFAULT 'system' CHECK (actor_role IN ('admin','system','user')),
  action     text NOT NULL,
  detail     text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.activity_logs IS
  'Append-only audit log. Admins and privileged functions insert; nobody updates or deletes.';

-- =====================================================================
-- 7. TRIGGERS
-- =====================================================================

-- updated_at maintenance on the main mutable tables.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','match_preferences','matches','conversations','messages',
    'experiences','date_applications','cafes','date_bookings',
    'membership_plans','subscriptions','payments','investors',
    'reports','cms_pages','platform_settings'
  ] LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_set_updated_at ON public.%I;
       CREATE TRIGGER trg_set_updated_at
       BEFORE UPDATE ON public.%I
       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();', t, t);
  END LOOP;
END $$;

-- Keep match pairs in canonical UUID order (least, greatest).
CREATE OR REPLACE FUNCTION public.order_match_pair()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  tmp uuid;
BEGIN
  IF NEW.user_a > NEW.user_b THEN
    tmp := NEW.user_a;
    NEW.user_a := NEW.user_b;
    NEW.user_b := tmp;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_order_match_pair ON public.matches;
CREATE TRIGGER trg_order_match_pair
  BEFORE INSERT OR UPDATE OF user_a, user_b ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.order_match_pair();

-- On a mutual like: create the match, its conversation, and notify both.
-- SECURITY DEFINER so it runs with full rights regardless of caller RLS.
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
  -- Only proceed if the reverse like exists (mutual interest).
  IF NOT EXISTS (
    SELECT 1 FROM public.likes
    WHERE from_user_id = NEW.to_user_id AND to_user_id = NEW.from_user_id
  ) THEN
    RETURN NEW;
  END IF;

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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_mutual_like ON public.likes;
CREATE TRIGGER trg_mutual_like
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.handle_mutual_like();

-- =====================================================================
-- 8. INDEXES
-- =====================================================================

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_user_created
  ON public.payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user
  ON public.subscriptions (user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created
  ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_to_user
  ON public.likes (to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_likes_from_user
  ON public.likes (from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_matches_user_a ON public.matches (user_a);
CREATE INDEX IF NOT EXISTS idx_matches_user_b ON public.matches (user_b);
CREATE INDEX IF NOT EXISTS idx_conversations_participants
  ON public.conversations USING gin (participant_ids);
CREATE INDEX IF NOT EXISTS idx_applications_user
  ON public.date_applications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_status
  ON public.date_applications (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_user
  ON public.date_bookings (user_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_city ON public.profiles (city);

-- =====================================================================
-- 9. ROW LEVEL SECURITY
-- =====================================================================

ALTER TABLE public.profiles           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.match_preferences  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.likes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.passes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiences        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cafes              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_cafes        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.date_bookings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.membership_plans   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investors          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocks             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cms_pages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs      ENABLE ROW LEVEL SECURITY;

-- ---------- profiles ----------
-- Members see each other through the profiles_public view (no email,
-- no blocked pairs). Direct table reads are own-row only.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own" ON public.profiles
  FOR SELECT TO authenticated USING (auth.uid() = id);
DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own" ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = id
    -- CRITICAL: never allow self-granting admin on signup (column defaults
    -- to false; this blocks an explicit is_admin=true in a direct API call)
    AND coalesce(is_admin, false) = false
  );
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    -- Non-recursive privilege guard: no subquery on profiles (the old
    -- version queried profiles inside its own policy). Members may never
    -- set is_admin; admins may (they are also covered by profiles_admin_all).
    -- The protect_profile_fields trigger enforces the same rule on OLD/NEW.
    AND (coalesce(is_admin, false) = false OR public.is_admin())
  );
DROP POLICY IF EXISTS "profiles_admin_all" ON public.profiles;
CREATE POLICY "profiles_admin_all" ON public.profiles
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Public-safe view: everything a member may see about another member.
-- Runs as the view owner (SECURITY DEFINER semantics) so email stays hidden.
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  p.id, p.first_name, p.age, p.gender, p.interested_in, p.city, p.bio,
  p.interests, p.hobbies, p.relationship_intent, p.lifestyle, p.photos,
  p.verified, p.online, p.last_active, p.profile_complete, p.plan_id,
  p.created_at
FROM public.profiles p
WHERE auth.uid() IS NOT NULL  -- defence in depth: only signed-in members
  AND NOT EXISTS (
  SELECT 1 FROM public.blocks b
  WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id)
     OR (b.blocker_id = p.id AND b.blocked_id = auth.uid())
);

COMMENT ON VIEW public.profiles_public IS
  'Discovery-safe profile view: excludes email, and hides anyone blocked in either direction.';

-- ---------- match_preferences ----------
DROP POLICY IF EXISTS "prefs_owner_all" ON public.match_preferences;
CREATE POLICY "prefs_owner_all" ON public.match_preferences
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------- likes / passes ----------
DROP POLICY IF EXISTS "likes_select_participants" ON public.likes;
CREATE POLICY "likes_select_participants" ON public.likes
  FOR SELECT TO authenticated
  USING (auth.uid() = from_user_id OR auth.uid() = to_user_id OR public.is_admin());
DROP POLICY IF EXISTS "likes_insert_own" ON public.likes;
CREATE POLICY "likes_insert_own" ON public.likes
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = from_user_id);
DROP POLICY IF EXISTS "likes_delete_own" ON public.likes;
CREATE POLICY "likes_delete_own" ON public.likes
  FOR DELETE TO authenticated USING (auth.uid() = from_user_id);

DROP POLICY IF EXISTS "passes_owner_all" ON public.passes;
CREATE POLICY "passes_owner_all" ON public.passes
  FOR ALL TO authenticated
  USING (auth.uid() = from_user_id) WITH CHECK (auth.uid() = from_user_id);

-- ---------- matches ----------
-- Matches are created server-side by the mutual-like trigger; members
-- only read their own.
DROP POLICY IF EXISTS "matches_select_participants" ON public.matches;
CREATE POLICY "matches_select_participants" ON public.matches
  FOR SELECT TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b OR public.is_admin());

-- ---------- saved_profiles ----------
DROP POLICY IF EXISTS "saved_profiles_owner_all" ON public.saved_profiles;
CREATE POLICY "saved_profiles_owner_all" ON public.saved_profiles
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------- conversations / messages ----------
DROP POLICY IF EXISTS "conversations_participants" ON public.conversations;
CREATE POLICY "conversations_participants" ON public.conversations
  FOR SELECT TO authenticated
  USING (participant_ids @> ARRAY[auth.uid()]::uuid[] OR public.is_admin());

DROP POLICY IF EXISTS "messages_select_participants" ON public.messages;
CREATE POLICY "messages_select_participants" ON public.messages
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND (c.participant_ids @> ARRAY[auth.uid()]::uuid[] OR public.is_admin()))
  );
DROP POLICY IF EXISTS "messages_insert_participant" ON public.messages;
CREATE POLICY "messages_insert_participant" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.participant_ids @> ARRAY[auth.uid()]::uuid[])
  );
DROP POLICY IF EXISTS "messages_update_participant" ON public.messages;
CREATE POLICY "messages_update_participant" ON public.messages
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.participant_ids @> ARRAY[auth.uid()]::uuid[])
  );

-- ---------- experiences / cafes / membership_plans ----------
DROP POLICY IF EXISTS "experiences_public_read" ON public.experiences;
CREATE POLICY "experiences_public_read" ON public.experiences
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "experiences_admin_write" ON public.experiences;
CREATE POLICY "experiences_admin_write" ON public.experiences
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "experiences_admin_update" ON public.experiences;
CREATE POLICY "experiences_admin_update" ON public.experiences
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "experiences_admin_delete" ON public.experiences;
CREATE POLICY "experiences_admin_delete" ON public.experiences
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "cafes_public_read" ON public.cafes;
CREATE POLICY "cafes_public_read" ON public.cafes
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "cafes_admin_write" ON public.cafes;
CREATE POLICY "cafes_admin_write" ON public.cafes
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "cafes_admin_update" ON public.cafes;
CREATE POLICY "cafes_admin_update" ON public.cafes
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "cafes_admin_delete" ON public.cafes;
CREATE POLICY "cafes_admin_delete" ON public.cafes
  FOR DELETE TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS "plans_public_read" ON public.membership_plans;
CREATE POLICY "plans_public_read" ON public.membership_plans
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "plans_admin_write" ON public.membership_plans;
CREATE POLICY "plans_admin_write" ON public.membership_plans
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- date_applications ----------
DROP POLICY IF EXISTS "applications_select_own" ON public.date_applications;
CREATE POLICY "applications_select_own" ON public.date_applications
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "applications_insert_own" ON public.date_applications;
CREATE POLICY "applications_insert_own" ON public.date_applications
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "applications_admin_update" ON public.date_applications;
CREATE POLICY "applications_admin_update" ON public.date_applications
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- date_bookings ----------
-- Bookings are created/updated by admins (manual selection workflow);
-- participants can read their own.
DROP POLICY IF EXISTS "bookings_select_participants" ON public.date_bookings;
CREATE POLICY "bookings_select_participants" ON public.date_bookings
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR auth.uid() = partner_id OR public.is_admin());
DROP POLICY IF EXISTS "bookings_admin_write" ON public.date_bookings;
CREATE POLICY "bookings_admin_write" ON public.date_bookings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- saved_cafes ----------
DROP POLICY IF EXISTS "saved_cafes_owner_all" ON public.saved_cafes;
CREATE POLICY "saved_cafes_owner_all" ON public.saved_cafes
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ---------- subscriptions / payments ----------
-- Rows are written server-side only (Edge Function) after Razorpay
-- verification. Members read their own; admins read all.
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own" ON public.subscriptions
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());
DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.is_admin());

-- ---------- reports / blocks ----------
DROP POLICY IF EXISTS "reports_insert_own" ON public.reports;
CREATE POLICY "reports_insert_own" ON public.reports
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = reporter_id
    -- Members can only file fresh reports; status changes are admin-only
    -- (prevents filing pre-resolved reports that skip the review queue)
    AND status = 'open'
  );
DROP POLICY IF EXISTS "reports_select_own_or_admin" ON public.reports;
CREATE POLICY "reports_select_own_or_admin" ON public.reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id OR public.is_admin());
DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;
CREATE POLICY "reports_admin_update" ON public.reports
  FOR UPDATE TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "blocks_owner_all" ON public.blocks;
CREATE POLICY "blocks_owner_all" ON public.blocks
  FOR ALL TO authenticated
  USING (auth.uid() = blocker_id) WITH CHECK (auth.uid() = blocker_id);
DROP POLICY IF EXISTS "blocks_admin_read" ON public.blocks;
CREATE POLICY "blocks_admin_read" ON public.blocks
  FOR SELECT TO authenticated USING (public.is_admin());

-- ---------- notifications ----------
-- Inserted server-side (triggers / Edge Functions); members manage their own.
DROP POLICY IF EXISTS "notifications_owner_read" ON public.notifications;
CREATE POLICY "notifications_owner_read" ON public.notifications
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_owner_update" ON public.notifications;
CREATE POLICY "notifications_owner_update" ON public.notifications
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "notifications_owner_delete" ON public.notifications;
CREATE POLICY "notifications_owner_delete" ON public.notifications
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- ---------- cms_pages ----------
DROP POLICY IF EXISTS "cms_public_read" ON public.cms_pages;
CREATE POLICY "cms_public_read" ON public.cms_pages
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "cms_admin_write" ON public.cms_pages;
CREATE POLICY "cms_admin_write" ON public.cms_pages
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- ---------- platform_settings / investors / activity_logs ----------
DROP POLICY IF EXISTS "settings_admin_all" ON public.platform_settings;
CREATE POLICY "settings_admin_all" ON public.platform_settings
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "investors_admin_all" ON public.investors;
CREATE POLICY "investors_admin_all" ON public.investors
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
DROP POLICY IF EXISTS "logs_admin_read" ON public.activity_logs;
CREATE POLICY "logs_admin_read" ON public.activity_logs
  FOR SELECT TO authenticated USING (public.is_admin());
-- Inserts come from admins (console) or privileged server functions.

-- =====================================================================
-- 10. STORAGE
-- =====================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES
  ('profile-photos',   'profile-photos',   true),
  ('cafe-media',       'cafe-media',       true),
  ('experience-media', 'experience-media', true)
ON CONFLICT (id) DO NOTHING;

-- Public reads (buckets are public; policies still required).
DROP POLICY IF EXISTS "Public read profile photos" ON storage.objects;
CREATE POLICY "Public read profile photos" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'profile-photos');
DROP POLICY IF EXISTS "Public read cafe media" ON storage.objects;
CREATE POLICY "Public read cafe media" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'cafe-media');
DROP POLICY IF EXISTS "Public read experience media" ON storage.objects;
CREATE POLICY "Public read experience media" ON storage.objects
  FOR SELECT TO public USING (bucket_id = 'experience-media');

-- Members upload only into their own folder: <user-id>/...
DROP POLICY IF EXISTS "Users upload own profile photos" ON storage.objects;
CREATE POLICY "Users upload own profile photos" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
DROP POLICY IF EXISTS "Users update own profile photos" ON storage.objects;
CREATE POLICY "Users update own profile photos" ON storage.objects
  FOR UPDATE TO authenticated USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
DROP POLICY IF EXISTS "Users delete own profile photos" ON storage.objects;
CREATE POLICY "Users delete own profile photos" ON storage.objects
  FOR DELETE TO authenticated USING (
    bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

-- Café & experience media are admin-managed.
DROP POLICY IF EXISTS "Admins manage cafe media" ON storage.objects;
CREATE POLICY "Admins manage cafe media" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'cafe-media' AND public.is_admin())
  WITH CHECK (bucket_id = 'cafe-media' AND public.is_admin());
DROP POLICY IF EXISTS "Admins manage experience media" ON storage.objects;
CREATE POLICY "Admins manage experience media" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'experience-media' AND public.is_admin())
  WITH CHECK (bucket_id = 'experience-media' AND public.is_admin());

-- =====================================================================
-- 11. SEED DATA
-- =====================================================================

-- Membership plans: the ONLY plans. Prices in INR, billed monthly.
INSERT INTO public.membership_plans (id, name, price, tagline, features, priority, badge)
VALUES
  ('connect', 'Connect', 499, 'Begin with intention',
   ARRAY['Premium membership badge','Priority matchmaking','Enhanced profile visibility',
         'Basic advanced discovery preferences','Premium profile enhancements'],
   1, 'Connect Member'),
  ('plus', 'Plus', 799, 'Be discovered, beautifully',
   ARRAY['Everything in Connect','Higher matchmaking priority','Enhanced discovery filters',
         'Additional profile visibility benefits','Enhanced profile presentation','Priority support'],
   2, 'Plus Member'),
  ('elite', 'Elite', 1199, 'The Datevra signature',
   ARRAY['Everything in Plus','Highest available matching priority','Advanced profile enhancements',
         'Exclusive discovery privileges','Premium customer support',
         'Eligibility for selected exclusive Datevra experiences'],
   3, 'Elite Member')
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, price = EXCLUDED.price, tagline = EXCLUDED.tagline,
  features = EXCLUDED.features, priority = EXCLUDED.priority, badge = EXCLUDED.badge,
  updated_at = now();

-- Singleton platform settings.
INSERT INTO public.platform_settings (id, maintenance_mode, min_age, razorpay_test_mode, support_email, announcements)
VALUES (1, false, 18, true, 'support@datevra.in', '[]')
ON CONFLICT (id) DO NOTHING;

-- Curated experiences (copied from the product seed catalogue).
INSERT INTO public.experiences (id, title, kind, city, description, image, price_from, duration_mins, eligibility, slots, elite_only)
VALUES
  ('e-golden-hour', 'Golden Hour Pour-Over', 'Coffee Date', 'Mumbai',
   'A guided coffee tasting for two at golden hour — three single-origin pour-overs, a shared dessert, and a table with the best light in Fort.',
   '', 1200, 90,
   ARRAY['Verified profile','Age 21+','Completed onboarding'],
   '[{"date":"2026-10-10","time":"5:00 PM","seats":6},{"date":"2026-10-11","time":"5:00 PM","seats":6}]'::jsonb,
   false),
  ('e-courtyard', 'Courtyard Candlelight', 'Romantic Café', 'Delhi',
   'An evening in Lodhi''s most romantic courtyard — artisanal bakes, slow coffee, and a corner table reserved under string lights.',
   '', 1800, 120,
   ARRAY['Verified profile','Age 23+'],
   '[{"date":"2026-10-12","time":"7:30 PM","seats":4},{"date":"2026-10-17","time":"7:30 PM","seats":4}]'::jsonb,
   false),
  ('e-chefs-table', 'Chef''s Table for Two', 'Premium Dining', 'Hyderabad',
   'A five-course tasting menu crafted for two, with the chef introducing each course. Datevra''s most requested evening.',
   '', 4500, 150,
   ARRAY['Elite membership','Verified profile','Age 25+'],
   '[{"date":"2026-10-18","time":"8:00 PM","seats":4}]'::jsonb,
   true),
  ('e-first-sip', 'First Sip, Easy Talk', 'Casual First Date', 'Bengaluru',
   'A relaxed first meeting built around a coffee flight — low pressure, easy conversation, and a graceful exit if the spark isn''t there.',
   '', 800, 60,
   ARRAY['Verified profile','Age 21+'],
   '[{"date":"2026-10-11","time":"11:00 AM","seats":8},{"date":"2026-10-12","time":"4:00 PM","seats":8}]'::jsonb,
   false),
  ('e-heritage', 'Heritage Evening', 'Romantic Café', 'Jaipur',
   'Fairy lights, a royal courtyard, and a curated high-tea that turns into dinner as the evening deepens.',
   '', 2200, 150,
   ARRAY['Verified profile','Age 23+'],
   '[{"date":"2026-10-16","time":"6:30 PM","seats":6}]'::jsonb,
   false),
  ('e-patisserie', 'Pâtisserie at Dusk', 'Premium Dining', 'Pune',
   'A French salon evening — champagne-hour mocktails, delicate pâtisserie, and candlelight corners at Maison Suzette.',
   '', 3200, 120,
   ARRAY['Elite membership','Verified profile','Age 24+'],
   '[{"date":"2026-10-19","time":"7:00 PM","seats":4}]'::jsonb,
   true)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title, kind = EXCLUDED.kind, city = EXCLUDED.city,
  description = EXCLUDED.description, price_from = EXCLUDED.price_from,
  duration_mins = EXCLUDED.duration_mins, eligibility = EXCLUDED.eligibility,
  slots = EXCLUDED.slots, elite_only = EXCLUDED.elite_only, updated_at = now();

-- Partner cafés (copied from the product seed catalogue).
INSERT INTO public.cafes (id, name, city, address, description, image, price_range, opening_hours, experiences, booking_info, rating, partner, commission_pct, agreement_ref, total_bookings, revenue)
VALUES
  ('c-roastery-mum', 'Kala Ghoda Roastery', 'Mumbai', 'Fort, Kala Ghoda, Mumbai 400001',
   'A sunlit heritage roastery with single-origin pour-overs and a quiet mezzanine made for long conversations.',
   '', '₹₹', '8:00 AM – 11:00 PM',
   ARRAY['Coffee Date','Casual First Date'],
   'Reserve via Datevra concierge. Window seats held for Datevra guests until 7 PM.',
   4.8, true, 12, 'DVR-AGR-2026-014', 132, 184800),
  ('c-lodhi-del', 'Lodhi Art House', 'Delhi', 'Lodhi Colony Market, New Delhi 110003',
   'Gallery-adjacent café with slow mornings, artisanal bakes, and Delhi''s most romantic courtyard.',
   '', '₹₹', '9:00 AM – 10:30 PM',
   ARRAY['Romantic Café','Coffee Date'],
   'Courtyard tables for Datevra bookings. 48-hour cancellation.',
   4.7, true, 10, 'DVR-AGR-2026-009', 98, 147000),
  ('c-thirdwave-blr', 'Indiranagar Brew Room', 'Bengaluru', '100 Feet Road, Indiranagar, Bengaluru 560038',
   'Minimalist brew room with tasting flights — perfect for a first date that feels effortless.',
   '', '₹', '8:30 AM – 10:00 PM',
   ARRAY['Coffee Date','Casual First Date'],
   'Walk-ins welcome; Datevra guests get priority seating.',
   4.6, true, 8, 'DVR-AGR-2026-021', 74, 59200),
  ('c-suzette-pune', 'Maison Suzette', 'Pune', 'Koregaon Park, Pune 411001',
   'French-style salon de thé with patisserie, candlelight corners, and unhurried evenings.',
   '', '₹₹₹', '10:00 AM – 11:00 PM',
   ARRAY['Romantic Café','Premium Dining'],
   'Datevra concierge booking required for evening slots.',
   4.9, true, 15, 'DVR-AGR-2026-003', 61, 183000),
  ('c-tapri-jpr', 'Johari Courtyard', 'Jaipur', 'Johari Bazaar, Jaipur 302003',
   'A royal-courtyard café under fairy lights — heritage romance with modern comfort.',
   '', '₹₹', '9:00 AM – 11:00 PM',
   ARRAY['Romantic Café','Casual First Date'],
   'Evening slots fill fast on weekends; book 3 days ahead.',
   4.7, false, 0, NULL, 45, 67500),
  ('c-aerocity-hyd', 'Deccan Table', 'Hyderabad', 'Jubilee Hills, Hyderabad 500033',
   'Contemporary dining room with a chef''s tasting menu designed for two.',
   '', '₹₹₹', '12:00 PM – 11:30 PM',
   ARRAY['Premium Dining'],
   'Tasting menu for two via Datevra concierge only.',
   4.8, true, 14, 'DVR-AGR-2026-027', 52, 208000)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, city = EXCLUDED.city, address = EXCLUDED.address,
  description = EXCLUDED.description, price_range = EXCLUDED.price_range,
  opening_hours = EXCLUDED.opening_hours, experiences = EXCLUDED.experiences,
  booking_info = EXCLUDED.booking_info, rating = EXCLUDED.rating,
  partner = EXCLUDED.partner, commission_pct = EXCLUDED.commission_pct,
  agreement_ref = EXCLUDED.agreement_ref, total_bookings = EXCLUDED.total_bookings,
  revenue = EXCLUDED.revenue, updated_at = now();

-- Starter CMS pages (edit in the admin console).
INSERT INTO public.cms_pages (slug, title, body)
VALUES
  ('privacy', 'Privacy Policy', 'Datevra privacy policy — to be completed before public launch.'),
  ('terms', 'Terms of Service', 'Datevra terms of service — to be completed before public launch.'),
  ('refund', 'Refund Policy', 'Datevra refund policy — to be completed before public launch.'),
  ('about', 'About Datevra', 'Datevra is a premium dating and curated date-experience platform.')
ON CONFLICT (slug) DO NOTHING;

-- =====================================================================
-- 12. GRANTS
-- =====================================================================
-- RLS policies do the row-level work; grants control table-level access.

GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT SELECT ON public.membership_plans, public.experiences, public.cafes,
              public.cms_pages TO anon, authenticated;
GRANT SELECT ON public.profiles_public TO authenticated;  -- members only, never anon
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated;

-- NOTE: inserts into payments / subscriptions / notifications by the app
-- must go through a privileged server context (Edge Function with the
-- service-role key), which bypasses RLS. Never ship the service-role key
-- or Razorpay key secret in frontend code.

-- =====================================================================
-- DONE. Next steps:
--   1. Paste this file into Supabase → SQL Editor → Run (fresh project).
--   2. Create an admin: sign up normally, then
--      UPDATE public.profiles SET is_admin = true WHERE email = 'you@example.com';
--   3. Set env vars (see .env.example) and build the Supabase adapter
--      to replace src/lib/mockDb.ts (snake_case → camelCase mapping).
-- =====================================================================


-- #####################################################################
-- FILE: db/migrations/002_client_parity.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA migration 002 — client parity for the web app
--
-- Closes the gaps between schema 001 and what the Datevra web client
-- needs to drive directly (until the payments Edge Function exists):
--
--   1. Matches: participants may UPDATE compatibility/factors (the client
--      computes the transparent score) and DELETE their own matches
--      (unmatch; cascades to the conversation + messages).
--   2. Admin interim writes: payments, subscriptions, notifications and
--      activity_logs get admin ALL/INSERT policies. These are replaced by
--      service-role Edge Functions in production (payments especially).
--   3. Server-side notifications mirroring the demo backend:
--      - a like notifies the liked user
--      - a message notifies the other participant + bumps
--        conversations.last_message_at
--      - an application status change notifies the applicant
--      - a booking notifies both participants
--
-- Apply AFTER db/schema.sql in the Supabase SQL editor.
-- Re-runnable: every statement is guarded with IF NOT EXISTS / DROP IF EXISTS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. matches: participant update + delete
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "matches_update_participants" ON public.matches;
CREATE POLICY "matches_update_participants" ON public.matches
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b)
  WITH CHECK (auth.uid() = user_a OR auth.uid() = user_b);

DROP POLICY IF EXISTS "matches_delete_participants" ON public.matches;
CREATE POLICY "matches_delete_participants" ON public.matches
  FOR DELETE TO authenticated
  USING (auth.uid() = user_a OR auth.uid() = user_b OR public.is_admin());

-- ---------------------------------------------------------------------
-- 2. admin interim writes (until the payments Edge Function ships)
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "payments_admin_write" ON public.payments;
CREATE POLICY "payments_admin_write" ON public.payments
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "subscriptions_admin_write" ON public.subscriptions;
CREATE POLICY "subscriptions_admin_write" ON public.subscriptions
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "notifications_admin_write" ON public.notifications;
CREATE POLICY "notifications_admin_write" ON public.notifications
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "logs_admin_insert" ON public.activity_logs;
CREATE POLICY "logs_admin_insert" ON public.activity_logs
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());

-- Members may create their own PENDING payment intents (e.g. starting a
-- Razorpay checkout). Only the server/admin may move them to verified.
-- Amount must be positive (blocks zero/negative-amount intent spam).
DROP POLICY IF EXISTS "payments_insert_own_pending" ON public.payments;
CREATE POLICY "payments_insert_own_pending" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id AND status = 'pending' AND amount > 0);

-- Support email / announcements are safe for members to read.
DROP POLICY IF EXISTS "settings_public_read" ON public.platform_settings;
CREATE POLICY "settings_public_read" ON public.platform_settings
  FOR SELECT TO anon, authenticated USING (true);

-- Members may withdraw their own undecided applications.
DROP POLICY IF EXISTS "applications_cancel_own" ON public.date_applications;
CREATE POLICY "applications_cancel_own" ON public.date_applications
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status IN ('submitted','under_review','eligible'))
  WITH CHECK (auth.uid() = user_id AND status = 'cancelled');

-- ---------------------------------------------------------------------
-- 3a. notify the liked user (mirrors demo backend sendLike)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_like()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  liker_name text;
BEGIN
  SELECT first_name INTO liker_name FROM public.profiles WHERE id = NEW.from_user_id;
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    NEW.to_user_id,
    'like',
    coalesce(liker_name, 'Someone') || ' liked your profile',
    'Take a look — maybe it''s mutual.',
    '/app/likes'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_like ON public.likes;
CREATE TRIGGER trg_notify_on_like
  AFTER INSERT ON public.likes
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_like();

-- ---------------------------------------------------------------------
-- 3b. notify on message + bump conversation timestamp
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_message()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  other_id   uuid;
  sender_name text;
BEGIN
  SELECT p INTO other_id
  FROM unnest(
    (SELECT participant_ids FROM public.conversations WHERE id = NEW.conversation_id)
  ) AS p
  WHERE p <> NEW.sender_id
  LIMIT 1;

  UPDATE public.conversations
  SET last_message_at = NEW.created_at, updated_at = now()
  WHERE id = NEW.conversation_id;

  IF other_id IS NOT NULL THEN
    SELECT first_name INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      other_id,
      'message',
      'New message from ' || coalesce(sender_name, 'your match'),
      left(NEW.text, 80),
      '/app/chat'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_message ON public.messages;
CREATE TRIGGER trg_notify_on_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_message();

-- ---------------------------------------------------------------------
-- 3c. notify applicant when an admin changes application status
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_application_decision()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
DECLARE
  exp_title text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT title INTO exp_title FROM public.experiences WHERE id = NEW.experience_id;
    INSERT INTO public.notifications (user_id, kind, title, body, link)
    VALUES (
      NEW.user_id,
      'experience',
      'Application ' || replace(NEW.status, '_', ' '),
      coalesce(exp_title, 'Curated experience') || ' — ' ||
        coalesce(NEW.slot_date, '') || ' at ' || coalesce(NEW.slot_time, ''),
      '/app/applications'
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_application ON public.date_applications;
CREATE TRIGGER trg_notify_on_application
  AFTER UPDATE OF status ON public.date_applications
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_application_decision();

-- ---------------------------------------------------------------------
-- 3d. notify both participants when a booking is created
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_booking()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  SELECT uid, 'booking', 'Your date is confirmed',
         NEW.venue || ' — ' || NEW.date || ' at ' || NEW.time,
         '/app/bookings'
  FROM unnest(ARRAY[NEW.user_id, NEW.partner_id]) AS uid
  WHERE uid IS NOT NULL;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_on_booking ON public.date_bookings;
CREATE TRIGGER trg_notify_on_booking
  AFTER INSERT ON public.date_bookings
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_booking();


-- #####################################################################
-- FILE: db/migrations/003_discovery_function.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA migration 003 — secure discovery reads
--
-- PROBLEM (found in audit):
--   db/schema.sql created a `profiles_public` view intended to give members
--   a safe, email-free, block-aware view of other profiles. But PostgreSQL
--   views cannot be SECURITY DEFINER: the view runs with the *caller's*
--   privileges, so the underlying `profiles` RLS policy
--   (`profiles_select_own`: auth.uid() = id) still applies. A member
--   querying the view therefore sees ONLY their own row — discovery and
--   profile lookups for other members return nothing.
--
-- FIX (additive — no tables altered, no data deleted, the old view is left
-- in place for compatibility):
--   Two SECURITY DEFINER functions that read `profiles` with elevated
--   table privileges (bypassing the own-row RLS) while still filtering by
--   the *caller's* auth.uid() for block pairs. They return only the safe
--   columns: email and plan_expires_at are never exposed.
--     - discovery_profiles()          → all discoverable profiles
--     - discovery_profile(p_id uuid)  → one discoverable profile or none
--   Execute is granted to `authenticated` only (revoked from PUBLIC/anon).
--
-- Apply AFTER db/schema.sql and db/migrations/002_client_parity.sql.
-- Re-runnable: CREATE OR REPLACE + explicit REVOKE/GRANT.
-- =====================================================================

-- ---------------------------------------------------------------------
-- All discoverable profiles for the caller
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.discovery_profiles()
RETURNS TABLE (
  id                uuid,
  first_name        text,
  age               int,
  gender            text,
  interested_in     text,
  city              text,
  bio               text,
  interests         text[],
  hobbies           text[],
  relationship_intent text,
  lifestyle         text[],
  photos            text[],
  verified          boolean,
  online            boolean,
  last_active       timestamptz,
  profile_complete  int,
  plan_id           text,
  created_at        timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id, p.first_name, p.age, p.gender, p.interested_in,
    p.city, p.bio, p.interests, p.hobbies, p.relationship_intent,
    p.lifestyle, p.photos, p.verified, p.online, p.last_active,
    p.profile_complete, p.plan_id, p.created_at
  FROM public.profiles p
  WHERE auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id)
         OR (b.blocker_id = p.id AND b.blocked_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.discovery_profiles() IS
  'Member-safe discovery set. SECURITY DEFINER bypasses the own-row profiles RLS; block filtering still uses the caller''s auth.uid(). Email and plan_expires_at are never returned.';

REVOKE ALL ON FUNCTION public.discovery_profiles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discovery_profiles() TO authenticated;

-- ---------------------------------------------------------------------
-- Single discoverable profile for the caller (null when blocked/hidden)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.discovery_profile(p_id uuid)
RETURNS TABLE (
  id                uuid,
  first_name        text,
  age               int,
  gender            text,
  interested_in     text,
  city              text,
  bio               text,
  interests         text[],
  hobbies           text[],
  relationship_intent text,
  lifestyle         text[],
  photos            text[],
  verified          boolean,
  online            boolean,
  last_active       timestamptz,
  profile_complete  int,
  plan_id           text,
  created_at        timestamptz
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    p.id, p.first_name, p.age, p.gender, p.interested_in,
    p.city, p.bio, p.interests, p.hobbies, p.relationship_intent,
    p.lifestyle, p.photos, p.verified, p.online, p.last_active,
    p.profile_complete, p.plan_id, p.created_at
  FROM public.profiles p
  WHERE p.id = p_id
    AND auth.uid() IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = p.id)
         OR (b.blocker_id = p.id AND b.blocked_id = auth.uid())
    );
$$;

COMMENT ON FUNCTION public.discovery_profile(uuid) IS
  'Single member-safe profile lookup. Returns zero rows when the profile is blocked in either direction or does not exist.';

REVOKE ALL ON FUNCTION public.discovery_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discovery_profile(uuid) TO authenticated;


-- #####################################################################
-- FILE: db/migrations/004_security_hardening.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA migration 004 — security hardening (audit findings)
--
-- Closes gaps found in the pre-launch audit. All changes are additive or
-- policy-tightening: no tables altered, no data deleted or modified.
--
--   1. blocked_pair(a, b) helper (SECURITY DEFINER): true when a block
--      exists in either direction. RLS hides the "blocked" side's row from
--      the victim, so checks must run elevated.
--   2. likes_insert_own: blocked users can no longer like the blocker.
--   3. messages_insert_participant: blocked users can no longer message
--      the blocker (defense in depth — the app deletes the conversation
--      on block, but the API is now airtight too).
--   4. protect_profile_fields trigger: members cannot self-grant a plan,
--      self-verify, change plan expiry, or change their profile email via
--      direct API calls. Admins (is_admin) are exempt so the verification
--      and membership-activation flows keep working.
--   5. freeze_message_content trigger: message text / sender / conversation
--      are immutable after insert (only read/delivered flags change).
--   6. enforce_application_rules trigger: non-admin application inserts
--      are forced to status 'submitted', and elite-only experiences reject
--      non-elite applicants at the database level (admins exempt — manual
--      selection workflow is the control for edge cases).
--
-- Apply AFTER 001–003. Re-runnable: DROP IF EXISTS / CREATE OR REPLACE.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. blocked_pair helper
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.blocked_pair(a uuid, b uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.blocks
    WHERE (blocker_id = a AND blocked_id = b)
       OR (blocker_id = b AND blocked_id = a)
  );
$$;

COMMENT ON FUNCTION public.blocked_pair(uuid, uuid) IS
  'True when a block exists in either direction. SECURITY DEFINER because RLS hides the victim''s side of the row.';

REVOKE ALL ON FUNCTION public.blocked_pair(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.blocked_pair(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------
-- 2. likes: no likes across a block
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "likes_insert_own" ON public.likes;
CREATE POLICY "likes_insert_own" ON public.likes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = from_user_id
    AND NOT public.blocked_pair(auth.uid(), to_user_id)
  );

-- ---------------------------------------------------------------------
-- 3. messages: no messages across a block
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "messages_insert_participant" ON public.messages;
CREATE POLICY "messages_insert_participant" ON public.messages
  FOR INSERT TO authenticated WITH CHECK (
    auth.uid() = sender_id AND
    EXISTS (SELECT 1 FROM public.conversations c
            WHERE c.id = messages.conversation_id
              AND c.participant_ids @> ARRAY[auth.uid()]::uuid[]) AND
    NOT EXISTS (
      SELECT 1 FROM public.conversations c
      CROSS JOIN unnest(c.participant_ids) AS other_id
      WHERE c.id = messages.conversation_id
        AND other_id <> auth.uid()
        AND public.blocked_pair(auth.uid(), other_id)
    )
  );

-- ---------------------------------------------------------------------
-- 4. profiles: members cannot touch plan / verification / email fields
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Bulletproof privilege guard: OLD/NEW row comparison has no RLS
  -- snapshot subtlety (unlike a WITH CHECK subquery). Members can never
  -- change these; admins and the service role (Edge Functions) can.
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.plan_id IS DISTINCT FROM NEW.plan_id
     OR OLD.plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
     OR OLD.verified IS DISTINCT FROM NEW.verified
     OR OLD.email IS DISTINCT FROM NEW.email THEN
    -- Admins may change these fields; so may the service role (Edge
    -- Functions), which presents no JWT and therefore no auth.uid().
    -- Regular members calling the API directly are rejected.
    IF NOT public.is_admin() AND auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'Only Datevra admins may change admin, plan, verification, or email fields';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields
  BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

COMMENT ON FUNCTION public.protect_profile_fields() IS
  'Prevents privilege escalation via direct API calls (self-granted admin/Elite, self-verification). Admin flows (membership activation, verification queue) are exempt via is_admin().';

-- ---------------------------------------------------------------------
-- 5. messages: content immutable after insert
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.freeze_message_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.text IS DISTINCT FROM NEW.text
     OR OLD.sender_id IS DISTINCT FROM NEW.sender_id
     OR OLD.conversation_id IS DISTINCT FROM NEW.conversation_id THEN
    RAISE EXCEPTION 'Message content is immutable; only read/delivered flags may change';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_message_content ON public.messages;
CREATE TRIGGER trg_freeze_message_content
  BEFORE UPDATE OF text, sender_id, conversation_id ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.freeze_message_content();

-- ---------------------------------------------------------------------
-- 6. applications: force submitted + enforce elite eligibility
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.enforce_application_rules()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_elite_only boolean;
  v_has_elite  boolean;
BEGIN
  IF TG_OP = 'INSERT' AND NOT public.is_admin() THEN
    -- Members can only ever create fresh applications.
    NEW.status := 'submitted';

    SELECT elite_only INTO v_elite_only
    FROM public.experiences WHERE id = NEW.experience_id;

    IF coalesce(v_elite_only, false) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = NEW.user_id
          AND plan_id = 'elite'
          AND (plan_expires_at IS NULL OR plan_expires_at > now())
      ) INTO v_has_elite;
      IF NOT v_has_elite THEN
        RAISE EXCEPTION 'This experience requires an active Elite membership';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_application_rules ON public.date_applications;
CREATE TRIGGER trg_enforce_application_rules
  BEFORE INSERT ON public.date_applications
  FOR EACH ROW EXECUTE FUNCTION public.enforce_application_rules();

COMMENT ON FUNCTION public.enforce_application_rules() IS
  'Database-level guard for the curated-experience workflow: members cannot forge statuses or bypass Elite eligibility. Admins are exempt; manual review remains the control for edge cases.';


-- #####################################################################
-- FILE: db/migrations/005_account_deletion.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA migration 005 — account deletion + payment hardening
--
-- 1. delete_own_account(): lets a signed-in member permanently delete
--    their own account in a single transaction. The function:
--      - requires auth.uid() (anonymous callers are rejected),
--      - deletes the member's profile-photos Storage objects,
--      - deletes their auth.users row.
--    Deleting auth.users cascades through profiles to likes, passes,
--    matches (→ conversations → messages), notifications, applications,
--    bookings, saved items, blocks, reports, and match_preferences
--    (all ON DELETE CASCADE in db/schema.sql).
--    Financial records are NOT deleted: migration 008 changes the
--    payments/subscriptions FKs to ON DELETE SET NULL, so those rows are
--    retained with user_id anonymized to NULL for accounting/audit.
--    Activity-log rows keep a pseudonymous actor_id (text, no FK) for
--    platform audit; they contain no profile data.
--
-- 2. payments_one_pending_per_user_plan: partial unique index so a
--    member can never hold two pending payments for the same plan —
--    database-level duplicate-transaction prevention backing the
--    create-order Edge Function's idempotency.
--
-- Apply AFTER 001–004. Re-runnable.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. delete_own_account()
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_own_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.';
  END IF;

  -- Profile photos in Storage (no FK — must be explicit).
  DELETE FROM storage.objects
  WHERE bucket_id = 'profile-photos'
    AND (storage.foldername(name))[1] = v_uid::text;

  -- Cascades: profiles → likes, passes, matches → conversations →
  -- messages, notifications, applications, bookings, saved items,
  -- blocks, reports, match_preferences.
  -- payments/subscriptions are RETAINED (migration 008: ON DELETE SET NULL).
  DELETE FROM auth.users WHERE id = v_uid;
END;
$$;

COMMENT ON FUNCTION public.delete_own_account() IS
  'GDPR-style erasure: the caller''s auth.users row is deleted, cascading to all personal data. Payment and subscription rows are RETAINED with user_id anonymized to NULL for accounting/audit (see migration 008). Only the caller''s own account can be deleted.';

REVOKE ALL ON FUNCTION public.delete_own_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.delete_own_account() TO authenticated;

-- ---------------------------------------------------------------------
-- 2. One pending payment per member per plan (duplicate prevention)
-- ---------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_pending_per_user_plan
  ON public.payments (user_id, plan_id)
  WHERE status = 'pending';


-- #####################################################################
-- FILE: db/migrations/006_match_integrity.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA migration 006 — match integrity hardening (audit fix)
--
-- PROBLEM:
--   The matches_update_participants policy (002) lets either participant
--   UPDATE a match row, but only checks that the caller is still *a*
--   participant in the new row. A malicious client could therefore:
--     - swap the OTHER participant (user_a/user_b) to a different user,
--       hijacking the match and its conversation, or
--     - rewrite the compatibility score / factors shown in the UI.
--
-- FIX (additive — no data changes):
--   freeze_match_participants trigger: user_a and user_b become immutable
--   after insert. The legitimate compatibility write-back (002) only ever
--   touches compatibility/factors, so no working feature is affected.
--   Unmatch still works via matches_delete_participants (DELETE policy).
--
-- Apply AFTER 001–005. Re-runnable.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.freeze_match_participants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.user_a IS DISTINCT FROM NEW.user_a
     OR OLD.user_b IS DISTINCT FROM NEW.user_b THEN
    RAISE EXCEPTION 'Match participants cannot be changed after creation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_freeze_match_participants ON public.matches;
CREATE TRIGGER trg_freeze_match_participants
  BEFORE UPDATE OF user_a, user_b ON public.matches
  FOR EACH ROW EXECUTE FUNCTION public.freeze_match_participants();

COMMENT ON FUNCTION public.freeze_match_participants() IS
  'Match participant swap / hijack prevention. Compatibility and factor write-backs are unaffected; unmatch uses the DELETE policy.';


-- #####################################################################
-- FILE: db/migrations/007_admin_bootstrap.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA migration 007 — first-admin bootstrap, SQL-Editor-only
--
-- SECURITY MODEL — there is intentionally NO client-callable path:
--   * bootstrap_first_admin() can only run as a database role with direct
--     SQL access: the Supabase project owner via the SQL Editor (the
--     postgres role), or the service_role. EXECUTE is revoked from
--     PUBLIC, anon, and authenticated, and NO grant is ever issued.
--   * Defense in depth: the function refuses any call that carries a JWT
--     (auth.uid() IS NOT NULL), so even an accidental future grant cannot
--     turn it into a self-promotion API.
--   * One-time: serialized by an advisory lock and permanently disabled
--     once any admin exists.
--   * The strict protect_profile_fields() trigger from migration 004 is
--     left untouched — it already blocks every non-admin is_admin change,
--     and SQL-Editor/service_role updates (auth.uid() IS NULL) bypass it
--     by design, which is exactly what the bootstrap uses.
--
-- OWNER PROCEDURE (Supabase dashboard → SQL Editor, as project owner):
--   1. Sign up in the Datevra app with the owner account (this creates
--      the auth.users row and the matching public.profiles row).
--   2. Immediately run:
--        SELECT public.bootstrap_first_admin('owner@example.com');
--   3. Verify:
--        SELECT email, is_admin FROM public.profiles WHERE is_admin;
--   Run step 2 promptly after the base setup: until the first admin
--   exists, the slot is open — whoever the owner bootstraps first wins,
--   and only the owner can reach the SQL Editor.
--
-- Apply AFTER 001–006. Re-runnable (re-running after bootstrap raises,
-- which is the intended closed state).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: does any admin exist? (SECURITY DEFINER so the guard cannot be
-- fooled by RLS. No client grants — owner/service tooling only.)
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_exists()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE is_admin);
$$;

COMMENT ON FUNCTION public.admin_exists() IS
  'True when any profile has is_admin. SECURITY DEFINER so the bootstrap guard cannot be fooled by RLS. No client grants.';

REVOKE ALL ON FUNCTION public.admin_exists() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- bootstrap_first_admin(target_email) — SQL-Editor-only, one-time
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bootstrap_first_admin(target_email text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
BEGIN
  -- Hard block on API use: SQL Editor calls carry no JWT. If this ever
  -- fires, someone is calling through PostgREST — refuse unconditionally.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'bootstrap_first_admin() must be run from the Supabase SQL Editor by the project owner, never through the API.';
  END IF;

  -- Serialize concurrent bootstrap attempts.
  PERFORM pg_advisory_xact_lock(hashtext('datevra_first_admin'));

  IF public.admin_exists() THEN
    RAISE EXCEPTION 'An admin already exists — bootstrap is permanently disabled.';
  END IF;

  IF target_email IS NULL OR target_email = '' THEN
    RAISE EXCEPTION 'Provide the owner account email, e.g. SELECT public.bootstrap_first_admin(''you@example.com'');';
  END IF;

  SELECT au.id INTO v_uid FROM auth.users au WHERE au.email = target_email;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No account found with that email. The owner must sign up in the app first.';
  END IF;

  UPDATE public.profiles SET is_admin = true WHERE id = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No profile row found for that account.';
  END IF;
END;
$$;

COMMENT ON FUNCTION public.bootstrap_first_admin(text) IS
  'One-time first-admin bootstrap for the project owner via the Supabase SQL Editor: SELECT public.bootstrap_first_admin(''owner@example.com''); No client grants; refuses JWT callers; permanently disabled once any admin exists.';

-- No EXECUTE grant is issued to any client role, ever. Only the postgres
-- owner role (SQL Editor) and service_role can run this function.
REVOKE ALL ON FUNCTION public.bootstrap_first_admin(text) FROM PUBLIC, anon, authenticated;


-- #####################################################################
-- FILE: db/migrations/008_payment_retention.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA migration 008 — retain anonymized financial records (audit fix)
--
-- DECISION (accounting):
--   On account deletion, payment and subscription rows are RETAINED but
--   ANONYMIZED (user_id → NULL) instead of deleted. Rationale:
--     - Tax / accounting audit requirements need the financial trail
--       (amounts, dates, plan, Razorpay references) to survive.
--     - GDPR-style erasure is satisfied: no row can be linked back to the
--       deleted person (profile, email, and all personal data are gone).
--     - Razorpay retains its own compliant transaction records as well.
--   Revenue reports and the admin payments ledger keep working; deleted
--   members simply show as "—" (the UI already falls back gracefully).
--
-- CHANGES (additive, re-runnable):
--   - payments.user_id / subscriptions.user_id become nullable.
--   - FKs change from ON DELETE CASCADE to ON DELETE SET NULL.
--   - delete_own_account() is unchanged — the FK behavior now preserves
--     the rows automatically.
--
-- Apply AFTER 001–007. Re-runnable.
-- =====================================================================

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
ALTER TABLE public.payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.subscriptions
  ADD CONSTRAINT subscriptions_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

COMMENT ON FUNCTION public.delete_own_account() IS
  'GDPR-style erasure: the caller''s auth.users row is deleted, cascading to all personal data. Payment and subscription rows are RETAINED with user_id anonymized to NULL for accounting/audit (see migration 008). Only the caller''s own account can be deleted.';


-- #####################################################################
-- FILE: db/realtime_setup.sql
-- #####################################################################

-- =====================================================================
-- DATEVRA — Supabase Realtime publication setup
--
-- Enables postgres_changes replication for the tables the web client
-- subscribes to:
--   messages        → live chat delivery
--   notifications   → notification bell / centre updates
--   matches, likes  → discovery + likes + matches screens
--   conversations   → conversation list ordering / unread badges
--   date_applications, date_bookings → member + admin workflow screens
--   profiles        → presence / profile updates
--
-- Typing indicators use Realtime *broadcast* (no table needed).
--
-- Re-runnable: each table is added only if not already a member.
-- Run once in the Supabase SQL editor as the postgres role (or a role
-- that owns the tables). All tables have primary keys, so the default
-- replica identity is sufficient for INSERT/UPDATE/DELETE payloads.
-- =====================================================================

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messages',
    'notifications',
    'matches',
    'likes',
    'conversations',
    'date_applications',
    'date_bookings',
    'profiles'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Added public.% to supabase_realtime', t;
    ELSE
      RAISE NOTICE 'public.% already in supabase_realtime, skipping', t;
    END IF;
  END LOOP;
END
$$;


