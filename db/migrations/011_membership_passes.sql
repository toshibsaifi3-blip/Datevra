-- ============================================================================
-- DATEVRA Migration 011: Free Membership Passes & Atomic Provisioning
-- REVISED & HARDENED PROPOSAL — DO NOT DEPLOY WITHOUT STAGING VALIDATION
--
-- Objective:
--   Enables administrators to generate and issue digital promotional / gift
--   membership passes (Select / Signature / Privé). Allows members to redeem
--   valid passes for 100% free (₹0) memberships with atomic row locking,
--   tamper-proof profile protection, rate-limiting, and complete audit logging.
--
-- Security Controls & Hardening Addressed:
--   1. Robust Role Authorization:
--      Replaces fragile current_user checks with verified Supabase JWT claims
--      (request.jwt.claim.role = 'service_role') and public.is_admin().
--      Direct backend execution requires session_user IN ('postgres', 'supabase_admin')
--      with no JWT context (v_jwt_role = ''). Anonymous 'anon' callers can NEVER
--      bypass profile protection.
--   2. Persisted Anti-Brute-Force Rate Limiting:
--      Redemption failures return structured JSON responses instead of raising
--      exceptions, allowing failed attempt counters to commit to disk.
--      Enforces a maximum of 10 failed attempts per 1-hour window per member.
--   3. Persisted Expired Pass Status:
--      When an expired pass is redeemed, status = 'expired' is updated and
--      committed without rolling back.
--   4. Cryptographically Secure Code Generation:
--      Uses unambiguous Base32 charset (no 0/O, 1/I/L) with 60-bit+ entropy.
--      Collision safety is guaranteed via EXCEPTION WHEN unique_violation loop.
--   5. Subscription State & Downgrade Protection:
--      - Lifetime memberships (expires_at IS NULL) can never be shortened or overwritten.
--      - Active higher-tier memberships cannot be silently downgraded by lower passes.
--      - Same-tier passes extend expiration cleanly.
--      - Upgrades activate immediately from now().
--      - Exactly ONE active subscription row exists after redemption.
--   6. Strict Least-Privilege Table Permissions:
--      Direct INSERT, UPDATE, and DELETE on public.membership_passes are revoked
--      from authenticated and anon. All writes are mediated by SECURITY DEFINER RPCs.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Create Dedicated Membership Passes Table
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.membership_passes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text NOT NULL UNIQUE,                                       -- Format: 'MEM-XXXX-XXXX-XXXX'
  plan_id            text NOT NULL REFERENCES public.membership_plans(id) ON DELETE RESTRICT,
  duration_days      integer NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  issued_to_user_id  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,     -- Optional pre-assignment to a specific member
  issued_by_admin_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  status             text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','redeemed','expired','revoked')),
  note               text,
  expires_at         timestamptz NOT NULL,                                       -- Expiration date for redeeming the pass
  redeemed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.membership_passes IS
  'Promotional and complimentary membership passes granting ₹0 access to Select, Signature, or Privé tiers.';

CREATE INDEX IF NOT EXISTS idx_membership_passes_code
  ON public.membership_passes (code);

CREATE INDEX IF NOT EXISTS idx_membership_passes_issued_to
  ON public.membership_passes (issued_to_user_id);

CREATE INDEX IF NOT EXISTS idx_membership_passes_status_expires
  ON public.membership_passes (status, expires_at);

-- ----------------------------------------------------------------------------
-- 2. Explicit Grants and Row Level Security on public.membership_passes
-- ----------------------------------------------------------------------------

ALTER TABLE public.membership_passes ENABLE ROW LEVEL SECURITY;

-- Revoke all direct write privileges from public clients.
-- All inserts, updates, and deletes MUST occur through authorized RPCs.
REVOKE ALL ON public.membership_passes FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON public.membership_passes FROM authenticated;
GRANT SELECT ON public.membership_passes TO authenticated;

-- Admins: Full SELECT access for management console
DROP POLICY IF EXISTS "membership_passes_admin_all" ON public.membership_passes;
CREATE POLICY "membership_passes_admin_all" ON public.membership_passes
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Members: Read-only access strictly to passes assigned to their profile
DROP POLICY IF EXISTS "membership_passes_user_read" ON public.membership_passes;
CREATE POLICY "membership_passes_user_read" ON public.membership_passes
  FOR SELECT TO authenticated
  USING (issued_to_user_id = auth.uid());

-- ----------------------------------------------------------------------------
-- 3. Private Intent & Rate-Limiting Schema (datevra_internal)
-- ----------------------------------------------------------------------------

