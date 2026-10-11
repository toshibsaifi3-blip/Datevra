# Datevra — Supabase Edge Functions (Razorpay)

Server-side payment endpoints. **Not deployed.** Written against the Razorpay
REST API + webhook spec; they need secrets and a `supabase functions deploy`
before they can serve traffic.

## Functions

| Function | Route | Purpose |
|---|---|---|
| `create-order` | `POST /functions/v1/create-order` | Authenticated member → creates a Razorpay order for a plan and records a `pending` payment. Amount is read from `membership_plans`, never from the client. |
| `verify-payment` | `POST /functions/v1/verify-payment` | Verifies the Razorpay checkout signature server-side, marks the payment `verified`, and activates the membership. Idempotent. |
| `razorpay-webhook` | `POST /functions/v1/razorpay-webhook` | Handles `payment.captured` / `payment.failed` webhook events (HMAC-verified). Safety net if the client never calls `verify-payment`. |

Shared code lives in `_shared/`:
- `crypto.ts` — HMAC-SHA256 signature verification (WebCrypto only, no npm deps; unit-testable in Node).
- `supabase.ts` — member-JWT identification + service-role client + `activateMembership()`.

## Required secrets (NOT SET — do not use live keys during development)

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_test_... \
                    RAZORPAY_KEY_SECRET=... \
                    RAZORPAY_WEBHOOK_SECRET=...
```

Use **test-mode** keys until the full flow is verified end-to-end. The service-role
key (`SUPABASE_SERVICE_ROLE_KEY`) and `SUPABASE_URL` / `SUPABASE_ANON_KEY` are
provided automatically by the Functions environment — never put them in the
browser bundle.

## Deploy (NOT DONE)

```bash
supabase functions deploy create-order
supabase functions deploy verify-payment
supabase functions deploy razorpay-webhook
```

Then register the webhook URL in the Razorpay dashboard:
`https://<project-ref>.supabase.co/functions/v1/razorpay-webhook`

## Client wiring (follow-up, not done)

`purchaseMembership` in `src/lib/supabase/db.ts` currently inserts a pending
payment intent for manual admin verification (test-mode behavior). Once these
functions are deployed and verified, replace that path with:

```ts
const { data, error } = await supabase.functions.invoke("create-order", {
  body: { planId },
});
// then open Razorpay checkout with data.orderId / data.keyId,
// and call verify-payment with the checkout result.
```

Until then, the app must keep the "pending — awaiting verification" UX and
must never claim a payment succeeded without server verification.
