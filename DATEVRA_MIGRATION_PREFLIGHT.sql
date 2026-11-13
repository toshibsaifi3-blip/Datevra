-- ============================================================================
-- DATEVRA — PRODUCTION DATABASE MIGRATION PREFLIGHT (STRICTLY READ-ONLY)
-- Target Project Ref: buendstsgzdcmzaodurp
--
-- PURPOSE:
--   Safely inspect the live Supabase database BEFORE running ANY migration SQL.
--   Every query in this file is 100% READ-ONLY (SELECT statements against
--   system catalogs and existing core tables only).
--
-- SAFETY GUARANTEES:
--   - ZERO INSERT, UPDATE, DELETE, ALTER, DROP, CREATE, GRANT, or REVOKE.
--   - ZERO FOR UPDATE locks.
--   - Safe even when migrations 010–025 are missing (no query references
--     missing tables like membership_passes or missing columns directly).
--
-- HOW TO USE (BEGINNER GUIDE):
--   1. Open Supabase Dashboard -> project `buendstsgzdcmzaodurp` -> SQL Editor.
--   2. Copy ONLY "-- QUERY 1" below (from SELECT to the semicolon ;), paste it
--      into a New query, and click Run.
--   3. Copy the output table and share it back before running any write scripts.
--   4. Run Queries 2 through 6 one at a time in the same read-only way.
-- ============================================================================


-- ============================================================================
-- QUERY 1: Extensions, Schema Presence, and Installed RPC / Trigger Functions
-- (Covers: pgcrypto schema + migrations 002, 003, 004, 005, 006, 007, 009,
--  010, 011, 012–016, 017/020/023, 018/019, 021, 022/024, 025)
-- ============================================================================
SELECT
  object_type,
  object_name,
  present,
  details
FROM (
  -- Extensions (specifically checking which schema pgcrypto lives in)
  SELECT
    1 AS sort_order,
    'extension' AS object_type,
    'pgcrypto' AS object_name,
    EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') AS present,
    COALESCE(
      (SELECT 'schema=' || n.nspname || ', version=' || e.extversion
       FROM pg_extension e
       JOIN pg_namespace n ON n.oid = e.extnamespace
       WHERE e.extname = 'pgcrypto'),
      'NOT INSTALLED'
    ) AS details

  UNION ALL
  -- Private schema & internal tables from Migration 011
  SELECT
    2,
    'schema',
    'datevra_internal',
    EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'datevra_internal'),
    COALESCE(
      (SELECT string_agg(tablename, ', ' ORDER BY tablename)
       FROM pg_tables WHERE schemaname = 'datevra_internal'),
      'schema or internal tables absent'
    )

  UNION ALL
  -- Key tables from 009, 010, 011
  SELECT
    3,
    'table',
    t.tbl_name,
    to_regclass('public.' || t.tbl_name) IS NOT NULL,
    CASE WHEN to_regclass('public.' || t.tbl_name) IS NOT NULL THEN 'EXISTS' ELSE 'ABSENT' END
  FROM (VALUES
    ('daily_action_limits'),
    ('complimentary_passes'),
    ('match_proposals'),
    ('membership_passes')
  ) AS t(tbl_name)

  UNION ALL
  -- Key functions across migrations 001–025
  SELECT
    4,
    'function',
    f.fn_sig,
    to_regprocedure(f.fn_sig) IS NOT NULL,
    COALESCE(
      (SELECT
         CASE WHEN p.prosecdef THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
         || COALESCE(' | config=' || array_to_string(p.proconfig, '; '), ' | NO search_path SET')
       FROM pg_proc p
       WHERE p.oid = to_regprocedure(f.fn_sig)),
      'ABSENT'
    )
  FROM (VALUES
    ('public.is_admin()'),
    ('public.set_updated_at()'),
    ('public.handle_mutual_like()'),
    ('public.notify_on_like()'),
    ('public.notify_on_message()'),
    ('public.notify_on_application_decision()'),
    ('public.notify_on_booking()'),
    ('public.discovery_profiles()'),
    ('public.discovery_profile(uuid)'),
    ('public.blocked_pair(uuid,uuid)'),
    ('public.protect_profile_fields()'),
    ('public.freeze_message_content()'),
    ('public.enforce_application_rules()'),
    ('public.delete_own_account()'),
    ('public.freeze_match_participants()'),
    ('public.admin_exists()'),
    ('public.bootstrap_first_admin(text)'),
    ('public._has_active_membership(uuid)'),
    ('public.record_profile_interest(uuid)'),
    ('public.get_daily_usage()'),
    ('public.redeem_pass(text)'),
    ('public.respond_to_proposal(uuid,boolean)'),
    ('public.check_proposal_not_blocked()'),
    ('public.check_match_proposal_integrity()'),
    ('public.lock_matchmaking_pair(uuid,uuid)'),
    ('public.create_membership_pass(text,integer,timestamptz,uuid,text)'),
    ('public.revoke_membership_pass(uuid,text)'),
    ('public.redeem_membership_pass(text)'),
    ('datevra_internal.generate_secure_pass_code()'),
    ('public.set_user_verified(uuid,boolean,text)'),
    ('public.set_report_status(uuid,text)'),
    ('public.check_report_status_audit_guard()'),
    ('public.admin_verify_payment(uuid)'),
    ('public.admin_refund_payment(uuid,text)'),
    ('public.admin_cancel_subscription(uuid,text)'),
    ('public.admin_extend_subscription(uuid,integer,text)')
  ) AS f(fn_sig)
) AS checks
ORDER BY sort_order, object_type, object_name;


