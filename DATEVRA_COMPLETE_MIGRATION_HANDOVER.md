# DATEVRA — Complete Database Migration Handover & Reconciliation Audit

**Audit Mode:** Strictly Read-Only Repository Inspection + Live-Evidence Reconciliation  
**Target Supabase Project Ref:** `buendstsgzdcmzaodurp` (`https://buendstsgzdcmzaodurp.supabase.co`)  
**Workspace Root:** `/app/applet` (Datevra React/Vite/TypeScript/Tailwind v4/Supabase codebase)  
**Deliverables Created:** `DATEVRA_COMPLETE_MIGRATION_HANDOVER.md` and `DATEVRA_MIGRATION_STATUS.csv`  
**Zero Mutations Performed:** Zero edits to app code, migrations, package SQL, Edge Functions, or configs; zero live DB connections or SQL executions.

---

## Section 1 — Project Context & Architecture

Datevra is a dating and curated date-experience web application supporting a dual-backend architecture:

1. **Frontend Application (`src/`):**
   - Built with **React 19.2.8**, **TypeScript ~6.0.2**, **Vite 8.3.0**, **React Router DOM 7.18.4**, **Tailwind CSS v4.3.3**, **Framer Motion 14.0.0**, and **Lucide React 1.68.0** (`package.json`).
   - Automatically selects backend adapter in `src/lib/data.ts`:
     - **Supabase Production Adapter (`src/lib/supabase/db.ts`, `src/lib/supabase/mappers.ts`, `src/lib/supabase/auth.ts`)** when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured (`@supabase/supabase-js ^2.117.2`).
     - **Local Demo Backend (`src/lib/mockDb.ts`)** when Supabase environment variables are absent.
   - Deployed hosting configuration references Vercel (`https://datevra.vercel.app`, `vercel.json`, `DATEVRA_PROJECT_MEMORY.md`).
2. **Database Backend (`db/`, Supabase PostgreSQL):**
   - Base schema in `db/schema.sql` defines **23 core tables** (`profiles` through `activity_logs`), `profiles_public` view, triggers (`trg_set_updated_at`, `trg_order_match_pair`, `trg_mutual_like`), helper functions (`is_admin()`, `set_updated_at()`, `handle_mutual_like()`), RLS policies on all 23 tables, storage buckets (`profile-photos`, `experience-media`, `cafe-media`), and initial seeds (6 cafés + 3 membership plans `connect`, `plus`, `elite`).
   - Incremental schema evolution resides in **`db/migrations/` (27 SQL files)** covering `002` through `027` plus `026_verify_seed_delhi_cafes.sql`. There is **no `db/migrations/001_*.sql`** (`db/schema.sql` serves as `001`).
   - A curated partial execution bundle resides in **`datevra_migration_package/` (7 SQL files: `01_` through `07_`)**, accompanied by prior workspace audit files (`README_FIRST.md`, `DATEVRA_MIGRATION_AUDIT.md`, `DATEVRA_MIGRATION_EXECUTION_PLAN.md`, `DATEVRA_MIGRATION_PREFLIGHT.sql`).
3. **Serverless Payment Functions (`supabase/functions/`):**
   - Three Deno Edge Functions (`create-order/index.ts`, `verify-payment/index.ts`, `razorpay-webhook/index.ts`) sharing `_shared/supabase.ts` and `_shared/crypto.ts`.
   - **Important Current Architecture Reality:** Historically documented as *test mode / not deployed* (`DATEVRA_MASTER_HANDOVER.md`, `DATEVRA_PROJECT_MEMORY.md`), while frontend checkout (`src/lib/supabase/db.ts:899–937`, `src/pages/user/Membership.tsx:83–122`) still uses client-inserted pending payments (`order_pending_...`) and calls the admin-restricted `admin_verify_payment` RPC in test flow rather than calling `create-order` / `verify-payment`. Furthermore, `verify-payment` and `razorpay-webhook` currently have schema bugs against `db/schema.sql` (detailed in Sections 5 & 7).

---

## Section 2 — Complete Exact Repository File Inventory & Filename Reconciliation

### 2.1 Filename Corrections vs External Prompts / Earlier Docs
1. **Prompt / Prior Miscount Correction #1 (`db/migrations/` count):** Earlier docs (`README_FIRST.md:11` and `DATEVRA_MIGRATION_AUDIT.md:39`) stated `26 files in db/migrations/`. The actual directory contains **27 files** (`002` through `027` plus `026_verify_seed_delhi_cafes.sql`).
2. **Base Schema Miscount Correction #2 (`db/schema.sql` table count):** `DATEVRA_MIGRATION_AUDIT.md:11,31` referred to "20 base tables" from `db/schema.sql`. Verified inspection of `db/schema.sql:557–579` confirms **`db/schema.sql` creates 23 base tables** (plus 1 view `profiles_public`), matching `FINAL_REPORT.md:11` ("23 base + `daily_action_limits` = 24 tables").
3. **Migration `001` Filename Clarification:** No `db/migrations/001_*.sql` file exists. `db/schema.sql` is the `001` baseline schema.
4. **Migration `021` Filename Clarification:** The file name `db/migrations/021_atomic_payment_verification_refund_reconciliation_and_entitlement_integrity.sql` **DOES NOT EXIST** in the repository. The actual file is **`db/migrations/021_atomic_payment_operations.sql`** (317 lines, whose SQL header comment states *"Phase 7.2 — Atomic Payment Verification, Refund Reconciliation & Entitlement Integrity"*).

### 2.2 Root Database Files (`db/` — 5 SQL Files)

| Exact Path | Lines | Role |
|---|---:|---|
| `db/schema.sql` | 1,039 | Base `001` schema: `pgcrypto`, `is_admin()`, `set_updated_at()`, 23 core tables, `profiles_public` view, triggers, RLS, storage buckets, 6 seed cafés, 3 plans |
| `db/realtime_setup.sql` | 49 | Adds 8 tables (`messages`, `notifications`, `matches`, `likes`, `conversations`, `date_applications`, `date_bookings`, `profiles`) to `supabase_realtime` |
| `db/000_full_setup.sql` | 1,917 | Legacy combined setup (`001`–`008` + `realtime_setup.sql`) |
| `db/000_full_setup_LATEST_2026-10-04.sql` | 1,946 | Legacy combined setup (`001`–`008` + `realtime_setup.sql`, Oct 4 snapshot) |
| `db/000_full_setup_LATEST_2026-10-04_v2.sql` | 2,224 | Latest combined setup (`001`–`009` + `realtime_setup.sql`; stops at `009`) |

### 2.3 Migration Files (`db/migrations/` — All 27 SQL Files)

