-- ============================================================================
-- DATEVRA — STRICTLY READ-ONLY LIVE DATABASE PREFLIGHT (GATE 1)
-- Target Project Ref: buendstsgzdcmzaodurp
--
-- READ-ONLY GUARANTEE:
--   - Contains ZERO DDL (CREATE/ALTER/DROP), ZERO DML (INSERT/UPDATE/DELETE),
--     ZERO GRANT/REVOKE, ZERO FOR UPDATE locks, ZERO side-effect RPC calls,
--     and ZERO write transactions.
--   - Returns structural metadata and AGGREGATE COUNTS ONLY.
--   - NEVER selects or outputs personal user records, email addresses,
--     user UUIDs, or individual payment/Razorpay IDs.
--   - Each section is catalog-guarded so missing tables/columns/functions
--     never abort downstream checks.
--
-- HOW TO RUN (BEGINNER OPERATOR):
--   Run each labeled section ONE AT A TIME in Supabase Dashboard -> SQL Editor,
--   or run the full script if your SQL Editor view displays multi-result tabs.
--   Compare every output against:
--     datevra_migration_repair_package/00_PREFLIGHT_EXPECTED_RESULTS.md
-- ============================================================================


-- ============================================================================
-- SECTION 1 [READ-ONLY]: Exact Table Columns, Types, Nullability & Defaults
-- Checks core and migration tables in public and datevra_internal.
-- ============================================================================
SELECT
  t.table_schema,
  t.table_name,
  CASE WHEN c.column_name IS NOT NULL THEN 'EXISTS' ELSE 'TABLE_ABSENT' END AS table_status,
  c.ordinal_position,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM (
  VALUES
    ('public', 'profiles'),
    ('public', 'subscriptions'),
    ('public', 'payments'),
    ('public', 'reports'),
    ('public', 'cafes'),
    ('public', 'experiences'),
    ('public', 'matches'),
    ('public', 'conversations'),
    ('public', 'notifications'),
    ('public', 'date_applications'),
    ('public', 'membership_plans'),
    ('public', 'daily_action_limits'),
    ('public', 'complimentary_passes'),
    ('public', 'match_proposals'),
    ('public', 'membership_passes'),
    ('datevra_internal', 'plan_update_intents'),
    ('datevra_internal', 'pass_redemption_attempts')
) AS t(table_schema, table_name)
LEFT JOIN information_schema.columns c
  ON c.table_schema = t.table_schema
 AND c.table_name = t.table_name
ORDER BY
  t.table_schema,
  t.table_name,
  c.ordinal_position NULLS LAST;


-- ============================================================================
-- SECTION 2 [READ-ONLY]: Constraints, Foreign Keys (ON DELETE) & Key Indexes
-- Verifies 005 index, 008 nullable user_id FKs, 014/018/019/021 constraints.
-- ============================================================================
SELECT
  item_kind,
  table_name,
  object_name,
  status,
  definition
FROM (
  -- Foreign key constraints and ON DELETE rules
  SELECT
    1 AS sort_order,
    'foreign_key' AS item_kind,
    rel.relname AS table_name,
    con.conname AS object_name,
    CASE con.confdeltype
      WHEN 'a' THEN 'NO ACTION'
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE con.confdeltype::text
    END AS status,
    pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND con.contype = 'f'
    AND rel.relname IN (
      'payments', 'subscriptions', 'date_applications',
      'complimentary_passes', 'match_proposals', 'membership_passes', 'profiles'
    )

  UNION ALL

  -- CHECK & UNIQUE constraints on key tables
  SELECT
    2 AS sort_order,
    CASE con.contype WHEN 'c' THEN 'check_constraint' ELSE 'unique_constraint' END AS item_kind,
    rel.relname AS table_name,
    con.conname AS object_name,
    CASE WHEN con.convalidated THEN 'VALIDATED' ELSE 'NOT_VALIDATED' END AS status,
    pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN pg_class rel ON rel.oid = con.conrelid
  JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
  WHERE nsp.nspname = 'public'
    AND con.contype IN ('c', 'u')
    AND rel.relname IN (
      'profiles', 'subscriptions', 'payments', 'reports',
      'matches', 'conversations', 'match_proposals', 'membership_passes'
    )

  UNION ALL

  -- Expected indexes across 005, 010, 011, 014, 018, 021
  SELECT
    3 AS sort_order,
    'index' AS item_kind,
    idx_list.tbl_name AS table_name,
    idx_list.idx_name AS object_name,
    CASE WHEN pi.indexname IS NOT NULL THEN 'PRESENT' ELSE 'ABSENT' END AS status,
    COALESCE(pi.indexdef, 'ABSENT') AS definition
  FROM (
    VALUES
      ('payments', 'payments_one_pending_per_user_plan'),
      ('match_proposals', 'idx_match_proposals_unique_pending_pair'),
      ('profiles', 'idx_profiles_verification_status'),
      ('subscriptions', 'idx_subscriptions_payment_id'),
      ('membership_passes', 'idx_membership_passes_code'),
      ('complimentary_passes', 'idx_complimentary_passes_code')
  ) AS idx_list(tbl_name, idx_name)
  LEFT JOIN pg_indexes pi
    ON pi.schemaname = 'public'
   AND pi.indexname = idx_list.idx_name
) AS sub
ORDER BY sort_order, table_name, object_name;


