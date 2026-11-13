-- ============================================================================
-- DATEVRA Execution Package File 06: Forward-Only Post-011 Reconciliation
-- RUN IMMEDIATELY AFTER File 05 (011_membership_passes.sql).
--
-- Purpose:
--   1. Ensures datevra_internal.generate_secure_pass_code() has
--      search_path = public, extensions, pg_temp (pgcrypto safety).
--   2. If Migration 018 verification columns already exist on public.profiles,
--      immediately restores the 9-column protect_profile_fields() function AND
--      recreates trg_protect_profile_fields covering all 9 protected columns
--      (closing both the 011->018 overwrite risk and 018's 5-col trigger gap).
--   3. If Migration 021 subscriptions.payment_id already exists, immediately
--      upgrades public.redeem_membership_pass(text) to insert payment_id
--      (preserving Migration 024 ledger traceability).
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_has_018_cols boolean;
  v_has_payment_id boolean;
BEGIN
  IF to_regclass('public.membership_passes') IS NULL
     OR to_regclass('datevra_internal.plan_update_intents') IS NULL THEN
    RAISE EXCEPTION 'Package 06 Aborted: Migration 011 objects not found. Run File 05 first.';
  END IF;

  -- 1. Guarantee extensions schema on generate_secure_pass_code
  IF to_regprocedure('datevra_internal.generate_secure_pass_code()') IS NOT NULL THEN
    ALTER FUNCTION datevra_internal.generate_secure_pass_code()
      SET search_path = public, extensions, pg_temp;
  END IF;

  -- 2. Reconcile 018 protection if verification_* columns already exist on profiles
  SELECT (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name IN (
        'verification_status',
        'verification_reviewed_at',
        'verification_reviewed_by',
        'verification_note'
      )
  ) = 4 INTO v_has_018_cols;

  IF v_has_018_cols THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.protect_profile_fields()
      RETURNS trigger
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, datevra_internal, pg_temp
      AS $body$
      DECLARE
        v_consumed boolean := false;
        v_jwt_role text;
      BEGIN
        IF OLD.is_admin IS DISTINCT FROM NEW.is_admin
           OR OLD.plan_id IS DISTINCT FROM NEW.plan_id
           OR OLD.plan_expires_at IS DISTINCT FROM NEW.plan_expires_at
           OR OLD.verified IS DISTINCT FROM NEW.verified
           OR OLD.verification_status IS DISTINCT FROM NEW.verification_status
           OR OLD.verification_reviewed_at IS DISTINCT FROM NEW.verification_reviewed_at
           OR OLD.verification_reviewed_by IS DISTINCT FROM NEW.verification_reviewed_by
           OR OLD.verification_note IS DISTINCT FROM NEW.verification_note
           OR OLD.email IS DISTINCT FROM NEW.email THEN

          v_jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');

          IF public.is_admin()
             OR v_jwt_role = 'service_role'
             OR (v_jwt_role = '' AND auth.uid() IS NULL AND session_user IN ('postgres', 'supabase_admin')) THEN
            RETURN NEW;
          END IF;

          IF OLD.is_admin IS NOT DISTINCT FROM NEW.is_admin
             AND OLD.verified IS NOT DISTINCT FROM NEW.verified
             AND OLD.verification_status IS NOT DISTINCT FROM NEW.verification_status
             AND OLD.verification_reviewed_at IS NOT DISTINCT FROM NEW.verification_reviewed_at
             AND OLD.verification_reviewed_by IS NOT DISTINCT FROM NEW.verification_reviewed_by
             AND OLD.verification_note IS NOT DISTINCT FROM NEW.verification_note
             AND OLD.email IS NOT DISTINCT FROM NEW.email THEN

            DELETE FROM datevra_internal.plan_update_intents
             WHERE user_id = NEW.id
               AND plan_id = NEW.plan_id
               AND expires_at IS NOT DISTINCT FROM NEW.plan_expires_at
            RETURNING true INTO v_consumed;

            IF v_consumed IS TRUE THEN
              RETURN NEW;
            END IF;
          END IF;

          RAISE EXCEPTION 'Only Datevra admins may change admin, plan, verification, or email fields';
        END IF;

        RETURN NEW;
      END;
      $body$;
    $fn$;

    EXECUTE 'DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles';
    EXECUTE 'CREATE TRIGGER trg_protect_profile_fields
             BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified,
               verification_status, verification_reviewed_at, verification_reviewed_by,
               verification_note, email
             ON public.profiles
             FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields()';

    RAISE NOTICE 'Reconciled 9-column protect_profile_fields() and trg_protect_profile_fields.';
  ELSE
    RAISE NOTICE 'Migration 018 columns not yet present on public.profiles; keeping 5-column trigger until 018 is applied.';
  END IF;

  -- 3. Reconcile redeem_membership_pass() payment_id link if Migration 021 column exists
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'subscriptions'
      AND column_name = 'payment_id'
  ) INTO v_has_payment_id;

  IF v_has_payment_id THEN
    EXECUTE $fn$
      CREATE OR REPLACE FUNCTION public.redeem_membership_pass(p_code text)
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, datevra_internal, pg_temp
      AS $body$
      DECLARE
        v_uid           uuid := auth.uid();
        v_clean_code    text;
        v_pass          public.membership_passes%ROWTYPE;
        v_current_sub   public.subscriptions%ROWTYPE;
        v_sub_priority  integer := 0;
        v_pass_priority integer := 0;
        v_attempts      datevra_internal.pass_redemption_attempts%ROWTYPE;
        v_start_at      timestamptz := now();
        v_expires_at    timestamptz;
        v_payment_id    uuid;
        v_sub_id        uuid;
      BEGIN
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

        v_clean_code := upper(btrim(p_code));

        PERFORM 1 FROM public.profiles WHERE id = v_uid FOR UPDATE;

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

        SELECT * INTO v_pass
        FROM public.membership_passes
        WHERE code = v_clean_code
        FOR UPDATE;

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

          IF v_current_sub.expires_at IS NULL THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'LIFETIME_ACTIVE',
              'message', 'You currently hold an active lifetime ' || v_current_sub.plan_id || ' membership. Passes cannot be applied to lifetime memberships.'
            );
          END IF;

          IF v_pass_priority < v_sub_priority THEN
            RETURN jsonb_build_object(
              'success', false,
              'error', 'DOWNGRADE_NOT_PERMITTED',
              'message', 'You currently have an active higher-tier membership (' || v_current_sub.plan_id || '). You cannot apply a lower-tier pass while it is active.'
            );
          END IF;

          IF v_current_sub.plan_id = v_pass.plan_id AND v_current_sub.expires_at IS NOT NULL THEN
            v_expires_at := v_current_sub.expires_at + (v_pass.duration_days || ' days')::interval;
          ELSE
            v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
          END IF;
        ELSE
          v_expires_at := v_start_at + (v_pass.duration_days || ' days')::interval;
        END IF;

        UPDATE public.subscriptions
           SET status = 'expired'
         WHERE user_id = v_uid
           AND status = 'active';

        UPDATE public.membership_passes
           SET status = 'redeemed',
               redeemed_at = now(),
               issued_to_user_id = COALESCE(issued_to_user_id, v_uid)
         WHERE id = v_pass.id;

        INSERT INTO public.payments (
          user_id, kind, amount, plan_id, status,
          razorpay_order_id, razorpay_payment_id, method
        ) VALUES (
          v_uid, 'membership', 0, v_pass.plan_id, 'verified',
          'pass_ord_' || v_pass.code, 'pass_pay_' || gen_random_uuid()::text, 'membership_pass'
        ) RETURNING id INTO v_payment_id;

        INSERT INTO public.subscriptions (
          user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew
        ) VALUES (
          v_uid, v_pass.plan_id, v_payment_id, 'active', v_start_at, v_expires_at, false
        ) RETURNING id INTO v_sub_id;

        INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)
        VALUES (v_uid, v_pass.plan_id, v_expires_at)
        ON CONFLICT (user_id) DO UPDATE
          SET plan_id = EXCLUDED.plan_id,
              expires_at = EXCLUDED.expires_at;

        UPDATE public.profiles
           SET plan_id = v_pass.plan_id,
               plan_expires_at = v_expires_at
         WHERE id = v_uid;

        UPDATE datevra_internal.pass_redemption_attempts
           SET failed_attempts = 0,
               last_attempt_at = now()
         WHERE user_id = v_uid;

        INSERT INTO public.notifications (user_id, kind, title, body, link)
        VALUES (
          v_uid, 'membership', 'Membership pass activated',
          'Your ' || v_pass.plan_id || ' membership has been activated for ' || v_pass.duration_days || ' days.',
          '/membership'
        );

        INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
        VALUES (
          v_uid, 'user', 'membership_pass.redeem',
          'Redeemed pass ' || v_pass.code || ' for plan ' || v_pass.plan_id || ' (' || v_pass.duration_days || ' days)'
        );

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
      $body$;
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.redeem_membership_pass(text) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.redeem_membership_pass(text) TO authenticated';

    RAISE NOTICE 'Reconciled redeem_membership_pass() to link subscriptions.payment_id.';
  END IF;
END $$;

COMMIT;
