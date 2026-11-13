# DATEVRA — Production Database Migration Audit & Dependency Reconciliation

- **Target Supabase Project Ref:** `buendstsgzdcmzaodurp`
- **Audit Mode:** Strictly read-only workspace & supplied live-evidence reconciliation (zero live DB connections or mutations performed).
- **Primary Objective:** Establish an exact, evidence-based map of all SQL files in `db/` and `db/migrations/`, reconcile them against the verified live findings, uncover dependency hazards and version overlaps, and prepare a safe, ordered execution package before building future features.

---

## 1. Executive Summary of Findings

1. **Baseline (`001` + `009`) Is Installed:** Live evidence confirms all 20 base tables from `db/schema.sql` and `public.daily_action_limits` from `009_daily_limits.sql` exist in `buendstsgzdcmzaodurp`. This aligns with `db/000_full_setup_LATEST_2026-10-04_v2.sql`, which bundles `schema.sql` (`001`) + `002`–`009` + `realtime_setup.sql` and stops at `009`. *(Individual `002`–`008` functions/triggers must still be confirmed via Preflight Queries 1–2.)*
2. **Passes & Curated Proposals (`010` & `011`) Are Verified Absent:** Live evidence confirms `public.complimentary_passes`, `public.match_proposals`, and `public.membership_passes` do **not** exist. All three tables plus their RPCs (`redeem_pass`, `respond_to_proposal`, `create_membership_pass`, `revoke_membership_pass`, `redeem_membership_pass`) are required for the Admin & Member passes/proposals features in `src/lib/supabase/db.ts`.
3. **Critical Cross-Migration Hazards Discovered (Would Break or Silently Regress Production If Run Out of Order):**
   - **Hazard A — `011` Overwrites `018`'s `protect_profile_fields()` Function:** `011_membership_passes.sql` rewrites `public.protect_profile_fields()` guarding only 5 columns (`is_admin`, `plan_id`, `plan_expires_at`, `verified`, `email`). `018_verification_status_and_rpc.sql` later expands it to guard 9 columns (adding `verification_status`, `verification_reviewed_at`, `verification_reviewed_by`, `verification_note`). Running `011` *after* `018` silently strips trigger protection from `verification_*` fields!
   - **Hazard B — `018` Trigger Column-List Gap (`trg_protect_profile_fields`):** Even when `018` runs *after* `011`, `018` updates the `protect_profile_fields()` function body **without** recreating the `trg_protect_profile_fields` trigger. Because `004` and `011` attach the trigger as `BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, email ON public.profiles`, an update touching *only* `verification_status` / `verification_note` / `verification_reviewed_*` would **not even fire the trigger** unless `trg_protect_profile_fields` is recreated with all 9 columns.
   - **Hazard C — `011` `pgcrypto` Schema Hazard (`gen_random_bytes(12)`):** In `011`, `datevra_internal.generate_secure_pass_code()` sets `SET search_path = public, pg_temp` and calls `gen_random_bytes(12)`. On standard Supabase projects, `pgcrypto` is installed in the `extensions` schema (`extensions.gen_random_bytes`), not `public`. Unless `extensions` is in `search_path` (`SET search_path = public, extensions, pg_temp`), `create_membership_pass()` fails at runtime with `function gen_random_bytes(integer) does not exist`. *(Verified via Preflight Query 1 before running `011`.)*
   - **Hazard D — `011` vs `024` `redeem_membership_pass()` (`subscriptions.payment_id`):** `011` inserts into `public.subscriptions` *without* `payment_id` (because `subscriptions.payment_id` is added in `021`). `024` replaces `redeem_membership_pass()` to link `payment_id`. If `021`/`024` are already live, running `011` afterwards would regress `redeem_membership_pass()` unless reconciled.
   - **Hazard E — Match Proposal Bug Chain (`010` → `014` → `015` → `016`):** `010` installs the initial `match_proposals` table and an unserialized `respond_to_proposal()`. `012` introduced an exception-rollback bug (fixed in `013`), and `014`–`016` replace `012`–`013` with the unique pending-pair index, `blocked_pair()` check, advisory pair serialization (`lock_matchmaking_pair`), lock-order deadlock fix, and `REVOKE EXECUTE` on `lock_matchmaking_pair`. Applying `010` without `014`–`016` leaves concurrency/block/duplicate-proposal vulnerabilities open. (`014`–`016` depend on `public.blocked_pair(uuid, uuid)` from `004`, which Preflight Query 1 checks first.)
