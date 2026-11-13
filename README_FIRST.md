# README FIRST — Datevra Database Migration Guide (Beginner-Friendly)

**Target Supabase Project:** `buendstsgzdcmzaodurp`

Please read this before opening the `datevra_migration_package/` folder.

---

## What Has Been Checked So Far?
1. Nothing in your live Supabase database has been modified.
2. We inspected all 26 migration files in `db/migrations/` and checked them against the live database details you shared:
   - Your core tables (`schema.sql`) and `009` (`daily_action_limits`) exist.
   - **Missing and needed:** Café Passes & Proposals (`010` + `014`–`016`), Membership Passes (`011` + safe reconciliation), and the 4 Delhi Curated Experiences (`027`).
   - **Already present (DO NOT run):** All 3 Delhi cafés from `026_seed_delhi_cafes.sql` are already in your database, so **`026` must be skipped**.
   - **Need to verify first (`UNKNOWN`):** Whether migrations `002`–`008` and `017`–`025` (verification RPC, payment RPCs, report/subscription security) are already installed or still missing.

---

## Rule #1: Check Before Writing!
**Do NOT run any file in `datevra_migration_package/` yet.**

First, run the read-only inspection queries in **`DATEVRA_MIGRATION_PREFLIGHT.sql`**:
- Those queries **only read** database structure (`SELECT` statements). They cannot add, edit, or delete any data.
- Follow the instructions at the end of our report to run **Query 1** first and share the output.
- Once we confirm Queries 1–6, we will confirm the exact green light to run the files in `datevra_migration_package/` one by one in numerical order (`01_...` through `07_...`).

---

## Folder Map
- `DATEVRA_MIGRATION_PREFLIGHT.sql` — Safe read-only queries to run **first** in Supabase SQL Editor.
- `DATEVRA_MIGRATION_AUDIT.md` — Full technical audit of all 30 SQL files (`db/` + `db/migrations/`), dependency conflicts, and risk findings.
- `DATEVRA_MIGRATION_EXECUTION_PLAN.md` — Step-by-step execution gates, post-run checks, and recovery notes.
- `datevra_migration_package/` — Reviewed, guarded SQL scripts (`01` through `07`) ready **only after** preflight confirms your live baseline.
