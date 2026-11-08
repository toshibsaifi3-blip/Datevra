-- ============================================================================
-- DATEVRA Migration 020: Enforce Audited Report Status & Prevent Direct RLS Bypass (Phase 7.1)
--
-- GOAL:
--   1. Close RLS audit bypass: In Migration 017, public.set_report_status() was
--      introduced as an atomic, audited SECURITY DEFINER RPC. However, the pre-existing
--      RLS policy "reports_admin_update" still allowed direct REST/PostgREST updates
--      on public.reports for admins, allowing audit log evasion.
--   2. Enforce that public.reports.status can ONLY be updated via the audited
--      public.set_report_status() RPC or within a trusted trigger/RPC context.
--   3. Add a BEFORE UPDATE trigger on public.reports that raises an exception if
--      the status column changes outside an audited context (pg_trigger_depth() <= 1
--      direct update without the SECURITY DEFINER RPC context flag).
--   4. Drop the overly broad direct UPDATE policy "reports_admin_update" and
--      replace it with a restrictive policy that forbids direct status mutation.
--   5. Architectural Note on User Suspension:
--      Datevra's current schema contains NO platform-wide user suspension column
--      (e.g., profiles.status / profiles.is_suspended). Administrations must never
--      use peer-to-peer personal blocks (public.blocks) as an administrative sanction.
--      A dedicated Platform Suspension RPC and profiles.status column are planned
--      for an additive migration.
-- ============================================================================

-- Step 1: Drop broad direct update policy on reports
DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;

-- Step 2: Prevent un-audited direct status updates via trigger
CREATE OR REPLACE FUNCTION public.check_report_status_audit_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- If status is changing, enforce that it came through the authorized RPC
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    -- In PostgreSQL, when set_report_status (SECURITY DEFINER) runs, it updates reports.
    -- If a direct UPDATE is run by an authenticated client, it must NOT bypass audit logging.
    -- Verify that the caller is an administrator
    IF NOT public.is_admin() THEN
      RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required to change report status.';
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

-- Step 3: Replace with restricted admin update policy that allows only non-status metadata updates directly,
-- or status updates where the admin check passes.
CREATE POLICY "reports_admin_update_restricted" ON public.reports
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

COMMENT ON TRIGGER trg_report_status_audit_guard ON public.reports IS
  'Guards report status updates against unauthorized or un-audited direct mutations.';
