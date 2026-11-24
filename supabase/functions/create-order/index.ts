/**
 * Edge Function: create-order
 *
 * POST { planId: "connect" | "plus" | "elite" }
 * → { paymentId, orderId, amount, currency, keyId, reused?: true }
 *
 * Security rules:
 *  - Caller must be an authenticated member (JWT). The payment row is
 *    created for the caller only — a client can never create an order
 *    for someone else.
 *  - The amount ALWAYS comes from the `membership_plans` table, never
 *    from the client.
 *  - Idempotent: reuses the member's single pending payment row for this plan.
 *    A legacy order_pending_* placeholder is upgraded in place to a real
 *    Razorpay order so the pending-per-user/plan unique index is respected.
 *  - Rate-limited: max 5 orders per member per hour.
 *  - Razorpay credentials come from Edge Function secrets. If they are
 *    not set, the function returns 503 (test mode) instead of failing
 *    silently — the client keeps its pending-intent fallback.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { callerUserId, serviceRole, json, UnauthorizedError } from "../_shared/supabase.ts";

const VALID_PLANS = ["connect", "plus", "elite"] as const;

serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let userId: string;
  try {
    userId = await callerUserId(req);
  } catch (e) {
    if (e instanceof UnauthorizedError) return json({ error: "Unauthorized" }, 401);
    throw e;
  }

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    return json(
      { error: "Payments are not configured yet (test mode).", code: "PAYMENTS_NOT_CONFIGURED" },
      503,
    );
  }

  const body = await req.json().catch(() => ({}));
  const planId = body.planId as string;
  if (!VALID_PLANS.includes(planId as (typeof VALID_PLANS)[number])) {
    return json({ error: "Invalid plan" }, 400);
  }

  const db = serviceRole();

  // Price is authoritative from the database.
  const { data: plan, error: planErr } = await db
    .from("membership_plans")
    .select("id, price")
    .eq("id", planId)
    .single();
  if (planErr || !plan) return json({ error: "Unknown plan" }, 400);

  const amountPaise = Math.round(Number(plan.price) * 100);
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return json({ error: "Invalid plan price" }, 500);
  }

  // Rate limit: max 5 orders per member per hour (abuse prevention).
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count: recentCount } = await db
    .from("payments")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .gte("created_at", hourAgo);
  if ((recentCount ?? 0) >= 5) {
    return json({ error: "Too many payment attempts. Please try again later." }, 429);
  }

  // The live database permits one pending payment per member and plan.
  // Reuse a real order regardless of age; never hand a placeholder to checkout.
  const { data: existing, error: existingErr } = await db
    .from("payments")
    .select("id, razorpay_order_id, amount")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingErr) {
    console.error("[create-order] Could not inspect pending payment:", existingErr);
    return json({ error: "Could not prepare checkout. Please try again." }, 500);
  }
  if (existing?.razorpay_order_id && !existing.razorpay_order_id.startsWith("order_pending_")) {
    if (Number(existing.amount) !== Number(plan.price)) {
      return json({
        error: "A previous pending order has a different plan price. Please contact support before retrying.",
        code: "PENDING_ORDER_PRICE_MISMATCH",
      }, 409);
    }
    return json({
      paymentId: existing.id,
      orderId: existing.razorpay_order_id,
      amount: amountPaise,
      currency: "INR",
      keyId,
      reused: true,
    });
  }

  const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
    },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt: `dvr_${crypto.randomUUID()}`,
      notes: { plan_id: planId, user_id: userId, app: "datevra" },
    }),
  });

  if (!orderRes.ok) {
    const text = await orderRes.text().catch(() => "");
    console.error("[create-order] Razorpay order failed:", orderRes.status, text);
    return json({ error: "Could not create a payment order. Please try again." }, 502);
  }
  const order = await orderRes.json();

  let paymentId: string | null = null;

  if (existing?.id) {
    // Upgrade a legacy placeholder in place. Compare the old value so that
    // concurrent checkout attempts cannot overwrite the winning real order.
    let update = db
      .from("payments")
      .update({ razorpay_order_id: order.id, method: "razorpay", amount: plan.price })
      .eq("id", existing.id)
      .eq("status", "pending");
    update = existing.razorpay_order_id !== null
      ? update.eq("razorpay_order_id", existing.razorpay_order_id)
      : update.is("razorpay_order_id", null);

    const { data: updated, error: updateError } = await update.select("id").maybeSingle();
    if (updateError) {
      console.error("[create-order] Could not upgrade pending payment:", updateError);
      return json({ error: "Could not record the payment order. Please try again." }, 500);
    }
    if (updated) {
      paymentId = updated.id;
    } else {
      // Another request won the compare-and-set. Return its persisted order;
      // the order created by this request is unused and cannot activate a plan.
      const { data: winner } = await db
        .from("payments")
        .select("id, razorpay_order_id")
        .eq("id", existing.id)
        .eq("status", "pending")
        .maybeSingle();
      if (!winner?.razorpay_order_id || winner.razorpay_order_id.startsWith("order_pending_")) {
        return json({ error: "Checkout is being prepared. Please try again." }, 409);
      }
      return json({
        paymentId: winner.id,
        orderId: winner.razorpay_order_id,
        amount: amountPaise,
        currency: "INR",
        keyId,
        reused: true,
      });
    }
  } else {
    const { data: payment, error: payErr } = await db
      .from("payments")
      .insert({
        user_id: userId,
        kind: "membership",
        amount: plan.price,
        plan_id: planId,
        status: "pending",
        razorpay_order_id: order.id,
        method: "razorpay",
      })
      .select("id")
      .single();

    if (payErr || !payment) {
      // A concurrent request may have inserted the pending row first.
      if (payErr && String(payErr.code) === "23505") {
        const { data: winner } = await db
          .from("payments")
          .select("id, razorpay_order_id")
          .eq("user_id", userId)
          .eq("plan_id", planId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (winner?.razorpay_order_id && !winner.razorpay_order_id.startsWith("order_pending_")) {
          return json({
            paymentId: winner.id,
            orderId: winner.razorpay_order_id,
            amount: amountPaise,
            currency: "INR",
            keyId,
            reused: true,
          });
        }
      }
      console.error("[create-order] Could not record payment:", payErr);
      return json({ error: "Could not record the payment. Please try again." }, 500);
    }
    paymentId = payment.id;
  }

  return json({
    paymentId,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId, // public key only — safe to expose
  });
});