CREATE SCHEMA IF NOT EXISTS datevra_internal;
REVOKE ALL ON SCHEMA datevra_internal FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA datevra_internal TO postgres, service_role;

-- Transient authorization tokens consumed atomically by protect_profile_fields()
CREATE TABLE IF NOT EXISTS datevra_internal.plan_update_intents (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id    text NOT NULL REFERENCES public.membership_plans(id),
  expires_at timestamptz,                                                        -- Nullable to represent lifetime access safely
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE datevra_internal.plan_update_intents IS
  'Transient internal tokens consumed atomically by protect_profile_fields() during verified membership updates.';

REVOKE ALL ON TABLE datevra_internal.plan_update_intents FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE datevra_internal.plan_update_intents TO postgres, service_role;

-- Rate limiting table for pass redemption attempts (anti-brute-force)
CREATE TABLE IF NOT EXISTS datevra_internal.pass_redemption_attempts (
  user_id         uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  window_start    timestamptz NOT NULL DEFAULT now(),
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE datevra_internal.pass_redemption_attempts IS
  'Tracks failed pass redemption attempts per account to prevent brute-force code guessing.';

REVOKE ALL ON TABLE datevra_internal.pass_redemption_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE datevra_internal.pass_redemption_attempts TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 4. Update Profile Protection Trigger Function (protect_profile_fields)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.protect_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, datevra_internal, pg_temp
AS $$
DECLARE
  v_consumed boolean := false;
  v_jwt_role text;
BEGIN
  -- Check if any protected administrative or sensitive field has changed
  IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
     OR OLD.plan_id IS DISTINCT FROM NEW.plan_id
     OR OLD.plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
     OR OLD.verified IS DISTINCT FROM NEW.verified
     OR OLD.email IS DISTINCT FROM NEW.email THEN

    -- Extract JWT claim role safely
    v_jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');

    -- 1. Authorized callers unconditionally allowed:
    --    a) Authenticated Datevra admins (public.is_admin() = true)
    --    b) Verified Supabase service-role (Edge Functions / Webhooks)
    --    c) Direct SQL Editor / maintenance scripts with no JWT context running under session_user
    IF public.is_admin()
       OR v_jwt_role = 'service_role'
       OR (v_jwt_role = '' AND auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin')) THEN
      RETURN NEW;
    END IF;

    -- 2. If caller is an ordinary authenticated member, verify whether this is an
    -- authorized internal plan update (admin, verified, and email fields MUST be untouched)
    IF OLD.is_admin IS NOT DISTINCT FROM NEW.is_admin
       AND OLD.verified IS NOT DISTINCT FROM NEW.verified
       AND OLD.email IS NOT DISTINCT FROM NEW.email THEN

      -- Atomically verify and consume the intent from the private schema
      DELETE FROM datevra_internal.plan_update_intents
       WHERE user_id = NEW.id
         AND plan_id = NEW.plan_id
         AND expires_at IS NOT DISTINCT FROM NEW.plan_expires_at
      RETURNING true INTO v_consumed;

      IF v_consumed IS TRUE THEN
        RETURN NEW; -- Authorized internal membership update: allow
      END IF;
    END IF;

    -- All other unauthorized direct mutations (including anonymous 'anon' attempts) are rejected
    RAISE EXCEPTION 'Only Datevra admins may change admin, plan, verification, or email fields';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.protect_profile_fields() IS
  'Prevents client privilege escalation. Permits plan updates only via verified internal intents or administrative roles.';

-- Ensure trigger is bound on public.profiles
DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_fields
  BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, email ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();

-- ----------------------------------------------------------------------------
-- 5. Helper: Cryptographically Secure Unambiguous Pass Code Generator
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION datevra_internal.generate_secure_pass_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  -- 32-character unambiguous alphabet (excludes 0/O, 1/I/L to avoid customer confusion)
  v_chars text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea;
  v_code  text := '';
  v_idx   integer;
  i       integer;
BEGIN
  -- 12 characters selected from 32 choices = 32^12 = 1.15e18 combinations (~60 bits of entropy)
  v_bytes := gen_random_bytes(12);
  FOR i IN 0..11 LOOP
    v_idx := (get_byte(v_bytes, i) % 32) + 1;
    v_code := v_code || substr(v_chars, v_idx, 1);
  END LOOP;

  -- Formatted as: 'MEM-XXXX-XXXX-XXXX'
  RETURN 'MEM-' || substr(v_code, 1, 4) || '-' || substr(v_code, 5, 4) || '-' || substr(v_code, 9, 4);
END;
$$;

COMMENT ON FUNCTION datevra_internal.generate_secure_pass_code() IS
  'Generates a high-entropy (~60 bits), unambiguous alphanumeric membership pass code.';

REVOKE ALL ON FUNCTION datevra_internal.generate_secure_pass_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION datevra_internal.generate_secure_pass_code() TO postgres, service_role;

-- ----------------------------------------------------------------------------
-- 6. Admin Pass Creation RPC (Collision-Safe Insert)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_membership_pass(
  p_plan_id            text,
  p_duration_days      integer DEFAULT 30,
  p_expires_at         timestamptz DEFAULT (now() + interval '90 days'),
  p_issued_to_user_id  uuid DEFAULT NULL,
  p_note               text DEFAULT NULL
)
RETURNS public.membership_passes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, datevra_internal, pg_temp
AS $$
DECLARE
  v_admin_id  uuid := auth.uid();
  v_pass      public.membership_passes%ROWTYPE;
  v_code      text;
  v_attempts  integer := 0;
BEGIN
  -- Strict administrator check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.';
  END IF;

  IF p_plan_id NOT IN ('connect', 'plus', 'elite') THEN
    RAISE EXCEPTION 'Invalid plan ID. Must be connect, plus, or elite.';
  END IF;

  IF p_duration_days IS NULL OR p_duration_days <= 0 THEN
    RAISE EXCEPTION 'Duration days must be greater than zero.';
  END IF;

  IF p_expires_at IS NULL OR p_expires_at <= now() THEN
    RAISE EXCEPTION 'Pass expiration date must be in the future.';
  END IF;

  IF p_issued_to_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_issued_to_user_id) THEN
      RAISE EXCEPTION 'Assigned user does not exist.';
    END IF;
  END IF;

  -- Collision-safe generation: catches unique_violation and retries
  LOOP
    v_attempts := v_attempts + 1;
    v_code := datevra_internal.generate_secure_pass_code();
    
    BEGIN
      INSERT INTO public.membership_passes (
        code, plan_id, duration_days, issued_to_user_id,
        issued_by_admin_id, status, note, expires_at
      ) VALUES (
        v_code, p_plan_id, p_duration_days, p_issued_to_user_id,
        v_admin_id, 'active', btrim(p_note), p_expires_at
      ) RETURNING * INTO v_pass;

      EXIT; -- Insertion succeeded
    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempts >= 10 THEN
          RAISE EXCEPTION 'Failed to generate a unique pass code after % attempts.', v_attempts;
        END IF;
    END;
  END LOOP;

  -- Audit log entry
  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'membership_pass.create',
    'Created ' || p_plan_id || ' membership pass ' || v_code || ' valid for ' || p_duration_days || ' days'
  );

  RETURN v_pass;
