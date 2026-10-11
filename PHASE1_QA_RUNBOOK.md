# Datevra — Phase 1 Live QA Runbook

*Prepared 2026-10-05. Live site: https://datevra.vercel.app*
*Do these on your phone, in order. Each step says what to do → what you should see.*

## Step 0 — Prerequisites (do once)

**0a. Verified test account.** During the first QA pass no verified account existed.
- If you own the inbox for `prodtest48291@gmail.com`: open that Gmail, find the Datevra verification email, tap the link. Then log in at datevra.vercel.app/#/login.
- If you don't own that inbox: register fresh at datevra.vercel.app/#/register with a Gmail address you control, then tap the verification link in that inbox.
- ⚠️ Avoid throwaway `.in` test domains — Supabase rejected one server-side at signup. Gmail works.

**0b. Migration 009 (free-user daily limits).** Still not run on live Supabase.
- Open Supabase Dashboard → SQL Editor → paste the contents of `db/migrations/009_daily_limits.sql` → Run.
- The migration is idempotent and verified safe to run. Skip section G until this is done.

---

## A. Login & session
- [ ] Log in with the verified account → lands on `#/app` dashboard, no errors.
- [ ] In a private/incognito tab, open datevra.vercel.app/#/matches → redirects to login (not a blank page).

## B. Profile (`#/profile`)
- [ ] Profile page loads with your account's details.
- [ ] Edit display name + bio → Save → reload the page → changes are still there.
- [ ] Add/change a profile photo → it appears after reload.

## C. Discover (`#/discover`)
- [ ] Profiles load (cards with photos, names, bios).
- [ ] Tap Like on 2–3 profiles → each card advances, like count feels responsive.
- [ ] Tap Pass on 1 profile → card advances without error.
- [ ] Open a full profile → counts as an "interest" (free users: 20/day cap after 009).

## D. Matches (`#/matches`) — needs a 2nd test account
- [ ] Register a second account (different Gmail), complete its profile.
- [ ] As account 1, Like account 2's profile. As account 2, Like account 1's profile.
- [ ] Both accounts now show the match under `#/matches`.

## E. Chat (`#/chat`) — needs the match from D
- [ ] As account 1, open the match's chat → send "hello test" → message appears instantly.
- [ ] As account 2 (other browser/incognito), open `#/chat` → the message is there.
- [ ] Reply from account 2 → account 1 sees it after refresh/realtime.

## F. Notifications (`#/notifications`)
- [ ] After the like/match/message above, the bell shows new notifications.
- [ ] Opening `#/notifications` lists them (match, message).

## G. Daily limits (only after Step 0b)
- [ ] As a free account, Like 20 profiles → the 21st like is blocked with an upgrade nudge.
- [ ] Open 20 full profiles → the 21st is blocked.
- [ ] Counters reset at IST midnight (can't easily test — note as known).

## H. Look & feel (2 min)
- [ ] Scroll homepage + Discover on your phone → Dreamy Fantasy styling intact, no broken images or overlapping text.
- [ ] Rotate to landscape / try a desktop browser → layout adapts, nothing cut off.

---

## Results log

| Step | Pass / Fail | Notes |
|------|-------------|-------|
| A | | |
| B | | |
| C | | |
| D | | |
| E | | |
| F | | |
| G | | |
| H | | |

*Send me the table (or just the failures) and I'll fix what's broken. Phase 2 (admin dashboard) starts after this passes.*
