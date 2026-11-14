# DATEVRA — Production Database Migration Master Execution Plan (Gates 0–8)

- **Target Supabase Project Ref:** `buendstsgzdcmzaodurp` (`https://buendstsgzdcmzaodurp.supabase.co`)
- **Authoritative Source Inspected:** This workspace (`/app/applet` — identical exported Datevra repository tree; `datevra (2).zip` was not present alongside it on disk, and `datevra-final-complete (1).zip` is an earlier superseded archive)
- **Live Baseline Context:** *User-supplied historical baseline — must be refreshed before production execution.*
- **Execution Rule:** **Run ONE reviewed SQL file per gate.** Never combine multiple gates into one paste, never run `db/000_full_setup*.sql` on this existing database, and **never run `public.bootstrap_first_admin(text)`**.

---

## Gate Sequence Overview

| Gate | Stage | Exact Full File to Run | Status |
|---|---|---|---|
| **Gate 0** | Source Integrity & Backup | **NO SQL TO RUN** | **READY NOW (Mandatory First)** |
| **Gate 1** | Read-Only Live Preflight | `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` | **READY AFTER GATE 0** |
| **Gate 2** | Schema Compatibility Repairs | `datevra_migration_repair_package/01_gate2_schema_compatibility_repairs.sql` | **GATED ON GATE 1 APPROVAL** |
| **Gate 3** | Matchmaking & Café Passes | `datevra_migration_repair_package/02_gate3_matchmaking_and_passes.sql` | **GATED ON GATE 2 + `blocked_pair` CHECK** |
| **Gate 4** | Membership Passes & Verification | `datevra_migration_repair_package/03_gate4_membership_passes_and_verification.sql` | **GATED ON GATE 3 + `pgcrypto` & 0 MISMATCHES** |
| **Gate 5A** | Admin Payment & Subscription Lifecycle Repairs | `datevra_migration_repair_package/04_gate5_payments_and_subscription_lifecycle.sql` | **GATED ON GATE 4** |
| **Gate 5B** | Online Razorpay Edge Functions (`verify-payment`, `razorpay-webhook`, `_shared/supabase.ts`) | **NO SQL / BLOCKED** | **BLOCKED (Code-to-Schema Mismatch: `payments.verified_at` & `subscriptions.payment_id`)** |
| **Gate 6** | Reports Audit & Final Privilege Hardening | `datevra_migration_repair_package/05_gate6_reports_and_final_hardening.sql` | **GATED ON GATE 5A** |
| **Gate 7** | Conditional Curated Experiences Seed (+ Conditional Realtime) | `datevra_migration_repair_package/06_gate7_seed_curated_experiences.sql` *(and `db/realtime_setup.sql` ONLY if Gate 1 Section 12 shows `NOT_INCLUDED`)* | **GATED ON GATE 1 SECTION 11/12 & GATE 6** |
| **Gate 8** | Final Preflight & Staging Workflow Verification | `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` *(re-run read-only)* | **GATED ON GATE 7** |

---

## GATE 0 — Source Integrity & Supabase Backup

1. **Exact full filename to run:** **NO SQL IS TO BE RUN AT GATE 0.**
2. **What it changes in plain English:** Changes nothing in Supabase or code. Confirms you have the authoritative workspace, have no unsaved local edits that could clash, and creates a restorable safety backup in Supabase Dashboard before any future database write touches live user profiles (`52` in historical baseline) or the pending ₹1,199 payment.
3. **Preconditions:**
   - Access to Supabase Dashboard for project `buendstsgzdcmzaodurp`.
   - Confirmation that you are working from the current workspace (`db/` + `datevra_migration_repair_package/`). Do not overwrite it with older archives (`datevra-final-complete (1).zip`).
4. **Expected success output:**
   - A completed manual backup/snapshot (or verified Supabase daily/PITR restore point timestamp noted down) visible in Supabase Dashboard → **Database → Backups**.