| Exact Path | Lines | Exact Purpose |
|---|---:|---|
| `db/migrations/002_client_parity.sql` | 204 | Participant `matches` UPDATE/DELETE policies, interim `payments_admin_write`/`subscriptions_admin_write`, `payments_insert_own_pending`, `settings_public_read`, `applications_cancel_own`, notification triggers |
| `db/migrations/003_discovery_function.sql` | 126 | `discovery_profiles()` & `discovery_profile(uuid)` SECURITY DEFINER RPCs excluding email/expiry and blocked pairs |
| `db/migrations/004_security_hardening.sql` | 184 | `blocked_pair(uuid,uuid)`, block-aware `likes`/`messages` policies, initial 5-col `protect_profile_fields()` + trigger, `freeze_message_content()`, `enforce_application_rules()` |
| `db/migrations/005_account_deletion.sql` | 69 | `delete_own_account()` RPC + `payments_one_pending_per_user_plan` partial unique index |
| `db/migrations/006_match_integrity.sql` | 40 | `freeze_match_participants()` trigger preventing `user_a`/`user_b` swap on `matches` |
| `db/migrations/007_admin_bootstrap.sql` | 101 | `admin_exists()`, `bootstrap_first_admin(text)` (SQL Editor / service_role only) |
| `db/migrations/008_payment_retention.sql` | 37 | Makes `payments.user_id` & `subscriptions.user_id` nullable with `ON DELETE SET NULL` FKs |
| `db/migrations/009_daily_limits.sql` | 301 | Table `daily_action_limits`, `_has_active_membership`, `_ist_today`, `_next_ist_midnight`, `_consume_daily_action`, `enforce_like_limit`, `record_profile_interest`, `get_daily_usage`, `prune_daily_action_limits` |
| `db/migrations/010_passes_proposals.sql` | 287 | Adds `cafes.menu`, tables `complimentary_passes`, `match_proposals`, RLS, `redeem_pass(text)`, `respond_to_proposal(uuid,boolean)` |
| `db/migrations/011_membership_passes.sql` | 670 | Table `membership_passes`, private schema `datevra_internal` (`plan_update_intents`, `pass_redemption_attempts`), overwrites 5-col `protect_profile_fields()`, `generate_secure_pass_code()`, `create_membership_pass`, `revoke_membership_pass`, `redeem_membership_pass` |
| `db/migrations/012_proposal_block_protection.sql` | 152 | Draft block check trigger + `respond_to_proposal()` (**has exception-rollback bug; superseded by `014`–`016`**) |
| `db/migrations/013_proposal_block_decline_persistence.sql` | 141 | Fixes `012` rollback bug in `respond_to_proposal()` (**superseded by `015`–`016`**) |
| `db/migrations/014_match_proposal_integrity.sql` | 126 | Preflight check + unique index `idx_match_proposals_unique_pending_pair` + `check_match_proposal_integrity()` trigger |
| `db/migrations/015_matchmaking_pair_serialization.sql` | 312 | `lock_matchmaking_pair(uuid,uuid)`, serialized trigger & `respond_to_proposal()`, updates `handle_mutual_like()` to decline pending proposals |
| `db/migrations/016_matchmaking_lock_order_hardening.sql` | 217 | Revokes `lock_matchmaking_pair` from `authenticated` + fixes lock order in `respond_to_proposal()` |
| `db/migrations/017_atomic_report_status_audit.sql` | 89 | Initial `set_report_status(uuid,text)` RPC (**superseded by `023` + `025`**) |
| `db/migrations/018_verification_status_and_rpc.sql` | 269 | Adds 4 `verification_*` cols + `chk_profiles_verification_status` + backfill + 9-col `protect_profile_fields()` (uses `datevra_internal`) + `set_user_verified(uuid,boolean,text)` (**omits recreating `trg_protect_profile_fields`**) |
| `db/migrations/019_verification_defense_in_depth.sql` | 178 | Adds `chk_profiles_verified_status_sync` CHECK constraint + upgrades `set_user_verified()` to block self-verification |
| `db/migrations/020_enforce_audited_report_status.sql` | 61 | Adds `check_report_status_audit_guard()` + `reports_admin_update_restricted` (**superseded by `023` + `025`**) |
| `db/migrations/021_atomic_payment_operations.sql` | 317 | Adds `subscriptions.payment_id` + index; creates `admin_verify_payment(uuid)` and `admin_refund_payment(uuid,text)` |
| `db/migrations/022_subscription_admin_operations.sql` | 253 | Initial `admin_cancel_subscription`, `admin_extend_subscription` (**fatal NULL `plan_id` bug + deadlock; DO NOT RUN, superseded by `024`**) |
| `db/migrations/023_reports_audit_privilege_correction.sql` | 129 | Revokes `UPDATE` on `reports`, drops `reports_admin_update*`, enforces `datevra.in_audited_report_status_rpc` trigger flag + hardened `set_report_status()` |
| `db/migrations/024_subscription_operations_lock_order_and_cancellation_fix.sql` | 539 | Fixes lock order (`profiles -> subscriptions`) & NULL intent bug in `admin_cancel_subscription` & `admin_extend_subscription`; updates `redeem_membership_pass()` to record `payment_id` |
| `db/migrations/025_admin_consolidated_security_and_integrity.sql` | 104 | Revokes `UPDATE, DELETE` on `reports`, `payments`, `subscriptions`; drops `*_admin_update*`; re-grants 5 admin RPCs |
| `db/migrations/026_seed_delhi_cafes.sql` | 137 | Inserts `c-hot-stag-del`, `c-karmala-del`, `c-yumm-club-del` (`ON CONFLICT DO NOTHING`) |
| `db/migrations/026_verify_seed_delhi_cafes.sql` | 47 | Read-only 3-query verification script for `026` |
| `db/migrations/027_seed_curated_experiences.sql` | 245 | Transactional seed for 4 Delhi `e-*` experiences + `cafes.experiences` array updates + trailing read-only SELECTs |

### 2.4 Curated Package Directory (`datevra_migration_package/` — 7 SQL Files)

| Exact Path | Lines | Origin & Modifications vs `db/migrations/` |
|---|---:|---|
| `datevra_migration_package/01_010_passes_proposals.sql` | 276 | From `010_passes_proposals.sql`: wrapped in `BEGIN...COMMIT` + adds `DO $$` preflight checking core tables, `is_admin()`, `cafes.id = text` |
| `datevra_migration_package/02_014_match_proposal_integrity.sql` | 106 | From `014_match_proposal_integrity.sql`: adds `DO $$` check for `match_proposals` and `public.blocked_pair(uuid,uuid)` |
| `datevra_migration_package/03_015_matchmaking_pair_serialization.sql` | 263 | From `015_matchmaking_pair_serialization.sql`: adds `DO $$` check for `match_proposals` & `blocked_pair` + clean comments |
| `datevra_migration_package/04_016_matchmaking_lock_order_hardening.sql` | 180 | From `016_matchmaking_lock_order_hardening.sql`: adds `DO $$` check for `lock_matchmaking_pair` & `match_proposals` |
| `datevra_migration_package/05_011_membership_passes.sql` | 609 | From `011_membership_passes.sql`: wrapped in `BEGIN...COMMIT`, preflight checks, **fixes `search_path = public, extensions, pg_temp`** on `generate_secure_pass_code()` (note: still retains `% 32` charset bug) |
| `datevra_migration_package/06_post_011_reconciliation.sql` | 389 | Custom forward reconciliation script: ensures `extensions` search_path; if `018` cols exist restores 9-col `protect_profile_fields()` + 9-col trigger; if `021` `payment_id` exists upgrades `redeem_membership_pass()` |
| `datevra_migration_package/07_027_seed_curated_experiences.sql` | 165 | From `027_seed_curated_experiences.sql`: stripped trailing `SELECT` queries, keeps transactional `BEGIN...COMMIT` + preflight + inserts + array updates |

### 2.5 Supabase Edge Functions (`supabase/functions/` — 6 Files)
- `supabase/functions/README.md`
- `supabase/functions/_shared/crypto.ts` (HMAC-SHA256 verification helpers)
- `supabase/functions/_shared/supabase.ts` (`callerUserId`, `serviceRole`, `activateMembership`, `json`)
- `supabase/functions/create-order/index.ts`
- `supabase/functions/verify-payment/index.ts`
- `supabase/functions/razorpay-webhook/index.ts`

### 2.6 Frontend Adapter & Audit Documentation Files
- Frontend adapters: `src/lib/supabase/db.ts` (1,619 lines), `src/lib/supabase/mappers.ts` (513 lines), `src/lib/supabase/auth.ts`, `src/context/AuthContext.tsx`
- Root SQL/handover/audit docs: `README_FIRST.md`, `DATEVRA_MIGRATION_AUDIT.md`, `DATEVRA_MIGRATION_EXECUTION_PLAN.md`, `DATEVRA_MIGRATION_PREFLIGHT.sql`, `DATEVRA_MASTER_HANDOVER.md`, `DATEVRA_PROJECT_MEMORY.md`, `FINAL_REPORT.md`, `DEPLOYMENT.md`, `PHASE1_QA_RUNBOOK.md`
- Root verification scripts: 11 `test_*.ts` files (`test_admin_route_404_diagnosis.ts`, `test_master_repairs_verification.ts`, `test_phase7_1_reports.ts`, `test_phase7_2_payments.ts`, `test_phase7_3_subscriptions.ts`, `test_phase7_5_security_and_integrity.ts`, `test_phase7_6_consolidated_completion.ts`, `test_phase7_7_final_verification.ts`, `test_reconciliation_repairs.ts`, `test_tinder_ux_verification.ts`, `test_ultimate_master_repairs.ts`)

---

## Section 3 — Known Live Baseline (`buendstsgzdcmzaodurp`)

Strictly separated to prevent false assumptions:

### 3.1 Verified Live Facts (From Owner-Supplied Evidence & Screenshots)
1. **Live Supabase Project:** Active at `https://buendstsgzdcmzaodurp.supabase.co` (`buendstsgzdcmzaodurp`).
2. **Core Schema + Migration `009` Tables Exist:** All core tables from `db/schema.sql` plus `public.daily_action_limits` (`009`) exist on the live database.
3. **Admin Authentication Works:** `founder@datevra.com` can authenticate and access `/admin` routes (live UI screenshot confirmed `/admin/membership-passes`).
4. **Migration `010` & `011` Tables Are VERIFIED ABSENT:**
   - `public.complimentary_passes` — ABSENT
   - `public.match_proposals` — ABSENT
   - `public.membership_passes` — ABSENT (evidenced by the live `/admin/membership-passes` banner triggered by `MIGRATION_REQUIRED:011:membership_passes`).