4. **Delhi Cafés Seed (`026`) Is Redundant → `SKIP`:** All three Delhi cafés (`c-hot-stag-del`, `c-karmala-del`, `c-yumm-club-del`) already exist in live `public.cafes` (with `'c-karmala-del'` named `'KARMALA CAFE & RESTAURANT'`). `026` creates no schema objects and uses `ON CONFLICT (id) DO NOTHING`. Mark `026` **`SKIP`**.
5. **Curated Experiences Seed (`027`) Is Verified Needed & Line-by-Line Safe:** Live `public.experiences` lacks all 4 approved IDs (`e-hotstag-premium-date`, `e-hotstag-coffee-date`, `e-hotstag-italian`, `e-karmala-karaoke`), and both target cafés (`c-hot-stag-del`, `c-karmala-del`) have empty `experiences` arrays `{}`. Line-by-line review of `db/migrations/027_seed_curated_experiences.sql` matches the live schema and safety rules cleanly.
6. **Migrations `017`–`025` Currently `UNKNOWN`:** Live status of verification columns/RPC (`018`–`019`), payment RPCs (`021`), report audit guard (`017`/`020`/`023`), and subscription/security hardening (`022`/`024`/`025`) is **not yet verified** and is gated behind `DATEVRA_MIGRATION_PREFLIGHT.sql`.

---

## 2. Complete Repository SQL Inventory & Live Status Classification

### 2A. Root Database Files (`db/`)

| File | Purpose & Key Objects | Live Status | Notes |
|---|---|---|---|
| `db/schema.sql` | Base `001` schema: `pgcrypto`, `is_admin()`, `set_updated_at()`, 20 core tables (`profiles` .. `activity_logs`), `profiles_public` view, `handle_mutual_like()`, triggers, RLS policies, storage buckets, base 6 cafés & 3 membership plans (`connect`, `plus`, `elite`). | **VERIFIED PRESENT** (20 core tables confirmed) | Functions/triggers/RLS assumed present via setup script, double-checked in Preflight Queries 1–2. |
| `db/realtime_setup.sql` | Adds 8 core tables (`messages`, `notifications`, `matches`, `likes`, `conversations`, `date_applications`, `date_bookings`, `profiles`) to `supabase_realtime` publication. | **UNKNOWN** | Checked in Preflight Query 6. |
| `db/000_full_setup.sql` | Combined bootstrap bundling `001`–`008` + `realtime_setup.sql`. | **SUPERSEDED BY `v2`** | Historical reference bundle only; do not run on live DB. |
| `db/000_full_setup_LATEST_2026-10-04.sql` | Combined bootstrap bundling `001`–`008` + `realtime_setup.sql`. | **SUPERSEDED BY `v2`** | Historical reference bundle only; do not run on live DB. |
| `db/000_full_setup_LATEST_2026-10-04_v2.sql` | Combined bootstrap bundling `001` (`schema.sql`) + `002`–`009` + `realtime_setup.sql` (ends at line 2225; does NOT include `010+`). | **PARTIALLY PRESENT / HISTORICAL REFERENCE** | Presence of `daily_action_limits` (`009`) strongly suggests this file initialized production. Do **not** blindly re-run because interim admin write policies from `002` would conflict with `020`/`023`/`025`. |

---

### 2B. Migration Files (`db/migrations/` — All 26 Files)

