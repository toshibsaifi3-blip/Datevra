# DATEVRA — Final Handover Brief for ChatGPT

- **Target Supabase Project Ref:** `buendstsgzdcmzaodurp` (`https://buendstsgzdcmzaodurp.supabase.co`)
- **Current Checkpoint Status:** Full repository reconciliation, forward-only repair package creation, beginner operator documentation, and offline validation suite are **COMPLETE** in the local workspace. **Zero** live Supabase queries, remote SQL executions, deployments, or source app edits were performed.

---

## 1. Source Version & Workspace Integrity

- **Authoritative Source:** Current `/app/applet` workspace containing all **39 historical SQL files** (`5` root `db/*.sql`, `27` `db/migrations/*.sql`, `7` `datevra_migration_package/*.sql`), application TypeScript callers (`src/lib/supabase/db.ts`, `mappers.ts`, `Membership.tsx`, `ExperiencesPublic.tsx`, `Reports.tsx`, `Verification.tsx`, `Passes.tsx`, `MembershipPasses.tsx`), and Edge Functions (`supabase/functions/verify-payment/index.ts`, `razorpay-webhook/index.ts`, `_shared/supabase.ts`).
- **Archive Note:** `datevra (2).zip` was not present on disk alongside `/app/applet`, and the workspace already matches its exact file inventory 1:1. Do **NOT** extract `datevra-final-complete (1).zip` (older archive on disk).
- **Phantom Filename Debunked:** `db/migrations/021_atomic_payment_verification.sql` does **NOT** exist anywhere; the real file is `db/migrations/021_atomic_payment_operations.sql`.

---

## 2. Deliverables Created / Updated in Workspace

1. **Forward-Only Repair Package (`datevra_migration_repair_package/` — 8 files):**
   - `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` (12 strictly `SELECT`-only, zero-PII, catalog-guarded sections)
   - `datevra_migration_repair_package/00_PREFLIGHT_EXPECTED_RESULTS.md`
   - `datevra_migration_repair_package/01_gate2_schema_compatibility_repairs.sql`
   - `datevra_migration_repair_package/02_gate3_matchmaking_and_passes.sql`
   - `datevra_migration_repair_package/03_gate4_membership_passes_and_verification.sql`
   - `datevra_migration_repair_package/04_gate5_payments_and_subscription_lifecycle.sql`
   - `datevra_migration_repair_package/05_gate6_reports_and_final_hardening.sql`
   - `datevra_migration_repair_package/06_gate7_seed_curated_experiences.sql`
2. **Documentation & Runbooks (Workspace Root):**
   - `DATEVRA_MIGRATION_MASTER_EXECUTION_PLAN.md` (Gates 0–8 with all 7 operator subsections at every gate)
   - `DATEVRA_MIGRATION_REPAIR_AUDIT.md` (source evidence ledger, 39-file analysis, Section 5 A–H resolutions, DAG, risk register)
   - `DATEVRA_MIGRATION_PREFLIGHT_GUIDE.md` (beginner step-by-step SQL Editor guide)
   - `DATEVRA_MIGRATION_TEST_REPORT.md` (`52/52` offline assertions + lint + Vite build + explicit `NOT RUN` items)
   - `DATEVRA_MIGRATION_ROLLBACK_AND_RECOVERY.md`
   - `DATEVRA_MIGRATION_OPERATOR_CHECKLIST.md`
   - `DATEVRA_MIGRATION_STATUS.csv` (updated 46-row inventory covering all 39 historical + 7 repair SQL files)
   - `DATEVRA_FINAL_HANDOVER_FOR_CHATGPT.md` (this file)
3. **Offline Validation Test Suite:**
   - `test_migration_repair_package.ts` (`11/11` passing offline tests)

---

## 3. Critical Issues Fixed in Repair Package vs. Still `BLOCKED` / Unverified