5. **How to verify:**
   - Confirm the backup timestamp is recorded and later than any recent live change in project `buendstsgzdcmzaodurp`.
6. **What to do if it errors / backup is unavailable:**
   - If your Supabase plan does not support on-demand backups or PITR, export a clean logical backup (`pg_dump` schema + data) via a trusted local admin environment before running any write SQL. Do not proceed to write gates without a recovery point.
7. **Whether the next gate is unlocked:**
   - Yes — **Gate 1 (`00_READ_ONLY_PREFLIGHT.sql`) is safe to run immediately after Gate 0**, because Gate 1 is 100% read-only (`SELECT` only).

---

## GATE 1 — Strictly Read-Only Live Preflight

1. **Exact full filename to run:** `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` (follow `DATEVRA_MIGRATION_PREFLIGHT_GUIDE.md`).
2. **What it changes in plain English:** Changes **zero** tables, columns, rows, triggers, or permissions. It runs 12 read-only `SELECT` inspection queries returning table schemas, constraints, function signatures, triggers, RLS policies, grants, aggregate counts (zero PII), consistency counts, café/experience records, and `pgcrypto`/realtime status.
3. **Preconditions:**
   - Gate 0 completed.
   - Logged into Supabase Dashboard (`buendstsgzdcmzaodurp`) → **SQL Editor**.
4. **Expected success output:**
   - Query tables matching the 12 sections described in `datevra_migration_repair_package/00_PREFLIGHT_EXPECTED_RESULTS.md`. Zero SQL errors (every optional table/column check is catalog-guarded).
5. **How to verify:**
   - Save or paste all 12 section results into your ChatGPT review session and compare every line against `datevra_migration_repair_package/00_PREFLIGHT_EXPECTED_RESULTS.md`.
   - Confirm Section 10 returns `issue_count = 0` for all 6 relational/integrity checks.
   - Confirm Section 4 shows `public.blocked_pair(uuid,uuid)` = `present: true`.
   - Confirm Section 12 shows `pgcrypto` in `extensions` or `public`.
   - Confirm Section 11 confirms `c-hot-stag-del`, `c-karmala-del`, `c-yumm-club-del` exist and target `e-*` experience IDs do not conflict.
6. **What to do if it errors or returns unexpected results:**
   - If a section errors in SQL Editor, run sections one at a time (each `SECTION N [READ-ONLY]` block is standalone) and share the exact error message with ChatGPT.
   - If Section 10 shows `issue_count > 0`, or `RLS_DISABLED`, or `blocked_pair` is missing, **STOP**. Do not run Gate 2+. Ask ChatGPT to update the plan from the fresh preflight evidence.
7. **Whether the next gate is unlocked:**
   - **No automatic unlock.** Gate 2 is unlocked ONLY after ChatGPT reviews your pasted Gate 1 results against `00_PREFLIGHT_EXPECTED_RESULTS.md`.

---

## GATE 2 — Schema Compatibility Repairs

1. **Exact full filename to run:** `datevra_migration_repair_package/01_gate2_schema_compatibility_repairs.sql`
2. **What it changes in plain English:**
   - Safely adds missing compatibility columns only if absent: `public.cafes.menu`, `public.subscriptions.auto_renew`, `public.subscriptions.created_at`, `public.subscriptions.updated_at`, `public.payments.created_at`, `public.payments.updated_at`, and `public.reports.updated_at`, plus `trg_set_updated_at` triggers.
   - Ensures Migration 008 account-deletion retention FKs (`payments.user_id` and `subscriptions.user_id` nullable with `ON DELETE SET NULL`).
   - Ensures Migration 005 partial unique index `payments_one_pending_per_user_plan` exists (aborting cleanly if duplicate pending `(user_id, plan_id)` rows already exist).
   - Deliberately does **NOT** add `payments.verified_at` (that belongs to Gate 5B BLOCKED Edge Function reconciliation).
