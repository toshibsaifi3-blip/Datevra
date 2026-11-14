-- ============================================================================
-- DATEVRA REPAIR PACKAGE — GATE 2: Schema Compatibility Repairs
-- File: datevra_migration_repair_package/01_gate2_schema_compatibility_repairs.sql
--
-- PURPOSE:
--   Align missing columns, timestamp triggers, financial retention FKs, and
--   pending-payment uniqueness constraints required before Gates 3-6 can run.
--
-- PREREQUISITES:
--   - Gate 0 backup completed and Gate 1 (00_READ_ONLY_PREFLIGHT.sql) reviewed.
--   - Base tables from db/schema.sql exist in schema public.
--
-- EXPECTED EFFECTS:
--   1. Adds public.cafes.menu (text NOT NULL DEFAULT '') if absent (used by
--      mappers.ts unmapCafe and Migration 010).
--   2. Adds public.subscriptions.auto_renew (boolean NOT NULL DEFAULT false)
--      if absent (required by schema.sql, Membership.tsx, Memberships.tsx,
--      Edge Functions, 011, 021, 024; confirmed missing in historical baseline).
--   3. Adds public.subscriptions.created_at / updated_at (timestamptz NOT NULL
--      DEFAULT now()) if absent, and attaches trg_set_updated_at (required by
--      021 and 024).
--   4. Ensures public.payments has created_at / updated_at and public.reports
--      has updated_at + trg_set_updated_at (required by 021 & 023).
--   5. Ensures Migration 008 nullable user_id + ON DELETE SET NULL FKs on
--      payments and subscriptions, and Migration 005 partial unique index
--      payments_one_pending_per_user_plan (aborts cleanly if duplicate pending
--      rows already exist).
--   6. Deliberately does NOT add payments.verified_at: Edge Functions using
--      verified_at remain a Gate 5B BLOCKED item pending code alignment.
--
-- POSTCONDITIONS:
--   All required compatibility columns, triggers, retention FKs, and partial
--   unique index exist and are validated.
--
-- RERUN / TRANSACTION SAFETY:
--   Wrapped in BEGIN ... COMMIT. Additive only; safe to re-run once clean.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_missing text := '';
  v_tbl     text;
  v_dup_pending integer;
  v_fk_del  "char";
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'profiles', 'subscriptions', 'payments', 'reports',
    'cafes', 'experiences', 'membership_plans', 'activity_logs', 'notifications'
  ] LOOP
    IF to_regclass('public.' || v_tbl) IS NULL THEN
      v_missing := v_missing || v_tbl || ', ';
    END IF;
  END LOOP;

  IF v_missing <> '' THEN
    RAISE EXCEPTION 'GATE2_PRECONDITION_FAILED: Missing required base table(s): %', rtrim(v_missing, ', ');
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'GATE2_PRECONDITION_FAILED: Function public.is_admin() does not exist.';
  END IF;

  IF to_regprocedure('public.set_updated_at()') IS NULL THEN
    RAISE EXCEPTION 'GATE2_PRECONDITION_FAILED: Function public.set_updated_at() does not exist.';
  END IF;

  -- Check duplicate pending payments before attempting 005 unique index
  IF to_regclass('public.payments_one_pending_per_user_plan') IS NULL THEN
    SELECT count(*) INTO v_dup_pending
    FROM (
      SELECT user_id, plan_id
      FROM public.payments
      WHERE status = 'pending'
      GROUP BY user_id, plan_id
      HAVING count(*) > 1
    ) dups;

    IF v_dup_pending > 0 THEN
      RAISE EXCEPTION 'GATE2_PRECONDITION_FAILED: % duplicate pending (user_id, plan_id) group(s) exist in public.payments. Resolve before creating payments_one_pending_per_user_plan.', v_dup_pending;
    END IF;
  END IF;

  -- 1. Ensure public.cafes.menu exists
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cafes' AND column_name = 'menu'
  ) THEN
    ALTER TABLE public.cafes
      ADD COLUMN menu text NOT NULL DEFAULT '';
  END IF;

  -- 2. Ensure public.subscriptions compatibility columns exist (schema.sql parity)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'auto_renew'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD COLUMN auto_renew boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.subscriptions
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;

  -- Attach trg_set_updated_at on public.subscriptions
  DROP TRIGGER IF EXISTS trg_set_updated_at ON public.subscriptions;
  CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

  -- 3. Ensure public.payments timestamps exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE public.payments
      ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.payments
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;

  DROP TRIGGER IF EXISTS trg_set_updated_at ON public.payments;
  CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON public.payments
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

  -- 4. Ensure public.reports.updated_at exists (required by set_report_status)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.reports
      ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;

  DROP TRIGGER IF EXISTS trg_set_updated_at ON public.reports;
  CREATE TRIGGER trg_set_updated_at
    BEFORE UPDATE ON public.reports
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

  -- 5. Ensure Migration 008 payment/subscription retention FKs (ON DELETE SET NULL)
  SELECT con.confdeltype INTO v_fk_del
  FROM pg_constraint con
  WHERE con.conrelid = 'public.payments'::regclass
    AND con.conname = 'payments_user_id_fkey'
    AND con.contype = 'f';

  IF v_fk_del IS DISTINCT FROM 'n' THEN
    ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_user_id_fkey;
    ALTER TABLE public.payments ALTER COLUMN user_id DROP NOT NULL;
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;

  SELECT con.confdeltype INTO v_fk_del
  FROM pg_constraint con
  WHERE con.conrelid = 'public.subscriptions'::regclass
    AND con.conname = 'subscriptions_user_id_fkey'
    AND con.contype = 'f';

  IF v_fk_del IS DISTINCT FROM 'n' THEN
    ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_user_id_fkey;
    ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
    ALTER TABLE public.subscriptions
      ADD CONSTRAINT subscriptions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 6. Ensure Migration 005 partial unique index exists
CREATE UNIQUE INDEX IF NOT EXISTS payments_one_pending_per_user_plan
  ON public.payments (user_id, plan_id)
  WHERE status = 'pending';

-- Postcondition verification
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'auto_renew'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'created_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'updated_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reports' AND column_name = 'updated_at'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'cafes' AND column_name = 'menu'
  ) THEN
    RAISE EXCEPTION 'GATE2_POSTCONDITION_FAILED: Required compatibility columns remain missing.';
  END IF;
END $$;

COMMIT;
