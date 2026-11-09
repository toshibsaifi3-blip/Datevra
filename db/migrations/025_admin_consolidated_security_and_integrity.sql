-- ============================================================================
-- DATEVRA Migration 025: Consolidated Admin Security, Privilege Hardening & Ledger Protection (Phase 7.6)
--
-- GOAL:
--   1. Reports Security & Audit Guarantee (Defense-in-Depth):
--      - Explicitly revoke both table-level AND column-level UPDATE and DELETE privileges
--        on public.reports from authenticated, anon, and PUBLIC.
--      - Ensure any historical column-level grants (e.g. UPDATE (status)) are extinguished.
--      - Preserve client SELECT (viewing under RLS) and INSERT (filing fresh reports).
--      - Ensure the check_report_status_audit_guard trigger cannot be bypassed.
--
--   2. Payments Financial Ledger Integrity:
--      - Revoke direct UPDATE and DELETE on public.payments from authenticated, anon, PUBLIC.
--      - Drop permissive "payments_admin_update" direct mutation policy.
--      - All payment state transitions (verify, refund) MUST route exclusively through
--        the atomic, audited SECURITY DEFINER RPCs (admin_verify_payment, admin_refund_payment).
--
--   3. Subscriptions Lifecycle Integrity:
--      - Revoke direct UPDATE and DELETE on public.subscriptions from authenticated, anon, PUBLIC.
--      - Drop permissive "subscriptions_admin_update" direct mutation policy.
--      - All subscription lifecycle transitions (cancel, extend, expire) MUST route
--        through authorized administrative RPCs (admin_cancel_subscription, admin_extend_subscription)
--        or payment reconciliation / pass redemption.
--
--   4. Function Permissions & Safe Execution:
--      - Ensure all administrative RPCs are strictly SECURITY DEFINER with fixed
--        search_path = public, pg_temp.
--      - Revoke EXECUTE from PUBLIC and anon; grant EXECUTE strictly to authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Reports Security & Audit Bypass Elimination
-- ----------------------------------------------------------------------------

-- Table-level revocations
REVOKE UPDATE, DELETE ON public.reports FROM authenticated, anon, PUBLIC;

-- Column-level revocations (ensures no column grant survived historical migrations)
REVOKE UPDATE (id, reporter_id, reported_id, reason, details, status, created_at, updated_at)
  ON public.reports FROM authenticated, anon, PUBLIC;

-- Drop any remaining permissive direct update policies
DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;
DROP POLICY IF EXISTS "reports_admin_update_restricted" ON public.reports;

-- Re-affirm safe SELECT and INSERT grants
GRANT SELECT, INSERT ON public.reports TO authenticated;
REVOKE ALL ON public.reports FROM anon;

-- ----------------------------------------------------------------------------
-- 2. Payments Ledger Protection
-- ----------------------------------------------------------------------------

-- Revoke direct mutation privileges from client roles
REVOKE UPDATE, DELETE ON public.payments FROM authenticated, anon, PUBLIC;

-- Drop direct update policy
DROP POLICY IF EXISTS "payments_admin_update" ON public.payments;

-- Re-affirm safe SELECT and INSERT grants
GRANT SELECT, INSERT ON public.payments TO authenticated;
REVOKE ALL ON public.payments FROM anon;

-- ----------------------------------------------------------------------------
-- 3. Subscriptions Lifecycle Protection
-- ----------------------------------------------------------------------------

-- Revoke direct mutation privileges from client roles
REVOKE UPDATE, DELETE ON public.subscriptions FROM authenticated, anon, PUBLIC;

-- Drop direct update policy
DROP POLICY IF EXISTS "subscriptions_admin_update" ON public.subscriptions;

-- Re-affirm safe SELECT grants
GRANT SELECT ON public.subscriptions TO authenticated;
REVOKE ALL ON public.subscriptions FROM anon;

-- ----------------------------------------------------------------------------
-- 4. Re-Verify Audited RPC Search Paths and Permissions
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

COMMENT ON TABLE public.reports IS
  'Member safety and conduct reports. All status updates must route via the audited public.set_report_status() RPC.';

COMMENT ON TABLE public.payments IS
  'Immutable financial ledger records. Captures and refunds must route via authorized RPCs.';

COMMENT ON TABLE public.subscriptions IS
  'Member tier entitlements. Lifecycle modifications must route via audited subscription and payment RPCs.';
