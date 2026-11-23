-- ============================================================================
-- DATEVRA Migration 034: READ-ONLY Verification Script for Migrations 030–033
--
-- Pure SELECT inspection queries ONLY. Modifies zero rows, zero tables, zero
-- settings. Run after applying Migrations 030, 031, 032, and 033 in order.
-- ============================================================================

-- 1. Verify all expected new tables exist
SELECT table_schema, table_name
FROM information_schema.tables
WHERE (table_schema = 'public' AND table_name IN (
  'auto_date_offer_batches',
  'automatic_date_offers',
  'manual_date_offers',
  'date_offer_events',
  'date_invitations',
  'date_invitation_recipients',
  'profile_city_history',
  'voucher_settings',
  'user_vouchers',
  'voucher_audit_logs',
  'payment_webhook_events'
))
   OR (table_schema = 'datevra_internal' AND table_name = 'voucher_otp_challenges')
ORDER BY table_schema, table_name;

-- 2. Verify all expected new columns on existing tables
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND (
    (table_name = 'membership_passes' AND column_name IN ('revoked_at', 'revocation_reason'))
    OR (table_name = 'payments' AND column_name IN ('verified_at', 'celebration_shown_at'))
    OR (table_name = 'profiles' AND column_name = 'registered_city')
  )
ORDER BY table_name, column_name;

-- 3. Verify Row Level Security (RLS) is ENABLED on all new public tables
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'auto_date_offer_batches',
    'automatic_date_offers',
    'manual_date_offers',
    'date_offer_events',
    'date_invitations',
    'date_invitation_recipients',
    'profile_city_history',
    'voucher_settings',
    'user_vouchers',
    'voucher_audit_logs',
    'payment_webhook_events'
  )
ORDER BY tablename;

-- 4. Verify RLS policies (especially private date_invitation_recipients & user_vouchers)
SELECT tablename, policyname, cmd, roles, qual
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'auto_date_offer_batches',
    'automatic_date_offers',
    'manual_date_offers',
    'date_offer_events',
    'date_invitations',
    'date_invitation_recipients',
    'profile_city_history',
    'voucher_settings',
    'user_vouchers',
    'voucher_audit_logs',
    'payment_webhook_events'
  )
ORDER BY tablename, policyname;

-- 5. Verify unique & partial unique indexes preventing duplicates
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN (
    'idx_auto_date_offers_unique_batch_pair',
    'idx_auto_date_offers_active_pair',
    'idx_manual_date_offers_active_pair_date',
    'idx_user_vouchers_unique_otp',
    'idx_subscriptions_unique_payment_id'
  )
ORDER BY tablename, indexname;

-- 6. Verify all new RPC functions exist with SECURITY DEFINER and zero anon execute grants
SELECT
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  p.prosecdef AS is_security_definer,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'evaluate_initial_auto_date_offers',
    'admin_evaluate_initial_auto_date_offers',
    'get_auto_date_offer_summary',
    'respond_to_automatic_date_offer',
    'admin_create_manual_date_offer',
    'admin_cancel_manual_date_offer',
    'respond_to_manual_date_offer',
    'admin_create_date_invitation',
    'admin_cancel_date_invitation',
    'respond_to_date_invitation',
    'revoke_membership_pass',
    'acknowledge_membership_celebration',
    'admin_update_voucher_settings',
    'admin_revoke_voucher',
    'admin_list_voucher_otp_status',
    'service_issue_verified_outside_delhi_voucher',
    'redeem_outside_delhi_voucher',
    'service_activate_verified_payment',
    'service_reconcile_refunded_payment',
    'admin_verify_payment'
  )
ORDER BY p.proname;

-- 7. Verify voucher_settings defaults safely to disabled with NULL value (no invented monetary value)
SELECT id, enabled, voucher_value_inr, max_claims_per_user, expiry_days, excluded_cities
FROM public.voucher_settings
WHERE id = 1;

-- 8. Verify triggers exist
SELECT event_object_table, trigger_name, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND trigger_name IN (
    'trg_matches_auto_date_offer_threshold',
    'trg_profiles_audit_city'
  )
ORDER BY event_object_table, trigger_name;

-- 9. Verify zero direct authenticated/anon privileges on private OTP challenges table
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'datevra_internal'
  AND table_name = 'voucher_otp_challenges'
  AND grantee IN ('PUBLIC', 'anon', 'authenticated');
