# Datevra Preflight Expected Results & Gate-Unlock Triage Guide

> **Notice on Prior Evidence:** The comparison column *"Historical Baseline (Must Refresh)"* uses the user-supplied historical baseline from earlier read-only checks on Supabase project `buendstsgzdcmzaodurp`. **Always treat historical baseline claims as stale until your fresh `00_READ_ONLY_PREFLIGHT.sql` run confirms current reality.**

---

## How to Interpret Each Section of `00_READ_ONLY_PREFLIGHT.sql`

### Section 1 — Table Columns, Types, Nullability & Defaults
| Table | Expected Fresh Preflight State (Before Repair) | If Different / Mismatch Rule |
|---|---|---|
| `public.subscriptions` | Historical baseline reported `id, user_id, plan_id, status, started_at, expires_at` with `auto_renew` and `payment_id` ABSENT (`created_at`/`updated_at` unconfirmed). | **Gate 2 (`01_gate2_schema_compatibility_repairs.sql`)** safely adds missing `auto_renew`, `created_at`, `updated_at` ONLY if absent. If `payment_id` is already present with `UNIQUE`, stop and review cardinality before Gate 5! |
| `public.payments` | Expected `id, user_id, kind, amount, plan_id, status, razorpay_order_id, razorpay_payment_id, method, created_at, updated_at`. | If `created_at` or `updated_at` is absent, Gate 2 adds them. Note `verified_at` is **NOT** in schema (Edge Function drift — handled as Gate 5B blocker). |
| `public.reports` | Expected `id, reporter_id, reported_id, reason, details, status, created_at, updated_at`. | If `updated_at` is missing, Gate 2 ensures it exists before Gate 6 (`set_report_status`) runs. |
| `public.cafes` | Expected 16 columns from `schema.sql`, lacking `menu`. | If `menu` is absent, Gate 2 adds `menu text NOT NULL DEFAULT ''`. |
| `public.profiles` | Expected base `schema.sql` columns; `verification_status`, `verification_reviewed_at`, `verification_reviewed_by`, `verification_note` likely ABSENT. | If already present, check Section 9C & 10.3 to ensure zero sync mismatches before Gate 4. |
| `complimentary_passes`, `match_proposals`, `membership_passes`, `datevra_internal.*` | Expected `TABLE_ABSENT` before Gates 3 & 4. | If any already exist, inspect Section 5/8/10 carefully before running Gates 3–4. |

---

### Section 2 — Constraints, Foreign Keys (`ON DELETE`) & Key Indexes
- **Foreign Keys (`payments.user_id`, `subscriptions.user_id`):** Should show `SET NULL` (`008_payment_retention.sql`). If `CASCADE` is shown, **Gate 2 repairs both FKs to nullable `ON DELETE SET NULL`**.
- **`date_applications.experience_id`:** Expected `RESTRICT` (`date_applications_experience_id_fkey`).
- **Unique constraints (`matches`, `conversations`):** `matches` must have `UNIQUE (user_a, user_b)` and `conversations` must have `UNIQUE (match_id)`. If missing, **STOP (BLOCKED)** and diagnose duplicates before Gate 3!
- **Index `payments_one_pending_per_user_plan`:** Should be `PRESENT` (`005`). If `ABSENT`, Gate 2 creates it only after verifying no duplicate pending `(user_id, plan_id)` rows exist.
- **Indexes `idx_match_proposals_unique_pending_pair`, `idx_profiles_verification_status`, `idx_subscriptions_payment_id`:** Expected `ABSENT` initially; created by Gates 3, 4, and 5 respectively.

---

### Section 3 — Migration Tracking Metadata
- **Expected:** Both `supabase_migrations.schema_migrations` and `datevra_custom_migration_tables` show `present = false` (`ABSENT`).
- **Triage:** Do **not** assume any migration is applied just because SQL files exist in `db/migrations/`. Verify every object via Sections 1–12.

---

### Section 4 — Functions, Security Mode, Owner, `search_path` & ACLs
- **Core Functions Expected Present:** `public.is_admin()`, `public.set_updated_at()`, `public.order_match_pair()`, `public.handle_mutual_like()`, `public.blocked_pair(uuid,uuid)`, `public.protect_profile_fields()`, `public.freeze_message_content()`, `public.enforce_application_rules()`, `public.freeze_match_participants()`.
  - **CRITICAL CHECK:** If `public.blocked_pair(uuid,uuid)` is `ABSENT`, **Gate 3 MUST STOP / BLOCKED** until `004` `blocked_pair` is reviewed and installed!
  - **Known Live Baseline Warning:** `protect_profile_fields`, `enforce_application_rules`, `freeze_match_participants`, `freeze_message_content` were reported `SECURITY INVOKER | NO_PROCONFIG_SET`. Confirm whether still true — Gate 4 replaces `protect_profile_fields()` as `SECURITY DEFINER` with fixed `search_path`, and Gate 6 hardens `search_path` on the remaining 3 trigger functions.
- **Admin Bootstrap Check:** `public.bootstrap_first_admin(text)` may be `PRESENT`. **NEVER invoke it.** Ensure ACL does NOT grant `EXECUTE` to `authenticated` or `anon` or `PUBLIC`.
- **Target New/Repaired RPCs Expected `ABSENT` Initially:** `redeem_pass`, `respond_to_proposal`, `lock_matchmaking_pair`, `check_match_proposal_integrity`, `datevra_internal.generate_secure_pass_code`, `create_membership_pass`, `revoke_membership_pass`, `redeem_membership_pass`, `set_user_verified`, `set_report_status`, `check_report_status_audit_guard`, `admin_verify_payment`, `admin_refund_payment`, `admin_cancel_subscription`, `admin_extend_subscription`.