-- ============================================================================
-- SECTION 3 [READ-ONLY]: Migration Tracking Metadata Inspection
-- Checks whether supabase_migrations or any custom tracker table exists.
-- ============================================================================
SELECT
  tracker_name,
  present,
  details
FROM (
  SELECT
    'supabase_migrations.schema_migrations' AS tracker_name,
    to_regclass('supabase_migrations.schema_migrations') IS NOT NULL AS present,
    CASE
      WHEN to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
        (xpath('/row/cnt/text()', query_to_xml(
          'SELECT count(*) AS cnt FROM supabase_migrations.schema_migrations',
          false, true, ''
        )))[1]::text || ' recorded rows (internal Supabase CLI tracker — not Datevra SQL Editor runs)'
      ELSE 'ABSENT'
    END AS details

  UNION ALL

  SELECT
    'datevra_custom_migration_tables' AS tracker_name,
    EXISTS (
      SELECT 1 FROM pg_tables
      WHERE schemaname IN ('public', 'datevra_internal')
        AND tablename ILIKE '%migration%'
    ) AS present,
    COALESCE(
      (SELECT string_agg(schemaname || '.' || tablename, ', ' ORDER BY schemaname, tablename)
       FROM pg_tables
       WHERE schemaname IN ('public', 'datevra_internal')
         AND tablename ILIKE '%migration%'),
      'ABSENT'
    ) AS details
) AS trackers;


-- ============================================================================
-- SECTION 4 [READ-ONLY]: Functions, Security Mode, Owner, search_path & ACLs
-- Inspects all functions from 001 through 025 without executing them.
-- ============================================================================
SELECT
  f.fn_sig,
  p.oid IS NOT NULL AS present,
  CASE
    WHEN p.oid IS NULL THEN 'ABSENT'
    WHEN p.prosecdef THEN 'SECURITY DEFINER'
    ELSE 'SECURITY INVOKER'
  END AS security_mode,
  COALESCE(r.rolname, 'N/A') AS owner_role,
  COALESCE(array_to_string(p.proconfig, '; '), 'NO_PROCONFIG_SET') AS function_config,
  COALESCE(array_to_string(p.proacl::text[], '; '), 'DEFAULT_PUBLIC_ACL') AS acl_grants
FROM (
  VALUES
    ('public.is_admin()'),
    ('public.set_updated_at()'),
    ('public.order_match_pair()'),
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
    ('public._ist_today()'),
    ('public._next_ist_midnight()'),
    ('public._consume_daily_action(uuid,text)'),
    ('public.enforce_like_limit()'),
    ('public.record_profile_interest(uuid)'),
    ('public.get_daily_usage()'),
    ('public.redeem_pass(text)'),
    ('public.respond_to_proposal(uuid,boolean)'),
    ('public.check_proposal_not_blocked()'),
    ('public.check_match_proposal_integrity()'),
    ('public.lock_matchmaking_pair(uuid,uuid)'),
    ('datevra_internal.generate_secure_pass_code()'),
    ('public.create_membership_pass(text,integer,timestamptz,uuid,text)'),
    ('public.revoke_membership_pass(uuid,text)'),
    ('public.redeem_membership_pass(text)'),
    ('public.set_user_verified(uuid,boolean,text)'),
    ('public.set_report_status(uuid,text)'),
    ('public.check_report_status_audit_guard()'),
    ('public.admin_verify_payment(uuid)'),
    ('public.admin_refund_payment(uuid,text)'),
    ('public.admin_cancel_subscription(uuid,text)'),
    ('public.admin_extend_subscription(uuid,integer,text)')
) AS f(fn_sig)
LEFT JOIN pg_proc p
  ON p.oid = to_regprocedure(f.fn_sig)