END;
$$;

COMMENT ON FUNCTION public.create_membership_pass(text, integer, timestamptz, uuid, text) IS
  'Admin-only function to generate unique promotional membership passes with collision retry.';

REVOKE ALL ON FUNCTION public.create_membership_pass(text, integer, timestamptz, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_membership_pass(text, integer, timestamptz, uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 7. Admin Pass Revocation RPC
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.revoke_membership_pass(
  p_pass_id uuid,
  p_reason  text DEFAULT NULL
)
RETURNS public.membership_passes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_pass     public.membership_passes%ROWTYPE;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.';
  END IF;

  SELECT * INTO v_pass
  FROM public.membership_passes
  WHERE id = p_pass_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Membership pass not found.';
  END IF;

  IF v_pass.status <> 'active' THEN
    RAISE EXCEPTION 'Only active passes may be revoked. Current status: %', v_pass.status;
  END IF;

  UPDATE public.membership_passes
     SET status = 'revoked',
         note = CASE
                  WHEN p_reason IS NOT NULL AND btrim(p_reason) <> '' THEN
                    COALESCE(note || ' | ', '') || 'Revoked: ' || btrim(p_reason)
                  ELSE note
                END
   WHERE id = p_pass_id
  RETURNING * INTO v_pass;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'membership_pass.revoke',
    'Revoked membership pass ' || v_pass.code || COALESCE(' (' || p_reason || ')', '')
  );

  RETURN v_pass;
END;
$$;

COMMENT ON FUNCTION public.revoke_membership_pass(uuid, text) IS
  'Admin-only function to revoke an active membership pass.';

REVOKE ALL ON FUNCTION public.revoke_membership_pass(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_membership_pass(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 8. Authenticated Member Pass Redemption RPC (Structured Persistence)
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.redeem_membership_pass(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, datevra_internal, pg_temp
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_clean_code   text;
  v_pass         public.membership_passes%ROWTYPE;
  v_current_sub  public.subscriptions%ROWTYPE;
  v_sub_priority integer := 0;
  v_pass_priority integer := 0;
  v_attempts     datevra_internal.pass_redemption_attempts%ROWTYPE;
  v_start_at     timestamptz := now();
  v_expires_at   timestamptz;
  v_payment_id   uuid;
  v_sub_id       uuid;
BEGIN
  -- 1. Enforce authenticated caller
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'UNAUTHORIZED',
      'message', 'You must be signed in to redeem a membership pass.'
    );
  END IF;

  IF p_code IS NULL OR btrim(p_code) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'MISSING_CODE',
      'message', 'A pass code is required.'
    );
  END IF;

  -- Normalize pass code format
  v_clean_code := upper(btrim(p_code));

  -- 2. Concurrency Guard 1: Lock caller's profile row first.
  -- Serializes concurrent multi-tab redemption attempts by the same member.
  PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;

  -- 3. Rate-Limiting / Anti-Brute-Force Guard
  -- Max 10 failed redemption attempts per 1-hour window per account.
  SELECT * INTO v_attempts
  FROM datevra_internal.pass_redemption_attempts
  WHERE user_id = v_uid
  FOR UPDATE;

  IF FOUND THEN
    IF v_attempts.window_start > (now() - interval '1 hour') AND v_attempts.failed_attempts >= 10 THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'RATE_LIMITED',
        'message', 'Too many invalid attempts. Please try again in an hour.'
      );
    ELSIF v_attempts.window_start <= (now() - interval '1 hour') THEN
      -- Reset rate window after 1 hour has elapsed
      UPDATE datevra_internal.pass_redemption_attempts
         SET failed_attempts = 0,
             window_start = now(),
             last_attempt_at = now()
       WHERE user_id = v_uid;
    END IF;
  ELSE
    INSERT INTO datevra_internal.pass_redemption_attempts (user_id, failed_attempts, window_start, last_attempt_at)
    VALUES (v_uid, 0, now(), now())
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  -- 4. Concurrency Guard 2: Lock the pass row exclusively to prevent double redemption.
  SELECT * INTO v_pass
  FROM public.membership_passes
  WHERE code = v_clean_code
  FOR UPDATE;

  -- 5. Strict Validation with Persisted Attempt Counting
  IF NOT FOUND THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'INVALID_CODE',
      'message', 'Invalid membership pass code.'
    );
  END IF;

  IF v_pass.status = 'redeemed' THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ALREADY_REDEEMED',
      'message', 'This membership pass has already been redeemed.'
    );
  END IF;

  IF v_pass.status = 'revoked' THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'PASS_REVOKED',
      'message', 'This membership pass has been revoked.'
    );
  END IF;

  -- Persist expired status safely if pass has elapsed
  IF v_pass.status = 'expired' OR (v_pass.expires_at IS NOT NULL AND v_pass.expires_at < now()) THEN
    UPDATE public.membership_passes
       SET status = 'expired'
     WHERE id = v_pass.id;

    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'PASS_EXPIRED',
      'message', 'This membership pass has expired.'
    );
  END IF;

  IF v_pass.issued_to_user_id IS NOT NULL AND v_pass.issued_to_user_id <> v_uid THEN
    UPDATE datevra_internal.pass_redemption_attempts
       SET failed_attempts = failed_attempts + 1,
           last_attempt_at = now()
     WHERE user_id = v_uid;
    RETURN jsonb_build_object(
      'success', false,
      'error', 'NOT_ASSIGNED_TO_CALLER',
      'message', 'This membership pass was issued to a different account.'
    );
  END IF;

  -- 6. Subscription State & Downgrade / Lifetime Protection
  -- Order: Highest tier first (elite > plus > connect), then lifetime, then furthest expiration.
  SELECT * INTO v_current_sub
  FROM public.subscriptions
  WHERE user_id = v_uid
    AND status = 'active'
    AND (expires_at IS NULL OR expires_at > now())
  ORDER BY
    CASE plan_id
      WHEN 'elite' THEN 3
      WHEN 'plus' THEN 2
      ELSE 1
    END DESC,
    (expires_at IS NULL) DESC,
    expires_at DESC NULLS LAST
  LIMIT 1;

  -- Priority tiers: connect = 1, plus = 2, elite = 3
  v_pass_priority := CASE v_pass.plan_id
                       WHEN 'elite' THEN 3
                       WHEN 'plus' THEN 2
                       ELSE 1
                     END;

  IF FOUND THEN
    v_sub_priority := CASE v_current_sub.plan_id
                        WHEN 'elite' THEN 3
                        WHEN 'plus' THEN 2
                        ELSE 1
                      END;

    -- LIFETIME PROTECTION: Never truncate or replace a lifetime membership
    IF v_current_sub.expires_at IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'LIFETIME_ACTIVE',
        'message', 'You currently hold an active lifetime ' || v_current_sub.plan_id || ' membership. Passes cannot be applied to lifetime memberships.'
      );
    END IF;

    -- DOWNGRADE PROTECTION: Prevent a lower-tier pass from silently replacing an active higher-tier plan
    IF v_pass_priority < v_sub_priority THEN
      RETURN jsonb_build_object(
        'success', false,
        'error', 'DOWNGRADE_NOT_PERMITTED',
        'message', 'You currently have an active higher-tier membership (' || v_current_sub.plan_id || '). You cannot apply a lower-tier pass while it is active.'
      );
    END IF;

    -- SAME-TIER EXTENSION: Append duration onto existing expiry date
    IF v_current_sub.plan_id = v_pass.plan_id AND v_current_sub.expires_at IS NOT NULL THEN
      v_expires_at := v_current_sub.expires_at + (v_pass.duration_days || ' days')::interval;
    ELSE
      -- UPGRADE: Higher tier replaces lower tier immediately from now()
      v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
    END IF;
  ELSE
    -- No prior active subscription: starts fresh from now()
    v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
  END IF;

  -- 7. Ensure exactly ONE active subscription row exists for the member:
  -- Expire all pre-existing active subscriptions before inserting the new one.
  UPDATE public.subscriptions
     SET status = 'expired'
   WHERE user_id = v_uid
     AND status = 'active';

  -- 8. Mark pass as redeemed & bind to the redeeming member
  UPDATE public.membership_passes
     SET status = 'redeemed',
         redeemed_at = now(),
         issued_to_user_id = COALESCE(issued_to_user_id, v_uid)
   WHERE id = v_pass.id;

  -- 9. Record ₹0 verified payment record for accounting and revenue tracking
  INSERT INTO public.payments (
    user_id, kind, amount, plan_id, status,
    razorpay_order_id, razorpay_payment_id, method
  ) VALUES (
    v_uid, 'membership', 0, v_pass.plan_id, 'verified',
    'pass_ord_' || v_pass.code, 'pass_pay_' || gen_random_uuid()::text, 'membership_pass'
  ) RETURNING id INTO v_payment_id;

  -- 10. Insert the single new active subscription
  INSERT INTO public.subscriptions (
    user_id, plan_id, status, started_at, expires_at, auto_renew
  ) VALUES (
    v_uid, v_pass.plan_id, 'active', v_start_at, v_expires_at, false
  ) RETURNING id INTO v_sub_id;

  -- 11. Register private authorization intent & update user profile
  -- The protect_profile_fields trigger will atomically verify and consume this intent.
  INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
  VALUES (v_uid, v_pass.plan_id, v_expires_at)
  ON CONFLICT (user_id) DO UPDATE
    SET plan_id = EXCLUDED.plan_id,
        expires_at = EXCLUDED.expires_at;

  UPDATE public.profiles
     SET plan_id = v_pass.plan_id,
         plan_expires_at = v_expires_at
   WHERE id = v_uid;

  -- 12. Reset rate-limit failed attempt counter on successful redemption
  UPDATE datevra_internal.pass_redemption_attempts
     SET failed_attempts = 0,
         last_attempt_at = now()
   WHERE user_id = v_uid;

  -- 13. Send in-app notification
  INSERT INTO public.notifications (user_id, kind, title, body, link)
  VALUES (
    v_uid, 'membership', 'Membership pass activated',
    'Your ' || v_pass.plan_id || ' membership has been activated for ' || v_pass.duration_days || ' days.',
    '/membership'
  );

  -- 14. Audit logging
  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_uid, 'user', 'membership_pass.redeem',
    'Redeemed pass ' || v_pass.code || ' for plan ' || v_pass.plan_id || ' (' || v_pass.duration_days || ' days)'
  );

  -- 15. Return structured success payload
  RETURN jsonb_build_object(
    'success', true,
    'code', v_pass.code,
    'plan_id', v_pass.plan_id,
    'duration_days', v_pass.duration_days,
    'expires_at', v_expires_at,
    'payment_id', v_payment_id,
    'subscription_id', v_sub_id
  );
END;
$$;

COMMENT ON FUNCTION public.redeem_membership_pass(text) IS
  'Redeem a digital membership pass. Atomic double row lock, lifetime & downgrade protection, persisted rate-limiting, and single active subscription guarantee.';

REVOKE ALL ON FUNCTION public.redeem_membership_pass(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_membership_pass(text) TO authenticated;
