# DATEVRA — Beginner Guide to Running the Read-Only Preflight (Gate 1)

This guide shows you step-by-step how to run the **read-only inspection SQL** in Supabase without making any changes to your database.

---

## 1. Is This Safe to Run?
**Yes — 100% safe and non-destructive.**
`datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql`:
- Contains **zero** `CREATE`, `ALTER`, `DROP`, `INSERT`, `UPDATE`, `DELETE`, `GRANT`, or `REVOKE` statements.
- Never calls `bootstrap_first_admin` or any modifying RPC.
- Outputs **structural metadata and anonymous counts only** — no user emails, no user UUIDs, no phone numbers, and no private Razorpay IDs.
- Is guarded so missing tables (`membership_passes`, `match_proposals`, etc.) will **not** crash the query.

---

## 2. Step-by-Step Instructions (Supabase Dashboard)

1. Ensure **Gate 0 (Backup)** is completed first in Supabase Dashboard → **Database → Backups**.
2. Open your Supabase Dashboard for project **`buendstsgzdcmzaodurp`**.
3. On the left sidebar, click **SQL Editor**.
4. Click **+ New query**.
5. Open `datevra_migration_repair_package/00_READ_ONLY_PREFLIGHT.sql` from this repository.

> **Tip for beginners (avoid truncated multi-tab results):**
> Because `00_READ_ONLY_PREFLIGHT.sql` has **12 sections**, Supabase SQL Editor may only display one result tab cleanly at a time if you run the whole file at once.
> The cleanest way is to copy and run **one `SECTION N [READ-ONLY]` block at a time** (Sections 1 through 12). Section 9 has 4 sub-queries (`9A`, `9B`, `9C`, `9D`) — run each sub-query one by one.

---

## 3. How to Copy & Share Results Safely with ChatGPT

For each section (`Section 1` through `Section 12`):
1. Run the single section query in **SQL Editor**.
2. Click the **Export / Download CSV** or **Copy JSON/Markdown** icon in the result panel (or copy the displayed table rows).
3. Paste the result under a clear label into ChatGPT, for example:
   - `Section 1 result:` *(paste)*
   - `Section 2 result:` *(paste)*
   - ...
   - `Section 12 result:` *(paste)*
4. **Do NOT paste** any secret keys, `.env` values, `service_role` keys, database passwords, or Razorpay secrets. (None of those appear in `00_READ_ONLY_PREFLIGHT.sql` output.)

---

## 4. Quick Red-Flag Check Before Gate 2

When comparing your results against `datevra_migration_repair_package/00_PREFLIGHT_EXPECTED_RESULTS.md`, stop immediately and wait for ChatGPT review if you notice:
- Any table in **Section 6** showing `RLS_DISABLED`.
- `public.blocked_pair(uuid,uuid)` in **Section 4** showing `present = false`.
- Any row in **Section 10** returning `issue_count > 0`.
- `pgcrypto` missing from **Section 12**.
- Any target `e-*` experience in **Section 11** already existing with unexpected values.