| # / File | Key Objects Created / Modified | Depends On | Live Status | Action / Classification |
|---|---|---|---|---|
| `002_client_parity.sql` | Match participant UPDATE/DELETE policies; interim admin policies on `payments`, `subscriptions`, `notifications`, `activity_logs`; `payments_insert_own_pending`; `settings_public_read`; `applications_cancel_own`; `notify_on_like`, `notify_on_message`, `notify_on_application_decision`, `notify_on_booking` triggers. | `001` | **UNKNOWN** (likely present via `000_full_setup..._v2.sql`) | **VERIFY IN PREFLIGHT Q1/Q2.** Note interim admin policies on `payments`/`subscriptions` are later dropped by `025`. |
| `003_discovery_function.sql` | `discovery_profiles()`, `discovery_profile(uuid)` SECURITY DEFINER RPCs. | `001` | **UNKNOWN** (likely present) | **VERIFY IN PREFLIGHT Q1.** Actively called by `src/lib/supabase/db.ts`. |
| `004_security_hardening.sql` | `blocked_pair(uuid, uuid)`; updated `likes_insert_own`, `messages_insert_participant`; `protect_profile_fields()` + `trg_protect_profile_fields`; `freeze_message_content()` + `trg_freeze_message_content`; `enforce_application_rules()` + `trg_enforce_application_rules`. | `001`–`003` | **UNKNOWN** (likely present) | **VERIFY IN PREFLIGHT Q1/Q2.** **`blocked_pair` is a hard prerequisite for `014`–`016`!** |
| `005_account_deletion.sql` | `delete_own_account()`; `payments_one_pending_per_user_plan` partial unique index. | `001`–`004` | **UNKNOWN** (likely present) | **VERIFY IN PREFLIGHT Q1/Q2.** |
| `006_match_integrity.sql` | `freeze_match_participants()` + `trg_freeze_match_participants` on `public.matches`. | `001`–`005` | **UNKNOWN** (likely present) | **VERIFY IN PREFLIGHT Q1/Q2.** |
| `007_admin_bootstrap.sql` | `admin_exists()`, `bootstrap_first_admin(text)`. | `001`–`006` | **UNKNOWN** (likely present) | **VERIFY IN PREFLIGHT Q1.** Do **not** invoke `bootstrap_first_admin`. |
| `008_payment_retention.sql` | Drops `NOT NULL` on `payments.user_id` & `subscriptions.user_id`; updates FKs to `ON DELETE SET NULL`. | `001`–`007` | **UNKNOWN** (likely present) | **VERIFY IN PREFLIGHT Q2.** |
| `009_daily_limits.sql` | Table `daily_action_limits`; `_has_active_membership`, `_ist_today`, `_next_ist_midnight`, `_consume_daily_action`, `enforce_like_limit` + `trg_enforce_like_limit`, `record_profile_interest(uuid)`, `get_daily_usage()`, `prune_daily_action_limits()`. | `001`–`008` | **VERIFIED PRESENT** (table confirmed; RPCs/triggers checked in Q1/Q2) | **VERIFY RPCs IN Q1/Q2.** |
| `010_passes_proposals.sql` | Adds `cafes.menu`; tables `complimentary_passes`, `match_proposals` + indexes + RLS; RPCs `redeem_pass(text)`, `respond_to_proposal(uuid, boolean)`. | `001` (`cafes`, `profiles`, `matches`, `conversations`, `notifications`, `is_admin()`) | **VERIFIED ABSENT** (`complimentary_passes` & `match_proposals` missing) | **REQUIRED (Package File `01`).** |
| `011_membership_passes.sql` | Table `membership_passes` + RLS; schema `datevra_internal` + `plan_update_intents` + `pass_redemption_attempts`; **overwrites `protect_profile_fields()` (5 cols)** & recreates `trg_protect_profile_fields`; `datevra_internal.generate_secure_pass_code()`; `create_membership_pass`, `revoke_membership_pass`, `redeem_membership_pass`. | `001`, `pgcrypto`, `is_admin()` | **VERIFIED ABSENT** (`membership_passes` missing; live UI banner confirms) | **REQUIRED (Package File `05` + `06` reconciliation).** Needs `extensions` in `generate_secure_pass_code` `search_path` + post-`011` trigger/RPC reconciliation. |
| `012_proposal_block_protection.sql` | `check_proposal_not_blocked()` + `trg_check_proposal_not_blocked`, initial blocked `respond_to_proposal()`. *(Has rollback defect on exception.)* | `010`, `004` (`blocked_pair`) | **VERIFIED ABSENT** (`match_proposals` missing) | **SUPERSEDED / SKIP.** Replaced entirely by `014` + `015` + `016`. |
| `013_proposal_block_decline_persistence.sql` | Updates `respond_to_proposal()` to persist `'declined'` without throwing. | `010`, `012`, `004` | **VERIFIED ABSENT** | **SUPERSEDED / SKIP.** Replaced entirely by `015` + `016`. |
| `014_match_proposal_integrity.sql` | Pre-check DO block; unique index `idx_match_proposals_unique_pending_pair`; `check_match_proposal_integrity()` + `trg_check_match_proposal_integrity` (drops `trg_check_proposal_not_blocked`). | `010`, `004` (`blocked_pair`) | **VERIFIED ABSENT** (`match_proposals` missing) | **REQUIRED WITH `010` (Package File `02`, gated on Q1 confirming `blocked_pair`).** |
| `015_matchmaking_pair_serialization.sql` | `lock_matchmaking_pair(uuid, uuid)`; updates `check_match_proposal_integrity()`, `respond_to_proposal()`, and `handle_mutual_like()` (closes pending proposals on mutual-like match). | `010`, `014`, `004` | **PARTIALLY ABSENT / UNKNOWN** (`match_proposals` absent; `handle_mutual_like()` version checked in Q3) | **REQUIRED WITH `010` (Package File `03`, gated on Q1/Q3).** |
| `016_matchmaking_lock_order_hardening.sql` | Revokes `lock_matchmaking_pair` from `authenticated`; fixes lock-order inversion in `respond_to_proposal()` (`lock_matchmaking_pair` *before* `FOR UPDATE`). | `010`, `015`, `004` | **VERIFIED ABSENT** (`match_proposals` missing) | **REQUIRED WITH `010` (Package File `04`, gated on Q1).** |
| `017_atomic_report_status_audit.sql` | Creates `set_report_status(uuid, text)` RPC. | `001` (`reports`, `activity_logs`, `is_admin()`) | **UNKNOWN** | **SUPERSEDED BY `023` + `025` / HOLD PENDING PREFLIGHT Q1 & Q3.** |
| `018_verification_status_and_rpc.sql` | Adds 4 `verification_*` columns + `chk_profiles_verification_status` + `idx_profiles_verification_status` + backfill; **updates `protect_profile_fields()` to 9 cols (referencing `datevra_internal.plan_update_intents`)**; creates `set_user_verified(uuid, boolean, text)`. *(Bug: forgets to recreate `trg_protect_profile_fields` column list!)* | `001`, `011` (`datevra_internal.plan_update_intents` runtime ref) | **UNKNOWN** (checked in Q1–Q4) | **HOLD PENDING PREFLIGHT.** Run *after* `011` if absent, plus trigger column-list fix (`06_post_011_reconciliation.sql`). |
| `019_verification_defense_in_depth.sql` | Adds `chk_profiles_verified_status_sync` `CHECK` constraint; updates `set_user_verified()` adding self-verification rejection (`p_user_id = v_admin_id`). | `018` columns & clean backfill | **UNKNOWN** (checked in Q1–Q4) | **HOLD PENDING PREFLIGHT Q2 & Q4.** Must verify `profiles` rows have zero mismatches before adding CHECK constraint. |
| `020_enforce_audited_report_status.sql` | Drops `reports_admin_update`, adds `check_report_status_audit_guard()` & `trg_report_status_audit_guard`, adds `reports_admin_update_restricted`. | `017` | **UNKNOWN** | **SUPERSEDED BY `023` + `025` / HOLD PENDING PREFLIGHT.** |
| `021_atomic_payment_operations.sql` | Adds `subscriptions.payment_id` + `idx_subscriptions_payment_id`; creates `admin_verify_payment(uuid)`, `admin_refund_payment(uuid, text)`. | `001` (`payments`, `subscriptions`, `profiles`, `is_admin()`) | **UNKNOWN** | **HOLD PENDING PREFLIGHT Q1 & Q2.** Frontend `db.ts` actively calls both RPCs. |
| `022_subscription_admin_operations.sql` | Initial `admin_cancel_subscription`, `admin_extend_subscription` *(has NULL `plan_id` bug in `plan_update_intents` & lock-order bug)*. | `001` | **UNKNOWN** | **SUPERSEDED BY `024` / DO NOT RUN.** Run `024` instead if absent. |
| `023_reports_audit_privilege_correction.sql` | Revokes `UPDATE` on `reports`; drops `reports_admin_update*`; hardens `check_report_status_audit_guard()` (`datevra.in_audited_report_status_rpc`) & `set_report_status(uuid, text)`. | `001` (`reports`, `activity_logs`, `is_admin()`) | **UNKNOWN** | **HOLD PENDING PREFLIGHT Q1–Q3 & Q6.** |
| `024_subscription_operations_lock_order_and_cancellation_fix.sql` | Fixes lock order (`profiles -> subscriptions`) & removes invalid intent insert in `admin_cancel_subscription` & `admin_extend_subscription`; updates `redeem_membership_pass(text)` to insert `payment_id` into `subscriptions`. | `011` (`membership_passes`, `datevra_internal`), `021` (`subscriptions.payment_id`) | **UNKNOWN** *(Likely absent since `011` is absent)* | **HOLD PENDING PREFLIGHT Q1 & Q2.** |
| `025_admin_consolidated_security_and_integrity.sql` | Revokes table/column `UPDATE`/`DELETE` on `reports`, `payments`, `subscriptions`; drops `reports_admin_update*`, `payments_admin_update`, `subscriptions_admin_update`; re-grants execute on all 5 admin RPCs (`set_report_status`, `admin_verify_payment`, `admin_refund_payment`, `admin_cancel_subscription`, `admin_extend_subscription`). | `021`, `023`, `024` | **UNKNOWN** | **HOLD PENDING PREFLIGHT Q1 & Q6.** *(Note: `002` created `"payments_admin_write"` and `"subscriptions_admin_write"`, whereas `025` drops `"payments_admin_update"`/`"subscriptions_admin_update"`, though `REVOKE UPDATE, DELETE` at PostgreSQL privilege level stops all direct client updates regardless of policy name.)* |
| `026_seed_delhi_cafes.sql` | `INSERT ... ON CONFLICT (id) DO NOTHING` for `c-hot-stag-del`, `c-karmala-del`, `c-yumm-club-del`. | `001` (`cafes`) | **VERIFIED PRESENT** (all 3 rows exist in `public.cafes`) | **SKIP.** Redundant; creates zero objects and changes zero rows. |
| `026_verify_seed_delhi_cafes.sql` | Read-only 3-query verification script for `026`. | `001` (`cafes`) | **N/A (Verification Script)** | **SKIP / Optional Read-Only Reference.** |
| `027_seed_curated_experiences.sql` | Transactional seed adding 4 experiences (`e-hotstag-*`, `e-karmala-karaoke`) and appending titles to `public.cafes.experiences` (`text[]`) for `c-hot-stag-del` and `c-karmala-del`. | `001` (`experiences`, `cafes`, `date_applications`) + `c-hot-stag-del`, `c-karmala-del` | **VERIFIED ABSENT** (4 experience IDs missing; cafés have `{}`) | **REQUIRED & READY (Package File `07`).** |

