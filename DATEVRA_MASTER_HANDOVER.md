# DATEVRA — MASTER HANDOVER

**Status:** PAUSED (2026-10-04). No further development until the owner explicitly resumes.
**Resume rule:** Read this file first, inspect the saved project state, and continue from
"The exact next pending step" below. Do not restart, repeat completed work, or re-ask settled questions.

---

## 1. What this project is

**Datevra** — premium dating + curated date-experience platform.
- **Stack:** React 19, TypeScript, Vite, Tailwind CSS v4, Framer Motion.
- **Data:** dual backend — demo (`src/lib/mockDb.ts`, localStorage-backed) ↔ Supabase (`src/lib/supabase/`).
  Switch is automatic: Supabase mode activates when `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` are set; otherwise demo mode.
- **Plans:** Connect ₹499 / Plus ₹799 / Elite ₹1,199 (source of truth: `src/data/seed.ts` → `PLANS`).
- **Project root:** `~/workspace/datevra`

---

## 2. Website structure & implemented features

### Pages (`src/pages/`)
| Route | File | Status |
|---|---|---|
| `/` | `public/Home.tsx` | ✅ Done — heart-moon hero, shortcuts, suggested profiles |
| `/discover` | `user/Discover.tsx` | ✅ Done — swipe deck, filters, like/pass/save, limit counters |
| `/matches` | `user/Matches.tsx` | ✅ Done — mutual-match grid |
| `/likes` | `user/Likes.tsx` | ✅ Done — received/sent tabs, like-back |
| `/chat` | `user/Chat.tsx` | ✅ Done — real messaging, typing, read ticks (media attach disabled, honest "coming soon") |
| `/cafes` | `public/CafesPublic.tsx` | ✅ Done — member tabs: All / Saved |
| `/experiences` | `public/ExperiencesPublic.tsx` | ✅ Done — Explore / applications / bookings |
| `/membership` | `user/Membership.tsx` + `public/MembershipPublic.tsx` | ✅ Done — 3 tiers, consent flow, test-mode payments |
| `/profile` | `user/Profile.tsx` | ✅ Done — photo manager, completion, editors |
| `/app` | `user/Dashboard.tsx` | ✅ Done — dashboard |
| `/notifications`, `/settings` | `user/` | ✅ Done — incl. account deletion (full cascade) |
| `/admin/*` | `admin/` | ✅ Done — dashboard, users, cafés, memberships, bookings, CMS |
| `/login`, `/register`, `/forgot` | `public/` | ✅ Done |

Mobile bottom nav (Home, Discover, Chat, Cafés, Profile) is consistent on all 7 member pages.

### Key feature files
- `src/lib/data.ts` — unified `Backend` interface + `useAsync` (with 30s cache for global lists)
- `src/lib/mockDb.ts` — demo backend (daily-limit enforcement included)
- `src/lib/supabase/db.ts` — Supabase adapter (RPCs: `get_daily_usage`, `record_profile_interest`)
- `src/lib/supabase/mappers.ts` — row mappers (`isoNull` for nullable expiry)
- `src/components/LimitModal.tsx` — `LimitReachedModal` + `DailyLimitCounters`
- `src/components/MatchOverlay.tsx` — mutual-match celebration (verified real matches only)
- `src/assets/hero-heart-moon.webp` (83KB) + `.jpg` fallback (167KB)

---

## 3. Free-user daily limits (20 likes / 20 interests)

- **Rule:** free = 20 likes/day + 20 profile-interest views/day, independent counters, IST-midnight reset.
- **Enforcement:** `BEFORE INSERT` trigger on `public.likes` (atomic, bypass-proof); `record_profile_interest()` RPC for views. Paid members exempt.
- **NULL expiry = lifetime membership** (fixed 2026-10-04 in SQL `_has_active_membership`, `mockDb.activeSubscription`, Supabase `activeSubscription`, mapper, and UI via `fmtExpiry` → "Lifetime").
- **Matches received are never limited.**
- **Migration:** `db/migrations/009_daily_limits.sql` (also synced byte-identical into `db/000_full_setup_LATEST_2026-10-04_v2.sql`).
- **UI:** counters on Discover; upgrade modal on cap (Discover, Likes, Dashboard, Home cards). Match-profile views intentionally ungated.

---

## 4. Backend / Supabase / migrations