-- ============================================================================
-- QUERY 2: Column Additions, Constraints, Indexes, Triggers & FK Nullability
-- (Covers: 005 index, 008 nullable user_id FKs, 010 cafes.menu, 014 index,
--  018 verification columns, 019 sync CHECK constraint, 021 subscriptions.payment_id)
-- ============================================================================
SELECT
  check_category,
  target_name,
  present,
  details
FROM (
  -- Expected added columns (010, 018, 021)
  SELECT
    1 AS sort_order,
    'column' AS check_category,
    c.tbl || '.' || c.col AS target_name,
    EXISTS (
      SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public' AND ic.table_name = c.tbl AND ic.column_name = c.col
    ) AS present,
    COALESCE(
      (SELECT ic.data_type || ' | nullable=' || ic.is_nullable || COALESCE(' | default=' || ic.column_default, '')
       FROM information_schema.columns ic
       WHERE ic.table_schema = 'public' AND ic.table_name = c.tbl AND ic.column_name = c.col),
      'ABSENT'
    ) AS details
  FROM (VALUES
    ('cafes', 'menu'),
    ('profiles', 'verification_status'),
    ('profiles', 'verification_reviewed_at'),
    ('profiles', 'verification_reviewed_by'),
    ('profiles', 'verification_note'),
    ('subscriptions', 'payment_id'),
    ('payments', 'user_id'),
    ('subscriptions', 'user_id')
  ) AS c(tbl, col)

  UNION ALL
  -- Foreign key ON DELETE behavior for payments & subscriptions (008 check)
  SELECT
    2,
    'fk_delete_rule',
    con.conname,
    true,
    pg_get_constraintdef(con.oid)
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND rel.relname IN ('payments', 'subscriptions', 'date_applications')
    AND con.contype = 'f'

  UNION ALL
  -- Key CHECK constraints (018, 019)
  SELECT
    3,
    'check_constraint',
    chk.name,
    EXISTS (
      SELECT 1 FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'public' AND rel.relname = 'profiles' AND con.conname = chk.name
    ),
    COALESCE(
      (SELECT pg_get_constraintdef(con.oid)
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
       WHERE nsp.nspname = 'public' AND rel.relname = 'profiles' AND con.conname = chk.name),
      'ABSENT'
    )
  FROM (VALUES
    ('chk_profiles_verification_status'),
    ('chk_profiles_verified_status_sync')
  ) AS chk(name)

  UNION ALL
  -- Key indexes (005, 014, 018, 021)
  SELECT
    4,
    'index',
    idx.name,
    EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = idx.name),
    COALESCE(
      (SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = idx.name),
      'ABSENT'
    )
  FROM (VALUES
    ('payments_one_pending_per_user_plan'),
    ('idx_match_proposals_unique_pending_pair'),
    ('idx_profiles_verification_status'),
    ('idx_subscriptions_payment_id')
  ) AS idx(name)

  UNION ALL
  -- Triggers across core tables (002, 004, 006, 009, 011, 014, 018, 020, 023)
  SELECT
    5,
    'trigger',
    rel.relname || '.' || trg.tgname,
    true,
    pg_get_triggerdef(trg.oid)
  FROM pg_trigger trg
  JOIN pg_class rel ON rel.oid = trg.tgrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND NOT trg.tgisinternal
) AS rows
ORDER BY sort_order, check_category, target_name;