---

## 3. Deep-Dive Technical Analysis by Critical Area

### A. Migration `010_passes_proposals.sql` (Café Passes & Match Proposals)
- **Live Evidence:** `public.complimentary_passes` and `public.match_proposals` are **VERIFIED ABSENT**. `public.cafes.menu` column status is `UNKNOWN` (checked in Preflight Q2).
- **Schema Compatibility Check:**
  - `complimentary_passes.cafe_id` is `text NOT NULL REFERENCES public.cafes(id) ON DELETE CASCADE` — matches live `cafes.id` (`text`, e.g., `'c-hot-stag-del'`).
  - `complimentary_passes.issued_to_user_id` & `issued_by_admin_id` reference `public.profiles(id)`.
  - `match_proposals` references `public.profiles(id)`, `public.matches(user_a, user_b)` (unique pair), `public.conversations(match_id)` (unique `match_id`), and `public.notifications(user_id, kind, title, body, link)` — all verified present in `db/schema.sql` and Live Fact A.
  - RLS & Frontend Check (`src/lib/supabase/db.ts`):
    - Admins use `.from("complimentary_passes").insert(...)` & `.update(...)` (works via `passes_admin_all FOR ALL USING (is_admin()) WITH CHECK (is_admin())`).
    - Members call `sb().rpc("redeem_pass", { p_code })` (exact parameter match).
    - Admins use `.from("match_proposals").insert(...)` (works via `proposals_admin_all FOR ALL`).
    - Members call `sb().rpc("respond_to_proposal", { p_proposal_id, p_accept })` (exact parameter match).
