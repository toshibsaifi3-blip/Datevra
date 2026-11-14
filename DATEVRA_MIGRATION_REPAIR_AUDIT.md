# DATEVRA — Production Database Migration Repair Audit & Source Evidence Ledger

- **Target Supabase Project Ref:** `buendstsgzdcmzaodurp` (`https://buendstsgzdcmzaodurp.supabase.co`)
- **Audit Scope:** Strictly local static audit of all **39 historical SQL files** (`5` root `db/*.sql` + `27` `db/migrations/*.sql` + `7` `datevra_migration_package/*.sql`), Edge Functions, TypeScript data/UI callers, and the **8 newly created files** in `datevra_migration_repair_package/`.
- **Production Safety:** Zero live Supabase connections, zero remote SQL execution, zero secret exposure, and zero changes to historical migrations or application/Edge Function code.

---

## 1. Source Authority Reconciliation (ZIP vs. Workspace)

| Artifact Checked | On-Disk Status in `/app/applet` | Determination |
|---|---|---|
| Workspace `/app/applet` (`db/`, `src/`, `supabase/`, `datevra_migration_package/`) | Present and active | **Authoritative working tree.** Contains every exact migration (`002`–`027`), all 7 `datevra_migration_package/` files, `DATEVRA_MIGRATION_*` prior handover docs, and latest `src/` repairs (`52/52` offline verification checks pass). |
| `datevra (2).zip` | Absent from disk | Referenced by prompt as the exported ZIP already extracted into `/app/applet`. Inventory matches 1:1 (zero discrepancy between prompt's exact file list and workspace files). |
| `datevra-final-complete (1).zip` | Present on disk in `/` | **Older superseded snapshot** — do NOT extract over `/app/applet`. |

**Critical Notice on Live DB Facts:** All live-state statements in Section 2 of the prompt (e.g., `52` profiles, `0` subscriptions, `1` pending `₹1,199` Elite payment, missing `subscriptions.auto_renew`/`payment_id`, absent `010`/`011` tables, `pgcrypto` in `extensions`) are **user-supplied historical baseline — must be refreshed before production execution** via `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql`.

---

## 2. Verified Source Evidence Ledger

| Exact File Path & Line Range | What It Proves | Independently Confirmed |
|---|---|---|
| `db/schema.sql:1-429` | Base `001` defines **23 tables** (prior docs miscounted 20), `is_admin()`, `set_updated_at()`, and `subscriptions` columns including `auto_renew boolean NOT NULL DEFAULT true` + `created_at`/`updated_at` (`subscriptions.auto_renew` missing in historical baseline proves live schema drifted from `schema.sql`). | Yes (`view_file`) |
| `db/schema.sql:434-552` | Attaches `trg_set_updated_at` to `profiles..platform_settings` (`16` tables), `trg_order_match_pair` (`UNIQUE (user_a, user_b)`), `handle_mutual_like()`, `UNIQUE (match_id)` on `conversations`. | Yes (`view_file`) |
| `db/schema.sql:557-881` | Enables RLS across all 23 base tables; defines `"reports_admin_update"` (`FOR UPDATE`), leaves `"payments_select_own"` / `"subscriptions_select_own"` without `INSERT`/`UPDATE` policies, and grants `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated` (line 1024). | Yes (`view_file`) |
| `db/schema.sql:887-1013` | Seeds `connect` (`499`), `plus` (`799`), `elite` (`1199`), singleton `platform_settings`, `6` base experiences (`e-golden-hour` .. `e-patisserie`), `6` base cafés, `4` CMS pages. | Yes (`view_file`) |
| `db/migrations/002_client_parity.sql:43-68` | Creates **`"payments_admin_write"`** and **`"subscriptions_admin_write"`** (`FOR ALL`!), plus `"payments_insert_own_pending"` (`WITH CHECK (auth.uid() = user_id AND status = 'pending' AND amount > 0)`), plus 4 notification triggers with `/app/...` links. | Yes (`view_file`) |
| `db/migrations/004_security_hardening.sql` & `006_match_integrity.sql` | Defines `blocked_pair(uuid,uuid)`, initial 5-col `protect_profile_fields()`, `enforce_application_rules()`, `freeze_message_content()`, and `freeze_match_participants()`. Source triggers reference explicitly `public.*`-qualified tables/functions and run `SECURITY INVOKER` without `SET search_path` in historical baseline. | Yes (`view_file` + prior grep) |
| `db/migrations/010_passes_proposals.sql` & `012`–`016` | `010` adds `cafes.menu`, `complimentary_passes`, `match_proposals`, `redeem_pass`, `respond_to_proposal`. `012` had exception-rollback bug on block; `013` patched only decline persistence; `014`–`016` add `idx_match_proposals_unique_pending_pair`, `lock_matchmaking_pair`, `handle_mutual_like()` pending cleanup, deadlock lock-order fix, and `REVOKE EXECUTE` on `lock_matchmaking_pair` (requiring `blocked_pair(uuid,uuid)`). | Yes (`view_file`) |
| `db/migrations/011_membership_passes.sql:200-225` & `datevra_migration_package/05_011_membership_passes.sql:185-195` | **Confirmed Critical Bug (`% 32` on 31-char alphabet):** `v_chars` = `'23456789ABCDEFGHJKMNPQRSTUVWXYZ'` has **31 characters**, while generator computes `get_byte % 32 + 1`. When `get_byte % 32 = 31` (~3.125% per char → `1 - (31/32)^12 = 31.68%` of generated codes), PostgreSQL `substr(v_chars, 32, 1)` returns `''`, emitting truncated codes rejected by `Membership.tsx`! Also raw `011` omits `extensions` from `search_path` (`gen_random_bytes`), inserts `subscriptions.auto_renew` (missing live), overwrites `018`'s 9-col `protect_profile_fields()`, and lacks `024`'s `subscriptions.payment_id`. | Yes (`view_file` + `grep` + deterministic test) |
| `db/migrations/018_verification_status_and_rpc.sql:1-200` & `019_verification_defense_in_depth.sql` | `018` adds 4 `verification_*` columns, backfills, updates `protect_profile_fields()` to 9 cols referencing `datevra_internal.plan_update_intents` (runtime dependency on `011`), **but omits recreating `trg_protect_profile_fields` (`BEFORE UPDATE OF` stays stuck at 5 cols!)**. `019` adds `chk_profiles_verified_status_sync` and self-verification block, but lacks explicit `p_verified IS NULL` guard. | Yes (`view_file`) |
| `db/migrations/021_atomic_payment_operations.sql:1-318` | **No `021_atomic_payment_verification...` file exists.** Exact file `021_atomic_payment_operations.sql` (1) adds `subscriptions.payment_id` + non-unique index, (2) **line 79 dangerously fabricates `'pay_' || replace(gen_random_uuid()::text, '-', '')` on pending payments**, allowing unpaid pending orders (e.g., live `₹1,199`) to be marked verified without gateway proof, (3) **line 222** `OR (user_id = v_payment.user_id AND plan_id = v_payment.plan_id AND status = 'active')` fallback sweep can cancel an unrelated subscription on refund, (4) omits `v_payment.user_id IS NOT NULL` check (`notifications.user_id` is `NOT NULL` under `008`), (5) writes `subscriptions.auto_renew` and `updated_at`. | Yes (`view_file`) |
| `db/migrations/022_subscription_admin_operations.sql` vs `024` | `022` (lines 88, 205) crashes with `NULL` `plan_id` into `NOT NULL datevra_internal.plan_update_intents` AND acquires locks backwards (`subscriptions -> profiles`, deadlocking against `011`/`021`). `024` fixes lock order (`profiles -> subscriptions`), drops bogus intent insert, and updates `redeem_membership_pass` to store `payment_id`. | Yes (`view_file` + `grep`) |
| `db/migrations/023_reports_audit_privilege_correction.sql` & `025_admin_consolidated_security_and_integrity.sql:1-105` | `023` installs `check_report_status_audit_guard()` + `set_report_status()`. `025` revokes `UPDATE`/`DELETE` on `reports`, `payments`, `subscriptions`, drops `reports_admin_update*`, `payments_admin_update`, `subscriptions_admin_update` — **but misses `002`'s policy names `payments_admin_write` and `subscriptions_admin_write`** (`FOR ALL`) AND lacks `BEGIN/COMMIT`, AND crashes if run before `021`/`023`/`024`. Also dropping `payments_admin_write` requires a narrow `"payments_admin_insert"` (`FOR INSERT`) policy so admin cash inserts (`db.ts:945`) still work! | Yes (`view_file`) |
| `db/migrations/026_seed_delhi_cafes.sql` vs `026_verify_seed_delhi_cafes.sql` & `027_seed_curated_experiences.sql` | Filename collision resolved: `026_seed_delhi_cafes.sql` is the `INSERT` seed (`SKIP`: live cafés `c-hot-stag-del`, `c-karmala-del`, `c-yumm-club-del` already exist); `026_verify_seed_delhi_cafes.sql` is a 3-query read-only verification helper (`SKIP`). `027` uses `ON CONFLICT (id) DO NOTHING` after checking only `title` (could silently ignore drifted non-title fields); `datevra_migration_repair_package/06_gate7_seed_curated_experiences.sql` checks all **10 fields** strictly. | Yes (`view_file`) |
| `supabase/functions/verify-payment/index.ts:99-116`, `razorpay-webhook/index.ts:78-91`, `_shared/supabase.ts:52-77` | **Gate 5B `BLOCKED` Cause:** Both `verify-payment` (line 104) and `razorpay-webhook` (line 83) update `payments.verified_at`, which **does not exist** in `db/schema.sql`, any migration, or historical live baseline! Both also invoke `_shared/supabase.ts` `activateMembership()` (lines 63–70), which inserts `subscriptions` **without `payment_id`**. | Yes (`view_file`) |
| `src/lib/supabase/db.ts:108-1513`, `mappers.ts:257-363`, `Membership.tsx:144`, `Reports.tsx:213-237` | Maps all client `.from(...)` and `.rpc(...)` calls. `db.ts:945` (`recordCashPayment`) relies on admin `INSERT` on `payments`; `db.ts:899` (`purchaseMembership`) relies on user pending `INSERT` (`payments_insert_own_pending`); `Membership.tsx:144` enforces `/^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/` (exact 18 chars); `Reports.tsx` uses `db.setReportStatus` (`set_report_status` RPC); `mappers.ts:284,333,337` read `cafes.menu`, `subscriptions.payment_id`, `subscriptions.auto_renew`. | Yes (`view_file` + `grep`) |

---

## 3. Complete Migration-by-Migration Inventory & Disposition (39 Historical SQL Files)

> Detailed per-row ledger also appears in `DATEVRA_MIGRATION_STATUS.csv`. Summary of disposition across all 39 existing SQL files:

- **Base & Setup Bundles (`db/*.sql` — 5 files):**
  - `db/000_full_setup.sql`, `db/000_full_setup_LATEST_2026-10-04.sql`, `db/000_full_setup_LATEST_2026-10-04_v2.sql` → **DO NOT RUN on existing DB.** Historical setup bundles (`v2` stops at `009`, explains why `daily_action_limits` exists and `002` policies may exist). Re-running restores interim `*_admin_write` policies and conflicts with hardened state.
  - `db/schema.sql` → **DO NOT RE-RUN FULL FILE.** Already initialized (`23` base tables exist, though live `subscriptions` drifted by missing `auto_renew`). Missing columns repaired cleanly in Gate 2 (`01_gate2_schema_compatibility_repairs.sql`).
  - `db/realtime_setup.sql` → **CONDITIONAL STANDALONE (Gate 7).** Run only if Preflight Section 12 indicates any of the 8 real-time client tables are `NOT_INCLUDED`.

- **Early Migrations (`002`–`009` — 8 files):**
  - `002_client_parity.sql` → **PRESENCE UNVERIFIED (Preflight Section 6/4).** Note its `"payments_admin_write"` / `"subscriptions_admin_write"` policies are cleaned up in Gate 6 while preserving `"payments_insert_own_pending"`.
  - `003_discovery_function.sql` (`discovery_profiles`, `discovery_profile`), `004_security_hardening.sql` (`blocked_pair(uuid,uuid)` — hard prereq for Gate 3), `005_account_deletion.sql` (`payments_one_pending_per_user_plan` — ensured in Gate 2), `006_match_integrity.sql` (`freeze_match_participants`), `007_admin_bootstrap.sql` (**NEVER invoke `bootstrap_first_admin`**), `008_payment_retention.sql` (nullable `ON DELETE SET NULL` FKs — ensured in Gate 2), `009_daily_limits.sql` (`daily_action_limits` table exists; RPCs verified in Preflight Section 4).
  - Gate 6 hardens `SET search_path = pg_catalog, public, pg_temp` on the 3 existing `004`/`006` trigger functions (`enforce_application_rules()`, `freeze_match_participants()`, `freeze_message_content()`).

- **Matchmaking & Passes Chain (`010`, `012`–`016` & Package `01`–`04` — 10 files):**
  - `012_proposal_block_protection.sql` and `013_proposal_block_decline_persistence.sql` → **SUPERSEDED / DO NOT RUN.**
  - `010`, `014`, `015`, `016` and package copies `01_010`..`04_016` → **REPLACED BY `datevra_migration_repair_package/02_gate3_matchmaking_and_passes.sql` (Gate 3).** Raw-vs-package diff: package `01`–`04` added `DO` preflight blocks and `BEGIN/COMMIT`, but omitted `p_accept IS NULL` rejection and one-time vote guard in `respond_to_proposal()`. Gate 3 adds all preconditions, canonical lock order, `p_accept IS NULL` check, one-time vote guard, `pg_catalog, public, pg_temp` `search_path`, and `REVOKE EXECUTE` on `lock_matchmaking_pair`.

- **Membership Passes, Verification & Hardening Chain (`011`, `017`–`025` & Package `05`–`06` — 12 files):**
  - `017` & `020` → **SUPERSEDED / DO NOT RUN** (superseded by `023` + `025`, now Gate 6).
  - `022` → **FATAL BUG / NEVER RUN** (NULL `plan_id` into `NOT NULL` intent table + deadlock lock order).
  - `011` & package `05_011_membership_passes.sql` + `06_post_011_reconciliation.sql` + `018` + `019` → **REPLACED BY `datevra_migration_repair_package/03_gate4_membership_passes_and_verification.sql` (Gate 4).** Raw-vs-package diff: `05_011` fixed `extensions` in `search_path`, but retained the fatal `% 32` modulo bug and inserted `subscriptions.auto_renew` blindly; `06_post_011` reconciled 9-col trigger & `024` only if `018`/`021` already ran. Gate 4 eliminates the `% 32` bug cleanly, includes 5-min freshness on `plan_update_intents`, installs `018`+`019` with `p_verified IS NULL` check, and binds `trg_protect_profile_fields` to all 9 columns permanently.
  - `021` & `024` → **REPLACED BY `datevra_migration_repair_package/04_gate5_payments_and_subscription_lifecycle.sql` (Gate 5A).** Eliminates mock `'pay_' || gen_random_uuid()` fabrication, eliminates unsafe fallback refund sweep, handles anonymized (`user_id IS NULL`) rows safely, and enforces unified billing lock order.
  - `023` & `025` → **REPLACED BY `datevra_migration_repair_package/05_gate6_reports_and_final_hardening.sql` (Gate 6).** Closes `002`'s missed `payments_admin_write` / `subscriptions_admin_write` policies, preserves narrow `"payments_admin_insert"` for cash payments (`db.ts:945`), ensures pre-existing admin RPC checks, wraps in `BEGIN/COMMIT`, and hardens `004`/`006` trigger `search_path`.

- **Seeds (`026_seed_delhi_cafes.sql`, `026_verify_seed_delhi_cafes.sql`, `027_seed_curated_experiences.sql`, Package `07_027` — 4 files):**
  - `026_seed_delhi_cafes.sql` → **SKIP** (partner cafés already present in live baseline).
  - `026_verify_seed_delhi_cafes.sql` → **SKIP** (read-only verification script; superseded by `00_READ_ONLY_PREFLIGHT.sql` Section 11).
  - `027` & `07_027` → **REPLACED BY `datevra_migration_repair_package/06_gate7_seed_curated_experiences.sql` (Gate 7).** Upgrades `ON CONFLICT (id) DO NOTHING` to exact **10-field comparison** + `GATE7_SEED_CONFLICT` exception on mismatch.

---

## 4. Resolution of Section 5 Critical Issues (A–H)

- **A. Subscription Schema Compatibility:** Gate 2 adds `cafes.menu`, `subscriptions.auto_renew` (`NOT NULL DEFAULT false`), `subscriptions.created_at`/`updated_at` + trigger, `payments`/`reports` timestamps, `008` `ON DELETE SET NULL` FKs, and `005` pending index cleanly before any function uses them. `subscriptions.payment_id` uses a **non-unique** index in Gate 5A (`idx_subscriptions_payment_id`) because multiple lifecycle/renewal records may point to one payment or `NULL`. `payments.verified_at` is **NOT** added by SQL; Edge Functions remain Gate 5B `BLOCKED`.
- **B. Membership Pass-Code Generation:** Gate 4 replaces `gen_random_bytes(12)` + `% 32 + 1` with a `WHILE` loop over `gen_random_bytes(32)` rejecting `v_byte >= 248` (`8 * 31`) and indexing `(v_byte % 31) + 1`, proved exhaustively across all 256 byte values (`8` hits per char) and 1,000 simulated codes matching `Membership.tsx:144`.
- **C. Payment Verification / Razorpay Integrity:** Gate 5A `admin_verify_payment` fails closed unless `razorpay_order_id` is non-placeholder (not `order_pending_%`), `razorpay_payment_id LIKE 'pay_%'` (for non-cash), and `amount = membership_plans.price`. Zero gateway ID fabrication. `admin_refund_payment` only revokes a subscription strictly matching `payment_id = p_payment_id AND user_id = v_payment.user_id` and explicitly logs itself as `ledger-only`. Live online Razorpay Edge Functions remain Gate 5B **`BLOCKED`**.
- **D. `protect_profile_fields` & Verification Ordering:** Gate 4 installs both `protect_profile_fields()` and `trg_protect_profile_fields` (`BEFORE UPDATE OF` all 9 columns), enforces `< interval '5 minutes'` freshness on `plan_update_intents`, rejects `p_verified IS NULL` and self-verification, and Gates 5A–7 never touch `protect_profile_fields`.
- **E. Matchmaking Concurrency & Blocking:** Gate 3 revokes `lock_matchmaking_pair(uuid,uuid)` from `PUBLIC, anon, authenticated`; `check_match_proposal_integrity` and `respond_to_proposal` acquire `lock_matchmaking_pair(v_u1, v_u2)` **first** before row locks (`FOR UPDATE`), and `handle_mutual_like()` acquires `lock_matchmaking_pair(a, b)` **before** checking `public.likes` for the reciprocal like (so concurrent reciprocal inserts serialize and observe committed peer rows under the lock), then checks `blocked_pair(a, b)` under the same lock before creating matches/conversations/notifications and declining pending proposals. *(Note: `00_READ_ONLY_PREFLIGHT.sql` Sections 10.4 & 10.5 also verify `public.match_proposals` plus required columns `user_a_id, user_b_id, status` in `information_schema.columns` and `public.matches` (`user_a, user_b`) before running dynamic SQL, returning `NULL` + `TABLE_ABSENT` or `REQUIRED_COLUMNS_ABSENT` rather than a false `0`.)*
- **F. Reports Security & Audit Trail:** Gate 6 installs `set_report_status(uuid,text)` + `trg_report_status_audit_guard`, revokes table & column `UPDATE, DELETE` on `reports`, `payments`, `subscriptions`, drops `*_admin_update*` and `002`'s `*_admin_write`, and preserves `SELECT`/`INSERT` plus narrow `"payments_admin_insert"` (`db.ts:945`). *(UX note recorded: `Reports.tsx` currently lacks a custom `MIGRATION_REQUIRED` banner unlike `Passes.tsx`/`MembershipPasses.tsx`/`Verification.tsx`, though no frontend edits are needed once Gate 6 is applied.)*
- **G. Subscription Lifecycle & Locking:** Canonical billing lock order enforced everywhere: `payments -> profiles -> subscriptions -> (pass_redemption_attempts -> membership_passes)`. Broken `022` is permanently bypassed; `admin_cancel_subscription` & `admin_extend_subscription` lock `profiles` before `subscriptions` and never touch `plan_update_intents`.
- **H. Seeds:** `026_seed_delhi_cafes.sql` is `SKIP` (live cafés present); Gate 7 verifies partner café names/cities, enforces exact 10-field comparison on any pre-existing `e-*` row (`RAISE EXCEPTION` on mismatch), and appends missing titles cleanly.

---

## 5. Dependency DAG

```
Gate 0 (Backup)
   │
   ▼
Gate 1 (00_READ_ONLY_PREFLIGHT.sql) ──[IF Section 10 > 0 or blocked_pair/pgcrypto missing]──▶ STOP / BLOCKED
   │
   ▼ [Approved]
Gate 2 (01_gate2_schema_compatibility_repairs.sql: cafes.menu, subscriptions.auto_renew/timestamps, reports.updated_at, 005/008)
   │
   ├──▶ Gate 3 (02_gate3_matchmaking_and_passes.sql: requires blocked_pair, cafes.menu, unique matches/conversations)
   │
   └──▶ Gate 4 (03_gate4_membership_passes_and_verification.sql: requires pgcrypto, subscriptions.auto_renew, 0 profile sync mismatches)
           │
           ├──▶ Gate 5A (04_gate5_payments_and_subscription_lifecycle.sql: requires Gate 2 & Gate 4)
           │       │
           │       └──▶ Gate 6 (05_gate6_reports_and_final_hardening.sql: requires reports.updated_at & Gate 5A admin RPCs)
           │               │
           │               └──▶ Gate 7 (06_gate7_seed_curated_experiences.sql [+ conditional db/realtime_setup.sql])
           │                       │
           │                       └──▶ Gate 8 (Re-run 00_READ_ONLY_PREFLIGHT.sql + Staging Test-Account Smoke Check)
           │
           └──▶ Gate 5B (Razorpay Edge Functions: verify-payment, razorpay-webhook, _shared/supabase.ts) ──▶ [BLOCKED]
```

---

## 6. Risk Register & Unresolved Questions

| Risk / Question | Severity | Mitigation / Status |
|---|---|---|
| Live DB state may have changed since the historical baseline | High | Gate 1 (`00_READ_ONLY_PREFLIGHT.sql`) must run before Gate 2 and results reviewed first. |
| Edge Functions (`verify-payment`, `razorpay-webhook`) write `payments.verified_at` and omit `subscriptions.payment_id` | High (`BLOCKED`) | Explicitly isolated as **Gate 5B `BLOCKED`**; neither Edge Functions nor `payments.verified_at` are touched until a separate code+schema alignment task is approved. |
| Pending `₹1,199` payment row (`order_pending_*`) in historical baseline | High | Gate 5A `admin_verify_payment` fails closed and refuses to activate unpaid placeholder orders; operator instructions prohibit altering or test-verifying it. |
| Whether `004_security_hardening.sql` (`blocked_pair(uuid,uuid)`) or `003`/`005`/`009` RPCs exist live | High | Explicitly checked in Preflight Section 4 & Gate 3 precondition DO block (aborts cleanly if missing). |
| Whether `db/realtime_setup.sql` was already run (`v2` includes it, but not directly confirmed live) | Medium | Checked in Preflight Section 12; run `db/realtime_setup.sql` only if any table shows `NOT_INCLUDED`. |
| Unauthenticated/unprivileged `bootstrap_first_admin` ACL in live DB | Medium | Checked in Preflight Section 4 ACL column (`NEVER invoke it`); review ACL if `authenticated`/`anon` execute exists. |
