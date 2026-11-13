# DATEVRA — Safe Migration Execution Plan

- **Target Project Ref:** `buendstsgzdcmzaodurp`
- **Important:** Do **NOT** execute any write SQL until all read-only queries in `DATEVRA_MIGRATION_PREFLIGHT.sql` have been run in Supabase SQL Editor and reviewed.

---

## Phase Gates Overview

| Gate | Scope | Current Status |
|---|---|---|
| **Gate 0** | Read-only preflight inspection (`DATEVRA_MIGRATION_PREFLIGHT.sql`, Queries 1–6) | **START HERE (Mandatory)** |
| **Gate 1** | Redundant / superseded files (`026`, `012`, `013`, `017`, `020`, `022`) | **SKIP (Do Not Run)** |
| **Gate 2** | Proposals + Complimentary Passes (`01_010`, `02_014`, `03_015`, `04_016`) | **READY AFTER PREFLIGHT CONFIRMS `001`–`004` (`blocked_pair`)** |
| **Gate 3** | Membership Passes + Post-`011` Reconciliation (`05_011`, `06_post_011_reconciliation`) | **READY AFTER PREFLIGHT CONFIRMS `pgcrypto` + BASELINE** |
| **Gate 4** | Verification & Admin Security Hardening (`018`, `019`, `021`, `023`, `024`, `025`, `realtime_setup`) | **HOLD / BLOCKED PENDING PREFLIGHT (Queries 1–4 & 6)** |
| **Gate 5** | Curated Delhi Experiences Seed (`07_027_seed_curated_experiences.sql`) | **VERIFIED READY (Confirm Query 5 clean before running)** |

---

## Exact Execution Order (Only After Gate 0 Review)

### Step 0 — Run Read-Only Preflight (`DATEVRA_MIGRATION_PREFLIGHT.sql`)
1. Run **Query 1** first in Supabase SQL Editor and share the result.
2. Then run **Queries 2–6** as directed so every assumption about `002`–`009` and `017`–`025` is verified before touching production.

---

### Files Marked `SKIP` (Never Execute)
- **`026_seed_delhi_cafes.sql`** — **SKIP.** All 3 Delhi cafés (`c-hot-stag-del`, `c-karmala-del`, `c-yumm-club-del`) already exist in live `public.cafes`.
- **`012_proposal_block_protection.sql` & `013_proposal_block_decline_persistence.sql`** — **SKIP.** Completely superseded by `014`, `015`, and `016`.
- **`017_atomic_report_status_audit.sql` & `020_enforce_audited_report_status.sql`** — **SKIP.** Completely superseded by `023` + `025`.
- **`022_subscription_admin_operations.sql`** — **SKIP.** Contains a fatal `NULL` `plan_id` bug and deadlock risk; superseded by `024`.
- **`000_full_setup*.sql`** — **SKIP.** Combined historical setup bundles ending at `008`/`009`; running them again could restore interim policies from `002`.

---

### Files in `datevra_migration_package/` (Reviewed & Pre-Guarded)

> **Warning:** Run these **one file at a time**, waiting for `Success` on each before proceeding to the next. Only start after Preflight Query 1–6 outputs are reviewed.

1. **`datevra_migration_package/01_010_passes_proposals.sql`**
   - **Preconditions:** Preflight confirms `cafes`, `profiles`, `matches`, `conversations`, `notifications`, and `public.is_admin()` exist.
   - **Action:** Adds `cafes.menu`, creates `public.complimentary_passes` and `public.match_proposals`, installs least-privilege RLS, `redeem_pass(text)`, and initial `respond_to_proposal(uuid, boolean)`.
2. **`datevra_migration_package/02_014_match_proposal_integrity.sql`**
   - **Preconditions:** Step 1 (`01_010`) succeeded AND Preflight Query 1 confirmed `public.blocked_pair(uuid, uuid)` exists (`004`). (Enforced internally by a `DO $$` preflight assertion.)
   - **Action:** Adds `idx_match_proposals_unique_pending_pair` and `trg_check_match_proposal_integrity`.
3. **`datevra_migration_package/03_015_matchmaking_pair_serialization.sql`**
   - **Preconditions:** Step 2 (`02_014`) succeeded. *(Check Preflight Query 3 on `handle_mutual_like()` first so no unexpected customization is overwritten.)*
   - **Action:** Adds `lock_matchmaking_pair(uuid, uuid)` and updates `check_match_proposal_integrity()`, `respond_to_proposal()`, and `handle_mutual_like()`.
4. **`datevra_migration_package/04_016_matchmaking_lock_order_hardening.sql`**
   - **Preconditions:** Step 3 (`03_015`) succeeded.
   - **Action:** Revokes direct `authenticated` execution of `lock_matchmaking_pair` and enforces strict `Advisory Lock -> Row Lock` ordering in `respond_to_proposal()`.
5. **`datevra_migration_package/05_011_membership_passes.sql`**
   - **Preconditions:** Preflight Query 1 confirms `pgcrypto`, `public.is_admin()`, `membership_plans`, `profiles`, `subscriptions`, `payments`, `activity_logs`, `notifications`.
   - **Safety Adjustment Preserved:** `datevra_internal.generate_secure_pass_code()` includes `SET search_path = public, extensions, pg_temp` so `gen_random_bytes(12)` works with Supabase's `extensions` schema.
   - **Action:** Creates `public.membership_passes`, `datevra_internal` schema & tables (`plan_update_intents`, `pass_redemption_attempts`), and RPCs `create_membership_pass`, `revoke_membership_pass`, `redeem_membership_pass`.
