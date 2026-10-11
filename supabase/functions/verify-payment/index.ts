/**
 * Edge Function: verify-payment
 *
 * POST {
 *   paymentId,            // our payments.id (pending row from create-order)
 *   razorpayOrderId,
 *   razorpayPaymentId,
 *   razorpaySignature     // HMAC-SHA256(order_id|payment_id, key_secret)
 * }
 * → { ok: true } | { ok: true, already: true }
 *
 * Security rules:
 *  - Caller must be authenticated; the payment must belong to the caller,
 *    be a membership payment, and still be pending.
 *  - The signature is verified with the server-side key secret. A forged
 *    callback can never activate a membership.
 *  - Binding checks: the order id in the callback must match the order id
 *    stored on our payment row, and the amount must match the plan price.
 *    This defeats signature-replay across different payments.
 *  - Idempotent: an already-verified payment returns success without
 *    duplicating subscriptions or notifications.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { verifyRazorpayPaymentSignature } from "../_shared/crypto.ts";
import { callerUserId, serviceRole, activateMembership, json, UnauthorizedError } from "../_shared/supabase.ts";

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let userId: string;
  try {
    userId = await callerUserId(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) return json({ error: "Unauthorized" }, 401);
    throw e;
  }

  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keySecret) {
    return json({ error: "Payments are not configured yet (test mode)." }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const { paymentId, razorpayOrderId, razorpayPaymentId, razorpaySignature } = body;
  if (!paymentId || !razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
    return json({ error: "Missing payment details" }, 400);
  }

  const okSig = await verifyRazorpayPaymentSignature(
    keySecret,
    String(razorpayOrderId),
    String(razorpayPaymentId),
    String(razorpaySignature),
  );
  if (!okSig) {
    console.warn("[verify-payment] Signature mismatch for payment", paymentId);
    return json({ error: "Payment verification failed. Please contact support." }, 402);
  }

  const db = serviceRole();
  const { data: payment, error: payErr } = await db
    .from("payments")
    .select("id, user_id, kind, status, plan_id, amount, razorpay_order_id")
    .eq("id", paymentId)
    .single();

  if (payErr || !payment) return json({ error: "Payment not found" }, 404);
  if (payment.user_id !== userId) return json({ error: "Payment does not belong to you" }, 403);
  if (payment.kind !== "membership" || !payment.plan_id) {
    return json({ error: "Not a membership payment" }, 400);
  }
  // Binding: the callback's order must be the order we created for this row.
  if (payment.razorpay_order_id !== String(razorpayOrderId)) {
    console.warn("[verify-payment] Order id mismatch for payment", paymentId);
    return json({ error: "Payment verification failed. Please contact support." }, 402);
  }
  // Amount binding: the stored amount must match the plan's configured price.
  const { data: plan } = await db
    .from("membership_plans")
    .select("price")
    .eq("id", payment.plan_id)
    .single();
  if (!plan || Number(payment.amount) !== Number(plan.price)) {
    console.warn("[verify-payment] Amount mismatch for payment", paymentId);
    await db.from("activity_logs").insert({
      actor_id: userId,
      actor_role: "system",
      action: "payment.amount_mismatch",
      detail: `Payment ${paymentId} amount ${payment.amount} != plan ${payment.plan_id} price ${plan?.price}. Held for review.`,
    });
    return json({ error: "Payment verification failed. Please contact support." }, 402);
  }
  if (payment.status === "verified") return json({ ok: true, already: true });
  if (payment.status !== "pending") {
    return json({ error: `Payment is ${payment.status}` }, 409);
  }

  const { error: updErr } = await db
    .from("payments")
    .update({
      status: "verified",
      razorpay_payment_id: String(razorpayPaymentId),
      verified_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .eq("status", "pending"); // optimistic guard against double-activation

  if (updErr) {
    console.error("[verify-payment] Could not mark payment verified:", updErr);
    return json({ error: "Could not finalize the payment. Please contact support." }, 500);
  }

  try {
    await activateMembership(db, userId, payment.plan_id);
  } catch (e) {
    // Payment is verified; activation must be retried by support/webhook.
    console.error("[verify-payment] Activation failed after verification:", e);
    await db.from("activity_logs").insert({
      actor_id: userId,
      actor_role: "system",
      action: "payment.activation_failed",
      detail: `Payment ${paymentId} verified but activation failed: ${(e as Error).message}`,
    });
    return json({ error: "Payment received but activation failed. Support has been notified." }, 500);
  }

  return json({ ok: true });
});