- **Fresh DB:** `db/000_full_setup_LATEST_2026-10-04_v2.sql` (schema + migrations 002–009 + realtime). One run = everything.
- **Existing DB:** `db/migrations/009_daily_limits.sql` only (idempotent).
- **Other migrations:** `db/migrations/002_client_parity.sql`, `003_discovery_function.sql`, `004_security_hardening.sql`, `005_account_deletion.sql`, `006_match_integrity.sql`, `007_admin_bootstrap.sql` (SQL-Editor-only, self-disabling), `008_payment_retention.sql`.
- **RLS:** enabled on all 24 tables. `profiles_public` view exposes NO email / plan_expires_at / is_admin; granted to `authenticated` only.
- **Edge Functions** (`supabase/functions/`): `create-order`, `verify-payment`, `razorpay-webhook` — hardened, **test mode, NOT deployed**.

---

## 5. Razorpay / payment status

- **Status: TEST MODE ONLY. Not deployed. No live transaction ever performed.**
- Frontend never marks payments successful; verification is server-side (HMAC-SHA256, amount binding, idempotency).
- To go live: deploy 3 Edge Functions → set `RAZORPAY_KEY_SECRET` as function secret → live keys → `VITE_RAZORPAY_TEST_MODE=false` → real ₹1 test purchase + refund.

---

## 6. Test results (actually run — nothing claimed without evidence)

| Test | Result | Date |
|---|---|---|
| `tsc -p tsconfig.app.json --noEmit` | ✅ clean | 2026-10-04 |
| `npm run build` | ✅ passes | 2026-10-04 |
| Limit logic (11 cases: 20th/21st like+interest, independent counters, duplicates, lifetime NULL-expiry, expired) | ✅ 11/11 | 2026-10-04 |
| UI regression (15 checks: mobile+desktop pages, auth, chat send, counters, admin, zero errors/overflow) | ✅ 15/15 | 2026-10-04 |
| Security audit (profiles_public, RLS×24, policies, no secrets in repo) | ✅ clean | 2026-10-04 |

**NOT verified (do not claim):** live Supabase SQL execution, live RLS/JWT behavior, Edge Function deployment, live/test payment transaction, auth email delivery, real-iPhone testing (viewport emulation only).

---

## 7. Known limitations / incomplete features

- Chat media attachments: honestly disabled ("coming soon") — backend has no message-media upload.
- Google Fonts blocked in sandbox; loads normally on real internet.
- Demo mode is the tested path; Supabase adapter code is complete but live-untested.
- `profiles_public.plan_id` is visible to members (tier badge) — intentional.

---

## 8. Configuration variables (`.env.example` — placeholders only, never secrets)

| Variable | Required? | Where to get it |
|---|---|---|
| `VITE_SUPABASE_URL` | Yes (production) | Supabase → Project Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Yes (production) | Same page → anon/publishable key (**never** service_role) |
| `VITE_RAZORPAY_KEY_ID` | Yes (payments) | Razorpay dashboard → API keys (test key first) |
| `VITE_RAZORPAY_TEST_MODE` | Yes | `true` until live (default) |
| `RAZORPAY_KEY_SECRET` | Yes (live payments) | Razorpay dashboard → **Edge Function secret only, never frontend** |

**Never put in the repo or chat:** service_role key, database password, Razorpay key secret.

---

## 9. Hosting & deployment (summary — full guide in `DEPLOYMENT.md`)

1. Run SQL setup on Supabase + `SELECT public.bootstrap_first_admin('owner@email')`.
2. `.env` from `.env.example`, rebuild.
3. Deploy via Vercel/Netlify (`npm run build`, publish `dist`), add env vars, connect domain via DNS.
4. Deploy Edge Functions + secrets for payments; live-key switch + ₹1 test.

---

## 10. Exact last completed task

**Final audit + NULL-expiry lifetime fix + master handover packaging (2026-10-04).**
Changed: `Subscription.expiresAt: string | null`; NULL-safe `activeSubscription` (mockDb + Supabase adapter + SQL `_has_active_membership`); `isoNull` mapper; `fmtExpiry` UI helper; migration 009 re-synced into the combined setup file. All tests re-run green.

## 11. Exact next pending step (resume here)

**Run the SQL setup against the live Supabase project** (this has never been done):
- Fresh DB → paste+run `db/000_full_setup_LATEST_2026-10-04_v2.sql`
- Existing DB (v2 already applied) → paste+run `db/migrations/009_daily_limits.sql` only
- Then verify: `SELECT tgname FROM pg_trigger WHERE tgname='trg_enforce_like_limit';` → must return 1 row.
- Then: `SELECT public.bootstrap_first_admin('<owner-email>');`

After that: set `.env`, rebuild, deploy (see `DEPLOYMENT.md` Part 2–3).

---

*End of handover. Project is saved as-is at `~/workspace/datevra`. Do not modify until the owner resumes.*