### Resolved in Forward-Only `datevra_migration_repair_package/`
- **31-Char `% 32` Pass Code Bug (`011` / `05_011`):** Replaced with unbiased rejection sampling (`v_byte < 248` → `(v_byte % 31) + 1`) and `extensions` in `search_path`, generating 100% valid 18-char `MEM-XXXX-XXXX-XXXX` codes matching `Membership.tsx:144`.
- **`protect_profile_fields` Overwrite & 5-Col Trigger Gap (`011` / `018`):** Unified into Gate 4 (`03_gate4`) covering **all 9 columns** on both the function body and `BEFORE UPDATE OF` trigger definition, with `< 5 minute` freshness on `plan_update_intents` and explicit `p_verified IS NULL` + self-verification checks.
- **Missing Subscriptions Compatibility Columns (`001` vs Live Historical Baseline):** Gate 2 (`01_gate2`) safely adds missing `cafes.menu`, `subscriptions.auto_renew`/`created_at`/`updated_at`, `payments`/`reports` timestamps, `005` index, and `008` `ON DELETE SET NULL` FKs before Gates 3–6 use them.
- **Dangerous Payment Verification & Refund Logic (`021` / `022` / `024`):** Gate 5A (`04_gate5`) eliminates mock `'pay_' || gen_random_uuid()` ID fabrication (requires genuine Razorpay order & `pay_*` ID), removes `021`'s dangerous `OR (user_id=... AND plan_id=...)` refund sweep in favor of strict `payment_id = p_payment_id` linkage, skips broken `022` cleanly, safely handles `user_id IS NULL` anonymized records, and enforces unified lock ordering (`payments -> profiles -> subscriptions -> attempts -> membership_passes`).
- **Matchmaking Serialization & Pair Lock Security (`010`–`016`):** Gate 3 (`02_gate3`) skips `012`/`013`, revokes `lock_matchmaking_pair` from `authenticated`, enforces `Advisory Lock -> Row Lock` in `respond_to_proposal` and `handle_mutual_like`, adds `p_accept IS NULL` and one-time vote guards.
- **Stale `002` Policies & `025` Ordering Trap (`023` / `025`):** Gate 6 (`05_gate6`) runs strictly after Gate 5A, drops `002`'s missed `"payments_admin_write"` / `"subscriptions_admin_write"` policies alongside `*_admin_update*`, adds narrow `"payments_admin_insert"` preserving cash payment recording (`db.ts:945`), revokes all table & column `UPDATE`/`DELETE` on `reports`/`payments`/`subscriptions`, and sets `search_path` on `enforce_application_rules()`, `freeze_match_participants()`, `freeze_message_content()`.
- **Delhi Seeds (`026` / `027`):** `026_seed_delhi_cafes.sql` is marked `SKIP`; Gate 7 (`06_gate7`) validates exact 10-field equality before skipping pre-existing `e-*` IDs.

### Explicitly `BLOCKED` or Requires Fresh Preflight Confirmation
1. **Gate 5B — Live Online Razorpay Edge Functions (`BLOCKED`):**
   - `supabase/functions/verify-payment/index.ts:104` and `supabase/functions/razorpay-webhook/index.ts:83` write to `payments.verified_at`, which **does not exist** in schema or SQL migrations.
   - `supabase/functions/_shared/supabase.ts:63-70` (`activateMembership`) inserts `subscriptions` without setting `payment_id`.
   - `admin_refund_payment` in SQL is ledger-only (no gateway refund API call).
   - **Rule for ChatGPT:** Keep Gate 5B marked `BLOCKED` and do NOT enable live Razorpay checkout/webhooks until a dedicated app+schema alignment update is authorized.
2. **Stale Historical Live Facts (Unverified Since Snapshot):**
   - `blocked_pair(uuid,uuid)` (`004`), `pgcrypto` schema location, `0` verification sync mismatches, `0` duplicate pending payments/proposals, and `supabase_realtime` publication membership **must be re-confirmed fresh** in Gate 1 before running any write gate.
   - Live pending ₹1,199 Elite payment row (`order_pending_*`) must NOT be altered or test-verified.

---

## 4. Local Validation Executed

- `npx tsx test_migration_repair_package.ts`: **11 / 11 PASS** (exit `0`)
- `npx tsx test_reconciliation_repairs.ts`: **4 / 4 PASS** (exit `0`)
- `npm run test:repairs`: **37 / 37 PASS** (`25/25` + `12/12`, exit `0`)
- `npm run lint`: **0 errors**, `39` warnings (exit `0`)
- `npm run build`: **Clean `tsc -b && vite build` in `1.10s`** (exit `0`)
- **Live DB / Edge / Payment tests:** **NOT RUN**.

---

## 5. Exact Single Next Action for ChatGPT & User

**Guide the user through Gate 0 + Gate 1:**
1. Confirm the user creates/verifies a fresh **Gate 0 Backup** in Supabase Dashboard (`buendstsgzdcmzaodurp` → **Database → Backups**).
2. Walk the user through `DATEVRA_MIGRATION_PREFLIGHT_GUIDE.md` to run `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` (**read-only `SELECT`s only**) section by section in SQL Editor and paste the anonymized outputs back to ChatGPT.
3. Once ChatGPT compares those live results against `datevra_migration_repair_package/00_PREFLIGHT_EXPECTED_RESULTS.md`, unlock **Gate 2** (`datevra_migration_repair_package/01_gate2_schema_compatibility_repairs.sql`) — and execute strictly one gate file at a time thereafter.
