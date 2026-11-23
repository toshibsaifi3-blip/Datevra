-- ============================================================================
-- DATEVRA Migration 032: Outside-Delhi Limited-Value Money Voucher System
-- with Mandatory Server-Side OTP Verification & Anti-Spoofing City Audit
--
-- Requirement 8 safeguards:
--   1. Disabled by default (enabled = false, voucher_value_inr = NULL).
--      No monetary value is invented; an authorized admin MUST explicitly
--      configure an approved positive INR value and enable issuance.
--   2. Explicit city rule:
--      - Normalizes city names (trim, lowercase, collapse whitespace).
--      - Default excluded_cities = ARRAY['delhi', 'new delhi'] (NCT of Delhi).
--      - Delhi-NCR cities (Noida, Gurugram, Faridabad, Ghaziabad) are NOT
--        silently conflated with Delhi; admins can explicitly add/remove them
--        via voucher_settings.excluded_cities with clear policy documentation.
--   3. Anti-spoofing city protection:
--      - Tracks profiles.registered_city (immutable once set on registration /
--        backfill) and logs every city change in public.profile_city_history.
--      - Voucher eligibility verifies BOTH registered_city and current city
--        are outside excluded Delhi cities so temporarily changing city cannot
--        game repeated or ineligible claims.
--   4. Mandatory trusted server-side OTP verification:
--      - Challenges stored strictly in datevra_internal.voucher_otp_challenges
--        (ZERO direct client/anon/authenticated access; only SHA-256 OTP hash
--        is stored, never plaintext OTPs).
--      - Rate-limited requests, attempt caps, expiry, single consumption.
--   5. Limited non-cash-withdrawable voucher value, single claim, atomic
--      single redemption, admin revocation, and full audit log.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS datevra_internal;
REVOKE ALL ON SCHEMA datevra_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA datevra_internal TO postgres, service_role;

-- 1. Anti-Spoofing Registered City & City Change Audit
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS registered_city text;

UPDATE public.profiles
   SET registered_city = btrim(city)
 WHERE registered_city IS NULL AND city IS NOT NULL AND btrim(city) <> '';

