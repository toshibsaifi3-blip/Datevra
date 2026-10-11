# DATEVRA — MASTER PROJECT MEMORY & CONTINUATION INSTRUCTIONS

*Saved 2026-10-05. This is the permanent working context for the Datevra project.*

**Trigger phrases:** "resume Datevra", "continue Datevra", "continue from where we stopped", "RESUME DATEVRA" (or similar) →
FIRST read this entire file, inspect the current project state, then continue from the exact current state / next unfinished roadmap item.

**CRITICAL RULE:** Datevra is an existing production project. PRESERVE. VERIFY. IMPROVE. DO NOT REBUILD FROM SCRATCH.

## Standing constraints (never violate without explicit instruction)

- Do NOT restart the project, rebuild from scratch, or replace the design with a template.
- Do NOT remove existing working features. Do NOT unnecessarily change working code.
- Do NOT use Replit.
- Do NOT rerun or recreate the existing Supabase SQL schema — it is already created.
- Never expose or request a Supabase service-role/secret key in frontend code.
- Never change membership plan names. Never reintroduce Marigold / Sunflower / Rose (in UI, code, seeds, billing, comments, docs). If found, flag and replace.
- Never introduce payment processing before the user asks for the payment phase.
- Membership benefits must never guarantee a match, relationship, commitment, or date.
- Do not redeploy unnecessarily unless a change requires it.

## Current deployment (live)

- **Live URL:** https://datevra.vercel.app
- **Platform:** Vercel (project `datevra`, id `prj_mxjWzVQEtCj5zBeePCxsjqFU2YU8`)
- **Stack:** React 19, TypeScript, Vite, Tailwind v4, Supabase
- **Supabase project:** https://buendstsgzdcmzaodurp.supabase.co (DB live, tables responding)
- **Env vars configured on Vercel (production+preview):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- **Project root:** `~/workspace/datevra`
- **Handover doc:** `~/workspace/datevra/DATEVRA_MASTER_HANDOVER.md`

## Membership plans — FINAL (user-approved 2026-10-11)

1. Select — ₹499
2. Signature — ₹799
3. Privé — ₹1,199

**Status:** Codebase renamed to Select/Signature/Privé in source (Oct 11, tested locally 8/8, tsc+build clean). Live site rolled back to Oct 5 build (still shows Connect/Plus/Elite). Deployment via Vercel MCP blocked by build failures (module_not_found/ENOENT). DB `membership_plans.name` still old — user to run 3 UPDATEs. Never use Marigold / Sunflower / Rose.

## Product direction

Premium dating platform. Core: registration/login, profiles, Discover, likes, passes, matching, DM/chat, notifications, memberships, curated date experiences, café listings, date bookings, admin-curated experiences. Design: premium, romantic, Dreamy Fantasy, mobile-first, smooth couple/romantic animations.

Free-user limits: max 20 likes/day + 20 interests/day (IST-midnight reset, enforced by DB trigger + RPCs). Paid members exempt. Matches received unlimited. NULL subscription expiry = lifetime membership.

## Completed work (verified)

- Production build ✅, Vercel deployment ✅, live URL ✅
- Supabase connection ✅ (URL+key baked in bundle, verified in production JS)
- Supabase Auth signup ✅ (live test: account created, email-verification flow)
- Membership page ✅ (all 3 plans, correct prices)
- Auth protection ✅ (matches/chat redirect guests to login)
- Supabase mode active ✅ (demo seed accounts correctly rejected)
- DB live ✅ (membership_plans, profiles, likes, matches, conversations, messages, notifications all HTTP 200)

## Known gaps / notes (2026-10-05)

- Logged-in flows NOT yet verified (profile edit, like/pass, match creation, chat send) — no verified test account existed during QA. Test account `prodtest48291@gmail.com` exists UNVERIFIED in Supabase Auth; user may delete it.
- Supabase server-side email check rejected a `.in` test domain at signup (client regex accepts it; Gmail worked). Real users on standard providers unaffected.
- Old wrong env vars `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (empty) still exist on the Vercel project — harmless, cleanup optional.
- JPG hero fallback resized 167KB → 43KB for deploy (WebP primary untouched).
- No payment gateway yet (per user instruction). Razorpay Edge Functions exist in repo, NOT deployed.

## Roadmap (in order)

**PHASE 1 — LIVE WEBSITE QA** (next priority): homepage, signup/login e2e, profile create/edit, Discover, Like/Pass, matching, DM/chat, notifications, mobile+desktop responsiveness, Dreamy Fantasy design/animations, 20-like + 20-interest limit verification.

**PHASE 2 — ADMIN DASHBOARD:** identify the REAL admin route from code (do not invent a URL), verify admin auth/role, user/profile management, likes/matches monitoring, reports, blocks, chat moderation, café CRUD, curated experiences + manual user selection, booking management, notifications, CMS, platform settings.

**PHASE 3 — MEMBERSHIP VERIFICATION:** Connect ₹499 / Plus ₹799 / Elite ₹1,199 across UI, DB, logic, benefits, matching priority, billing prep. No old plan names.

**PHASE 4 — CUSTOM DOMAIN:** connect Hostinger domain to Vercel, DNS, SSL/HTTPS, final test.

**PHASE 5 — PAYMENTS (only when asked):** Razorpay (UPI/GPay/PhonePe/Paytm/cards/netbanking/wallets), server-side handling, success/failure, webhooks, activation/renewal/cancellation/refunds, transaction + admin records. Never expose secret keys in frontend.

**PHASE 6 — SECURITY & LEGAL:** RLS review, admin/auth/payment security review, Terms, Privacy, Refund/Cancellation policy, Contact/Support, safety/reporting, age requirements.

**PHASE 7 — FINAL LAUNCH:** full QA pass, payment+webhook test, admin test, booking test, performance, security, backup, launch approval, public launch.

## How to work on return

1. Do not start from scratch. 2. Read this memory. 3. Inspect current project state first. 4. Determine completed vs next unfinished task. 5. State the exact next step simply. 6. Make only required changes. 7. Preserve what works. 8. Verify after each major change. 9. Never silently remove functionality.
