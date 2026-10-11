# Datevra — Final Delivery Report

**Date:** 2026-10-04 · **Stack:** React 19 + TypeScript + Vite + Tailwind v4 + Supabase-ready

---

## Security audit (this round)

- **`profiles_public` view:** verified clean — exposes only id, first_name, age, gender, interested_in, city, bio, interests, hobbies, relationship_intent, lifestyle, photos, verified, online, last_active, profile_complete, plan_id, created_at. **Never exposes:** email, plan_expires_at, is_admin. Granted to `authenticated` only (never anon); block-aware filtering.
- **Discovery functions (003):** SECURITY DEFINER, email-free columns only, execute granted to `authenticated` only.
- **RLS:** enabled on all 24 tables (23 base + `daily_action_limits`).
- **Key policies verified:** `profiles_select_own` (own-row only), `likes_insert_own` (own likes + block check), `subscriptions_select_own` / `payments_select_own` (own-row or admin, no user writes).
- **Frontend data access:** `getUser` only queries own profile; discovery uses the safe RPC; admin reads protected by `is_admin()` RLS.
- **No secrets** in the repo (verified: no service_role keys, DB passwords, or Razorpay secrets).

## What was completed

### Frontend
- Premium Dreamy Fantasy theme on every page (midnight purple, royal purple, electric pink, lavender, celestial blue).
- Pages: Home (heart-moon hero), Discover (swipe deck), Likes, Matches, Chat (real messaging, typing, read ticks), Cafés, Experiences, Membership (Connect ₹499 / Plus ₹799 / Elite ₹1,199), Profile, Dashboard, Notifications, Settings, Admin panel.
- Mobile bottom nav (Home, Discover, Chat, Cafés, Profile), responsive, zero horizontal overflow.
- Performance: 83KB WebP hero (was 417KB), static ambient orbs, 30s list-request cache, lazy images, GPU-only keyframe animations.

### Free-user daily limits (20 likes / 20 interests, IST reset)
- **Database (`009_daily_limits.sql`):** counter table + `BEFORE INSERT` trigger on `likes` (atomic, bypass-proof, duplicate-safe) + `record_profile_interest()` / `get_daily_usage()` RPCs + RLS. Paid members (active subscription **or** active plan, **NULL expiry = lifetime**) exempt.
- **Demo backend:** identical rules in `mockDb` (persisted, survives refresh/logout).
- **UI:** visible "N/20 likes used · N/20 interests used" counters on Discover; upgrade modal on cap (Discover, Likes, Dashboard, Home cards).

### NULL-expiry fix (this round)
- `Subscription.expiresAt` is now `string | null`; NULL = lifetime membership everywhere: SQL `_has_active_membership`, `mockDb.activeSubscription`, Supabase `activeSubscription`, mapper no longer coerces NULL to "now". UI shows "Lifetime".

### Backend / DB
- Migrations 002–009 audited for order + compatibility; combined fresh-DB setup file synced byte-identical with sources.
- RLS, triggers, functions reviewed; no secret material in repo.

### Payments
- Razorpay Edge Functions (`create-order`, `verify-payment`, `razorpay-webhook`) hardened (HMAC, amount binding, idempotency). **Test mode, NOT deployed, NOT live-tested.**

---

## What was tested and passed
- `tsc` clean · production build passes.
- **11/11 logic tests:** 20th like/interest allowed, 21st blocked (`DAILY_LIKE_LIMIT_REACHED`); independent counters; duplicates don't consume; lifetime (NULL expiry) member unlimited; expired member capped at 20.
- **31/31 UI checks** (mobile 390px + desktop 1280px): all pages render, login (member + admin), chat send works, counters display + increment via real UI, zero page errors, zero overflow.

## What could NOT be verified
- **Live Supabase execution** — no SQL has been run against the live project; RLS/JWT/trigger behavior on the real database is unverified until you run the setup.
- **Live payments** — Edge Functions not deployed; no live/test transaction performed.
- **Auth emails** — email provider not configured.
- **Real-device iPhone testing** — verified via mobile viewport emulation only.

## What you still need to do before launch
1. Run the SQL setup on Supabase (fresh: full v2 file; existing: 009 only) + bootstrap the first admin.
2. Set `.env` (Supabase URL/anon key, Razorpay test key) and rebuild/redeploy.
3. Deploy the site (Vercel/Netlify) + connect your domain.
4. Deploy Razorpay Edge Functions + set `RAZORPAY_KEY_SECRET` + switch to live keys + do a ₹1 live test purchase/refund.
5. Full live pass: register, like, chat, buy membership, admin — on your iPhone.

See `DEPLOYMENT.md` for the step-by-step guide.