LEFT JOIN pg_roles r
  ON r.oid = p.proowner
ORDER BY f.fn_sig;


-- ============================================================================
-- SECTION 5 [READ-ONLY]: All Non-Internal Trigger Definitions (incl. UPDATE OF)
-- Confirms exact trigger firing columns (e.g., 5-col vs 9-col profiles trigger).
-- ============================================================================
SELECT
  rel.relname AS table_name,
  trg.tgname AS trigger_name,
  CASE trg.tgenabled
    WHEN 'O' THEN 'ENABLED'
    WHEN 'D' THEN 'DISABLED'
    WHEN 'R' THEN 'REPLICA'
    WHEN 'A' THEN 'ALWAYS'
    ELSE trg.tgenabled::text
  END AS trigger_state,
  pg_get_triggerdef(trg.oid) AS trigger_definition
FROM pg_trigger trg
JOIN pg_class rel ON rel.oid = trg.tgrelid
JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
WHERE nsp.nspname = 'public'
  AND NOT trg.tgisinternal
ORDER BY rel.relname, trg.tgname;


-- ============================================================================
-- SECTION 6 [READ-ONLY]: RLS Enabled/Forced Status & All Active Policies
-- ============================================================================
SELECT
  'rls_table_status' AS check_type,
  c.relname AS table_name,
  CASE WHEN c.relrowsecurity THEN 'RLS_ENABLED' ELSE 'RLS_DISABLED' END AS detail_1,
  CASE WHEN c.relforcerowsecurity THEN 'FORCED' ELSE 'NOT_FORCED' END AS detail_2,
  '' AS detail_3
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'

UNION ALL

SELECT
  'rls_policy' AS check_type,
  p.tablename AS table_name,
  p.policyname || ' [' || p.cmd || ']' AS detail_1,
  'roles=' || array_to_string(p.roles, ',') AS detail_2,
  COALESCE('USING: ' || p.qual, '') || COALESCE(' | WITH CHECK: ' || p.with_check, '') AS detail_3
FROM pg_policies p
WHERE p.schemaname = 'public'
ORDER BY check_type, table_name, detail_1;


-- ============================================================================
-- SECTION 7 [READ-ONLY]: Table-Level & Column-Level Privileges
-- Checks anon, authenticated, and PUBLIC privileges on sensitive tables.
-- ============================================================================
SELECT
  'table_privilege' AS grant_scope,
  tp.table_name,
  '(ALL_TABLE_COLUMNS)' AS column_name,
  tp.grantee,
  string_agg(tp.privilege_type, ', ' ORDER BY tp.privilege_type) AS privileges
FROM information_schema.table_privileges tp
WHERE tp.table_schema = 'public'
  AND tp.table_name IN (
    'reports', 'payments', 'subscriptions', 'profiles',
    'membership_passes', 'complimentary_passes', 'match_proposals',
    'cafes', 'experiences', 'activity_logs'
  )
  AND tp.grantee IN ('PUBLIC', 'anon', 'authenticated')
GROUP BY tp.table_name, tp.grantee

UNION ALL

SELECT
  'column_privilege' AS grant_scope,
  cp.table_name,
  cp.column_name,
  cp.grantee,
  string_agg(cp.privilege_type, ', ' ORDER BY cp.privilege_type) AS privileges
FROM information_schema.column_privileges cp
WHERE cp.table_schema = 'public'
  AND cp.table_name IN ('reports', 'payments', 'subscriptions', 'profiles', 'membership_passes')
  AND cp.grantee IN ('PUBLIC', 'anon', 'authenticated')