5. **Live `public.subscriptions` Table Column Gap (CRITICAL VERIFIED FACT):**
   - Reported live column list on `public.subscriptions`: only `id`, `user_id`, `plan_id`, `status`, `started_at`, `expires_at` (missing `auto_renew` and `payment_id`; `created_at` and `updated_at` were also not in that 6-column summary and remain unverified).
6. **Live Trigger Functions From `004`/`006` Identified Without `SECURITY DEFINER` / `search_path`:**
   - `protect_profile_fields()`, `enforce_application_rules()`, `freeze_match_participants()`, and `freeze_message_content()` exist in live `pg_proc` as **`SECURITY INVOKER` with NO `search_path` set** (which matches `db/migrations/004_security_hardening.sql` and `006_match_integrity.sql`, NOT `011`/`018` which change `protect_profile_fields()` to `SECURITY DEFINER SET search_path = ...`).
7. **Live RPCs Verified ABSENT (`018`–`025`):**
   - `set_user_verified`, `set_report_status`, `admin_verify_payment`, `admin_refund_payment`, `admin_cancel_subscription`, `admin_extend_subscription` are all verified ABSENT in live DB.
8. **Live Seed Data Facts (`cafes`, `experiences`, operational rows):**
   - 9 cafés exist live, including the 3 Delhi cafés from `026`: `c-hot-stag-del` (`'Café Hot Stag'`), `c-karmala-del` (`'KARMALA CAFE & RESTAURANT'`, `experiences = '{}'`), and `c-yumm-club-del` (`'The Yumm Club'`). Notice `'c-hot-stag-del'` and `'c-karmala-del'` both currently have `{}` in `cafes.experiences`.
   - 6 base experiences exist; the 4 target Delhi IDs (`e-hotstag-premium-date`, `e-hotstag-coffee-date`, `e-hotstag-italian`, `e-karmala-karaoke`) are ABSENT.
   - 52 profiles and 1 pending ₹1,199 Elite payment row reported in live DB baseline.
   - `membership_plans` table in live DB reportedly still has legacy display labels `Connect / Plus / Elite` (mapping to `select / signature / privé` in frontend code — `DATEVRA_PROJECT_MEMORY.md:38`).

### 3.2 Assumptions / Prior Doc Claims (Not Yet Directly Proven Live)
- Presence of `009_daily_limits.sql` table + `004`/`006` trigger signatures strongly suggests `db/000_full_setup_LATEST_2026-10-04_v2.sql` originally initialized the live DB, OR `schema.sql` + `002`–`009` were run partially (since `subscriptions.auto_renew` from `schema.sql:302` is missing!).
- That discrepancy (`subscriptions.auto_renew` missing even though `schema.sql:302` defines it) proves the live database schema **cannot be assumed** to match `db/schema.sql` or `v2` column-for-column!

### 3.3 Unknowns Requiring Preflight Inspection Before Execution
- Exact columns on `subscriptions` (`created_at`, `updated_at`), `payments` (`created_at`, `updated_at`), `reports` (`updated_at`), `cafes.menu`, and `profiles` (`verification_status`, `verification_reviewed_at`, `verification_reviewed_by`, `verification_note`).
- Exact schema where `pgcrypto` is installed (`public` vs `extensions`).
- Exact live RLS policies (e.g., whether `payments_admin_write`, `subscriptions_admin_write`, `reports_admin_update` from `001`/`002` exist) and table privileges.
- Whether `003` (`discovery_profiles`), `004` (`blocked_pair`), `005` (`delete_own_account`, `payments_one_pending_per_user_plan`), `007` (`admin_exists`, `bootstrap_first_admin`), `008` (`ON DELETE SET NULL` FKs + nullable `user_id`), and `009` RPCs (`record_profile_interest`, `get_daily_usage`, `trg_enforce_like_limit`) are installed completely.
- Exact state of `handle_mutual_like()` (`001` vs custom vs `015`) and `realtime_setup.sql` publication membership.
- Details of the 1 pending ₹1,199 Elite payment and any `profiles` rows where `verified = true` or `verified = false` relative to `018`/`019`.

---

## Section 4 — Migrations & Execution Package Already Reviewed

