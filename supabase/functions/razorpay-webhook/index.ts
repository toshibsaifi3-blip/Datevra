/**
 * Edge Function: razorpay-webhook
 *
 * Verifies Razorpay's HMAC over the raw request body, then claims each event
 * atomically. Failed events can be retried; completed events are never replayed.
 * A five-minute lease recovers events abandoned by a crashed worker.
 */
import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { verifyRazorpayWebhookSignature } from "../_shared/crypto.ts";
import {
  serviceRole,
  activateVerifiedPayment,
  reconcileRefundedPayment,
  json,
} from "../_shared/supabase.ts";

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  if (!webhookSecret) return json({ error: "Webhook not configured" }, 503);

  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  if (!await verifyRazorpayWebhookSignature(webhookSecret, rawBody, signature)) {
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
  const razorpayPaymentId = String(refund?.payment_id ?? payment?.id ?? "");
  const eventId = req.headers.get("x-razorpay-event-id")?.trim()
    || `sha256_${await sha256Hex(rawBody)}`;
  const claimToken = crypto.randomUUID();
  const db = serviceRole();

  // The RPC atomically inserts or reclaims failed/stale events. A false result
  // means another worker owns it or it has already completed.
  const { data: claimed, error: claimError } = await db.rpc("service_claim_payment_webhook_event", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_order_id: orderId,
    p_payment_id: razorpayPaymentId,
    p_claim_token: claimToken,
  });
  if (claimError) {
    console.error("[razorpay-webhook] Event claim failed:", claimError);
    return json({ error: "Could not claim webhook event" }, 500);
  }
  if (claimed !== true) return json({ ok: true, duplicate: true, eventId });

  const finish = async (status: "processed" | "ignored" | "failed", detail?: string) => {
    const { data, error } = await db.rpc("service_finish_payment_webhook_event", {
      p_event_id: eventId,
      p_claim_token: claimToken,
      p_status: status,
      p_detail: detail ?? null,
    });
    if (error || data !== true) {
      console.error("[razorpay-webhook] Could not finalize event claim:", error);
      throw new Error("Webhook event claim was superseded or could not be finalized");
    }
  };

  try {
    if (eventType === "payment.captured" && payment) {
      const capturedPaise = Number(payment.amount ?? 0);
      const capturedCurrency = String(payment.currency ?? "");
      if (!orderId || !razorpayPaymentId.startsWith("pay_")) {
        await finish("ignored", "Missing or invalid Razorpay order/payment identifier");
        return json({ ok: true, skipped: true });
      }

      const { data: existing, error: lookupError } = await db
        .from("payments")
        .select("id, user_id, kind, status, plan_id, amount, razorpay_order_id")
        .eq("razorpay_order_id", orderId)
        .maybeSingle();

      if (lookupError) throw lookupError;
      if (!existing) {
        await finish("ignored", "Unknown order_id");
        return json({ ok: true, skipped: true });
      }

      if (existing.kind !== "membership" || !existing.plan_id) {
        await finish("ignored", "Order is not a membership payment");
        return json({ ok: true, skipped: true });
      }

      const expectedPaise = Math.round(Number(existing.amount) * 100);
      if (capturedCurrency !== "INR" || capturedPaise !== expectedPaise) {
        const detail = `Captured ${capturedPaise} ${capturedCurrency}; expected ${expectedPaise} INR. Held for manual review.`;
        const { error: logError } = await db.from("activity_logs").insert({
          actor_id: existing.user_id,
          actor_role: "system",
          action: "payment.amount_mismatch",
          detail: `Payment ${existing.id}: ${detail}`,
        });
        if (logError) throw logError;
        await finish("ignored", detail);
        return json({ ok: true, held: true });
      }

      const activated = await activateVerifiedPayment(db, existing.id, razorpayPaymentId, "razorpay");
      await finish("processed");
      return json({
        ok: true,
        already: Boolean(activated.already_verified),
        paymentId: activated.payment_id,
        subscriptionId: activated.subscription_id,
      });
    }

    if (eventType === "payment.failed" && payment) {
      if (!orderId) {
        await finish("ignored", "payment.failed event missing order_id");
        return json({ ok: true, skipped: true });
      }
      // Razorpay can emit payment.failed for one attempt while the same order
      // remains payable and a later attempt succeeds. Do not fail the Datevra
      // order here: doing so would block the subsequent payment.captured event.
      // The webhook event itself is retained in payment_webhook_events for audit.
      await finish("processed", "Failed payment attempt recorded; order remains pending for retry or later capture.");
      return json({ ok: true, paymentAttemptFailed: true, orderStatusUnchanged: true });
    }

    if ((eventType === "refund.processed" || eventType === "payment.refunded") && razorpayPaymentId) {
      // Never revoke a membership for a partial refund. Razorpay amounts are
      // in paise; Datevra stores INR as whole rupees. If the payload does not
      // prove a full refund, hold it for manual reconciliation.
      const { data: refundPayment, error: refundLookupError } = await db
        .from("payments")
        .select("id, amount")
        .eq("razorpay_payment_id", razorpayPaymentId)
        .maybeSingle();
      if (refundLookupError) throw refundLookupError;
      if (!refundPayment) {
        await finish("ignored", "Refund payment record not found");
        return json({ ok: true, skipped: true });
      }

      const refundedPaise = Number(
        refund?.amount ?? payment?.amount_refunded ?? 0,
      );
      const expectedPaise = Math.round(Number(refundPayment.amount) * 100);
      if (!Number.isFinite(refundedPaise) || refundedPaise !== expectedPaise) {
        await finish("ignored", `Partial or unverified refund amount (${refundedPaise} paise; full refund requires ${expectedPaise} paise). Held for manual review.`);
        return json({ ok: true, held: true, reason: "partial_or_unverified_refund" });
      }

      const result = await reconcileRefundedPayment(db, razorpayPaymentId, `Webhook ${eventType} (${eventId})`);
      if (result.reconciled !== true) {
        await finish("ignored", "Refund payment record not found during reconciliation");
        return json({ ok: true, skipped: true });
      }
      await finish("processed");
      return json({ ok: true, ...result });
    }

    await finish("ignored", `Unhandled event ${eventType}`);
    return json({ ok: true, ignored: eventType });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("[razorpay-webhook] Event processing failed:", detail);
    try {
      await finish("failed", detail);
    } catch (finishError) {
      console.error("[razorpay-webhook] Failed to record retryable failure:", finishError);
    }
    return json({ error: "Webhook processing failed; retry is permitted" }, 500);
  }
});