GROUP BY cp.table_name, cp.column_name, cp.grantee
ORDER BY grant_scope, table_name, grantee, column_name;


-- ============================================================================
-- SECTION 8 [READ-ONLY]: Inspect Pass Generator & Key Security Function Bodies
-- Checks whether generate_secure_pass_code (% 31 vs % 32), protect_profile_fields,
-- handle_mutual_like, or redeem_membership_pass exist and shows their exact SQL.
-- ============================================================================
SELECT
  f.fn_sig,
  p.oid IS NOT NULL AS present,
  CASE WHEN p.oid IS NOT NULL THEN pg_get_functiondef(p.oid) ELSE 'ABSENT' END AS live_sql_definition
FROM (
  VALUES
    ('datevra_internal.generate_secure_pass_code()'),
    ('public.protect_profile_fields()'),
    ('public.handle_mutual_like()'),
    ('public.respond_to_proposal(uuid,boolean)'),
    ('public.redeem_membership_pass(text)'),
    ('public.set_user_verified(uuid,boolean,text)'),
    ('public.set_report_status(uuid,text)'),
    ('public.admin_verify_payment(uuid)'),
    ('public.admin_refund_payment(uuid,text)'),
    ('public.admin_cancel_subscription(uuid,text)'),
    ('public.admin_extend_subscription(uuid,integer,text)')
) AS f(fn_sig)
LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.fn_sig)
ORDER BY f.fn_sig;


-- ============================================================================
-- SECTION 9 [READ-ONLY]: Aggregate-Only Operational & Financial Distributions
-- Zero PII: outputs ONLY grouped counts and aggregate INR totals.
-- ============================================================================
-- 9A. Payments aggregate distribution (no user IDs, emails, or gateway IDs)
SELECT
  kind,
  status,
  CASE
    WHEN method IS NULL THEN 'null'
    WHEN method ILIKE 'cash%' THEN 'cash_prefix'
    ELSE method
  END AS method_group,
  (razorpay_order_id IS NOT NULL AND btrim(razorpay_order_id) <> '') AS has_order_id,
  (razorpay_order_id LIKE 'order_pending_%') AS is_pending_placeholder_order,
  (razorpay_payment_id IS NOT NULL AND btrim(razorpay_payment_id) <> '') AS has_gateway_payment_id,
  count(*) AS row_count,
  COALESCE(sum(amount), 0) AS total_inr
FROM public.payments
GROUP BY 1, 2, 3, 4, 5, 6
ORDER BY 1, 2, 3;

-- 9B. Subscriptions aggregate distribution (catalog-safe for optional payment_id)
SELECT
  plan_id,
  status,
  (expires_at IS NULL) AS is_lifetime,
  count(*) AS row_count,
  count(*) FILTER (WHERE to_jsonb(s) ? 'payment_id' AND NULLIF(to_jsonb(s)->>'payment_id', '') IS NOT NULL) AS linked_payment_count
FROM public.subscriptions s
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

-- 9C. Profiles plan & verification consistency aggregates
SELECT
  COALESCE(plan_id, 'free_null') AS plan_id,
  is_admin,
  verified,
  CASE
    WHEN to_jsonb(p) ? 'verification_status' THEN COALESCE(to_jsonb(p)->>'verification_status', 'NULL')
    ELSE 'COL_ABSENT'
  END AS verification_status_state,
  count(*) AS profile_count
FROM public.profiles p
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 3, 4;

-- 9D. Reports aggregate distribution
SELECT
  status,
  count(*) AS report_count
FROM public.reports
GROUP BY status
ORDER BY status;


-- ============================================================================
-- SECTION 10 [READ-ONLY]: Structural & Relational Consistency Checks (Counts Only)
-- Uses catalog guards so absent optional tables never raise runtime errors.
-- ============================================================================
SELECT
  check_name,
  issue_count,
  status