### 4.1 Review of `datevra_migration_package/` (`01`–`07`)
- **Critical Finding on Prior Review:** Earlier docs (`README_FIRST.md`, `DATEVRA_MIGRATION_AUDIT.md`, `DATEVRA_MIGRATION_EXECUTION_PLAN.md`) reviewed `01`–`07` and improved `05_011` (`extensions` search_path) and `06_post_011_reconciliation`, **but missed TWO severe blockers** uncovered in deeper audit:
  1. **`05_011_membership_passes.sql` (lines 185, 193) AND `06_post_011_reconciliation.sql` (line 335) INSERT `auto_renew` into `public.subscriptions`**, which is verified MISSING in live `buendstsgzdcmzaodurp` (`id, user_id, plan_id, status, started_at, expires_at` only). Without `ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false;`, **every pass redemption will fail at runtime**.
  2. **`05_011_membership_passes.sql` lines 185 & 193 copy `011`'s `% 32` modulo bug against a 31-character string (`v_chars := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'`)**! ~31.7% of generated pass codes will be shorter than 19 chars and rejected by UI validation!
- **`01_010` – `04_016` Verdict:** Package hardening (transaction wrapper, `DO $$` preflight guards, `blocked_pair` check, advisory lock-order fix, `REVOKE lock_matchmaking_pair`) is solid and ready *once preflight confirms `004` (`blocked_pair`) and `001` handle_mutual_like*, subject only to two minor non-blocking edge cases noted in Section 5.
- **`07_027` Verdict:** Reviewed line-by-line; safe, transactional, idempotent, and ready after Preflight Query 5.

### 4.2 Review Status Summary of `db/migrations/002`–`027`
- **`002`–`009`:** Inspected in full; baseline layer (`002` interim policies on `payments`/`subscriptions` remain dangerous until `025`; `004` `blocked_pair` is required before `014`–`016`; `005` & `008` needed for payment idempotency & GDPR account deletion).
- **`010`, `014`–`016`:** Inspected in full; sound chain replacing `012`–`013`.
- **`012`, `013`:** Inspected in full; superseded (**DO NOT RUN**).
- **`011`:** Inspected in full; superseded by package `05_011` + fixes (original `011` lacks `extensions` in `search_path`, overwrites `018` `protect_profile_fields()`, omits `subscriptions.payment_id`, and has the `% 32` / 31-char bug).
- **`017`, `020`:** Inspected in full; superseded by `023` + `025` (**DO NOT RUN**).
- **`018`, `019`:** Inspected in full; `018` has runtime dependency on `011` (`datevra_internal.plan_update_intents`) and forgets to recreate `trg_protect_profile_fields` with 9 columns. `019` adds sync CHECK constraint + self-verification ban.
- **`021` (`021_atomic_payment_operations.sql`):** Inspected in full; adds `subscriptions.payment_id`, `admin_verify_payment`, `admin_refund_payment`; depends on `auto_renew` and `updated_at`/`created_at` existing on `subscriptions` & `payments`.
- **`022`:** Inspected in full; **FATAL BUGS** (`NULL` `plan_id` in `plan_update_intents` + lock-order deadlock) — **DO NOT RUN**.
- **`023`, `024`, `025`:** Inspected in full; complete the security/integrity hardening, but **must execute AFTER `011` + `021` + missing timestamp/auto_renew column checks**, and **BEFORE any Edge Function live launch**.
- **`026`, `026_verify`:** Redundant live (**SKIP**).
- **`027`:** Ready (**Run via package `07_027`**).

---

## Section 5 — Confirmed Bugs, Deficiencies & Unresolved Findings

All findings below are verified directly against file paths and line numbers:

1. **LIVE `public.subscriptions` Missing `auto_renew` (and Possibly `created_at` / `updated_at`) — BLOCKING RUNTIME & MIGRATION CRASH**
   - *Evidence:* `db/schema.sql:302` defines `auto_renew boolean NOT NULL DEFAULT false`, plus `created_at` and `updated_at` (`lines 303–304`). Live `buendstsgzdcmzaodurp` reportedly has ONLY `(id, user_id, plan_id, status, started_at, expires_at)`.
   - *Impact:*
     - `datevra_migration_package/05_011_membership_passes.sql:556–560`, `06_post_011_reconciliation.sql:334–338`, `db/migrations/011_membership_passes.sql:613–617`, and `db/migrations/024:476–480` all execute `INSERT INTO public.subscriptions (..., auto_renew)` -> fails at runtime with `column "auto_renew" of relation "subscriptions" does not exist`.
     - `db/migrations/021_atomic_payment_operations.sql:102–118` inserts `auto_renew` AND lines `97, 224, 242` read/update `subscriptions.updated_at` and `subscriptions.created_at`. `db/migrations/024:78, 214` updates `subscriptions.updated_at = now()`.
     - `supabase/functions/_shared/supabase.ts:69` inserts `auto_renew: true`.
     - `src/lib/supabase/mappers.ts:337` reads `r.auto_renew` (defaults `false` safely, so read doesn't crash, only writes crash).

2. **`011` / `05_011` Pass Code Generator `% 32` Modulo Bug Against 31-Char Alphabet — ~31.7% MALFORMED CODES**
   - *Evidence:* `db/migrations/011_membership_passes.sql:211, 220` and `datevra_migration_package/05_011_membership_passes.sql:185, 193`:
     ```sql
     v_chars text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; -- LENGTH = 31 (indices 1..31)
     ...
     v_idx := (get_byte(v_bytes, i) % 32) + 1;           -- RANGE = 1..32!
     v_code := v_code || substr(v_chars, v_idx, 1);
     ```
   - `v_chars` has 8 digits (`2..9`) + 23 letters (`A..Z` excluding `I, L, O`) = **31 characters**.
   - When `get_byte(...) % 32 = 31` (`v_idx = 32`, 1/32 chance per char across 12 chars = `1 - (31/32)^12 = 31.69%` of passes!), `substr(v_chars, 32, 1)` returns `''`, truncating the generated code below 19 characters!
   - *UI Breakage:* `src/pages/user/Membership.tsx:144` enforces `const PASS_REGEX = /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;` — ~1 in 3 generated passes would fail redemption validation in the UI!
   - *Note:* `06_post_011_reconciliation.sql:30–33` only alters `search_path` and does **not** fix this bug.

3. **Razorpay Edge Functions Reference Nonexistent `payments.verified_at` Column & Break `021`/`024` Linking**
   - *Evidence:*
     - `supabase/functions/verify-payment/index.ts:104` and `supabase/functions/razorpay-webhook/index.ts:83` execute `.update({ status: "verified", razorpay_payment_id: ..., verified_at: new Date().toISOString() })`.
     - **Verified absence:** `verified_at` does NOT exist in `db/schema.sql:309–322` (`public.payments`) nor in ANY migration `002`–`027`.
     - `supabase/functions/_shared/supabase.ts:63–70` inserts into `subscriptions` **without `payment_id`** (breaking `021` `admin_refund_payment()` direct trace), writes direct `profiles` update without setting `auto_renew` check awareness (service_role bypasses `protect_profile_fields()` via `011`/`018` `v_jwt_role = 'service_role'`, which works once `011`/`018` is applied, OR via `auth.uid() IS NULL` in `004`), and hardcodes wrong notification route `link: "/app/membership"` (line 84) instead of `"/membership"`.
     - Note `002_client_parity.sql:99, 140, 171, 194` triggers also emit `/app/likes`, `/app/chat`, `/app/applications`, `/app/bookings` links (pre-existing minor route mismatch unless redirects exist).

4. **`018_verification_status_and_rpc.sql` Runtime Dependency on `011` + Trigger Column-List Bypass Bug**
   - *Evidence:*
     - `db/migrations/018:129` executes `DELETE FROM datevra_internal.plan_update_intents ...` inside `protect_profile_fields()`. If `018` is executed *before* `011`, `datevra_internal` schema does not exist -> **breaks member profile updates touching plan fields**.
     - `db/migrations/018:84–146` replaces `protect_profile_fields()` to guard 9 columns, **never runs `CREATE TRIGGER trg_protect_profile_fields`**. The existing trigger from `004:114` or `011:196` only fires on `BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, email`. A direct client `UPDATE` modifying only `verification_status` / `verification_note` / `verification_reviewed_*` silently **bypasses the trigger**!
     - `018:156` & `019:59` (`set_user_verified`) lack `IF p_verified IS NULL THEN RAISE EXCEPTION ...` validation (though `NOT NULL` on `profiles.verified` catches it late with a generic constraint error).
     - `verification_reviewed_by uuid` (`018:55`) has no FK (harmless if reviewing admin is deleted; retains UUID).

5. **`011_membership_passes.sql` / `05_011` Overwrite Hazards vs `018` & `024`**
   - *Hazard A (`011` vs `018`):* Running `011`/`05_011` after `018` reverts `protect_profile_fields()` and `trg_protect_profile_fields` back to 5 columns (stripped of `verification_*` guards). (`06_post_011` repairs this ONLY if `018` was already present before `06` ran; if `018` runs *after* `06`, `018` re-introduces its 5-column trigger bug unless `trg_protect_profile_fields` is recreated after `018`!)
   - *Hazard B (`011` vs `024`):* `05_011:556` inserts into `subscriptions` without `payment_id`; `024:476` includes `payment_id`. Running `05_011` after `021` requires `06_post_011` or `024` afterwards.

6. **`019_verification_defense_in_depth.sql` Brittle `LIKE` Check & Pre-existing Data Sensitivity**
   - *Evidence:* `019:41–47` adds `chk_profiles_verified_status_sync` (`CHECK ((verified=true AND verification_status='verified') OR (verified=false AND verification_status IN ('pending','declined')))`). Fails cleanly if any existing `profiles` row violates it; lines `32–36` inspect `pg_get_constraintdef()` using brittle English `LIKE` clauses on re-runs.

7. **`021_atomic_payment_operations.sql` Financial & Ledger Subtle Defects**
   - *Mock Payment Fabrication Risk (`021:79`):* `admin_verify_payment()` sets `v_pay_id := COALESCE(v_payment.razorpay_payment_id, 'pay_' || replace(gen_random_uuid()::text, '-', ''));`. Note that **live DB reportedly has 1 pending ₹1,199 Elite payment**, and `src/pages/user/Membership.tsx:100–122` has a *"Complete test payment"* button calling `db.verifyPayment` (`admin_verify_payment`). Non-admins calling `admin_verify_payment` are blocked (`is_admin()` returns `false`), **but if an admin clicks verify on a pending test-mode payment, `021` marks a real ₹1,199 row `'verified'` with a fake `'pay_...'` ID and activates a real 1-month Elite subscription!**
   - *Refund Fallback & Non-Unique Trace (`021:30–31, 220–226`):* `idx_subscriptions_payment_id` is **non-unique**; line 222 matches `(payment_id = p_payment_id OR (user_id = ... AND plan_id = ... AND status = 'active'))` `LIMIT 1`, which can match an unlinked subscription if `payment_id` is NULL.
   - *Ledger-Only Refund:* `admin_refund_payment` does **NOT** trigger Razorpay's refund API (UI `Payments.tsx:875–880` explicitly warns admins of this).
   - *Timestamp Dependency:* Lines `85, 97, 210, 224, 242` require `payments.updated_at`, `payments.created_at`, `subscriptions.updated_at`, and `subscriptions.created_at`.

8. **`022_subscription_admin_operations.sql` Fatal Bug & Deadlock (DO NOT RUN)**
   - *Evidence:* `022:88–89` inserts `(v_sub.user_id, NULL, NULL)` into `datevra_internal.plan_update_intents` where `plan_id` is `text NOT NULL` (`011:105`), crashing every `admin_cancel_subscription()` call once `011` is installed. Also locks `subscriptions` before `profiles` (`022:50, 95`), inverting the `profiles -> subscriptions` lock order of `021`. Superseded entirely by `024`.

9. **`025_admin_consolidated_security_and_integrity.sql` Ordering Trap & Unremoved `*_admin_write` Policy Names**
   - *Ordering Trap (`025:82–95`):* Executes `REVOKE ALL ON FUNCTION ... / GRANT EXECUTE` on all 5 RPCs (`set_report_status`, `admin_verify_payment`, `admin_refund_payment`, `admin_cancel_subscription`, `admin_extend_subscription`). Since all 5 are currently **ABSENT** on `buendstsgzdcmzaodurp`, running `025` before `021`, `023`, and `024` **immediately fails**. Also lacks `BEGIN...COMMIT` wrapper.
   - *Missed Policy Names (`025:58, 72` vs `002:43–51`):* `002_client_parity.sql` created `"payments_admin_write"` and `"subscriptions_admin_write"` (`FOR ALL TO authenticated`), whereas `025` runs `DROP POLICY IF EXISTS "payments_admin_update"` and `DROP POLICY IF EXISTS "subscriptions_admin_update"`. Because PostgreSQL checks table privileges (`REVOKE UPDATE, DELETE` in `025:55, 69`) before RLS, direct client `UPDATE`/`DELETE` is still blocked, **however `payments_admin_write` + `GRANT INSERT ON public.payments` (`025:61`) intentionally preserves admin `INSERT` for cash payments (`db.ts:945`)**. Cleanup of stale `*_admin_write` naming (keeping a narrow admin-only `INSERT` policy on `payments` if dropping `payments_admin_write`) is cleaner hygiene.

10. **Proposal Chain Minor Residual Edge Cases (`010` / `014` / `015` / `016`)**
    - `010:151–153` (`redeem_pass`): Lazy `UPDATE complimentary_passes SET status = 'expired'` immediately precedes `RAISE EXCEPTION 'This pass has expired.'`, which rolls back the status update cleanly (benign but means expired passes remain `'active'` status until manually updated, unlike `011` `redeem_membership_pass` which returns JSON without raising so expiry commits).
    - `014:120` (`trg_check_match_proposal_integrity`): Fires `BEFORE INSERT` only (safe against member API writes because members have no `UPDATE` policy; admins can't accidentally bypass via `createMatchProposal`, though a direct SQL `UPDATE` changing participants wouldn't re-run the trigger).
    - `016:145–207` (`respond_to_proposal`): Does not guard `p_accept IS NULL` and allows the first respondent to flip their own `true` response while the proposal is still `'pending'`. Non-critical, good to note.

11. **Live Unsecured Trigger Functions (`004` / `006`)**
    - User baseline confirms live `protect_profile_fields()`, `enforce_application_rules()`, `freeze_match_participants()`, `freeze_message_content()` exist as `SECURITY INVOKER` without `SET search_path`. Setting `search_path = public, pg_temp` hardens against search-path hijacking (`protect_profile_fields` gets fixed when `011` + `018` + `06` reconciliation run).

12. **Unresolved Data & Naming Questions**
    - Live `membership_plans` uses display names `Connect / Plus / Elite` vs frontend UI `Select / Signature / Privé` (`DATEVRA_PROJECT_MEMORY.md:32–38`). Plan IDs remain `'connect'`, `'plus'`, `'elite'` everywhere — compatible at the FK level, display text differs until `membership_plans.name` is updated intentionally.
    - Support email drift: `db/schema.sql:411,910` defaults to `support@datevra.in`, `db.ts:1025` & `mappers.ts:428` fallback is `care@datevra.in`, while recent UI edit set `support@datevra.com`.

---

## Section 6 — Full Dependency Graph

```text
[db/schema.sql (001): 23 base tables + is_admin() + set_updated_at() + handle_mutual_like()]
   │
   ├──> [002_client_parity.sql] (interim admin policies + app triggers)
   ├──> [003_discovery_function.sql] (discovery_profiles / discovery_profile RPCs)
   ├──> [004_security_hardening.sql] ──► blocked_pair(uuid, uuid) + base protect_profile_fields()
   ├──> [005_account_deletion.sql] (delete_own_account + payments_one_pending_per_user_plan)
   ├──> [006_match_integrity.sql] (freeze_match_participants)
   ├──> [007_admin_bootstrap.sql] (admin_exists / bootstrap_first_admin)
   ├──> [008_payment_retention.sql] (nullable payments/subscriptions.user_id + ON DELETE SET NULL)
   ├──> [009_daily_limits.sql] (daily_action_limits + rate limit trigger/RPCs)  [LIVE TABLE CONFIRMED]
   │
   ├──> PROPOSAL & CAFÉ PASS CHAIN (Requires 001 + 004 blocked_pair):
   │       [010 / Pkg 01] ──> [014 / Pkg 02 (requires 004 blocked_pair)]
   │                                │
   │                                ▼
   │                          [015 / Pkg 03] ──> [016 / Pkg 04]
   │       (SKIP superseded: 012, 013)
   │
   ├──> MEMBERSHIP PASS, VERIFICATION, PAYMENTS & SECURITY CHAIN:
   │       [Pre-Check: ensure subscriptions has auto_renew, created_at, updated_at; payments has updated_at]
   │       [Requires pgcrypto in extensions/public]
   │            │
   │            ├──> [011 / Pkg 05 (WITH %31 RNG FIX!)] ──> datevra_internal.plan_update_intents + membership_passes
   │            │         │
   │            │         ├──> [018 (requires datevra_internal from 011!)] ──> verification_* cols + set_user_verified
   │            │         │         │   (BUG: 018 leaves 5-col trg_protect_profile_fields!)
   │            │         │         ▼
   │            │         │    [06_post_011_reconciliation OR Trigger Recreate] ──> fixes 9-col trigger!
   │            │         │         │
   │            │         │         ▼
   │            │         │    [019 (requires 018 cols + clean rows)] ──> sync CHECK + no self-verify
   │            │         │
   │            │         └──> [021 (requires auto_renew + updated_at + created_at)] ──> subscriptions.payment_id + admin_verify/refund_payment
   │            │                   │
   │            │                   ▼  (Requires BOTH 011 + 021)
   │            │              [024 (SUPERSEDES 022)] ──> admin_cancel/extend_subscription + redeem_membership_pass(payment_id)
   │            │
   │            └──> [023 (SUPERSEDES 017 & 020)] ──> reports revoke UPDATE + set_report_status + audit trigger
   │                                  │
   │                                  ▼  (HARD REQUIREMENT: MUST run AFTER 021, 023, AND 024!)
   │                             [025] ──> final revokes on reports/payments/subscriptions + GRANT 5 RPCs
   │
   └──> SEEDS & REALTIME:
           [026_seed_delhi_cafes.sql] ──► SKIP (c-hot-stag-del, c-karmala-del, c-yumm-club-del already live)
                │
                ▼ (Requires 001 tables + c-hot-stag-del & c-karmala-del + empty target e-* IDs)
           [027 / Pkg 07] ──► 4 curated Delhi experiences + cafes.experiences updates
           [realtime_setup.sql] ──► independent on 001 tables
