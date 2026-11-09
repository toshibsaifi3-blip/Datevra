-- ============================================================================
-- DATEVRA Migration 023: Reports Audit Privilege Correction & Direct RLS Remediation (Phase 7.5)
--
-- GOAL:
--   1. Close PostgREST direct-update audit bypass on public.reports:
--      In Migration 020, policy "reports_admin_update_restricted" permitted authenticated
--      administrators to issue direct UPDATE statements against public.reports through PostgREST,
--      bypassing the audited public.set_report_status() RPC and activity logging.
--   2. Explicitly REVOKE UPDATE on public.reports from authenticated, anon, and PUBLIC.
--      Client-facing roles are strictly restricted to SELECT (viewing reports) and INSERT
--      (filing new reports). No direct UPDATE is allowed from any client role.
--   3. Drop the permissive "reports_admin_update_restricted" and "reports_admin_update" policies.
--   4. Update public.check_report_status_audit_guard() to strictly require that any status
--      modification occurs within the audited public.set_report_status() transaction context
--      (verified via session configuration 'datevra.in_audited_report_status_rpc' = 'true').
--   5. Re-declare public.set_report_status(p_report_id uuid, p_status text) as SECURITY DEFINER
--      with fixed search_path = public, pg_temp, which sets the transaction-local guard flag,
--      locks the report row FOR UPDATE, performs the status update, and writes the activity log.
--   6. Maintain strict principle of least privilege: direct mutations fail at both the SQL
--      privilege layer (42501 permission denied) and the trigger layer (AUDIT_GUARD_VIOLATION).
-- ============================================================================

-- Step 1: Revoke direct UPDATE privileges from client-facing roles
REVOKE UPDATE ON public.reports FROM authenticated, anon, PUBLIC;

-- Step 2: Drop permissive direct UPDATE policies
DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;
DROP POLICY IF EXISTS "reports_admin_update_restricted" ON public.reports;

-- Step 3: Hardened Trigger Audit Guard
CREATE OR REPLACE FUNCTION public.check_report_status_audit_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- If status is changing, enforce that it executed through public.set_report_status()
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    IF current_setting('datevra.in_audited_report_status_rpc', true) IS DISTINCT FROM 'true' THEN
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

COMMENT ON FUNCTION public.check_report_status_audit_guard() IS
  'Trigger guard preventing direct or un-audited status modifications on public.reports.';

-- Step 4: Atomic Audited Report Status RPC with Context Flag
CREATE OR REPLACE FUNCTION public.set_report_status(
  p_report_id uuid,
  p_status    text
)
RETURNS public.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_admin_id uuid := auth.uid();
  v_report   public.reports%ROWTYPE;
BEGIN
  -- 1. Authentication check
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHENTICATED: Authentication required.';
  END IF;

  -- 2. Authorization check
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: Administrator privileges required to change report status.';
  END IF;

  -- 3. Validate status domain values
  IF p_status NOT IN ('open', 'reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'INVALID_REPORT_STATUS: Invalid report status: %. Must be open, reviewing, resolved, or dismissed.', p_status;
  END IF;

  -- 4. Set transaction-local audit context flag for trigger guard
  PERFORM set_config('datevra.in_audited_report_status_rpc', 'true', true);

  -- 5. Exclusively lock the report row
  SELECT * INTO v_report
  FROM public.reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPORT_NOT_FOUND: Report % not found.', p_report_id;
  END IF;

  -- 6. Atomically update status and timestamp
  UPDATE public.reports
     SET status = p_status,
         updated_at = now()
   WHERE id = p_report_id
  RETURNING * INTO v_report;

  -- 7. Atomically record immutable audit log event
  INSERT INTO public.activity_logs (
    actor_id,
    actor_role,
    action,
    detail
  ) VALUES (
    v_admin_id,
    'admin',
    'report.status',
    'Report ' || p_report_id || ' status → ' || p_status
  );

  RETURN v_report;
END;
$$;

COMMENT ON FUNCTION public.set_report_status(uuid, text) IS
  'Admin-only atomic RPC to update report status and record an activity log event in a single database transaction.';

-- Step 5: Execution Permissions
REVOKE ALL ON FUNCTION public.set_report_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_status(uuid, text) TO authenticated;