-- ============================================================================
-- QUERY 3: Inspect Live Definitions of Overwritten / Security-Sensitive Functions
-- (Detects exact version of protect_profile_fields, set_user_verified,
--  handle_mutual_like, set_report_status, admin_cancel_subscription,
--  redeem_membership_pass without crashing if absent)
-- ============================================================================
SELECT
  f.fn_sig,
  CASE WHEN p.oid IS NOT NULL THEN 'INSTALLED' ELSE 'ABSENT' END AS status,
  p.prosecdef AS is_security_definer,
  p.proconfig AS function_config,
  CASE WHEN p.oid IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE NULL END AS live_definition
FROM (VALUES
  ('public.protect_profile_fields()'),
  ('public.set_user_verified(uuid,boolean,text)'),
  ('public.handle_mutual_like()'),
  ('public.set_report_status(uuid,text)'),
  ('public.check_report_status_audit_guard()'),
  ('public.admin_cancel_subscription(uuid,text)'),
  ('public.admin_extend_subscription(uuid,integer,text)'),
  ('public.redeem_membership_pass(text)'),
  ('public.respond_to_proposal(uuid,boolean)')
) AS f(fn_sig)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.fn_sig)
ORDER BY f.fn_sig;


-- ============================================================================
-- QUERY 4: Data Consistency Check on public.profiles & public.payments
-- (Safe even if migration 018 verification_status column does NOT exist yet!)
-- ============================================================================
SELECT
  count(*) AS total_profiles,
  count(*) FILTER (WHERE is_admin = true) AS admin_profiles,
  count(*) FILTER (WHERE verified = true) AS verified_true_profiles,
  count(*) FILTER (WHERE verified = false) AS verified_false_profiles,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'verification_status'
  ) AS has_verification_status_column,
  count(*) FILTER (
    WHERE verified = true
      AND coalesce(to_jsonb(p)->>'verification_status', 'MISSING_COL') <> 'verified'
  ) AS verified_true_vs_status_mismatch_or_missing_col,
  count(*) FILTER (
    WHERE verified = false
      AND to_jsonb(p) ? 'verification_status'
      AND coalesce(to_jsonb(p)->>'verification_status', '') NOT IN ('pending', 'declined')
  ) AS verified_false_vs_status_invalid_rows
FROM public.profiles p;


-- ============================================================================
-- QUERY 5: Partner Cafés, Experiences Seed Check (026 SKIP & 027 READINESS)
-- ============================================================================
SELECT 'cafe_row' AS check_type, id, name AS label, city, experiences::text AS extra
FROM public.cafes
WHERE id IN ('c-hot-stag-del', 'c-karmala-del', 'c-yumm-club-del')
UNION ALL
SELECT 'target_experience_row', id, title, city, kind || ' | ₹' || price_from::text
FROM public.experiences
WHERE id IN (
  'e-hotstag-premium-date',
  'e-hotstag-coffee-date',
  'e-hotstag-italian',
  'e-karmala-karaoke'
)
UNION ALL
SELECT 'orphan_date_applications', a.id::text, a.experience_id, a.status, 'missing parent experience'
FROM public.date_applications a
LEFT JOIN public.experiences e ON e.id = a.experience_id
WHERE e.id IS NULL
ORDER BY check_type, id;


-- ============================================================================
-- QUERY 6: RLS Policies, Role Grants, Execute Grants & Realtime Publication
-- (Checks whether 023/025 revocations and realtime_setup.sql are active)
-- ============================================================================
SELECT 'rls_policy' AS item_type, tablename AS target_table, policyname AS name, cmd || ' | roles=' || array_to_string(roles, ',') AS detail
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'reports', 'payments', 'subscriptions', 'cafes', 'experiences', 'date_applications', 'complimentary_passes', 'match_proposals', 'membership_passes')
UNION ALL
SELECT 'table_privilege', table_name, grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type)
FROM information_schema.table_privileges
WHERE table_schema = 'public'
  AND table_name IN ('reports', 'payments', 'subscriptions', 'profiles', 'cafes', 'experiences')
  AND grantee IN ('anon', 'authenticated', 'PUBLIC')
GROUP BY table_name, grantee
UNION ALL
SELECT 'realtime_table', tablename, 'supabase_realtime', 'INCLUDED'
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY item_type, target_table, name;