```

---

## Section 7 — App-to-Database Compatibility Matrix

| App Feature / File | Frontend (`db.ts` / `mappers.ts` / UI) or Edge Function | DB Object(s) Used | Live Status (`buendstsgzdcmzaodurp`) | Runtime Impact Today |
|---|---|---|---|---|
| Discovery grid / swipe deck (`Discover.tsx`, `db.ts:118,126`) | `rpc("discovery_profiles")`, `rpc("discovery_profile", { p_id })` | `003` RPCs + `004` `blocks` exclusion | **UNKNOWN** (verify Preflight Q1) | If absent, profile lookup fails with RPC missing error |
| Account deletion (`Settings.tsx:96`, `db.ts:247`) | `rpc("delete_own_account")` | `005` RPC + `008` `ON DELETE SET NULL` FKs | **UNKNOWN** (verify Q1–Q2) | Fails if `005` absent; loses anonymized financial history if `008` absent |
| Free-user daily limits (`Discover.tsx:340,415`, `db.ts:299,585,601`) | `rpc("get_daily_usage")`, `rpc("record_profile_interest")`, `likes` insert | `009` table, trigger & RPCs | **PARTIAL CONFIRMED** (`daily_action_limits` table live; RPCs/trigger checked in Q1–Q2) | Counter UI/gating breaks if RPCs missing |
| Bidirectional block check (`Matchmaking.tsx`, `db.ts:413`) | `rpc("blocked_pair", { a, b })` (with table fallback) | `004` `blocked_pair(uuid,uuid)` | **UNKNOWN** (verify Q1) | Fallback works for `db.ts`, **but `014`–`016` hard-fail without `blocked_pair`** |
| Complimentary café passes (`Passes.tsx`, `MyPasses.tsx`, `db.ts:1086–1227`) | `complimentary_passes` SELECT/INSERT/UPDATE + `rpc("redeem_pass", { p_code })` | `010` table + RLS + `redeem_pass` | **VERIFIED ABSENT** | Throws `MIGRATION_REQUIRED:010:complimentary_passes` banner |
| Curated match proposals (`Matchmaking.tsx:287`, `Matches.tsx:81`, `db.ts:1378–1425`) | `match_proposals` SELECT/INSERT + `rpc("respond_to_proposal", { p_proposal_id, p_accept })` | `010` + `014` + `015` + `016` | **VERIFIED ABSENT** | Matchmaking proposal UI fails with missing relation |
| Café menus (`Cafes.tsx`, `CafeDetail.tsx`, `mappers.ts:284`) | `cafes.menu` mapped to `menu: str(r.menu)` | `010` `ALTER TABLE cafes ADD COLUMN menu` | **UNKNOWN** (verify Q2) | Reads fallback cleanly to `""`; admin save of `menu` via `unmapCafe` (`mappers.ts:306`) **FAILS** if column missing |
| Membership passes (`MembershipPasses.tsx`, `Membership.tsx:144,152`, `db.ts:1231–1374`) | `membership_passes` SELECT + `create_membership_pass`, `revoke_membership_pass`, `redeem_membership_pass` | `011` (`05_011`) + `024` + `subscriptions.auto_renew` + `payment_id` | **VERIFIED ABSENT** | `/admin/membership-passes` shows Migration 011 warning; redemption blocked until fixed |
| Verification workflow (`Verification.tsx:185`, `Users.tsx:191`, `db.ts:1044`) | `rpc("set_user_verified", { p_user_id, p_verified, p_note })`; `mappers.ts:65–68` reads 4 `verification_*` cols | `018` + `019` (`verification_*` cols + RPC) | **VERIFIED ABSENT** (`set_user_verified` absent) | Throws `MIGRATION_REQUIRED` ("Migration 019" label in UI even though introduced in `018`) |
| Report moderation (`Reports.tsx:218`, `db.ts:440–446`) | `rpc("set_report_status", { p_report_id, p_status })` | `023` (supersedes `017`, `020`) + `reports.updated_at` | **VERIFIED ABSENT** | Fails with raw PostgREST RPC error (no friendly `MIGRATION_REQUIRED` banner) |
| Subscriptions admin (`Memberships.tsx:234,268`, `db.ts:863–892`, `mappers.ts:328–339`) | `rpc("admin_cancel_subscription")`, `rpc("admin_extend_subscription")`; reads `auto_renew`, `payment_id` | `024` + `subscriptions.auto_renew` + `updated_at` + `021.payment_id` | **VERIFIED ABSENT** + **`auto_renew` MISSING LIVE** | Admin cancel/extend fails; `mappers.ts` safely falls back `autoRenew: false` & `paymentId: null` on read |
| Member test checkout (`Membership.tsx:86,104`, `db.ts:899–937`) | Member creates pending payment (`order_pending_...`); "Complete test payment" button calls `db.verifyPayment` -> `admin_verify_payment` | `002` `payments_insert_own_pending` + `021` `admin_verify_payment` | **`admin_verify_payment` ABSENT** | Non-admins are intentionally blocked by `021` `is_admin()`, test button only works for admin accounts |
| Admin payments verify/refund (`Payments.tsx:213,239`, `db.ts:924–967`) | `rpc("admin_verify_payment", { p_payment_id })`, `rpc("admin_refund_payment", { p_payment_id, p_reason })`, cash INSERT (`db.ts:945`) | `021` + `subscriptions.auto_renew` + `updated_at`/`created_at` + `002` `payments_admin_write` | **VERIFIED ABSENT** + **`auto_renew` MISSING LIVE** | Verify/refund throws `MIGRATION_REQUIRED` (021); live DB has 1 pending ₹1,199 Elite payment waiting |
| Razorpay Edge Functions (`supabase/functions/verify-payment/index.ts:104`, `razorpay-webhook/index.ts:83`, `_shared/supabase.ts:69`) | Direct service_role writes to `payments` (`verified_at`) & `subscriptions` (`auto_renew`, omitting `payment_id`) | `payments.verified_at` (**NONEXISTENT**), `subscriptions.auto_renew` (**MISSING LIVE**) | **BROKEN CODE vs SCHEMA** (Functions not deployed) | Will fail on `verified_at` and `auto_renew` if deployed before fixes |
| Delhi Curated Experiences (`ExperiencesPublic.tsx`, `CafesPublic.tsx`) | Queries `experiences`, appends/filters `cafes.experiences`, submits `date_applications` | `027` (`07_027`) + `c-hot-stag-del`, `c-karmala-del` | **4 IDs ABSENT** (`cafes.experiences = '{}'`) | Delhi partner café experiences missing / FK fails on application |

---

## Section 8 — Critical Security, Integrity & Financial Risks Ranked by Severity

### CRITICAL
1. **Financial & Subscription Schema Crash (`subscriptions.auto_renew` Missing Live + Unverified `updated_at`/`created_at`):**
   - Attempting to install `05_011`, `06_post_011`, `021`, or `024` on `buendstsgzdcmzaodurp` will succeed in DDL or partially deploy broken RPCs that **crash on every pass redemption, admin payment verification, refund, cancellation, or extension** because `auto_renew` is missing on live `public.subscriptions`.
2. **Pass Code Generator Defect (`011` / `05_011`: 31-Char String vs `% 32`):**
   - Unpatched `generate_secure_pass_code()` produces truncated codes (`< 19` chars) ~31.7% of the time, creating unusable admin-issued membership passes that fail UI validation (`Membership.tsx:144`).
3. **Mock Payment Activation Risk on Real Pending ₹1,199 Elite Row:**
   - `admin_verify_payment()` (`021:79`) invents a fake `'pay_' || gen_random_uuid()` ID when `razorpay_payment_id` is NULL. Running it on the live ₹1,199 pending payment grants real Elite access without real Razorpay settlement unless explicitly intended as test/manual override.
4. **Live `payments` / `subscriptions` / `reports` Exposed to Direct Client Mutation Until `023` + `025` Apply:**
   - If `002_client_parity.sql` (`payments_admin_write`, `subscriptions_admin_write`) and `001` (`reports_admin_update`) are active live without `023`/`025`, compromised or buggy admin client calls can directly `UPDATE`/`DELETE` financial ledger rows and report statuses without `activity_logs` audit entries.
5. **Broken Razorpay Edge Functions (`payments.verified_at` Nonexistent Column):**
   - Both `verify-payment/index.ts` and `razorpay-webhook/index.ts` fail trying to update non-existent `payments.verified_at`, and `_shared/supabase.ts` omits `payment_id` when creating subscriptions.

### HIGH
6. **Privilege Escalation / Trigger Bypass on `profiles.verification_*` (`018` Trigger Bug + `011` Overwrite):**
   - `011` overwrites `protect_profile_fields()` back to 5 columns; `018` updates the function to 9 columns but never recreates `trg_protect_profile_fields` with the 4 `verification_*` columns, allowing unblocked updates to `verification_status` when none of the original 5 columns change.
   - `018` depends at runtime on `datevra_internal.plan_update_intents` (from `011`).
7. **Deadlock & Crash in `022` (`NULL` `plan_id` in `plan_update_intents`):**
   - Any execution of `022` breaks `admin_cancel_subscription()`. Only `024` is safe.
8. **`025` Ordering Failure:**
   - Running `025` before `021`, `023`, and `024` aborts because none of the 5 target RPCs exist yet in live `buendstsgzdcmzaodurp`.
9. **Live `SECURITY INVOKER` + Unset `search_path` on `004`/`006` Trigger Functions:**
   - Verified in user's baseline evidence (`protect_profile_fields`, `enforce_application_rules`, `freeze_match_participants`, `freeze_message_content`). Leaving triggers without `SET search_path` risks schema shadowing.

### MEDIUM
10. **Match Proposal Concurrency / Block Bypass Unless `010 + 014 + 015 + 016` Run Together:**
    - Running `010` alone permits A-B / B-A duplicate pending proposals and race conditions against mutual likes (`handle_mutual_like()`).
11. **`admin_refund_payment()` Fallback Match When `payment_id` Is NULL (`021:222`) & Non-Unique `idx_subscriptions_payment_id`:**
    - Can mistakenly match an unlinked subscription on users with historical null `payment_id` rows.
12. **Stale `*_admin_write` Policy Names Left by `025` & Unchecked UI `setReportStatus` Error Handling:**
    - `Reports.tsx` / `db.ts:440` does not show a `MIGRATION_REQUIRED` banner when `set_report_status` is absent, unlike `Passes.tsx`, `MembershipPasses.tsx`, and `Verification.tsx`.

### LOW
13. **`cafes.menu` & `set_user_verified` Minor Gaps:**
    - `unmapCafe` includes `menu`, requiring `010`'s `ALTER TABLE cafes ADD COLUMN menu` before admins edit cafés.
    - `set_user_verified` lacks explicit `p_verified IS NULL` check.
    - `002` trigger & `_shared/supabase.ts` notification links use `/app/...` paths; `011`/`021`/`024` use `/membership`.

---

## Section 9 — Authoritative Recommended Execution Order (Gated)

**Rule:** Do **NOT** execute any write SQL until Gate 0 (Preflight) completes and the two blocking SQL fixes in Section 11 are prepared for review. Because no files may be modified in this read-only audit, this is the target execution blueprint for ChatGPT + the owner to execute **after preflight output is returned**:

- **Gate 0 — Strict Read-Only Preflight (`DATEVRA_MIGRATION_PREFLIGHT.sql` + Supplementary Preflight in Section 12):**
  - Confirm exact columns of `subscriptions`, `payments`, `reports`, `profiles`, `cafes`; confirm `pgcrypto` schema (`extensions` vs `public`); confirm `002`–`009` functions/triggers/policies/FKs; inspect the 1 pending ₹1,199 payment and `profiles.verified` consistency.
- **Gate 1 — Pre-Migration Schema Column Alignment (Only If Preflight Confirms Columns Missing on `subscriptions` / `payments` / `reports`):**
  - Safely add `auto_renew boolean NOT NULL DEFAULT false` (and `created_at` / `updated_at` if missing per Preflight Query S1) to `public.subscriptions` (and verify `payments`/`reports` have `updated_at`/`created_at`) + ensure `008` nullable FKs & `005` partial unique index if preflight showed them absent.
- **Gate 2 — Café Passes & Match Proposals Chain (`004 blocked_pair` confirmed first):**
  1. `datevra_migration_package/01_010_passes_proposals.sql`
  2. `datevra_migration_package/02_014_match_proposal_integrity.sql`
  3. `datevra_migration_package/03_015_matchmaking_pair_serialization.sql`
  4. `datevra_migration_package/04_016_matchmaking_lock_order_hardening.sql`
- **Gate 3 — Membership Passes + Verification + Payments + Reports + Subscription Hardening:**
  1. **Patched `05_011_membership_passes.sql`** (must fix the 31-char vs `% 32` bug in `generate_secure_pass_code()` before running! Plus keep `extensions` in `search_path` and `subscriptions.auto_renew` present from Gate 1).
  2. **`db/migrations/018_verification_status_and_rpc.sql`** (runs safely *after* `011` because `datevra_internal` now exists).
  3. **`datevra_migration_package/06_post_011_reconciliation.sql`** (runs *after* `018` so it upgrades `protect_profile_fields()` AND recreates `trg_protect_profile_fields` with all **9 columns**, closing `018`'s trigger gap!).
  4. **`db/migrations/019_verification_defense_in_depth.sql`** (only after Query 4 shows 0 inconsistent profile rows).
  5. **`db/migrations/021_atomic_payment_operations.sql`** (adds `subscriptions.payment_id` + `admin_verify_payment` + `admin_refund_payment`).
  6. **`db/migrations/023_reports_audit_privilege_correction.sql`** (replaces `017`/`020` cleanly: revokes `UPDATE` on `reports`, creates `set_report_status` & trigger).
  7. **`db/migrations/024_subscription_operations_lock_order_and_cancellation_fix.sql`** (replaces `022`: creates `admin_cancel_subscription`, `admin_extend_subscription`, and upgrades `redeem_membership_pass()` to link `payment_id`).
  8. **`db/migrations/025_admin_consolidated_security_and_integrity.sql`** (runs LAST after `021`, `023`, `024` exist; optionally also drop legacy `"payments_admin_write"` / `"subscriptions_admin_write"` with narrow admin INSERT policy on `payments` if confirmed by Preflight Query 6).
- **Gate 4 — Curated Delhi Experiences Seed & Post-Run Hygiene:**
  1. `datevra_migration_package/07_027_seed_curated_experiences.sql`
  2. `db/realtime_setup.sql` (if Preflight Query 6 shows any of the 8 core tables missing from `supabase_realtime`).
  3. Search-path hardening patch for live `004`/`006` triggers (`enforce_application_rules`, `freeze_match_participants`, `freeze_message_content`) if Preflight Query 1 confirms `NO search_path SET`.
- **Gate 5 — Before Live Razorpay Activation (Edge Functions Code + Deployment):**
  - Fix `verified_at` and `payment_id` in `supabase/functions/` before ever deploying Razorpay Edge Functions.

*(Alternative note: If `018`, `019`, `021`, `023`, `024`, `025` are NOT applied in the first pass and only `01`–`07` are applied, the DB will NOT have `set_user_verified`, `set_report_status`, `admin_verify_payment`, `admin_refund_payment`, `admin_cancel_subscription`, or `admin_extend_subscription` — those admin pages will remain blocked. Also, even for `05_011` alone, **Gate 1 (`subscriptions.auto_renew`) and the `05_011` `% 32` pass-code fix are strictly mandatory first!**)*

---

## Section 10 — DO-NOT-RUN / Skip / Superseded Migrations List

| File(s) | Classification | Exact Technical Reason |
|---|---|---|
| `db/000_full_setup.sql`, `db/000_full_setup_LATEST_2026-10-04.sql`, `db/000_full_setup_LATEST_2026-10-04_v2.sql` | **DO NOT RUN** (Reference Only) | Monolithic fresh-DB bootstrap scripts ending at `008`/`009`; re-running against live DB restores interim `002` policies conflicting with `023`/`025`. |
| `db/migrations/011_membership_passes.sql` (unpatched original) | **SUPERSEDED / DO NOT RUN RAW** | Missing `extensions` in `generate_secure_pass_code()` `search_path`, overwrites `018` `protect_profile_fields()`, has 31-char vs `% 32` bug, lacks `06` reconciliation. |
| `db/migrations/012_proposal_block_protection.sql` | **DO NOT RUN** (Superseded) | Uncaught exception in `respond_to_proposal()` rolls back `status = 'declined'` update; replaced by `014`–`016`. |
| `db/migrations/013_proposal_block_decline_persistence.sql` | **DO NOT RUN** (Superseded) | Replaced entirely by `015` + `016` (advisory pair lock + lock-order hardening). |
| `db/migrations/017_atomic_report_status_audit.sql` | **DO NOT RUN** (Superseded) | Replaced completely by `023` + `025`. |
| `db/migrations/020_enforce_audited_report_status.sql` | **DO NOT RUN** (Superseded) | Left permissive `reports_admin_update_restricted` direct UPDATE policy open; fixed and superseded by `023` + `025`. |
| `db/migrations/022_subscription_admin_operations.sql` | **DO NOT RUN** (**FATAL BUG**) | Inserts `NULL` `plan_id` into `NOT NULL` `datevra_internal.plan_update_intents.plan_id` in `admin_cancel_subscription()` AND locks `subscriptions` before `profiles` (deadlock risk). Replaced by `024`. |
| `db/migrations/026_seed_delhi_cafes.sql` | **SKIP** (Already Live) | All 3 Delhi cafés (`c-hot-stag-del`, `c-karmala-del`, `c-yumm-club-del`) already exist in live `public.cafes`; creates zero schema objects and inserts zero rows. |
| `db/migrations/026_verify_seed_delhi_cafes.sql` | **SKIP / Reference** | Read-only 3-query verification script, not a migration. |

---

## Section 11 — Required SQL & Code Fixes Before Execution

*(Documented here strictly for review & future execution; ZERO files edited in this read-only audit.)*

1. **Pre-`05_011` / Pre-`021` / Pre-`024` Live Table Column Repair (Pending Preflight Query S1):**
   - If Preflight confirms missing columns on `public.subscriptions` (already known for `auto_renew`):
     ```sql
     ALTER TABLE public.subscriptions
       ADD COLUMN IF NOT EXISTS auto_renew boolean NOT NULL DEFAULT false,
       ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
       ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
     ```
     *(Plus `payments.updated_at` / `payments.created_at` / `reports.updated_at` if missing per Preflight Query S1.)*
2. **Fix `datevra_internal.generate_secure_pass_code()` Charset/Modulo Bug Before Running `05_011`:**
   - Replace `(get_byte(v_bytes, i) % 32) + 1` against the 31-character string with a 32-character unambiguous alphabet OR rejection sampling `< 248` with `% 31` (preserving unambiguous alphabet without `0/O/1/I/L` and eliminating modulo bias), e.g., rejecting bytes `>= 248` (`248 = 31 * 8`) and indexing `(byte % 31) + 1`.
3. **Ensure 9-Column `trg_protect_profile_fields` Runs AFTER `018`:**
   - Either run `06_post_011_reconciliation.sql` **after** `018_verification_status_and_rpc.sql`, or append `DROP TRIGGER IF EXISTS trg_protect_profile_fields ON public.profiles; CREATE TRIGGER trg_protect_profile_fields BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, verification_status, verification_reviewed_at, verification_reviewed_by, verification_note, email ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.protect_profile_fields();` after `018`.
4. **Harden `004`/`006` Live Trigger Search Paths:**
   - Set `SET search_path = public, pg_temp` on live `enforce_application_rules()`, `freeze_match_participants()`, and `freeze_message_content()` if Preflight confirms `NO search_path SET`.
5. **Handle `025` vs `002` Policy Names & `payments_admin_write` Cash Insert:**
   - Check Preflight Query 6; if `payments_admin_write` / `subscriptions_admin_write` exist from `002`, drop both in `025` cleanly AND replace `payments_admin_write` with an `INSERT`-only `payments_admin_insert` policy (`FOR INSERT TO authenticated WITH CHECK (public.is_admin())`) so admin cash recording (`db.ts:945`) keeps working while `UPDATE`/`DELETE` policies are completely eliminated.
6. **Edge Functions Fixes Required Before Payment Launch (Do NOT Deploy As-Is):**
   - Remove `verified_at` update from `supabase/functions/verify-payment/index.ts:104` and `supabase/functions/razorpay-webhook/index.ts:83` (or add `verified_at timestamptz` to `public.payments` in a future payment migration).
   - Update `_shared/supabase.ts:63–70` to pass `payment_id` into `subscriptions` and change notification `link` from `"/app/membership"` to `"/membership"`.

---

## Section 12 — Read-Only Preflight Checks Still Needed

Run **both** the existing `DATEVRA_MIGRATION_PREFLIGHT.sql` (Queries 1–6) **and** the supplementary read-only `SELECT` checks below (`S1`–`S4`) that cover gaps discovered in this audit:

### 12.1 Existing Preflight (`DATEVRA_MIGRATION_PREFLIGHT.sql`)
- **Query 1:** `pgcrypto` schema (`public` vs `extensions`), `datevra_internal`, presence & `SECURITY DEFINER`/`proconfig` of all 36 key functions (`001`–`025`).
- **Query 2:** Key added columns (`cafes.menu`, `018` cols, `021` `payment_id`), FKs (`008` `ON DELETE SET NULL`), CHECK constraints, indexes, and all live triggers on `public.*`.
- **Query 3:** Exact live SQL body of `protect_profile_fields`, `handle_mutual_like`, `redeem_membership_pass`, `respond_to_proposal`, etc.
- **Query 4:** Profile count, admin count, and `verified` vs `verification_status` consistency before running `018`/`019`.
- **Query 5:** Delhi partner cafés & 4 target experience IDs + orphan `date_applications` check before running `07_027`.
- **Query 6:** Live RLS policies, table privileges (`reports`, `payments`, `subscriptions`, `profiles`, `cafes`, `experiences`), and `supabase_realtime` publication membership.

### 12.2 Supplementary Read-Only Queries (Audit Gaps Not Covered by `DATEVRA_MIGRATION_PREFLIGHT.sql`)

```sql
-- QUERY S1: Full live columns on subscriptions, payments, reports, profiles, cafes
-- (Confirms whether auto_renew, created_at, updated_at exist before 011/021/023/024!)
SELECT
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('subscriptions', 'payments', 'reports', 'profiles', 'cafes')
ORDER BY table_name, ordinal_position;