3. **Preconditions:**
   - Gate 0 backup completed + Gate 1 preflight approved.
   - All core base tables (`profiles`, `subscriptions`, `payments`, `reports`, `cafes`, `experiences`, `membership_plans`, `activity_logs`, `notifications`) and `is_admin()` / `set_updated_at()` exist.
   - Zero duplicate pending `(user_id, plan_id)` payments exist in `public.payments`.
4. **Expected success output:**
   - `Success. No rows returned` (or PostgreSQL `COMMIT` notice) with zero `GATE2_PRECONDITION_FAILED` or `GATE2_POSTCONDITION_FAILED` exceptions.
5. **How to verify:**
   - Run Section 1 and Section 2 of `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` and verify:
     - `public.subscriptions` has `auto_renew`, `created_at`, `updated_at` and FK `payments_user_id_fkey` / `subscriptions_user_id_fkey` status = `SET NULL`.
     - `public.cafes` has `menu`, `public.reports` has `updated_at`.
     - `payments_one_pending_per_user_plan` = `PRESENT`.
6. **What to do if it errors:**
   - Because the file runs inside `BEGIN; ... COMMIT;`, any exception automatically rolls back 100% of changes in Gate 2.
   - Copy the exact error message (e.g., `GATE2_PRECONDITION_FAILED: ... duplicate pending ...`), stop, and share it with ChatGPT before retrying.
7. **Whether the next gate is unlocked:**
   - **Yes**, once Gate 2 commits cleanly and verification confirms the new columns/constraints.

---

## GATE 3 — Matchmaking Serialization & Complimentary Café Passes

1. **Exact full filename to run:** `datevra_migration_repair_package/02_gate3_matchmaking_and_passes.sql`
2. **What it changes in plain English:**
   - Installs `public.complimentary_passes`, indexes, RLS, and `public.redeem_pass(text)` (replacing Migration `010`).
   - Installs `public.match_proposals`, canonical unordered pending-pair unique index `idx_match_proposals_unique_pending_pair`, and strict RLS.
   - Consolidates `014` + `015` + `016` (completely skipping buggy `012` and superseded `013`): installs internal `public.lock_matchmaking_pair(uuid, uuid)` with client `EXECUTE` revoked, installs `trg_check_match_proposal_integrity` (`BEFORE INSERT`), hardens `public.respond_to_proposal(uuid, boolean)` with canonical lock order (`Advisory Pair Lock -> match_proposals Row Lock -> matches`), `p_accept IS NULL` validation, one-time vote guard, and non-throwing `'declined'` persistence if blocked, and updates `public.handle_mutual_like()` to share the same pair lock and block check.
3. **Preconditions:**
   - Gate 2 applied (`public.cafes.menu` exists).
   - Gate 1 Section 4 confirmed `public.blocked_pair(uuid, uuid)` (Migration `004`) exists.
   - Gate 1 Section 2 confirmed unique constraints on `public.matches(user_a, user_b)` and `public.conversations(match_id)`.
   - Zero duplicate pending proposals or pending proposals on existing matches.
4. **Expected success output:**
   - Clean transaction commit (`Success. No rows returned`).
5. **How to verify:**
   - Run Sections 1, 2, 4, 5, and 6 of `00_READ_ONLY_PREFLIGHT.sql`:
     - `complimentary_passes` and `match_proposals` exist with `RLS_ENABLED`.
     - `idx_match_proposals_unique_pending_pair` = `PRESENT`.
     - `redeem_pass(text)`, `respond_to_proposal(uuid,boolean)`, `check_match_proposal_integrity()`, `handle_mutual_like()` show `SECURITY DEFINER` with `search_path=pg_catalog, public, pg_temp`.
     - `lock_matchmaking_pair(uuid,uuid)` ACL excludes `PUBLIC`, `anon`, and `authenticated`.
     - `/admin/passes` in the app loads cleanly without the Migration `010` banner.
