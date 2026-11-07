-- ============================================================================
-- DATEVRA Migration 017: Atomic Report Status Management & Audit Logging (Phase 5.1)
--
-- GOAL:
--   1. Replace multi-roundtrip split-transaction report updates with an atomic,
--      server-side RPC: public.set_report_status(p_report_id uuid, p_status text).
--   2. Enforce strict administrator authorization via public.is_admin().
--   3. Validate that p_status is one of ('open', 'reviewing', 'resolved', 'dismissed').
--   4. Exclusively lock and update public.reports (status and updated_at).
--   5. Atomically insert a single audit event into public.activity_logs:
--        actor_id:   auth.uid() (never trusted from client input)
--        actor_role: 'admin'
--        action:     'report.status'
--        detail:     'Report <id> status → <status>'
--   6. Guarantee that any failure during report update or audit log insertion
--      rolls back the entire transaction, preventing orphaned updates.
--   7. Follow SECURITY DEFINER best practices with fixed search_path = public, pg_temp.
--   8. Revoke EXECUTE from PUBLIC and anon, granting EXECUTE only to authenticated.
-- ============================================================================

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
  -- 1. Authentication check: caller must be authenticated
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  -- 2. Administrator authorization check: caller must have is_admin = true
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Administrator privileges required.';
  END IF;

  -- 3. Validate status against allowable domain values
  IF p_status NOT IN ('open', 'reviewing', 'resolved', 'dismissed') THEN
    RAISE EXCEPTION 'Invalid report status: %. Must be open, reviewing, resolved, or dismissed.', p_status;
  END IF;

  -- 4. Verify report exists and lock row to prevent concurrent overwrite
  SELECT * INTO v_report
  FROM public.reports
  WHERE id = p_report_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found: %', p_report_id;
  END IF;

  -- 5. Atomically update report status and timestamp
  UPDATE public.reports
     SET status = p_status,
         updated_at = now()
   WHERE id = p_report_id
  RETURNING * INTO v_report;

  -- 6. Atomically insert audit log record into public.activity_logs
  -- Uses server-verified auth.uid() as actor_id
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

-- Restrict execution: revoke from unauthenticated roles, grant to authenticated
REVOKE ALL ON FUNCTION public.set_report_status(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_report_status(uuid, text) TO authenticated;