- **Mandatory Companion Migrations (`014` → `015` → `016`):**
  - Installing `010` alone leaves three known defects that `014`–`016` fix: duplicate pending proposals in reverse A/B order, proposing/accepting across a `public.blocks` pair, and lock-order deadlocks / unrevoked `lock_matchmaking_pair` DoS risk.
  - `012` and `013` are **superseded** and should be skipped because `014`–`016` replace all of their triggers and functions.
  - **Precondition Gate:** `014`–`016` require `public.blocked_pair(uuid, uuid)` from Migration `004` (verified in Preflight Query 1).

---

### B. Migration `011_membership_passes.sql` (Membership Passes & Atomic Provisioning)
- **Live Evidence:** `public.membership_passes` is **VERIFIED ABSENT**; `/admin/membership-passes` displays the Migration 011 dependency alert.
- **Dependencies:** `public.membership_plans` (`'connect'`, `'plus'`, `'elite'`), `public.profiles`, `public.subscriptions`, `public.payments`, `public.activity_logs`, `public.notifications`, `public.is_admin()`, and PostgreSQL `pgcrypto` (`gen_random_bytes(12)`).
- **Frontend Alignment (`src/lib/supabase/db.ts`):**
  - `create_membership_pass(p_plan_id, p_duration_days, p_expires_at, p_issued_to_user_id, p_note)` — exact match.
  - `revoke_membership_pass(p_pass_id, p_reason)` — exact match.
  - `redeem_membership_pass(p_code)` — exact match; frontend strictly validates non-empty `code`, `plan_id`, `duration_days`, `expires_at`, `payment_id`, `subscription_id`.
