# DATEVRA — Beginner One-Step-at-a-Time Operator Checklist

- **Target Project Ref:** `buendstsgzdcmzaodurp`
- **Rule:** Check off **one box at a time in exact order**. Never paste two SQL files together. Never click Run on any `000_full_setup*.sql` or `bootstrap_first_admin`.

---

## Gate 0 — Source Integrity & Backup
- [ ] Confirmed this workspace (`datevra_migration_repair_package/` + `db/`) is authoritative (do not overwrite with `datevra-final-complete (1).zip`).
- [ ] Opened Supabase Dashboard → project **`buendstsgzdcmzaodurp`** → **Database → Backups**.
- [ ] Created/confirmed a fresh backup/restore point **before** any SQL writes. Timestamp recorded: `____________________`

## Gate 1 — Strictly Read-Only Preflight
- [ ] Opened `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql`.
- [ ] Ran Sections **1 through 12** (one section at a time) in Supabase **SQL Editor**.
- [ ] Pasted all 12 outputs (no secrets, no PII) to ChatGPT and compared against `datevra_migration_repair_package/00_PREFLIGHT_EXPECTED_RESULTS.md`.
- [ ] Verified: all 6 **Section 10** checks = `0`, `blocked_pair(uuid,uuid)` = present (**Section 4**), `pgcrypto` = present (**Section 12**), all tables = `RLS_ENABLED` (**Section 6**).
- [ ] Received ChatGPT sign-off to unlock **Gate 2**.

## Gate 2 — Schema Compatibility Repairs
- [ ] Ran ONLY `datevra_migration_repair_package/01_gate2_schema_compatibility_repairs.sql`.
- [ ] Saw clean `Success` / `COMMIT` (zero errors).
- [ ] Re-ran **Section 1 & Section 2** of `00_READ_ONLY_PREFLIGHT.sql` and confirmed `cafes.menu`, `subscriptions.auto_renew`, `created_at`, `updated_at`, `reports.updated_at`, `SET NULL` FKs, and `payments_one_pending_per_user_plan`.

## Gate 3 — Matchmaking Serialization & Complimentary Passes
- [ ] Ran ONLY `datevra_migration_repair_package/02_gate3_matchmaking_and_passes.sql`.
- [ ] Saw clean `Success` / `COMMIT`.
- [ ] Re-ran **Sections 1, 2, 4, 5, 6** of `00_READ_ONLY_PREFLIGHT.sql` and confirmed `complimentary_passes`, `match_proposals`, `idx_match_proposals_unique_pending_pair`, `lock_matchmaking_pair` revoked from `authenticated`, and `respond_to_proposal`/`handle_mutual_like` installed.
- [ ] Verified `/admin/passes` no longer shows the Migration `010` missing-table warning.

## Gate 4 — Membership Passes & Verification Integrity
- [ ] Ran ONLY `datevra_migration_repair_package/03_gate4_membership_passes_and_verification.sql`.
- [ ] Saw clean `Success` / `COMMIT`.
- [ ] Re-ran **Sections 1, 2, 4, 5, 6, 8** of `00_READ_ONLY_PREFLIGHT.sql` and confirmed:
  - `membership_passes` and `datevra_internal.*` exist.
  - **Section 5** `trg_protect_profile_fields` covers **all 9 columns**.
  - **Section 8** `generate_secure_pass_code()` uses `IF v_byte < 248 THEN` and `(v_byte % 31) + 1`.
- [ ] Verified `/admin/membership-passes` and `/admin/verification` no longer show Migration `011` / `019` warnings.

## Gate 5A — Atomic Payment & Subscription Lifecycle Repairs
- [ ] Ran ONLY `datevra_migration_repair_package/04_gate5_payments_and_subscription_lifecycle.sql`.
- [ ] Saw clean `Success` / `COMMIT`.
- [ ] Re-ran **Sections 1, 2, 4, 8** of `00_READ_ONLY_PREFLIGHT.sql` and confirmed `subscriptions.payment_id`, non-unique `idx_subscriptions_payment_id`, and all 4 payment/subscription admin RPCs + updated `redeem_membership_pass`.
- [ ] Did **NOT** touch or verify the pending ₹1,199 payment row.

## Gate 5B — Live Razorpay Edge Functions (`BLOCKED`)
- [ ] **SKIPPED / DO NOT DEPLOY YET:** `verify-payment`, `razorpay-webhook`, and `_shared/supabase.ts` remain `BLOCKED` until a separate code+schema alignment task resolves `payments.verified_at` and `subscriptions.payment_id`.

## Gate 6 — Reports Audit & Final Privilege Hardening
- [ ] Ran ONLY `datevra_migration_repair_package/05_gate6_reports_and_final_hardening.sql`.
- [ ] Saw clean `Success` / `COMMIT`.
- [ ] Re-ran **Sections 4, 6, 7** of `00_READ_ONLY_PREFLIGHT.sql` and confirmed:
  - `set_report_status(uuid,text)` & `check_report_status_audit_guard()` present.
  - **Section 7** shows zero `UPDATE`/`DELETE` privileges for `anon`, `authenticated`, or `PUBLIC` on `reports`, `payments`, `subscriptions`.
  - **Section 6** shows `"payments_admin_insert"` exists and `"payments_admin_write"` / `"subscriptions_admin_write"` / `"reports_admin_update*"` are dropped.
  - **Section 4** shows `enforce_application_rules`, `freeze_match_participants`, `freeze_message_content` have fixed `search_path`.

## Gate 7 — Conditional Experiences Seed & Conditional Realtime
- [ ] Verified from Gate 1 **Section 11** that target `e-*` experiences are missing (or exact match) and partner Delhi cafés exist.
- [ ] **DID NOT RUN `db/migrations/026_seed_delhi_cafes.sql`** (skipped — cafés already present).
- [ ] Ran ONLY `datevra_migration_repair_package/06_gate7_seed_curated_experiences.sql` (if Section 11 showed missing seeds).
- [ ] Checked Gate 1 **Section 12**: if (and only if) any of the 8 core tables showed `NOT_INCLUDED`, ran `db/realtime_setup.sql`.

## Gate 8 — Final Read-Only Verification
- [ ] Re-ran the full `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` (Sections 1–12).
- [ ] Shared final preflight results with ChatGPT and verified clean staging/test-account flows (zero real payments, zero changes to the live ₹1,199 row).