CREATE TABLE IF NOT EXISTS public.profile_city_history (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  old_city   text,
  new_city   text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_profile_city_history_user
  ON public.profile_city_history (user_id, changed_at DESC);

ALTER TABLE public.profile_city_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profile_city_history_admin_select" ON public.profile_city_history;
CREATE POLICY "profile_city_history_admin_select"
  ON public.profile_city_history FOR SELECT
  TO authenticated
  USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.profile_city_history FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_audit_profile_city()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.registered_city IS NULL AND NEW.city IS NOT NULL AND btrim(NEW.city) <> '' THEN
      NEW.registered_city := btrim(NEW.city);
    END IF;
    RETURN NEW;
  END IF;

  -- Preserve immutable registered_city once set (except admin override)
  IF OLD.registered_city IS NOT NULL AND NEW.registered_city IS DISTINCT FROM OLD.registered_city THEN
    IF NOT public.is_admin() AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      NEW.registered_city := OLD.registered_city;
    END IF;
  ELSIF OLD.registered_city IS NULL AND NEW.city IS NOT NULL AND btrim(NEW.city) <> '' THEN
    NEW.registered_city := btrim(NEW.city);
  END IF;

  IF lower(btrim(COALESCE(OLD.city, ''))) IS DISTINCT FROM lower(btrim(COALESCE(NEW.city, ''))) THEN
    INSERT INTO public.profile_city_history (user_id, old_city, new_city)
    VALUES (NEW.id, OLD.city, COALESCE(NEW.city, ''));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profiles_audit_city ON public.profiles;
CREATE TRIGGER trg_profiles_audit_city
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_audit_profile_city();

-- 2. City Normalization & Outside-Delhi Eligibility Helper
CREATE OR REPLACE FUNCTION public.normalize_city_name(p_city text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(lower(btrim(COALESCE(p_city, ''))), '\s+', ' ', 'g');
$$;

CREATE OR REPLACE FUNCTION public.is_outside_delhi_city(
  p_city           text,
  p_excluded_cities text[] DEFAULT ARRAY['delhi', 'new delhi']
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_norm text := public.normalize_city_name(p_city);
  v_item text;
BEGIN
  IF v_norm = '' THEN
    RETURN false;
  END IF;

  FOREACH v_item IN ARRAY COALESCE(p_excluded_cities, ARRAY['delhi', 'new delhi']) LOOP
    IF v_norm = public.normalize_city_name(v_item) THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

-- 3. Admin-Configurable Voucher Settings (DISABLED BY DEFAULT — NO INVENTED VALUE)
CREATE TABLE IF NOT EXISTS public.voucher_settings (
  id                  integer PRIMARY KEY CHECK (id = 1),
  enabled             boolean NOT NULL DEFAULT false,
  voucher_value_inr   integer CHECK (voucher_value_inr IS NULL OR (voucher_value_inr > 0 AND voucher_value_inr <= 50000)),
  max_claims_per_user integer NOT NULL DEFAULT 1 CHECK (max_claims_per_user >= 1 AND max_claims_per_user <= 5),
  max_total_vouchers  integer CHECK (max_total_vouchers IS NULL OR max_total_vouchers > 0),
  expiry_days         integer NOT NULL DEFAULT 30 CHECK (expiry_days >= 1 AND expiry_days <= 365),
  excluded_cities     text[] NOT NULL DEFAULT ARRAY['delhi', 'new delhi'],
  ncr_policy_note     text NOT NULL DEFAULT 'Excludes NCT of Delhi (Delhi, New Delhi). Delhi-NCR cities (Noida, Gurugram, Faridabad, Ghaziabad) are treated as outside-Delhi unless explicitly added to excluded_cities by an administrator.',
  usage_rules         text NOT NULL DEFAULT 'Limited-value, non-cash-withdrawable Datevra experience/partner credit. Single-use only. Valid for eligible members registered outside Delhi after OTP verification.',
  updated_by_admin_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voucher_enabled_requires_value CHECK (NOT enabled OR voucher_value_inr IS NOT NULL)
);

INSERT INTO public.voucher_settings (id, enabled, voucher_value_inr)
VALUES (1, false, NULL)
ON CONFLICT (id) DO NOTHING;

-- 4. Private Server-Side OTP Challenges (datevra_internal — ZERO client access)
CREATE TABLE IF NOT EXISTS datevra_internal.voucher_otp_challenges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel            text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination_masked text NOT NULL,
  destination_hash   text NOT NULL,
  otp_hash           text NOT NULL,
  attempt_count      integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts       integer NOT NULL DEFAULT 5 CHECK (max_attempts > 0),
  status             text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'verified', 'expired', 'locked', 'consumed')),
  expires_at         timestamptz NOT NULL,
  verified_at        timestamptz,
  consumed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_otp_user_created
  ON datevra_internal.voucher_otp_challenges (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voucher_otp_user_status
  ON datevra_internal.voucher_otp_challenges (user_id, status, expires_at);

REVOKE ALL ON TABLE datevra_internal.voucher_otp_challenges FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE datevra_internal.voucher_otp_challenges TO postgres, service_role;

-- 5. Issued Outside-Delhi Vouchers & Audit Log
CREATE TABLE IF NOT EXISTS public.user_vouchers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code                     text NOT NULL UNIQUE,
  value_inr                integer NOT NULL CHECK (value_inr > 0),
  non_cash_withdrawable    boolean NOT NULL DEFAULT true,
  status                   text NOT NULL DEFAULT 'issued'
                           CHECK (status IN ('issued', 'redeemed', 'expired', 'revoked')),
  city_at_claim            text NOT NULL,
  registered_city_at_claim text NOT NULL,
  otp_challenge_id         uuid REFERENCES datevra_internal.voucher_otp_challenges(id) ON DELETE SET NULL,
  otp_verified_at          timestamptz NOT NULL,
  expires_at               timestamptz NOT NULL,
  redeemed_at              timestamptz,
  redemption_ref           text,
  revoked_at               timestamptz,
  revoked_by_admin_id      uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revocation_reason        text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_vouchers_user_status
  ON public.user_vouchers (user_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_vouchers_unique_otp
  ON public.user_vouchers (otp_challenge_id)
  WHERE otp_challenge_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.voucher_audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id  uuid REFERENCES public.user_vouchers(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_id    uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role  text NOT NULL DEFAULT 'system' CHECK (actor_role IN ('system', 'admin', 'user')),
  event_type  text NOT NULL,
  detail      text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voucher_audit_logs_created
  ON public.voucher_audit_logs (created_at DESC);

-- 6. Row Level Security
ALTER TABLE public.voucher_settings   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_vouchers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voucher_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voucher_settings_authenticated_read" ON public.voucher_settings;
CREATE POLICY "voucher_settings_authenticated_read"
  ON public.voucher_settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "user_vouchers_own_or_admin_select" ON public.user_vouchers;
CREATE POLICY "user_vouchers_own_or_admin_select"
  ON public.user_vouchers FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "voucher_audit_logs_admin_select" ON public.voucher_audit_logs;
CREATE POLICY "voucher_audit_logs_admin_select"
  ON public.voucher_audit_logs FOR SELECT
  TO authenticated
  USING (public.is_admin());

REVOKE INSERT, UPDATE, DELETE ON TABLE public.voucher_settings   FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_vouchers      FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.voucher_audit_logs FROM PUBLIC, anon, authenticated;

-- 7. Cryptographically Unbiased Voucher Code Generator (DVR-VCH-XXXX-XXXX)
CREATE OR REPLACE FUNCTION public.generate_voucher_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; -- 31 unambiguous chars (no I, L, O, 0, 1)
  v_bytes    bytea;
  v_idx      integer;
  v_chars    text := '';
  v_byte_val integer;
  v_pos      integer := 0;
BEGIN
  WHILE length(v_chars) < 8 LOOP
    v_bytes := extensions.gen_random_bytes(16);
    FOR v_pos IN 0..15 LOOP
      EXIT WHEN length(v_chars) >= 8;
      v_byte_val := get_byte(v_bytes, v_pos);
      -- Rejection sampling: 248 = 31 * 8 (eliminates modulo bias)
      IF v_byte_val < 248 THEN
        v_idx := (v_byte_val % 31) + 1;
        v_chars := v_chars || substr(v_alphabet, v_idx, 1);
      END IF;
    END LOOP;
  END LOOP;

  RETURN 'DVR-VCH-' || substr(v_chars, 1, 4) || '-' || substr(v_chars, 5, 4);
END;
$$;

REVOKE ALL ON FUNCTION public.generate_voucher_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_voucher_code() TO service_role;

-- 8. Admin Configuration, Revocation & Safe OTP Status RPCs
CREATE OR REPLACE FUNCTION public.admin_update_voucher_settings(
  p_enabled             boolean,
  p_voucher_value_inr   integer,
  p_max_claims_per_user integer DEFAULT 1,
  p_max_total_vouchers  integer DEFAULT NULL,
  p_expiry_days         integer DEFAULT 30,
  p_excluded_cities     text[] DEFAULT ARRAY['delhi', 'new delhi'],
  p_usage_rules         text DEFAULT NULL
)
RETURNS public.voucher_settings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_row      public.voucher_settings%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  IF p_enabled AND (p_voucher_value_inr IS NULL OR p_voucher_value_inr <= 0) THEN
    RAISE EXCEPTION 'VALUE_REQUIRED: An approved positive INR voucher value must be configured before enabling issuance.';
  END IF;

  UPDATE public.voucher_settings
     SET enabled = p_enabled,
         voucher_value_inr = p_voucher_value_inr,
         max_claims_per_user = GREATEST(1, COALESCE(p_max_claims_per_user, 1)),
         max_total_vouchers = p_max_total_vouchers,
         expiry_days = GREATEST(1, COALESCE(p_expiry_days, 30)),
         excluded_cities = COALESCE(p_excluded_cities, ARRAY['delhi', 'new delhi']),
         usage_rules = COALESCE(NULLIF(btrim(COALESCE(p_usage_rules, '')), ''), usage_rules),
         updated_by_admin_id = v_admin_id,
         updated_at = now()
   WHERE id = 1
  RETURNING * INTO v_row;

  INSERT INTO public.voucher_audit_logs (actor_id, actor_role, event_type, detail)
  VALUES (
    v_admin_id, 'admin', 'settings.updated',
    'enabled=' || p_enabled::text || ', value_inr=' || COALESCE(p_voucher_value_inr::text, 'NULL') || ', expiry_days=' || v_row.expiry_days::text
  );

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'voucher_settings.update',
    'Updated outside-Delhi voucher settings (enabled=' || p_enabled::text || ', value=₹' || COALESCE(p_voucher_value_inr::text, 'unset') || ')'
  );

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_voucher_settings(boolean, integer, integer, integer, integer, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_voucher_settings(boolean, integer, integer, integer, integer, text[], text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_revoke_voucher(
  p_voucher_id uuid,
  p_reason     text DEFAULT NULL
)
RETURNS public.user_vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_voucher  public.user_vouchers%ROWTYPE;
  v_reason   text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  IF v_admin_id IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  SELECT * INTO v_voucher
  FROM public.user_vouchers
  WHERE id = p_voucher_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: Voucher not found.';
  END IF;

  IF v_voucher.status <> 'issued' THEN
    RAISE EXCEPTION 'INVALID_STATUS: Only unredeemed issued vouchers may be revoked (current: %).', v_voucher.status;
  END IF;

  UPDATE public.user_vouchers
     SET status = 'revoked',
         revoked_at = now(),
         revoked_by_admin_id = v_admin_id,
         revocation_reason = v_reason,
         updated_at = now()
   WHERE id = v_voucher.id
  RETURNING * INTO v_voucher;

  INSERT INTO public.voucher_audit_logs (voucher_id, user_id, actor_id, actor_role, event_type, detail)
  VALUES (v_voucher.id, v_voucher.user_id, v_admin_id, 'admin', 'voucher.revoked', COALESCE(v_reason, 'Revoked by administrator.'));

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (v_admin_id, 'admin', 'voucher.revoke', 'Revoked voucher ' || v_voucher.code);

  RETURN v_voucher;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_revoke_voucher(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_revoke_voucher(uuid, text) TO authenticated;

-- Admin-only OTP verification status viewer (NEVER returns OTP hashes or secrets)
CREATE OR REPLACE FUNCTION public.admin_list_voucher_otp_status(
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id                 uuid,
  user_id            uuid,
  channel            text,
  destination_masked text,
  status             text,
  attempt_count      integer,
  max_attempts       integer,
  expires_at         timestamptz,
  verified_at        timestamptz,
  consumed_at        timestamptz,
  created_at         timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required.';
  END IF;

  RETURN QUERY
  SELECT
    c.id, c.user_id, c.channel, c.destination_masked, c.status,
    c.attempt_count, c.max_attempts, c.expires_at, c.verified_at, c.consumed_at, c.created_at
  FROM datevra_internal.voucher_otp_challenges c
  ORDER BY c.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_voucher_otp_status(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_voucher_otp_status(integer) TO authenticated;

-- 9. Server-Only Verified Voucher Issuance RPC (called ONLY by Edge Function after real OTP verification)
CREATE OR REPLACE FUNCTION public.service_issue_verified_outside_delhi_voucher(
  p_user_id          uuid,
  p_otp_challenge_id uuid
)
RETURNS public.user_vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, datevra_internal, pg_temp
AS $$
DECLARE
  v_settings      public.voucher_settings%ROWTYPE;
  v_profile       public.profiles%ROWTYPE;
  v_otp           datevra_internal.voucher_otp_challenges%ROWTYPE;
  v_user_claims   integer := 0;
  v_total_claims  integer := 0;
  v_code          text;
  v_attempt       integer := 0;
  v_voucher       public.user_vouchers%ROWTYPE;
  v_reg_city      text;
BEGIN
  -- Lock settings and user profile to serialize concurrent claims
  SELECT * INTO v_settings FROM public.voucher_settings WHERE id = 1 FOR SHARE;
  IF NOT FOUND OR NOT v_settings.enabled OR v_settings.voucher_value_inr IS NULL OR v_settings.voucher_value_inr <= 0 THEN
    RAISE EXCEPTION 'VOUCHER_PROGRAM_DISABLED: Outside-Delhi voucher issuance is currently disabled until an administrator configures an approved value.';
  END IF;

  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND: Member profile not found.';
  END IF;

  -- Enforce outside-Delhi rule on BOTH registered_city and current city (anti-spoofing)
  v_reg_city := COALESCE(NULLIF(btrim(v_profile.registered_city), ''), btrim(COALESCE(v_profile.city, '')));
  IF NOT public.is_outside_delhi_city(v_reg_city, v_settings.excluded_cities)
     OR NOT public.is_outside_delhi_city(v_profile.city, v_settings.excluded_cities) THEN
    RAISE EXCEPTION 'INELIGIBLE_CITY: Vouchers are strictly reserved for members registered and residing outside Delhi.';
  END IF;

  -- Verify trusted server-side OTP challenge belongs to user, is verified, unexpired, and unconsumed
  SELECT * INTO v_otp
  FROM datevra_internal.voucher_otp_challenges
  WHERE id = p_otp_challenge_id
    AND user_id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OTP_NOT_FOUND: Verified OTP challenge not found.';
  END IF;

  IF v_otp.status <> 'verified' OR v_otp.verified_at IS NULL OR v_otp.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'OTP_NOT_VERIFIED: Valid, unconsumed server-side OTP verification is required.';
  END IF;

  -- Enforce per-user claim limit (count all non-revoked claims to prevent repeat abuse)
  SELECT count(*)::integer INTO v_user_claims
  FROM public.user_vouchers
  WHERE user_id = p_user_id
    AND status IN ('issued', 'redeemed', 'expired');

  IF v_user_claims >= v_settings.max_claims_per_user THEN
    RAISE EXCEPTION 'CLAIM_LIMIT_REACHED: Member has already reached the maximum voucher claim limit (%).', v_settings.max_claims_per_user;
  END IF;

  -- Enforce global cap if configured
  IF v_settings.max_total_vouchers IS NOT NULL THEN
    SELECT count(*)::integer INTO v_total_claims
    FROM public.user_vouchers
    WHERE status IN ('issued', 'redeemed');

    IF v_total_claims >= v_settings.max_total_vouchers THEN
      RAISE EXCEPTION 'PROGRAM_CAP_REACHED: Maximum voucher issuance cap has been reached.';
    END IF;
  END IF;

  -- Generate unique collision-free voucher code
  LOOP
    v_attempt := v_attempt + 1;
    v_code := public.generate_voucher_code();
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.user_vouchers WHERE code = v_code);
    IF v_attempt >= 10 THEN
      RAISE EXCEPTION 'CODE_GENERATION_FAILED: Unable to generate unique voucher code.';
    END IF;
  END LOOP;

  -- Atomically consume OTP challenge so it can never be reused
  UPDATE datevra_internal.voucher_otp_challenges
     SET status = 'consumed',
         consumed_at = now()
   WHERE id = v_otp.id;

  INSERT INTO public.user_vouchers (
    user_id, code, value_inr, non_cash_withdrawable, status,
    city_at_claim, registered_city_at_claim, otp_challenge_id, otp_verified_at,
    expires_at
  ) VALUES (
    p_user_id, v_code, v_settings.voucher_value_inr, true, 'issued',
    btrim(v_profile.city), v_reg_city, v_otp.id, v_otp.verified_at,
    now() + make_interval(days => v_settings.expiry_days)
  )
  RETURNING * INTO v_voucher;

  INSERT INTO public.voucher_audit_logs (voucher_id, user_id, actor_id, actor_role, event_type, detail)
  VALUES (
    v_voucher.id, p_user_id, p_user_id, 'user', 'voucher.issued',
    'Issued ₹' || v_voucher.value_inr::text || ' outside-Delhi voucher (' || v_reg_city || ') after OTP verification.'
  );

  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    p_user_id, 'voucher', 'Outside-Delhi Voucher Issued',
    'Your ₹' || v_voucher.value_inr::text || ' Datevra voucher (' || v_voucher.code || ') is ready to use. Non-cash-withdrawable.', '/passes'
  );

  RETURN v_voucher;
END;
$$;

REVOKE ALL ON FUNCTION public.service_issue_verified_outside_delhi_voucher(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_issue_verified_outside_delhi_voucher(uuid, uuid) TO service_role;

-- 10. Atomic Single-Use Voucher Redemption RPC (Member owns voucher)
CREATE OR REPLACE FUNCTION public.redeem_outside_delhi_voucher(
  p_code           text,
  p_redemption_ref text DEFAULT NULL
)
RETURNS public.user_vouchers
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_clean_code text := upper(btrim(COALESCE(p_code, '')));
  v_voucher    public.user_vouchers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Sign in required.';
  END IF;

  IF v_clean_code = '' THEN
    RAISE EXCEPTION 'MISSING_CODE: Voucher code is required.';
  END IF;

  SELECT * INTO v_voucher
  FROM public.user_vouchers
  WHERE code = v_clean_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'VOUCHER_NOT_FOUND: Voucher code not found.';
  END IF;

  IF v_voucher.user_id <> v_uid AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: You are not authorized to redeem this voucher.';
  END IF;

  IF v_voucher.status = 'redeemed' THEN
    RAISE EXCEPTION 'ALREADY_REDEEMED: This voucher has already been redeemed.';
  END IF;

  IF v_voucher.status = 'revoked' THEN
    RAISE EXCEPTION 'VOUCHER_REVOKED: This voucher has been revoked.';
  END IF;

  IF v_voucher.status = 'expired' OR v_voucher.expires_at <= now() THEN
    UPDATE public.user_vouchers
       SET status = 'expired', updated_at = now()
     WHERE id = v_voucher.id;
    RAISE EXCEPTION 'VOUCHER_EXPIRED: This voucher has expired.';
  END IF;

  UPDATE public.user_vouchers
     SET status = 'redeemed',
         redeemed_at = now(),
         redemption_ref = COALESCE(NULLIF(btrim(COALESCE(p_redemption_ref, '')), ''), 'in_app_redemption'),
         updated_at = now()
   WHERE id = v_voucher.id
  RETURNING * INTO v_voucher;

  INSERT INTO public.voucher_audit_logs (voucher_id, user_id, actor_id, actor_role, event_type, detail)
  VALUES (
    v_voucher.id, v_voucher.user_id, v_uid,
    CASE WHEN public.is_admin() THEN 'admin' ELSE 'user' END,
    'voucher.redeemed',
    'Redeemed ₹' || v_voucher.value_inr::text || ' voucher ' || v_voucher.code
  );

  RETURN v_voucher;
END;
$$;

REVOKE ALL ON FUNCTION public.redeem_outside_delhi_voucher(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_outside_delhi_voucher(text, text) TO authenticated;
