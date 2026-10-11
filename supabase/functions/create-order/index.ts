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
 *  - Idempotent: if the caller already has a pending payment for this
 *    plan created in the last 30 minutes, the existing order is returned
 *    instead of creating a duplicate Razorpay order (backed by a partial
 *    unique index on payments in migration 005).
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

  // Idempotency: reuse a recent pending payment for the same plan instead
  // of creating a duplicate Razorpay order.
  const thirtyMinAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const { data: existing } = await db
    .from("payments")
    .select("id, razorpay_order_id, amount")
    .eq("user_id", userId)
    .eq("plan_id", planId)
    .eq("status", "pending")
    .gte("created_at", thirtyMinAgo)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.razorpay_order_id) {
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
    // Race safety: a concurrent request may have won the insert — the
    // partial unique index (migration 005) rejects the duplicate. Fall
    // back to the winner's pending payment instead of erroring.
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
      if (winner?.razorpay_order_id) {
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

  return json({
    paymentId: payment.id,
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    keyId, // public key only — safe to expose
  });
});