-- QUERY S2: Inspect live triggers on profiles/payments/subscriptions/reports/likes/matches/messages
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing || ' ' || string_agg(event_manipulation, ', ') AS event,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('profiles', 'payments', 'subscriptions', 'reports', 'likes', 'matches', 'messages', 'date_applications')
GROUP BY event_object_table, trigger_name, action_timing, action_statement
ORDER BY event_object_table, trigger_name;

-- QUERY S3: Inspect live membership_plans and pending payment rows (read-only metadata)
SELECT id, name, price, priority FROM public.membership_plans ORDER BY price;

SELECT id, kind, plan_id, amount, status, method,
       (razorpay_order_id IS NOT NULL) AS has_order_id,
       (razorpay_payment_id IS NOT NULL) AS has_payment_id,
       created_at
FROM public.payments
WHERE status = 'pending'
ORDER BY created_at DESC;
```

---

## Section 13 — Exact Next Step for ChatGPT + Beginner Owner

1. **Step 1 (Owner — Safe Read-Only Check):** Open Supabase Dashboard → Project `buendstsgzdcmzaodurp` → **SQL Editor**, and run **Query 1 through Query 6** from `DATEVRA_MIGRATION_PREFLIGHT.sql` plus **Queries S1–S3** from Section 12 above (all are 100% read-only `SELECT`s). Paste the results to ChatGPT.
2. **Step 2 (ChatGPT — Analyze Output & Prepare Exact Copy-Ready Bundle):** Using those live query outputs, confirm `subscriptions.auto_renew` / `updated_at` / `created_at` status, `pgcrypto` schema, and `002`–`008` object presence; prepare the small Gate 1 column-alignment SQL + the `% 31` rejection-sampling fix for `05_011` + the clean ordered run steps for Gates 2, 3, and 4.
3. **Step 3 (Owner — Run Gate by Gate Only When Green-Lit):** Execute one approved file/step at a time in SQL Editor, confirm `Success` before moving to the next, verify `/admin/membership-passes`, `/admin/passes`, `/admin/verification`, and Curated Experiences load cleanly without migration banners, and only **then** proceed to the separate Indian states/cities feature.

---

## Section 14 — Audit Coverage Ledger (Inspected vs Uninspected Files)

### 14.1 Files Inspected in Full
- Root config & audit/handover docs: `package.json`, `README_FIRST.md`, `DATEVRA_MIGRATION_AUDIT.md`, `DATEVRA_MIGRATION_EXECUTION_PLAN.md`, `DATEVRA_MIGRATION_PREFLIGHT.sql`, `DATEVRA_MASTER_HANDOVER.md`, `DATEVRA_PROJECT_MEMORY.md`, `FINAL_REPORT.md`
- Database SQL (`db/`): `db/schema.sql` (lines 1–600 + schema/policies/seeds), `db/realtime_setup.sql`, all 27 files in `db/migrations/` (`002` through `027` + `026_verify_seed_delhi_cafes.sql`) reviewed/inspected cleanly
- Execution Package (`datevra_migration_package/`): All 7 files (`01`–`07`, including `diff -u` against `db/migrations/` originals and full inspection of `05_011` & `06_post_011_reconciliation`)
- Frontend Adapters: `src/lib/supabase/db.ts` (full 1,619 lines across audit passes), `src/lib/supabase/mappers.ts` (full 513 lines)
- Edge Functions (`supabase/functions/`): `_shared/supabase.ts`, `create-order/index.ts`, `verify-payment/index.ts`, `razorpay-webhook/index.ts` (and prior pass read `_shared/crypto.ts`)
- UI Pages Inspected in Full / Key Sections: `src/pages/user/Membership.tsx`, `src/pages/admin/Payments.tsx`, plus prior-pass full reads of `src/pages/admin/{Verification,Memberships,MembershipPasses,Reports,Passes,Matchmaking}.tsx` and `src/pages/user/{MyPasses,Dashboard}.tsx`

### 14.2 Files Partially Inspected / Indexed / Grepped Only
- `db/000_full_setup.sql`, `db/000_full_setup_LATEST_2026-10-04.sql`, `db/000_full_setup_LATEST_2026-10-04_v2.sql` (line counts & role verified against `001`–`009` + `realtime_setup.sql`; not read line-by-line across all ~2,200 lines)
- `src/context/AuthContext.tsx`, `src/pages/admin/{Applications,Users}.tsx`, `src/pages/user/{Discover,Matches,Settings}.tsx` (targeted grep for `.rpc(`, `MIGRATION_REQUIRED`, and `MEM-` call sites)

### 14.3 Files NOT Inspected (Out of Scope / Unverified by Direct Read)
- `README.md`, `DEPLOYMENT.md`, `PHASE1_QA_RUNBOOK.md`, `.env.example`, `.oxlintrc.json`, `vercel.json`, `vite.config.ts`, `index.html`, `metadata.json`, `tsconfig*.json`, `supabase/functions/README.md`, `datevra-final-complete (1).zip`
- All 11 root `test_*.ts` verification scripts
- Remaining files under `src/lib/` (`supabase/auth.ts`, `mockDb.ts`, `data.ts`, `compat.ts`, `photos.ts`, `cafeFilter.ts`, `supabase.ts`, `types.ts`), `src/data/`, `src/components/`, and remaining `src/pages/` (`public/*`, top-level `*Page.tsx`, and remaining `admin/*` & `user/*` pages)
