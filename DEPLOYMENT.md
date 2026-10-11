# Datevra — Deployment Guide

One complete guide: Supabase setup → environment → deploy → domain → live test.
Sections marked **[YOU]** need your action. Sections marked **[DONE]** are already finished in this project.

---

## Part 1 — Supabase database [YOU, ~10 min]

### 1a. For a FRESH database (nothing set up yet)
1. Open [supabase.com](https://supabase.com) → your project → **SQL Editor** (left sidebar) → **New query**.
2. Open the file `db/000_full_setup_LATEST_2026-10-04_v2.sql` from this project, copy **everything**, paste into the query box.
3. Click **Run**. Expect "Success. No rows returned".
4. This creates all tables, RLS policies, triggers, functions (including the daily-limits system), and realtime setup in one go.

### 1b. For an EXISTING database (v2 setup already run, before 009)
1. SQL Editor → New query.
2. Copy/paste **only** `db/migrations/009_daily_limits.sql` → Run.
3. Verify:
   ```sql
   SELECT tgname FROM pg_trigger WHERE tgname = 'trg_enforce_like_limit';
   ```
   → must return one row.

### 1c. Create the first admin [YOU]
After signing up with your owner email in the app:
```sql
SELECT public.bootstrap_first_admin('your-email@example.com');
```
(Replace with your real owner email. Run once — it permanently disables itself afterwards.)

---

## Part 2 — Environment variables [YOU, ~5 min]

1. Copy `.env.example` to `.env` in the project root.
2. Fill in:
   - `VITE_SUPABASE_URL` — Supabase → Project Settings → API → Project URL
   - `VITE_SUPABASE_ANON_KEY` — same page → `anon` / `publishable` key (**never** the `service_role` key)
   - `VITE_RAZORPAY_KEY_ID` — Razorpay dashboard → Settings → API Keys (**test-mode key** for now)
   - Keep `VITE_RAZORPAY_TEST_MODE=true` until you go live (see Part 4).
3. Never commit `.env` to git.

---

## Part 3 — Deploy the website [YOU, ~15 min]

**Option A — Vercel (recommended):**
1. Push this project to a GitHub repo.
2. [vercel.com](https://vercel.com) → New Project → import the repo.
3. Add the same environment variables from `.env` in Vercel → Settings → Environment Variables.
4. Deploy. You'll get a `*.vercel.app` URL.

**Option B — Netlify:** same flow (New site from Git), build command `npm run build`, publish directory `dist`.

### Connect your domain [YOU]
- In Vercel/Netlify → Domains → add your domain → copy the DNS records shown.
- At your domain registrar, add those DNS records. Wait up to 24h for propagation.

---

## Part 4 — Payments (Razorpay) [YOU]

**Current state [DONE]:** Edge Functions (`create-order`, `verify-payment`, `razorpay-webhook`) are written, hardened (HMAC verification, amount binding, idempotency), and in **test mode**. They are **NOT deployed** and **NOT tested live**.

To go live with real payments:
1. Get **live** Razorpay API keys (dashboard → switch from Test to Live mode).
2. Deploy the three Edge Functions: `supabase functions deploy create-order verify-payment razorpay-webhook`.
3. Set the secret: `supabase secrets set RAZORPAY_KEY_SECRET=<live secret>` (**never** in frontend code).
4. In Razorpay dashboard → Webhooks, add your function URL for `razorpay-webhook`; copy the webhook secret into function secrets if used.
5. Set `VITE_RAZORPAY_KEY_ID` to the **live** key id and `VITE_RAZORPAY_TEST_MODE=false`, redeploy.
6. Do a real ₹1 test purchase and refund it. **Do not claim live payments work until this test passes.**

---

## Part 5 — Test the live site [YOU]

1. Register a new account → verify you receive the auth email.
2. Discover → like someone → check the counter shows "1/20 likes used".
3. Open a full profile → "1/20 interests used".
4. Buy a test membership (test mode) → counters disappear (paid = unlimited).
5. Admin login → check dashboard, cafés, memberships.
6. On mobile (your iPhone): bottom nav (Home, Discover, Chat, Cafés, Profile), chat send, no horizontal scrolling.

---

## What you must supply yourself (nothing is pre-filled)

- Supabase project URL + anon key
- Razorpay test/live key id + key secret
- Your domain + DNS access
- Owner email for the admin bootstrap step

**[DONE] in this project:** all source code, migrations 002–009, RLS policies, triggers, Edge Function code, daily-limit enforcement (20 likes / 20 interests, IST reset, paid exemption incl. lifetime memberships), performance optimizations, and the full test suite results (see FINAL_REPORT.md).
