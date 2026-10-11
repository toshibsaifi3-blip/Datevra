# DATEVRA

Datevra is a premium dating and curated date-experience platform: preference-based matchmaking, private chat, manually-curated date experiences, café partnerships, and a full admin console — wrapped in a midnight-black / deep-burgundy / rose-gold brand.

## Tech stack

| Layer      | Technology |
|------------|------------|
| Frontend   | React 18 + TypeScript + Vite |
| Styling    | Tailwind CSS v4, custom cinematic theme |
| Animation  | Framer Motion (+ CSS ambient effects, reduced-motion aware) |
| Routing    | react-router-dom **HashRouter** (no server rewrites needed) |
| Backend    | Supabase (Postgres + Auth + Realtime + Storage) |
| Payments   | Razorpay (test mode until live credentials are configured) |
| Demo mode  | `src/lib/mockDb.ts` — localStorage adapter with the same call shapes as the Supabase queries |

## Quick start

```bash
npm install
npm run dev      # local dev server
npm run build    # production build (outputs to dist/)
```

## Demo credentials (localStorage demo mode)

| Role  | Email              | Password   |
|-------|--------------------|------------|
| User  | `demo@datevra.in`  | `demo1234` |
| Admin | `admin@datevra.in` | `admin1234` |

Demo mode works with zero configuration — open the app and log in with either account. Reset demo data from Settings → "Reset demo data".

## Supabase setup (going live)

> **Status: adapter implemented, awaiting credentials.** The app now ships a complete Supabase backend (`src/lib/supabase/`) behind the unified data layer (`src/lib/data.ts`). Every screen calls the async `Backend` interface; with env vars set it talks to Supabase (RLS-enforced, realtime), without them it runs the local demo backend. UI, routing, and animations are identical in both modes.