FROM (
  -- 10.1 Duplicate unordered pairs in public.matches
  SELECT
    'duplicate_unordered_matches' AS check_name,
    (
      SELECT count(*) FROM (
        SELECT LEAST(user_a, user_b), GREATEST(user_a, user_b)
        FROM public.matches
        GROUP BY 1, 2
        HAVING count(*) > 1
      ) m
    )::bigint AS issue_count,
    'EXPECTED_0' AS status

  UNION ALL

  -- 10.2 Active subscriptions referencing non-existent or non-verified payments (if payment_id col exists)
  SELECT
    'subscriptions_missing_or_unverified_payment_link' AS check_name,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'subscriptions' AND column_name = 'payment_id'
      ) THEN (
        xpath('/row/cnt/text()', query_to_xml(
          'SELECT count(*) AS cnt FROM public.subscriptions s LEFT JOIN public.payments p ON p.id = s.payment_id WHERE s.payment_id IS NOT NULL AND (p.id IS NULL OR p.status <> ''verified'')',
          false, true, ''
        ))
      )[1]::text::bigint
      ELSE 0::bigint
    END AS issue_count,
    'EXPECTED_0_OR_COL_ABSENT' AS status

  UNION ALL

  -- 10.3 Profiles with verified/verification_status inconsistency (safe if col missing)
  SELECT
    'profiles_verification_sync_mismatch' AS check_name,
    (
      SELECT count(*)
      FROM public.profiles p
      WHERE to_jsonb(p) ? 'verification_status'
        AND NOT (
          (p.verified = true AND to_jsonb(p)->>'verification_status' = 'verified')
          OR
          (p.verified = false AND COALESCE(to_jsonb(p)->>'verification_status', '') IN ('pending', 'declined'))
        )
    )::bigint AS issue_count,
    'EXPECTED_0_BEFORE_019' AS status

  UNION ALL

  -- 10.4 Duplicate pending proposals (guarded on table + required columns)
  SELECT
    'match_proposals_duplicate_pending_pairs' AS check_name,
    CASE
      WHEN to_regclass('public.match_proposals') IS NOT NULL
        AND (
          SELECT count(DISTINCT c.column_name)
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'match_proposals'
            AND c.column_name IN ('user_a_id', 'user_b_id', 'status')
        ) = 3
      THEN (
        xpath('/row/cnt/text()', query_to_xml(
          'SELECT count(*) AS cnt FROM (SELECT LEAST(user_a_id, user_b_id), GREATEST(user_a_id, user_b_id) FROM public.match_proposals WHERE status = ''pending'' GROUP BY 1, 2 HAVING count(*) > 1) d',
          false, true, ''
        ))
      )[1]::text::bigint
      ELSE NULL::bigint
    END AS issue_count,
    CASE
      WHEN to_regclass('public.match_proposals') IS NULL THEN 'TABLE_ABSENT'
      WHEN (
        SELECT count(DISTINCT c.column_name)
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = 'match_proposals'
          AND c.column_name IN ('user_a_id', 'user_b_id', 'status')
      ) < 3 THEN 'REQUIRED_COLUMNS_ABSENT'
      ELSE 'EXPECTED_0'
    END AS status

  UNION ALL

  -- 10.5 Pending proposals between already-matched members (guarded on tables + required columns)
  SELECT
    'match_proposals_pending_for_existing_matches' AS check_name,
    CASE
      WHEN to_regclass('public.match_proposals') IS NOT NULL
        AND to_regclass('public.matches') IS NOT NULL
        AND (
          SELECT count(DISTINCT c.column_name)
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'match_proposals'
            AND c.column_name IN ('user_a_id', 'user_b_id', 'status')
        ) = 3
        AND (
          SELECT count(DISTINCT c.column_name)
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'matches'
            AND c.column_name IN ('user_a', 'user_b')
        ) = 2
      THEN (
        xpath('/row/cnt/text()', query_to_xml(
          'SELECT count(*) AS cnt FROM public.match_proposals mp JOIN public.matches m ON m.user_a = LEAST(mp.user_a_id, mp.user_b_id) AND m.user_b = GREATEST(mp.user_a_id, mp.user_b_id) WHERE mp.status = ''pending''',
          false, true, ''
        ))
      )[1]::text::bigint
      ELSE NULL::bigint
    END AS issue_count,
    CASE
      WHEN to_regclass('public.match_proposals') IS NULL OR to_regclass('public.matches') IS NULL THEN 'TABLE_ABSENT'
      WHEN (
        SELECT count(DISTINCT c.column_name)
        FROM information_schema.columns c
        WHERE c.table_schema = 'public'
          AND c.table_name = 'match_proposals'
          AND c.column_name IN ('user_a_id', 'user_b_id', 'status')
      ) < 3
        OR (
          SELECT count(DISTINCT c.column_name)
          FROM information_schema.columns c
          WHERE c.table_schema = 'public'
            AND c.table_name = 'matches'
            AND c.column_name IN ('user_a', 'user_b')
        ) < 2
      THEN 'REQUIRED_COLUMNS_ABSENT'
      ELSE 'EXPECTED_0'
    END AS status

  UNION ALL

  -- 10.6 Orphan date_applications missing parent experience
  SELECT
    'orphan_date_applications_missing_experience' AS check_name,
    (
      SELECT count(*)
      FROM public.date_applications a
      LEFT JOIN public.experiences e ON e.id = a.experience_id
      WHERE e.id IS NULL
    )::bigint AS issue_count,
    'EXPECTED_0' AS status
) AS checks
ORDER BY check_name;


