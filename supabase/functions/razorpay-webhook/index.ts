/**
 * Edge Function: razorpay-webhook
 *
 * Receives Razorpay webhook events (no member JWT — authenticity comes
 * from the `x-razorpay-signature` HMAC over the RAW request body).
 *
 * Handled events:
 *  - payment.captured               → atomically verifies pending payment &
 *                                     activates membership via service_activate_verified_payment.
 *  - payment.failed                 → marks matching pending payment failed.
 *  - refund.processed /
 *    payment.refunded               → atomically reconciles refund via
 *                                     service_reconcile_refunded_payment.
 *
 * Idempotency:
 *  - Every delivered event is recorded in public.payment_webhook_events using
 *    `x-razorpay-event-id` (or SHA-256 of rawBody fallback). Replayed events
 *    return 200 `{ ok: true, duplicate: true }` without repeating side effects.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { verifyRazorpayWebhookSignature } from "../_shared/crypto.ts";
import {
  serviceRole,
  activateVerifiedPayment,
  reconcileRefundedPayment,
  json,
} from "../_shared/supabase.ts";

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("[razorpay-webhook] RAZORPAY_WEBHOOK_SECRET not set");
    return json({ error: "Webhook not configured" }, 503);
  }

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const okSig = await verifyRazorpayWebhookSignature(webhookSecret, rawBody, signature);
  if (!okSig) {
    console.warn("[razorpay-webhook] Invalid signature");
    return json({ error: "Invalid signature" }, 401);
  }

  let event: {
    event?: string;
    payload?: {
      payment?: { entity?: Record<string, unknown> };
      refund?: { entity?: Record<string, unknown> };
    };
  };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "Invalid JSON payload" }, 400);
  }

  const eventType = String(event.event ?? "unknown");
  const payment = event.payload?.payment?.entity;
  const refund = event.payload?.refund?.entity;
  const orderId = String(payment?.order_id ?? "");
  const paymentRzpId = String(refund?.payment_id ?? payment?.id ?? "");
  const headerEventId = req.headers.get("x-razorpay-event-id")?.trim();
  const eventId = headerEventId || `sha256_${await sha256Hex(rawBody)}`;

  const db = serviceRole();

  // Record event idempotently before side effects; PK conflict (23505) => duplicate delivery
  const { error: dedupErr } = await db.from("payment_webhook_events").insert({
    event_id: eventId,
    event_type: eventType,
    razorpay_order_id: orderId || null,
    razorpay_payment_id: paymentRzpId || null,
    status: "processed",
  });
  if (dedupErr) {
    if (String(dedupErr.code) === "23505") {
      return json({ ok: true, duplicate: true, eventId });
    }
    console.error("[razorpay-webhook] Failed to record webhook event:", dedupErr);
    return json({ error: "Could not record webhook event" }, 500);
  }

  if (eventType === "payment.captured" && payment) {
    const capturedPaise = Number(payment.amount ?? 0);
    const capturedCurrency = String(payment.currency ?? "");

    const { data: existing } = await db
      .from("payments")
      .select("id, user_id, kind, status, plan_id, amount")
      .eq("razorpay_order_id", orderId)
      .maybeSingle();

    if (!existing) {
      await db
        .from("payment_webhook_events")
        .update({ status: "ignored", detail: "Unknown order_id" })
        .eq("event_id", eventId);
      return json({ ok: true, skipped: true });
    }

    if (existing.status === "verified") {
      return json({ ok: true, already: true });
    }

    if (existing.status !== "pending") {
      await db
        .from("payment_webhook_events")
        .update({ status: "ignored", detail: `Payment already in status ${existing.status}` })
        .eq("event_id", eventId);
      return json({ ok: true, skipped: true });
    }

    // Amount/currency binding: never activate on a mismatched capture.
    const expectedPaise = Math.round(Number(existing.amount) * 100);
    if (capturedCurrency !== "INR" || capturedPaise !== expectedPaise) {
      console.error(
        `[razorpay-webhook] Amount mismatch for payment ${existing.id}: got ${capturedPaise} ${capturedCurrency}, expected ${expectedPaise} INR`,
      );
      await db.from("activity_logs").insert({
        actor_id: existing.user_id,
        actor_role: "system",
        action: "payment.amount_mismatch",
        detail: `Captured ${capturedPaise} ${capturedCurrency} for payment ${existing.id}, expected ${expectedPaise} INR. Held for manual review.`,
      });
      await db
        .from("payment_webhook_events")
        .update({ status: "failed", detail: "Amount or currency mismatch" })
        .eq("event_id", eventId);
      return json({ ok: true, held: true });
    }

    try {
      const activated = await activateVerifiedPayment(db, existing.id, paymentRzpId, "razorpay");
      return json({ ok: true, already: Boolean(activated.already_verified), paymentId: activated.payment_id });
    } catch (e) {
      console.error("[razorpay-webhook] Atomic activation failed:", e);
      await db.from("activity_logs").insert({
        actor_id: existing.user_id,
        actor_role: "system",
        action: "payment.activation_failed",
        detail: `Webhook captured payment ${existing.id} but activation failed: ${(e as Error).message}`,
      });
      await db
        .from("payment_webhook_events")
        .update({ status: "failed", detail: (e as Error).message })
        .eq("event_id", eventId);
      return json({ error: "Activation failed" }, 500);
    }
  }

  if (eventType === "payment.failed" && payment) {
    await db
      .from("payments")
      .update({ status: "failed" })
      .eq("razorpay_order_id", orderId)
      .eq("status", "pending");
    return json({ ok: true });
  }

  if ((eventType === "refund.processed" || eventType === "payment.refunded") && paymentRzpId) {
    try {
      const result = await reconcileRefundedPayment(
        db,
        paymentRzpId,
        `Webhook ${eventType} (${eventId})`,
      );
      return json({ ok: true, ...result });
    } catch (e) {
      console.error("[razorpay-webhook] Refund reconciliation failed:", e);
      await db
        .from("payment_webhook_events")
        .update({ status: "failed", detail: (e as Error).message })
        .eq("event_id", eventId);
      return json({ error: "Refund reconciliation failed" }, 500);
    }
  }

  await db
    .from("payment_webhook_events")
    .update({ status: "ignored", detail: `Unhandled event ${eventType}` })
    .eq("event_id", eventId);

  return json({ ok: true, ignored: eventType });
});