6. **What to do if it errors:**
   - Transaction rolls back automatically (`BEGIN ... COMMIT`). Check whether `GATE3_PRECONDITION_FAILED` flagged missing `blocked_pair(uuid,uuid)` (in which case review `004` with ChatGPT before proceeding).
7. **Whether the next gate is unlocked:**
   - **Yes**, once Gate 3 verification passes.

---

## GATE 4 — Membership Passes & Profile Verification Integrity

1. **Exact full filename to run:** `datevra_migration_repair_package/03_gate4_membership_passes_and_verification.sql`
2. **What it changes in plain English:**
   - Creates `public.membership_passes` with strict least-privilege RLS (`SELECT` only; no client `INSERT/UPDATE/DELETE`) and private schema `datevra_internal` (`plan_update_intents`, `pass_redemption_attempts`) completely locked down from `PUBLIC`/`anon`/`authenticated`.
   - Fixes the broken 31-character `% 32` pass generator bug from `011` / `05_011` using unbiased rejection sampling (`v_byte < 248` -> `% 31 + 1`) and `extensions` in `search_path`, guaranteeing 100% valid 18-character `MEM-XXXX-XXXX-XXXX` codes.
   - Installs `create_membership_pass`, `revoke_membership_pass`, and initial `redeem_membership_pass` (canonical lock order `profiles -> subscriptions -> attempts -> membership_passes`).
   - Adds `verification_status`, `verification_reviewed_at`, `verification_reviewed_by`, `verification_note`, backfills cleanly, adds `chk_profiles_verified_status_sync`, installs hardened `public.set_user_verified(uuid, boolean, text)` (rejecting `NULL` `p_verified` and self-verification), and installs the **unified 9-column `protect_profile_fields()` + `trg_protect_profile_fields`** (`BEFORE UPDATE OF` all 9 sensitive fields + 5-minute `plan_update_intents` freshness check) so `011` never overwrites `018` and `018` never leaves a 5-column trigger gap.
3. **Preconditions:**
   - Gate 2 applied (`subscriptions.auto_renew` exists).
   - Gate 1 Section 12 confirmed `pgcrypto` exists in `extensions` or `public`.
   - Zero pre-existing `verified` vs `verification_status` mismatches in `public.profiles`.
4. **Expected success output:**
   - Clean transaction commit (`Success. No rows returned`).
5. **How to verify:**
   - Run Sections 1, 2, 4, 5, 6, and 8 of `00_READ_ONLY_PREFLIGHT.sql`:
     - `membership_passes` exists with `RLS_ENABLED` and `datevra_internal.*` tables exist.
     - Section 5 `trg_protect_profile_fields` definition lists **all 9 columns** (`is_admin, plan_id, plan_expires_at, verified, verification_status, verification_reviewed_at, verification_reviewed_by, verification_note, email`).
     - Section 8 confirms `datevra_internal.generate_secure_pass_code()` contains `IF v_byte < 248 THEN` and `(v_byte % 31) + 1`.
     - `/admin/membership-passes` and `/admin/verification` load cleanly without Migration `011` / `019` dependency warnings.
6. **What to do if it errors:**
   - Transaction rolls back cleanly. If `GATE4_PRECONDITION_FAILED` reports `pgcrypto` missing or verification row mismatch, stop and send output to ChatGPT.
7. **Whether the next gate is unlocked:**
   - **Yes**, once Gate 4 verification passes.

---

## GATE 5A — Atomic Payment & Subscription Lifecycle Repairs

