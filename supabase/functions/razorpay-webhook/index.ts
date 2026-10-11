/**
 * Edge Function: razorpay-webhook
 *
 * Receives Razorpay webhook events (no member JWT — authenticity comes
 * from the `x-razorpay-signature` HMAC over the RAW request body).
 *
 * Handled events:
 *  - payment.captured → marks the matching pending payment verified and
 *    activates the membership (idempotent — safe if verify-payment or a
 *    retry already handled it).
 *  - payment.failed   → marks the matching pending payment failed.
 *
 * All other events are acknowledged (200) and ignored.
 *
 * Configure in the Razorpay dashboard:
 *  URL: https://<project-ref>.supabase.co/functions/v1/razorpay-webhook
 *  Secret: the value stored as RAZORPAY_WEBHOOK_SECRET
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { verifyRazorpayWebhookSignature } from "../_shared/crypto.ts";
import { serviceRole, activateMembership, json } from "../_shared/supabase.ts";

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

  const event = JSON.parse(rawBody) as { event?: string; payload?: { payment?: { entity?: Record<string, unknown> } } };
  const payment = event.payload?.payment?.entity;

  if (event.event === "payment.captured" && payment) {
    const orderId = String(payment.order_id ?? "");
    const paymentRzpId = String(payment.id ?? "");
    const capturedPaise = Number(payment.amount ?? 0);
    const capturedCurrency = String(payment.currency ?? "");
    const db = serviceRole();

    const { data: existing } = await db
      .from("payments")
      .select("id, user_id, kind, status, plan_id, amount")
      .eq("razorpay_order_id", orderId)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) {
      // Already handled (verify-payment won the race) or unknown order.
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
      return json({ ok: true, held: true });
    }

    const { error: updErr } = await db
      .from("payments")
      .update({
        status: "verified",
        razorpay_payment_id: paymentRzpId,
        verified_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .eq("status", "pending");

    if (!updErr && existing.kind === "membership" && existing.plan_id) {
      try {
        await activateMembership(db, existing.user_id, existing.plan_id);
      } catch (e) {
        console.error("[razorpay-webhook] Activation failed:", e);
        await db.from("activity_logs").insert({
          actor_id: existing.user_id,
          actor_role: "system",
          action: "payment.activation_failed",
          detail: `Webhook captured payment ${existing.id} but activation failed: ${(e as Error).message}`,
        });
      }
    }
    return json({ ok: true });
  }

  if (event.event === "payment.failed" && payment) {
    const orderId = String(payment.order_id ?? "");
    const db = serviceRole();
    await db
      .from("payments")
      .update({ status: "failed" })
      .eq("razorpay_order_id", orderId)
      .eq("status", "pending");
    return json({ ok: true });
  }

  return json({ ok: true, ignored: event.event ?? "unknown" });
});