1. **Create a project** at [supabase.com](https://supabase.com) and copy the project URL + anon key.
2. **Run the schema:** open Supabase → SQL Editor → paste the entire contents of `db/schema.sql` → Run. This creates all tables, triggers, RLS policies, storage buckets, and seeds (plans, settings, 6 experiences, 6 cafés).
3. **Run the migrations in order:** `db/migrations/002_client_parity.sql` (client-needed policies + server-side notification triggers), then `db/migrations/003_discovery_function.sql` (secure member-safe discovery reads — required; the `profiles_public` view cannot bypass RLS on its own), then `db/migrations/004_security_hardening.sql` (block enforcement on likes/messages, privilege-escalation protection, message immutability, elite-experience enforcement), then `db/migrations/005_account_deletion.sql` (`delete_own_account()` erasure function + one-pending-payment-per-plan uniqueness), then `db/migrations/006_match_integrity.sql` (match participants immutable — prevents match hijacking), then `db/migrations/007_admin_bootstrap.sql` (SQL-Editor-only first-admin bootstrap, no client path), then `db/migrations/008_payment_retention.sql` (anonymized financial records on deletion).
   - **Phone shortcut:** `db/000_full_setup.sql` is all of the above concatenated in order — paste it whole into the SQL editor and run once. Fully re-runnable.
4. **Enable Realtime:** run `db/realtime_setup.sql` once in the SQL editor (adds chat, matches, notifications, applications, bookings, profiles, conversations, likes to the `supabase_realtime` publication). Typing indicators use Realtime broadcast and need no table setup.
4. **Enable email auth:** Authentication → Providers → Email (on). Configure the site URL and redirect URLs for your deployment.
5. **Enable Realtime:** Database → Replication → enable for `messages`, `notifications`, `matches`, `likes`, `conversations`, `date_applications`, `date_bookings`, `profiles` (live chat, typing indicators, and cross-screen refresh).
6. **Create the first admin** — SQL-Editor-only bootstrap (there is intentionally no client/API path; ordinary users can never self-promote):
   1. Sign up in the app with the owner account.
   2. Immediately, as project owner in the SQL Editor, run:
   ```sql
   SELECT public.bootstrap_first_admin('you@example.com');
   ```
   3. Verify with:
   ```sql
   SELECT email, is_admin FROM public.profiles WHERE is_admin;
   ```
   The function refuses JWT callers, has no client grants, and is permanently disabled once any admin exists.
   Afterwards, admins can promote others from the admin panel. Ordinary users can never self-promote: the `protect_profile_fields` trigger blocks every non-admin `is_admin` change.
7. **Set environment variables** (see `.env.example`):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_RAZORPAY_KEY_ID` (test key for now)
   - `VITE_RAZORPAY_TEST_MODE=true`
8. **Verify:** `npm run build` must pass; sign up two accounts, like each other, confirm the mutual-match trigger fires, a conversation appears, and messages arrive live. Admin sign-in → verify a pending payment → confirm the subscription activates.

### Storage

The schema creates three public buckets via SQL: `profile-photos` (members write only their own `<user-id>/…` folder), `cafe-media` and `experience-media` (admins only).

### Realtime

Chat uses Postgres changes on `messages` plus broadcast channels for typing indicators. Coarse screen invalidation subscribes to table changes per area (likes, matches, notifications, …). **Not yet integration-tested against a live project** — needs the credentials from step 1.

## Razorpay integration — status: TEST MODE (PENDING)

What exists today: checkout UI, a terms-confirmation popup (payment never guarantees romantic outcomes), payment records with `pending / verified / failed / refunded` statuses, and refund tracking.

What is still required before taking real money:

- [ ] Server-side order creation (Edge Function using `RAZORPAY_KEY_SECRET` — never in frontend code)
- [ ] Server-side signature verification → only then mark payments `verified`
- [ ] Webhook endpoint (`payment.captured`, `payment.failed`) with signature validation
- [ ] Live Razorpay keys + `VITE_RAZORPAY_TEST_MODE=false`

Until then, the app stays in test mode and never reports a payment as successful without verification.

## Membership plans

The only plans — legacy names were permanently removed from code, seeds, pricing, checkout and dashboards:

| Plan    | Price / month | Highlights |
|---------|---------------|-----------|
| Connect | ₹499  | Premium badge, priority matchmaking, enhanced visibility |
| Plus    | ₹799  | Everything in Connect + higher priority, discovery filters, priority support |
| Elite   | ₹1,199 | Everything in Plus + highest priority, exclusive discovery, eligibility for selected exclusive experiences |

Membership enhances visibility and priority. It never guarantees a match, a relationship, commitment, a date, or any particular romantic outcome.

## Deployment

The app is a static Vite build using **HashRouter**, so it deploys anywhere static files are served with **no rewrite rules needed**:

- **Netlify:** build command `npm run build`, publish directory `dist`
- **Vercel:** framework preset "Vite", output `dist`
- Any static host / CDN works the same way

Direct internal routes and browser refresh work because routing lives in the URL hash (`#/matches`), not the server path.

## Project structure

```
datevra/
├── db/
│   └── schema.sql          # Complete production Postgres schema (Supabase)
├── src/
│   ├── components/         # UI primitives, layout, animated building blocks
│   ├── pages/              # Public, user, and admin pages
│   ├── context/            # App/session state
│   ├── data/seed.ts        # Demo catalogue (plans, profiles, cafés, experiences, FAQs)
│   ├── lib/
│   │   ├── mockDb.ts       # Demo-mode localStorage adapter (same call shapes as Supabase)
│   │   ├── data.ts         # Unified async Backend: demo vs Supabase switch + useBackend/useAsync
│   │   ├── supabase.ts     # Supabase client bootstrap + env detection
│   │   ├── supabase/       # Real backend: mappers.ts, auth.ts, db.ts (RLS-enforced, realtime)
│   │   ├── compat.ts       # Transparent compatibility scoring (real factors only)
│   │   └── types.ts        # Shared TypeScript types
│   └── main.tsx            # Entry (HashRouter)
├── db/
│   ├── schema.sql              # Complete production Postgres schema (Supabase)
│   └── migrations/
│       └── 002_client_parity.sql  # Client-needed policies + notification triggers
├── .env.example            # Required env vars (never commit real keys)
└── README.md
```

## What's demo vs production

**Working today (demo mode, localStorage):** registration/login, discovery with like/pass/save/report/block, preference-based matching with transparent compatibility scores, mutual-match flow, private chat with typing indicators and delivery states, curated-experience applications, café discovery + saved cafés, membership purchase flow (simulated), notifications centre, full admin console (users, applications, bookings, cafés, payments, investors, CMS, settings, activity logs). Verified by 21 automated runtime smoke tests + `tsc` + production build.

**Supabase mode (adapter implemented, NOT yet tested live):** set `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`, run `db/schema.sql` + `db/migrations/002_client_parity.sql`, and the same UI talks to the real backend: Supabase Auth (email verification, password recovery), RLS-enforced profiles/likes/matches/chat, realtime messages + typing indicators, server-side notifications, admin writes. The adapter, mappers, and migration are written and typechecked, but no live project credentials exist yet, so this path is **unverified**.

**Pending external dependencies (honestly marked, never faked):** Supabase project credentials (to test/verify); Razorpay live keys + server verification + webhooks (a payments Edge Function is still needed — members can only create *pending* intents); email provider for notification emails (structure prepared, not active); real café photography and venue imagery (seed uses placeholders).

## Quality checklist

- [x] No Marigold / Sunflower / Rose plan references anywhere (codebase grep verified; `rose` appears only as a UI color tone)
- [x] Connect ₹499 / Plus ₹799 / Elite ₹1,199 everywhere (UI, seeds, SQL)
- [x] Homepage cinematic animations, page transitions, couple visuals, floating petals
- [x] Discovery, like/pass, mutual-match creation (trigger in SQL mirrors mock logic)
- [x] Private chat (participants-only RLS), notifications centre
- [x] Date application workflow with all 8 statuses; manual admin selection
- [x] Café management, commission tracking, investor ledger, activity audit log
- [x] 18+ age enforcement (DB check constraint + signup validation)
- [x] RLS on every table; discovery returns only safe columns (email never exposed) via SECURITY DEFINER functions (migration 003); blocks enforced at RLS level for likes/messages; plan/verification fields protected from self-escalation (migration 004)
- [x] Mobile navigation, responsive layouts, reduced-motion support
- [x] HashRouter: internal routes load directly, refresh never breaks
- [x] `npm run build` succeeds with no critical errors
- [x] Supabase adapter implemented (`src/lib/supabase/` + unified `src/lib/data.ts`); all 49 pages on the async backend; demo mode verified by 21 runtime smoke tests
- [ ] **Supabase live verification — needs your project URL + anon key** (adapter written but untested against a real project)
- [ ] **Razorpay live verification — needs test-mode keys first** (Edge Functions in `supabase/functions/` are written but **not deployed**; the app currently records pending intents for manual admin verification)

## Security notes

- Service-role keys and `RAZORPAY_KEY_SECRET` are server-side only — never in frontend code, never in `.env` shipped to the browser.
- Historical financial records are append-only; changes are logged in `activity_logs`. On account deletion, payment/subscription rows are retained with `user_id` anonymized to NULL (migration 008) — the audit trail survives, the person is forgotten.
- Profile photos use a **public** bucket deliberately: photos are shared with other members in discovery/matching/chat by design, object paths are unguessable UUIDs, and writes/deletes are restricted to the owner's `<user-id>/` folder by RLS. A private bucket would add signed-URL complexity with no real privacy gain.
- Booking details are visible only to participants and admins.
- Reports/blocks are enforced at the database layer, not just the UI.