-- ============================================================================
-- SECTION 11 [READ-ONLY]: Partner Cafés, Target Experiences & Plan Catalog
-- Confirms 026 presence, exact café names/partner flags, and 027 collision safety.
-- ============================================================================
SELECT
  'cafe' AS record_type,
  c.id,
  c.name AS title_or_name,
  c.city,
  'partner=' || c.partner::text || ' | experiences=' || COALESCE(c.experiences::text, 'NULL') AS metadata
FROM public.cafes c
WHERE c.id IN (
  'c-hot-stag-del', 'c-karmala-del', 'c-yumm-club-del',
  'c-roastery-mum', 'c-lodhi-del', 'c-thirdwave-blr',
  'c-suzette-pune', 'c-tapri-jpr', 'c-aerocity-hyd'
)

UNION ALL

SELECT
  'target_experience' AS record_type,
  e.id,
  e.title AS title_or_name,
  e.city,
  'kind=' || e.kind || ' | price_from=' || e.price_from::text ||
  ' | duration_mins=' || e.duration_mins::text || ' | elite_only=' || e.elite_only::text ||
  ' | image=' || e.image AS metadata
FROM public.experiences e
WHERE e.id IN (
  'e-hotstag-premium-date',
  'e-hotstag-coffee-date',
  'e-hotstag-italian',
  'e-karmala-karaoke'
)

UNION ALL

SELECT
  'membership_plan' AS record_type,
  mp.id,
  mp.name AS title_or_name,
  'priority=' || mp.priority::text AS city,
  'price_inr=' || mp.price::text AS metadata
FROM public.membership_plans mp
ORDER BY record_type, id;


-- ============================================================================
-- SECTION 12 [READ-ONLY]: Extensions, Realtime Publication & Storage Buckets
-- ============================================================================
SELECT
  'extension' AS resource_type,
  e.extname AS name,
  n.nspname AS schema_or_scope,
  'version=' || e.extversion AS details
FROM pg_extension e
JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname IN ('pgcrypto', 'uuid-ossp', 'pg_stat_statements')

UNION ALL

SELECT
  'realtime_publication_table' AS resource_type,
  t.tbl_name AS name,
  'supabase_realtime' AS schema_or_scope,
  CASE WHEN pt.tablename IS NOT NULL THEN 'INCLUDED' ELSE 'NOT_INCLUDED' END AS details
FROM (
  VALUES
    ('messages'),
    ('notifications'),
    ('matches'),
    ('likes'),
    ('conversations'),
    ('date_applications'),
    ('date_bookings'),
    ('profiles')
) AS t(tbl_name)
LEFT JOIN pg_publication_tables pt
  ON pt.pubname = 'supabase_realtime'
 AND pt.schemaname = 'public'
 AND pt.tablename = t.tbl_name

UNION ALL

SELECT
  'storage_bucket' AS resource_type,
  b.id AS name,
  'storage.buckets' AS schema_or_scope,
  'public=' || b.public::text AS details
FROM storage.buckets b
ORDER BY resource_type, name;
