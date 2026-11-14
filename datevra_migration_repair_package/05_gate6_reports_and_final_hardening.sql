-- ============================================================================
-- DATEVRA REPAIR PACKAGE — GATE 6: Reports Audit & Final Privilege Hardening
-- File: datevra_migration_repair_package/05_gate6_reports_and_final_hardening.sql
--
-- PURPOSE:
--   Consolidate Migrations 023 and 025 cleanly (superseding 017 and 020),
--   close stale 002 *_admin_write policy names left open by raw 025, preserve
--   required app INSERT/SELECT grants, and harden existing 004/006 SECURITY
--   INVOKER trigger search_paths.
--
-- PREREQUISITES:
--   - Gate 2 applied (public.reports.updated_at exists).
--   - Gate 5 applied (admin_verify_payment, admin_refund_payment,
--     admin_cancel_subscription, admin_extend_subscription exist).
--
-- EXPECTED EFFECTS:
--   1. Installs check_report_status_audit_guard() + trg_report_status_audit_guard
--      and atomic audited public.set_report_status(uuid, text).
--   2. Revokes table-level AND column-level UPDATE/DELETE on public.reports,
--      public.payments, and public.subscriptions from authenticated, anon, PUBLIC.
--   3. Drops permissive direct mutation policies:
--      - reports_admin_update, reports_admin_update_restricted
--      - payments_admin_update, payments_admin_write (002)
--      - subscriptions_admin_update, subscriptions_admin_write (002)
--   4. Preserves app-required grants & policies:
--      - reports: SELECT, INSERT for authenticated (anon revoked)
--      - payments: SELECT, INSERT for authenticated + narrow payments_admin_insert
--        (FOR INSERT WITH CHECK (public.is_admin())) for cash payments (db.ts:945)
--        alongside payments_insert_own_pending
--      - subscriptions: SELECT for authenticated (anon revoked)
--   5. Re-affirms EXECUTE grants/revocations for all admin/member RPCs and
--      hardens search_path on 004/006 trigger functions (enforce_application_rules,
--      freeze_match_participants, freeze_message_content).
--
-- RERUN / TRANSACTION SAFETY:
--   Wrapped in BEGIN ... COMMIT. Additive/idempotent; must run AFTER Gate 5.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'updated_at'
  ) THEN
    RAISE EXCEPTION 'GATE6_PRECONDITION_FAILED: public.reports.updated_at is missing. Run Gate 2 first.';
  END IF;

  IF to_regprocedure('public.admin_verify_payment(uuid)') IS NULL
     OR to_regprocedure('public.admin_refund_payment(uuid,text)') IS NULL
     OR to_regprocedure('public.admin_cancel_subscription(uuid,text)') IS NULL
     OR to_regprocedure('public.admin_extend_subscription(uuid,integer,text)') IS NULL THEN
    RAISE EXCEPTION 'GATE6_PRECONDITION_FAILED: Gate 5 payment/subscription admin RPCs are missing. Run Gate 5 first.';
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 1. Audited Report Status RPC & Trigger Guard (from 023)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_report_status_audit_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF pg_catalog.current_setting('datevra.in_audited_report_status_rpc', true) IS DISTINCT FROM 'true' THEN
      RAISE EXCEPTION 'AUDIT_GUARD_VIOLATION: Direct updates to report status are forbidden. Use public.set_report_status().';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_report_status_audit_guard ON public.reports;
CREATE TRIGGER trg_report_status_audit_guard
  BEFORE UPDATE ON public.reports
  FOR EACH ROW
  EXECUTE FUNCTION public.check_report_status_audit_guard();