- **Two Critical Hazards Found in `011`:**
  1. **`pgcrypto` `search_path` Bug (`gen_random_bytes(12)`):** Line 207 of `db/migrations/011_membership_passes.sql` sets `SET search_path = public, pg_temp` on `datevra_internal.generate_secure_pass_code()`. In Supabase, `pgcrypto` is normally installed in the `extensions` schema (`extensions.gen_random_bytes`), NOT `public`. Without `extensions` in `search_path`, calling `create_membership_pass()` fails with `function gen_random_bytes(integer) does not exist`. The packaged file `05_011_membership_passes.sql` (and `06_post_011_reconciliation.sql`) sets `SET search_path = public, extensions, pg_temp`.
  2. **Function Overwrite Conflicts (`011` vs `018` and `011` vs `024`):** See Section 4 below!

---

### C. Migrations `018` & `019` (Profile Verification Status & Defense-in-Depth)
- **Live Evidence:** **UNKNOWN** (verified in Preflight Queries 1–4).
- **Technical Dependency & Bug Analysis:**
  - `018` adds `verification_status`, `verification_reviewed_at`, `verification_reviewed_by`, `verification_note` + `chk_profiles_verification_status` + `idx_profiles_verification_status` + backfill, updates `protect_profile_fields()`, and creates `set_user_verified(uuid, boolean, text)`.
  - **`018` References `011`'s Private Table:** `018`'s `protect_profile_fields()` queries `datevra_internal.plan_update_intents` (created by `011`). Therefore `011` **must run before `018`** (or `datevra_internal` must exist).
  - **`018` Trigger Column-List Bug:** `018` updates `public.protect_profile_fields()` to compare all 9 protected fields (`is_admin`, `plan_id`, `plan_expires_at`, `verified`, `verification_status`, `verification_reviewed_at`, `verification_reviewed_by`, `verification_note`, `email`), **but never recreates `trg_protect_profile_fields`**. Because `004` and `011` defined `trg_protect_profile_fields` as `BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, email ON public.profiles`, a direct client update changing *only* `verification_status` would **bypass the trigger completely** unless `trg_protect_profile_fields` is recreated covering all 9 columns!
  - `019` adds `chk_profiles_verified_status_sync` (`CHECK` constraint linking `verified` boolean ↔ `verification_status`) and upgrades `set_user_verified()` to forbid admin self-verification (`p_user_id = v_admin_id`). `019` will **fail** if any existing row violates the sync rule — Preflight Query 4 checks this safely first.