6. **`datevra_migration_package/06_post_011_reconciliation.sql`** *(Forward-Only Reconciliation)*
   - **Preconditions:** Step 5 (`05_011`) succeeded.
   - **Action (Self-Checking & Conditional):**
     - Ensures `datevra_internal.generate_secure_pass_code()` uses `SET search_path = public, extensions, pg_temp`.
     - If `profiles.verification_status` (`018`) already exists, restores `018`'s 9-column `public.protect_profile_fields()` **and** binds `trg_protect_profile_fields` to all 9 columns (`BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, verification_status, verification_reviewed_at, verification_reviewed_by, verification_note, email`), preventing `011` from regressing `018` AND fixing `018`'s trigger column-list gap.
     - If `subscriptions.payment_id` (`021`) already exists, upgrades `public.redeem_membership_pass(text)` to `024`'s version linking `payment_id` onto `public.subscriptions`.
7. **`datevra_migration_package/07_027_seed_curated_experiences.sql`**
   - **Preconditions:** Preflight Query 5 confirms `c-hot-stag-del` & `c-karmala-del` exist and the 4 target `e-*` experience IDs are absent or exact title matches.
   - **Action:** Atomically inserts `e-hotstag-premium-date`, `e-hotstag-coffee-date`, `e-hotstag-italian`, `e-karmala-karaoke` (`ON CONFLICT (id) DO NOTHING`) and safely appends missing titles to `public.cafes.experiences` without duplicates.

---

### Gate 4 — Migrations Held Pending Preflight (`018`, `019`, `021`, `023`, `024`, `025`)
These files are **not** included in `datevra_migration_package/` yet because Preflight Queries 1–6 have not run on `buendstsgzdcmzaodurp`:
- If Preflight confirms `018` / `019` are missing → review Query 4 consistency counts, then apply `018` (with 9-column `trg_protect_profile_fields`) and `019`.
- If Preflight confirms `021` / `023` / `024` / `025` are missing → apply in order `021` → `023` → `024` → `025` (which also keeps `redeem_membership_pass` linked to `subscriptions.payment_id`).
- If Preflight confirms `018` IS already installed → `06_post_011_reconciliation.sql` protects you automatically by repairing the trigger column list and 9-column function right after `011`.

---

## Post-Migration Verification Queries (Run After Package Execution)

Run these read-only checks once approved migrations finish:
1. **Confirm New Tables & Seeded Experiences:**
   ```sql
   SELECT table_name
   FROM information_schema.tables
   WHERE table_schema = 'public'
     AND table_name IN ('complimentary_passes', 'match_proposals', 'membership_passes')
   ORDER BY table_name;

   SELECT id, title, price_from, duration_mins
   FROM public.experiences
   WHERE id IN ('e-hotstag-premium-date', 'e-hotstag-coffee-date', 'e-hotstag-italian', 'e-karmala-karaoke')
   ORDER BY id;

   SELECT id, name, experiences
   FROM public.cafes
   WHERE id IN ('c-hot-stag-del', 'c-karmala-del');
   ```
2. **Confirm RPCs & Trigger Coverage:**
   ```sql
   SELECT p.proname, p.proconfig
   FROM pg_proc p
   JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname IN ('public', 'datevra_internal')
     AND p.proname IN (
       'redeem_pass', 'respond_to_proposal', 'lock_matchmaking_pair',
       'create_membership_pass', 'revoke_membership_pass', 'redeem_membership_pass',
       'generate_secure_pass_code', 'protect_profile_fields'
     )
   ORDER BY n.nspname, p.proname;

   SELECT tgname, pg_get_triggerdef(oid)
   FROM pg_trigger
   WHERE tgrelid = 'public.profiles'::regclass AND NOT tgisinternal;
   ```
3. **UI Verification (In App After SQL Passes):**
   - Refresh `/admin/membership-passes` and `/admin/passes` as admin — the Migration 010/011 warning banners should be gone.
   - Refresh Curated Experiences — the 4 Delhi experiences should display cleanly and submit applications without `date_applications_experience_id_fkey` errors.

---

## Rollback & Recovery Notes
- **Before Running Writes:** Take an automatic or manual Supabase point-in-time / logical backup (`Dashboard → Database → Backups`) if available on your plan.
- **`07_027_seed_curated_experiences.sql` Recovery:** Wrapped in `BEGIN ... COMMIT` — any error aborts with zero partial inserts or café array edits. Because it only inserts 4 distinct `e-*` IDs and appends titles, if an unwanted title/row ever needed removal after commit, only those exact 4 IDs (provided no `date_applications` reference them yet) and those array strings would be touched.
- **`010` / `014`–`016` / `011` Recovery:** All new tables (`complimentary_passes`, `match_proposals`, `membership_passes`, `datevra_internal.*`) are brand-new additive objects (`VERIFIED ABSENT` beforehand), so they cannot corrupt existing user data on creation. Never run `DROP TABLE ... CASCADE` blindly in production; forward-only `CREATE OR REPLACE FUNCTION` / `ALTER` patches are always preferred.
- **Function/Trigger Regression Recovery:** Re-running `06_post_011_reconciliation.sql` safely restores `protect_profile_fields()`, `trg_protect_profile_fields`, `generate_secure_pass_code()`, and `redeem_membership_pass()` to match whatever columns currently exist on `profiles` and `subscriptions`.