CREATE OR REPLACE FUNCTION public.set_report_status(
  p_report_id uuid,
  p_status    text
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_report   public.reports%ROWTYPE;
BEGIN
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required to change report status.';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('open', 'reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'INVALID_REPORT_STATUS: Invalid report status: %. Must be open, reviewing, resolved, or dismissed.', COALESCE(p_status, 'NULL');
  END IF;

  PERFORM pg_catalog.set_config('datevra.in_audited_report_status_rpc', 'true', true);

  SELECT * INTO v_report
  FROM public.reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND: Report % not found.', p_report_id;
  END IF;

  UPDATE public.reports
     SET status = p_status,
         updated_at = now()
   WHERE id = p_report_id
  RETURNING * INTO v_report;

  INSERT INTO public.activity_logs (actor_id, actor_role, action, detail)
  VALUES (
    v_admin_id, 'admin', 'report.status',
    'Report ' || p_report_id || ' status → ' || p_status
  );

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.set_report_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_status(uuid, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- 2. Revoke Direct UPDATE/DELETE & Clean Stale Policies (023 + 025 + 002 Fix)
-- ----------------------------------------------------------------------------

-- 2A. Reports
REVOKE UPDATE, DELETE ON public.reports FROM authenticated, anon, PUBLIC;
REVOKE UPDATE (id, reporter_id, reported_id, reason, details, status, created_at, updated_at)
  ON public.reports FROM authenticated, anon, PUBLIC;

DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;
DROP POLICY IF EXISTS "reports_admin_update_restricted" ON public.reports;

REVOKE ALL ON public.reports FROM anon;
GRANT SELECT, INSERT ON public.reports TO authenticated;

-- 2B. Payments
REVOKE UPDATE, DELETE ON public.payments FROM authenticated, anon, PUBLIC;
REVOKE UPDATE (id, user_id, kind, amount, plan_id, status, razorpay_order_id, razorpay_payment_id, method, created_at, updated_at)
  ON public.payments FROM authenticated, anon, PUBLIC;

DROP POLICY IF EXISTS "payments_admin_update" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_write" ON public.payments;
DROP POLICY IF EXISTS "payments_admin_insert" ON public.payments;

CREATE POLICY "payments_admin_insert" ON public.payments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin());

REVOKE ALL ON public.payments FROM anon;
GRANT SELECT, INSERT ON public.payments TO authenticated;

-- 2C. Subscriptions
REVOKE UPDATE, DELETE ON public.subscriptions FROM authenticated, anon, PUBLIC;
REVOKE UPDATE (id, user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew, created_at, updated_at)
  ON public.subscriptions FROM authenticated, anon, PUBLIC;

DROP POLICY IF EXISTS "subscriptions_admin_update" ON public.subscriptions;
DROP POLICY IF EXISTS "subscriptions_admin_write" ON public.subscriptions;

REVOKE ALL ON public.subscriptions FROM anon;
GRANT SELECT ON public.subscriptions TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Re-Verify RPC Execute Grants & Internal Helper Revocations
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.set_report_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_status(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_verify_payment(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_verify_payment(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_refund_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_refund_payment(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_cancel_subscription(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cancel_subscription(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_extend_subscription(uuid, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_extend_subscription(uuid, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_user_verified(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_user_verified(uuid, boolean, text) TO authenticated;

-- Ensure internal helpers remain inaccessible to client roles
DO $$
BEGIN
  IF to_regprocedure('public.lock_matchmaking_pair(uuid,uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.lock_matchmaking_pair(uuid, uuid) FROM PUBLIC, anon, authenticated;
  END IF;
  IF to_regprocedure('datevra_internal.generate_secure_pass_code()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION datevra_internal.generate_secure_pass_code() FROM PUBLIC, anon, authenticated;
    GRANT EXECUTE ON FUNCTION datevra_internal.generate_secure_pass_code() TO postgres, service_role;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. Source-Verified Search-Path Hardening on 004/006 SECURITY INVOKER Triggers
--    Verified against db/migrations/004_security_hardening.sql and 006_match_integrity.sql:
--    all schema references are explicitly public.* (experiences, profiles, is_admin).
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regprocedure('public.enforce_application_rules()') IS NOT NULL THEN
    ALTER FUNCTION public.enforce_application_rules()
      SET search_path = pg_catalog, public, pg_temp;
  END IF;

  IF to_regprocedure('public.freeze_match_participants()') IS NOT NULL THEN
    ALTER FUNCTION public.freeze_match_participants()
      SET search_path = pg_catalog, public, pg_temp;
  END IF;

  IF to_regprocedure('public.freeze_message_content()') IS NOT NULL THEN
    ALTER FUNCTION public.freeze_message_content()
      SET search_path = pg_catalog, public, pg_temp;
  END IF;
END $$;

COMMENT ON TABLE public.reports IS
  'Member safety and conduct reports. Status changes must route via audited public.set_report_status().';
COMMENT ON TABLE public.payments IS
  'Financial ledger records. Captures and refunds must route via authorized RPCs/Edge Functions.';
COMMENT ON TABLE public.subscriptions IS
  'Member tier entitlements. Lifecycle changes must route via audited subscription and payment RPCs.';

COMMIT;