1. **Exact full filename to run:** `datevra_migration_repair_package/04_gate5_payments_and_subscription_lifecycle.sql`
2. **What it changes in plain English:**
   - Adds `public.subscriptions.payment_id` (`REFERENCES public.payments(id) ON DELETE SET NULL`) + non-unique index `idx_subscriptions_payment_id` (cleanly supporting renewals, extensions, and multi-row history).
   - Replaces raw `021` with **fail-closed `public.admin_verify_payment(uuid)`**: eliminates fake `'pay_' || gen_random_uuid()` ID fabrication and refuses to verify pending Razorpay orders unless genuine `razorpay_payment_id LIKE 'pay_%'`, non-placeholder `razorpay_order_id`, and exact `membership_plans.price` are present.
   - Replaces raw `021` `public.admin_refund_payment(uuid, text)`: marks ledger `status = 'refunded'` (explicitly logged as **ledger-only** — does NOT call Razorpay Refund API) and revokes **only** an active subscription strictly linked by `payment_id = p_payment_id` (removing `021`'s dangerous fallback sweep), while safely handling `user_id IS NULL` anonymized records (`008`).
   - Replaces broken `022` & raw `024` `admin_cancel_subscription(uuid, text)` and `admin_extend_subscription(uuid, integer, text)` using canonical lock order (`profiles -> subscriptions`) and zero invalid `plan_update_intents` inserts.
   - Upgrades `public.redeem_membership_pass(text)` to populate `subscriptions.payment_id`.
3. **Preconditions:**
   - Gate 2 applied (`subscriptions` and `payments` timestamps & `auto_renew` exist).
   - Gate 4 applied (`datevra_internal.plan_update_intents`, `membership_passes`, 9-column trigger exist).
4. **Expected success output:**
   - Clean transaction commit (`Success. No rows returned`).
5. **How to verify:**
   - Run Sections 1, 2, 4, and 8 of `00_READ_ONLY_PREFLIGHT.sql`:
     - `subscriptions.payment_id` and non-unique `idx_subscriptions_payment_id` exist.
     - `admin_verify_payment(uuid)`, `admin_refund_payment(uuid,text)`, `admin_cancel_subscription(uuid,text)`, `admin_extend_subscription(uuid,integer,text)` all show `SECURITY DEFINER` and `search_path=pg_catalog, public, pg_temp`.
     - Section 8 confirms `admin_verify_payment` contains `GATEWAY_VERIFICATION_REQUIRED` and zero `gen_random_uuid` `'pay_'` fallback; `admin_refund_payment` uses strict `WHERE payment_id = p_payment_id`.
6. **What to do if it errors:**
   - Transaction rolls back cleanly. Report exact SQL error to ChatGPT; do not attempt manual fixes to pending payments (especially the ₹1,199 pending row).
7. **Whether the next gate is unlocked:**
   - **Gate 6 is unlocked** once Gate 5A verifies cleanly.
   - **Gate 5B (live Razorpay Edge Functions) remains `BLOCKED` (see below).**

---

## GATE 5B — Online Razorpay Edge Functions Deployment — **STATUS: `BLOCKED`**

1. **Exact full filename to run:** **NO SQL TO RUN — `BLOCKED` UNTIL CODE/SCHEMA RECONCILIATION.**
2. **What is blocked and why (source-verified):**
   - `supabase/functions/verify-payment/index.ts:104` and `supabase/functions/razorpay-webhook/index.ts:83` execute `.update({ status: "verified", razorpay_payment_id: ..., verified_at: new Date().toISOString() })`, writing to a `payments.verified_at` column that **does not exist** in `db/schema.sql`, any migration `002`–`027`, or the historical baseline!
   - `supabase/functions/_shared/supabase.ts:63-70` (`activateMembership`) inserts into `public.subscriptions` without passing `payment_id`, leaving online Razorpay checkouts unlinked for `admin_refund_payment`.
   - `admin_refund_payment` in SQL is **ledger-only**; automated Razorpay gateway refunds would require a separate Razorpay Refund API Edge Function if online refunds are desired.
3. **Preconditions before unblocking Gate 5B:**
   - A dedicated, explicitly authorized application + Edge Function + SQL schema alignment task deciding whether to (a) add `payments.verified_at` or remove it from the two Edge Functions, and (b) update `activateMembership` to store `payment_id`.
4. **Expected success output / Verification / Errors:** N/A while `BLOCKED`.
5. **Whether the next gate is unlocked:**
   - Gate 5B is independent of Gate 6 & Gate 7! You **can** proceed to Gate 6 and Gate 7 safely while keeping live Razorpay Edge Functions disabled (`razorpay_test_mode` / manual admin non-deployment).

---

## GATE 6 — Reports Audit Trail & Final Privilege Hardening

1. **Exact full filename to run:** `datevra_migration_repair_package/05_gate6_reports_and_final_hardening.sql`
2. **What it changes in plain English:**
   - Consolidates `023` + `025` cleanly (superseding `017` and `020`): installs `check_report_status_audit_guard()`, `trg_report_status_audit_guard`, and `public.set_report_status(uuid, text)` so report status transitions only succeed inside the audited RPC and always log to `activity_logs`.
   - Revokes both table-level AND column-level `UPDATE` and `DELETE` on `public.reports`, `public.payments`, and `public.subscriptions` from `authenticated`, `anon`, and `PUBLIC`.
   - Drops legacy direct-mutation policies **including the `002_client_parity.sql` policy names missed by raw `025`**: `"payments_admin_write"` and `"subscriptions_admin_write"`, alongside `"reports_admin_update"`, `"reports_admin_update_restricted"`, `"payments_admin_update"`, `"subscriptions_admin_update"`.
   - Preserves app-required grants/policies: `SELECT, INSERT` on `reports` and `payments`, `SELECT` on `subscriptions`, AND adds narrow `"payments_admin_insert"` (`FOR INSERT WITH CHECK (public.is_admin())`) so Admin cash payment recording (`src/lib/supabase/db.ts:945`) keeps working after `"payments_admin_write"` is dropped!
   - Re-verifies `EXECUTE` grants on all 6 client-callable admin RPCs and revocations on internal helpers (`lock_matchmaking_pair`, `generate_secure_pass_code`).
   - Applies source-verified `SET search_path = pg_catalog, public, pg_temp` to the 3 remaining `004`/`006` trigger functions (`enforce_application_rules()`, `freeze_match_participants()`, `freeze_message_content()`).
3. **Preconditions:**
   - Gate 2 applied (`public.reports.updated_at` exists).
   - Gate 5A applied (`admin_verify_payment`, `admin_refund_payment`, `admin_cancel_subscription`, `admin_extend_subscription` all exist — preventing raw `025`'s ordering crash).
4. **Expected success output:**
   - Clean transaction commit (`Success. No rows returned`).
5. **How to verify:**
   - Run Sections 4, 5, 6, and 7 of `00_READ_ONLY_PREFLIGHT.sql`:
     - Section 7 shows `authenticated` has ONLY `SELECT, INSERT` on `reports` & `payments` and `SELECT` on `subscriptions`; **zero** `UPDATE` or `DELETE` table/column privileges for `anon`, `authenticated`, or `PUBLIC`.
     - Section 6 shows `"payments_admin_write"`, `"subscriptions_admin_write"`, and `"reports_admin_update*"` are gone, while `"payments_admin_insert"` and `"payments_insert_own_pending"` remain active.
     - Section 4 shows `enforce_application_rules()`, `freeze_match_participants()`, and `freeze_message_content()` now have `search_path=pg_catalog, public, pg_temp` configured.
6. **What to do if it errors:**
   - Transaction rolls back cleanly. If any admin RPC is reported missing, verify Gate 4 & Gate 5A succeeded first.
7. **Whether the next gate is unlocked:**
   - **Yes**, Gate 7 is unlocked once Gate 6 verification passes.

---

## GATE 7 — Conditional Curated Experiences Seed (+ Optional Realtime)

1. **Exact full filename to run:**
   - `datevra_migration_repair_package/06_gate7_seed_curated_experiences.sql` *(Run ONLY if Gate 1 Section 11 confirms any of the 4 target `e-*` experiences are missing from `public.experiences` or missing from `cafes.experiences`.)*
   - Conditionally ALSO run `db/realtime_setup.sql` **ONLY** if Gate 1 Section 12 shows any of the 8 core tables as `NOT_INCLUDED` in `supabase_realtime`.
   - **DO NOT RUN `db/migrations/026_seed_delhi_cafes.sql`** (marked `SKIP`: partner Delhi cafés already exist).
2. **What it changes in plain English:**
   - Verifies `'c-hot-stag-del'` (`'Café Hot Stag'`, `'Delhi'`) and `'c-karmala-del'` (`'KARMALA CAFE & RESTAURANT'`, `'Delhi'`) exist.
   - Inserts the 4 approved Delhi experiences (`e-hotstag-premium-date`, `e-hotstag-coffee-date`, `e-hotstag-italian`, `e-karmala-karaoke`), comparing ALL 10 fields if any ID already exists and aborting cleanly on any mismatch (`GATE7_SEED_CONFLICT`) instead of silently ignoring drifted rows.
   - Appends missing titles cleanly to `public.cafes.experiences` without duplicates.
3. **Preconditions:**
   - Gate 1 Section 11 confirmed `c-hot-stag-del` & `c-karmala-del` exist and either target `e-*` IDs are absent or match exact seed values.
   - `experiences`, `cafes`, and `date_applications` exist.
4. **Expected success output:**
   - Clean transaction commit (`Success. No rows returned`).
5. **How to verify:**
   - Run Section 11 (and Section 12 if `db/realtime_setup.sql` was run) of `00_READ_ONLY_PREFLIGHT.sql`:
     - All 4 `e-*` experiences appear with exact titles, prices (`3200` / `4500`), durations, and `c-hot-stag-del` / `c-karmala-del` `experiences` arrays contain the matching titles.
6. **What to do if it errors:**
   - Transaction rolls back automatically. If `GATE7_SEED_CONFLICT` appears, do not overwrite live rows blindly — send the conflict details to ChatGPT to reconcile with existing `date_applications`.
7. **Whether the next gate is unlocked:**
   - **Yes**, Gate 8 (final read-only verification) is unlocked.

---

## GATE 8 — Final Read-Only Verification & Staging Workflow Testing

1. **Exact full filename to run:** `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` (full read-only re-run in Supabase SQL Editor).
2. **What it changes in plain English:** Changes nothing (`SELECT`-only). Captures the final post-repair structural, security, trigger, privilege, and consistency state for final sign-off, followed by safe test-account checks in local/staging (without real charges, real refunds, or touching the live ₹1,199 pending payment).
3. **Preconditions:**
   - Gates 0–7 completed and verified.
4. **Expected success output:**
   - Zero errors across all 12 preflight sections:
     - All 6 Section 10 integrity checks = `0`.
     - Section 5 `trg_protect_profile_fields` shows all **9 columns**.
     - Section 7 shows zero client `UPDATE`/`DELETE` grants on `reports`, `payments`, `subscriptions`.
     - Section 8 `datevra_internal.generate_secure_pass_code()` shows `< 248` / `% 31`.
     - All tables show `RLS_ENABLED`.
5. **How to verify:**
   - Paste the final Gate 8 preflight results into ChatGPT for confirmation, then run non-destructive staging/test-account UI smoke checks (`/admin/membership-passes`, `/admin/passes`, `/admin/verification`, `/admin/reports`, `/app/experiences`). Do **not** trigger live Razorpay checkout or click Verify/Refund on the live ₹1,199 pending payment.
6. **What to do if it errors or fails any post-check:**
   - Stop before opening production traffic to repaired flows and share the exact failing section output with ChatGPT (refer to `DATEVRA_MIGRATION_ROLLBACK_AND_RECOVERY.md`).
7. **Whether the next gate is unlocked:**
   - **Database migration track complete** (with Gate 5B online Razorpay Edge Functions remaining explicitly `BLOCKED` until a separate code/schema alignment task is authorized).