---

### D. Migrations `017`, `020`–`025` (Reports Audit, Payments, Subscriptions & Security Consolidation)
- **Live Evidence:** **UNKNOWN** (checked in Preflight Queries 1, 2, 3, 6).
- **Consolidation Chain:**
  - Reports audit: `017` → `020` → `023` → `025`. (`023` + `025` completely supersede `017` and `020`.)
  - Payments ledger: `021` adds `subscriptions.payment_id` and atomic RPCs `admin_verify_payment(uuid)` and `admin_refund_payment(uuid, text)` (both actively called by `src/lib/supabase/db.ts`).
  - Subscriptions & pass traceability: `022` introduced a fatal `NULL` `plan_id` insert into `datevra_internal.plan_update_intents` + lock-order inversion; `024` fixes both in `admin_cancel_subscription` & `admin_extend_subscription`, and updates `redeem_membership_pass` to record `payment_id` on `public.subscriptions` (depending on `011` + `021`).
  - `025` revokes `UPDATE`/`DELETE` grants on `reports`, `payments`, and `subscriptions` from `authenticated`, `anon`, and `PUBLIC` and re-verifies `EXECUTE` grants on all 5 admin RPCs. *(Note: `002` created policies named `payments_admin_write` and `subscriptions_admin_write`, whereas `025` drops `payments_admin_update` and `subscriptions_admin_update`. PostgreSQL enforces table privileges BEFORE RLS, so `REVOKE UPDATE, DELETE` in `025` blocks direct client mutations even if legacy `*_admin_write` policies exist, though Preflight Query 6 inspects exact live policies so we know cleanly.)*

---

### E. Migration `026_seed_delhi_cafes.sql` — Marked `SKIP`
- **Live Fact C:** `public.cafes` already contains:
  1. `c-hot-stag-del` (`'Café Hot Stag'`, `'Delhi'`)
  2. `c-karmala-del` (`'KARMALA CAFE & RESTAURANT'`, `'Delhi'`)
  3. `c-yumm-club-del` (`'The Yumm Club'`, `'Delhi'`)
- **Why `SKIP`:** `026_seed_delhi_cafes.sql` contains strictly 3 `INSERT INTO public.cafes ... ON CONFLICT (id) DO NOTHING;` statements and creates no tables, columns, indexes, triggers, or RPCs. Because all 3 primary keys already exist in `public.cafes`, running `026` inserts 0 rows and modifies 0 rows. Skipping it eliminates unnecessary noise and risk.

