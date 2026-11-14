# DATEVRA — Migration Rollback, Irreversibility & Recovery Strategy

> **Honest Engineering Policy:** Forward-only migrations are the safest production practice, and **not all database operations are cleanly reversible without a backup**. Never rely on ad-hoc `DROP` scripts in production — **Gate 0 backup/snapshot before Gate 2 writes is mandatory.**

---

## 1. Mandatory Gate 0 Recovery Point (Before Any Write SQL)

1. Before running **Gate 2** (`01_gate2_schema_compatibility_repairs.sql`), take or confirm a Supabase Backup / Restore Point on project **`buendstsgzdcmzaodurp`** (Dashboard → **Database → Backups**), or capture a complete `pg_dump` snapshot.
2. Every executable repair SQL file (`01_gate2` through `06_gate7`) runs inside a single **`BEGIN; ... COMMIT;`** transaction:
   - **If ANY precondition check or SQL statement errors inside a gate**, PostgreSQL **automatically rolls back 100%** of that file before anything is saved. You do **not** need a rollback script for a failed gate.
   - Rollback considerations apply **only after a gate commits cleanly** and later behavior proves unsatisfactory.

---

## 2. Honest Gate-by-Gate Reversibility Assessment

| Gate & Exact File | What Can Be Reversed Cleanly | What Is Irreversible or Hazardous Without Backup | Recommended Recovery Strategy |
|---|---|---|---|
| **Gate 0 & Gate 1**<br>`00_READ_ONLY_PREFLIGHT.sql` | Everything (zero changes made). | None. | Nothing to roll back. |
| **Gate 2**<br>`01_gate2_schema_compatibility_repairs.sql` | Added triggers (`trg_set_updated_at`), index `payments_one_pending_per_user_plan`, and FK constraints can be dropped/reverted (`DROP INDEX` / `ALTER TABLE ... DROP CONSTRAINT`). | Once rows populate `cafes.menu`, `subscriptions.auto_renew`, `created_at`, `updated_at`, or `reports.updated_at`, dropping columns destroys newly written data. Changing `payments.user_id` back to `NOT NULL` fails if anonymized rows (`user_id IS NULL`) exist. | Keep additive columns/constraints (all match `db/schema.sql` and `005`/`008`); only restore from Gate 0 backup if catastrophic unforeseen drift occurred. |
| **Gate 3**<br>`02_gate3_matchmaking_and_passes.sql` | Functions (`redeem_pass`, `respond_to_proposal`, `check_match_proposal_integrity`, `lock_matchmaking_pair`) can be replaced; `idx_match_proposals_unique_pending_pair` can be dropped. | **Once live admins issue passes or proposals, or users trigger mutual matches**, dropping `complimentary_passes` or `match_proposals` destroys live user/pass history. Side effects in `matches`/`conversations`/`notifications` created by `respond_to_proposal` or `handle_mutual_like` are permanent data mutations. | Never run `DROP TABLE ... CASCADE`. If a bug is found, patch forward via `CREATE OR REPLACE FUNCTION`; if pre-traffic rollback is needed immediately after deploy, restore Gate 0 backup. |
| **Gate 4**<br>`03_gate4_membership_passes_and_verification.sql` | Verification RPC (`set_user_verified`), pass RPCs, and `chk_profiles_verified_status_sync` constraint can be altered/replaced forward-only. | **Backfill of `profiles.verification_status`**, plus any live membership pass redemptions (which write `payments`, `subscriptions`, `profiles.plan_id`, `notifications`, `activity_logs`) cannot be undone by dropping functions. Dropping `membership_passes` or `datevra_internal` after redemptions destroys financial audit history. | Never revert `protect_profile_fields` back to 5 columns! Fix logic bugs forward-only via `CREATE OR REPLACE FUNCTION`, or restore pre-Gate-4 backup if caught before member redemptions. |
| **Gate 5A**<br>`04_gate5_payments_and_subscription_lifecycle.sql` | `admin_verify_payment`, `admin_refund_payment`, `admin_cancel_subscription`, `admin_extend_subscription`, and `redeem_membership_pass` bodies can be updated via `CREATE OR REPLACE FUNCTION`. | Any live payment marked `'verified'` or `'refunded'`, or subscription cancelled/extended/linked via `payment_id`, writes permanent ledger & profile state + notifications + `activity_logs`. | **Financial ledger state is append/state-machine critical:** never blindly delete rows. Patch RPC bugs forward-only; if corrupted test/prod rows occurred, restore Gate 0 / pre-Gate-5 backup. |
| **Gate 6**<br>`05_gate6_reports_and_final_hardening.sql` | **Highest reversibility:** `GRANT SELECT, UPDATE ...` or `ALTER FUNCTION ... RESET search_path` or `DROP TRIGGER trg_report_status_audit_guard` can temporarily restore prior access if an unexpected client query breaks, though doing so weakens security. | None structural (purely triggers, grants, policies, `search_path`). | If an authorized client path breaks unexpectedly, inspect PostgreSQL permission error first and prefer a narrow RPC or policy fix rather than re-granting table-wide `UPDATE`/`DELETE`. |
| **Gate 7**<br>`06_gate7_seed_curated_experiences.sql` *(and conditional `db/realtime_setup.sql`)* | Removing tables from `supabase_realtime` (`ALTER PUBLICATION supabase_realtime DROP TABLE ...`) is cleanly reversible. | **Once any user submits a `date_application` against a seeded `e-*` experience**, deleting that experience row is blocked by `ON DELETE RESTRICT` (`date_applications_experience_id_fkey`) and would break user applications. Deleting/editing `cafes.experiences` text arrays after launch risks UI mismatch. | Verify exact seed data in Gate 1 + Gate 7 exact-match checks BEFORE running; after applications exist, adjust rows via careful `UPDATE`, never `DELETE`. |

---

## 3. Incident Recovery Playbook (If Something Fails Live)

1. **Error occurred DURING execution of a Gate file (`GATE*_PRECONDITION_FAILED`, constraint error, permission error):**
   - **Action:** Stop immediately. Do **not** run later gates or re-paste partial chunks.
   - Because each repair gate uses `BEGIN; ... COMMIT;`, nothing from that file was committed.
   - Copy the exact SQL Editor error message and share it with ChatGPT to diagnose cleanly.
2. **Error discovered AFTER a gate committed:**
   - **Option A (Preferred for logic/RLS/grant adjustments before/after user traffic):** Keep newly created tables/data intact and author a dedicated forward-only hotfix SQL script after inspecting live state with `00_READ_ONLY_PREFLIGHT.sql`.
   - **Option B (Emergency state recovery before new production traffic):** Restore the Supabase backup taken at **Gate 0** (or exact timestamp before the faulty gate), verify with `00_READ_ONLY_PREFLIGHT.sql`, and fix the script before re-applying.
3. **Strict Prohibition:**
   - Never run `db/000_full_setup*.sql` as a "reset" on the existing database.
   - Never disable RLS (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`) or disable triggers (`ALTER TABLE ... DISABLE TRIGGER ALL`) to bypass an error.