---

### Section 5 — Triggers & `UPDATE OF` Column Lists
- Confirm `public.profiles.trg_protect_profile_fields`: historically expected `BEFORE UPDATE OF is_admin, plan_id, plan_expires_at, verified, email` (5 columns). After Gate 4, it **must** show all **9 columns** (`is_admin, plan_id, plan_expires_at, verified, verification_status, verification_reviewed_at, verification_reviewed_by, verification_note, email`).
- Confirm `public.likes.trg_mutual_like` calls `public.handle_mutual_like()`.
- Confirm `public.subscriptions` has `trg_set_updated_at` (repaired in Gate 2 if missing).
- Confirm there is NO unexpected custom payment-to-subscription trigger already installed (historical baseline confirmed none).

---

### Section 6 & Section 7 — RLS Policies & Grants (CRITICAL SECURITY BASELINE)
- Every table in `public` must show `RLS_ENABLED`. If ANY table shows `RLS_DISABLED`, **STOP IMMEDIATELY (BLOCKED)**.
- Check `payments` & `subscriptions` policies: if `002_client_parity.sql` was run, `"payments_admin_write"` and `"subscriptions_admin_write"` (`FOR ALL`) will appear. **Gate 6 explicitly drops those AND `*_admin_update` policies**, replacing cash insert need only with narrow `"payments_admin_insert"` (`FOR INSERT`) while revoking table & column `UPDATE, DELETE` on `reports`, `payments`, `subscriptions`.
- Ensure `"payments_insert_own_pending"` exists on `public.payments` if members create pending payment intents.
- Ensure `anon` has **zero** `INSERT`, `UPDATE`, `DELETE` privileges on `reports`, `payments`, `subscriptions`, `profiles`, `membership_passes`.

---

### Section 8 — Function Bodies
- Verify whether `public.handle_mutual_like()` has any unexpected custom edits before Gate 3 replaces it with the pair-locked version.
- If `datevra_internal.generate_secure_pass_code()` already exists, check whether it uses `% 32` (BUGGY — must be replaced by Gate 4) or `< 248` rejection sampling `% 31` (FIXED).

---

### Section 9 — Aggregate Operational & Financial Distributions (Zero PII)
- **9A (`payments`):** Historical baseline showed `1` pending Elite row of `₹1,199`. Confirm exact counts and whether `is_pending_placeholder_order = true` / `has_gateway_payment_id = false`. **Gate 5 will fail closed on any unconfirmed Razorpay row lacking real gateway `razorpay_payment_id`!**
- **9B (`subscriptions`):** Historical baseline showed `0` rows. If `> 0` rows now exist, review before Gate 2 / Gate 5.
- **9C (`profiles`):** Historical baseline showed `52` profiles. Check `verification_status_state`: expected `COL_ABSENT` (or clean `'verified'`/`'pending'`/`'declined'`). Ensure at least 1 `is_admin = true` account exists (`founder@datevra.com` confirmed via login).

---

### Section 10 — Relational & Data Consistency Checks
- **ALL 6 checks MUST return `issue_count = 0` before proceeding to writes!**
- If ANY check returns `> 0` (e.g., `duplicate_unordered_matches > 0`, `profiles_verification_sync_mismatch > 0`, `orphan_date_applications_missing_experience > 0`), **STOP AND MARK THE AFFECTED GATE `BLOCKED`** until ChatGPT & the owner inspect and clean up the discrepancy safely.

---

### Section 11 — Partner Cafés, Target Experiences & Membership Plans
- **Expected cafés:** All 9 (`6` original + `3` Delhi: `c-hot-stag-del` `'Café Hot Stag'`, `c-karmala-del` `'KARMALA CAFE & RESTAURANT'`, `c-yumm-club-del` `'The Yumm Club'`), with `c-hot-stag-del` and `c-karmala-del` having `experiences={}`.
  - Note: If `026` cafés are missing, Gate 7 (`06_gate7_...`) will abort cleanly instead of violating FKs.
- **Expected target experiences:** `0` rows (all 4 `e-*` IDs absent). If any of the 4 already exist, **Gate 7 checks exact 10-field equality** and aborts if any field mismatches!
- **Membership plans:** Confirm `'connect'` (`499`), `'plus'` (`799`), `'elite'` (`1199`) exist cleanly. *(Display names `'Connect'`, `'Plus'`, `'Elite'` vs UI `'Select'`, `'Signature'`, `'Privé'` remain cosmetic only and do not block SQL.)*

---

### Section 12 — Extensions, Realtime & Storage Buckets
- **`pgcrypto`:** Historical baseline showed `schema = extensions, version = 1.3`. Must be present in `extensions` or `public`. If absent, **Gate 4 is BLOCKED**.
- **`supabase_realtime`:** Verify which of the 8 core client-subscribed tables show `INCLUDED` vs `NOT_INCLUDED`. If any show `NOT_INCLUDED`, run `db/realtime_setup.sql` conditionally in Gate 7.
- **`storage.buckets`:** Confirm `profile-photos`, `cafe-media`, `experience-media` exist (`public = true`).