---

### F. Migration `027_seed_curated_experiences.sql` — Line-by-Line Verification
Compared `db/migrations/027_seed_curated_experiences.sql` (246 lines) against live facts `D`, `E`, `F`, `G`, `H`, `I`, and `N`:
1. **Whole-transaction wrapper (`BEGIN;` lines 28–208 `COMMIT;`):** Any preflight assertion failure rolls back cleanly before committing. (Lines 214–245 are trailing read-only `SELECT`s.)
2. **Table & column preflight (lines 35–68):** Verifies `public.experiences`, `public.cafes`, `public.date_applications`, plus columns `experiences.price_from`, `experiences.duration_mins`, and `cafes.experiences`. Matches Live Fact D.
3. **Partner café existence check (lines 71–77):** Aborts if `c-hot-stag-del` or `c-karmala-del` is absent. Matches Live Fact C.
4. **Pre-existing title conflict guard (lines 80–98):** Checks if any of the 4 target IDs exist with a mismatched title and aborts if so. Matches Live Fact F (currently all 4 are absent).
5. **Experience inserts (lines 105–171):** Inserts `e-hotstag-premium-date`, `e-hotstag-coffee-date`, `e-hotstag-italian`, `e-karmala-karaoke` using only verified live columns (`id`, `title`, `kind`, `city`, `description`, `image`, `price_from`, `duration_mins`, `eligibility`, `slots`, `elite_only`) with `ON CONFLICT (id) DO NOTHING`. Does **not** touch nonexistent `cafe_id` or `active` columns.
6. **Café `experiences` array update (lines 179–206):** Appends only missing approved titles to `public.cafes.experiences` (`text[]`) using `coalesce(experiences, '{}'::text[]) || ARRAY(...)` without duplicates or overwriting existing order. Matches Live Fact E (both arrays currently `{}`).
7. **Triggers & RLS check:** Live Fact G (`trg_set_updated_at` calls `public.set_updated_at()`, setting `NEW.updated_at = now()`) works cleanly on both tables (`updated_at` exists per schema/Fact D). Live Fact H (`cafes_admin_update`) & SQL Editor (`postgres`) execution work cleanly without RLS blocks.
8. **Verdict:** **APPROVED / READY** (`datevra_migration_package/07_027_seed_curated_experiences.sql`).

---

## 4. Critical Ordering & Reconciliation Rules

1. **Preflight First (Mandatory):** Run `DATEVRA_MIGRATION_PREFLIGHT.sql` Queries 1–6 before executing any file in `datevra_migration_package/`.
2. **Proposal Chain Ordering:** `010` (`01`) → verify `004` `blocked_pair()` → `014` (`02`) → `015` (`03`) → `016` (`04`). Skip `012` & `013`.
3. **Membership Pass + Reconciliation Ordering:** `011` (`05`, with `extensions` in `generate_secure_pass_code` `search_path`) → immediately followed by `06_post_011_reconciliation.sql`, which dynamically checks live columns:
   - If `018` (`verification_status`) is already installed, it immediately restores the 9-column `protect_profile_fields()` function **and** binds `trg_protect_profile_fields` to all 9 columns (closing `018`'s trigger column-list gap).
   - If `021` (`subscriptions.payment_id`) is already installed, it immediately upgrades `redeem_membership_pass()` to `024`'s `payment_id`-linked version.
4. **Migrations `017`–`025` Hold Rule:** Excluded from auto-execution until Preflight Queries 1–4 confirm exactly which objects are absent in `buendstsgzdcmzaodurp`.
5. **Experiences Seed (`027`):** Independent of `010`–`025` (depends only on `001` tables + `c-hot-stag-del` & `c-karmala-del` which already exist). Safe to run as `07_027_seed_curated_experiences.sql` once preflight Query 5 confirms target IDs are still clean.
