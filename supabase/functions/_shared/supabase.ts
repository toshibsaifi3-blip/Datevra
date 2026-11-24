/**
 * Shared Supabase helpers for the Datevra Razorpay and voucher OTP Edge Functions.
 *
 * Caller JWTs are used only to identify the authenticated member. Privileged
 * database operations use the service-role client, which remains server-only.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export class UnauthorizedError extends Error {
  constructor() {
    super("Unauthorized");
  }
}

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required Edge Function secret: ${name}`);
  return v;
}

/** Identify the calling member from their Authorization: Bearer JWT. */
export async function callerUserId(req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new UnauthorizedError();
  const client = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new UnauthorizedError();
  return data.user.id;
}

/**
 * Voucher OTP helper: return only the authenticated user's ID and email.
 * A null result is returned for missing/invalid caller JWTs.
 */
export async function getAuthenticatedUser(
  req: Request,
): Promise<{ id: string; email?: string } | null> {
  const auth = req.headers.get("Authorization");
  if (!auth) return null;

  const client = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data, error } = await client.auth.getUser();
  if (error || !data.user) return null;

  return {
    id: data.user.id,
    ...(data.user.email ? { email: data.user.email } : {}),
  };
}

/** Privileged client for server-side writes. */
export function serviceRole(): SupabaseClient {
  return createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/** Voucher OTP helper alias; service-role credentials never reach the browser. */
export function getServiceClient(): SupabaseClient {
  return serviceRole();
}

export interface ActivatedPaymentResult {
  already_verified: boolean;
  payment_id: string;
  subscription_id: string | null;
  plan_id: string | null;
  verified_at: string | null;
  expires_at: string | null;
}

/**
 * Atomically verify a pending payment, link subscriptions.payment_id,
 * insert plan_update_intents for protect_profile_fields() compatibility,
 * update profiles.plan_id/plan_expires_at, and notify the member at /membership.
 */
export async function activateVerifiedPayment(
  db: SupabaseClient,
  paymentId: string,
  razorpayPaymentId: string,
  method = "razorpay",
): Promise<ActivatedPaymentResult> {
  const { data, error } = await db.rpc("service_activate_verified_payment", {
    p_payment_id: paymentId,
    p_razorpay_payment_id: razorpayPaymentId,
    p_method: method,
  });
  if (error) {
    throw new Error(`Could not activate verified payment: ${error.message}`);
  }
  return (data ?? {}) as ActivatedPaymentResult;
}

/**
 * Atomically reconcile a Razorpay refund webhook: marks payment refunded,
 * cancels the linked subscription, and recalculates profile entitlement.
 */
export async function reconcileRefundedPayment(
  db: SupabaseClient,
  razorpayPaymentId: string,
  reason = "Razorpay refund processed",
): Promise<Record<string, unknown>> {
  const { data, error } = await db.rpc("service_reconcile_refunded_payment", {
    p_razorpay_payment_id: razorpayPaymentId,
    p_reason: reason,
  });
  if (error) {
    throw new Error(`Could not reconcile refunded payment: ${error.message}`);
  }
  return (data ?? {}) as Record<string, unknown>;
}

/**
 * Legacy fallback helper — links payment_id when provided and uses /membership route.
 */
export async function activateMembership(
  db: SupabaseClient,
  userId: string,
  planId: string,
  paymentId?: string,
): Promise<void> {
  const now = new Date();
  const expires = new Date(now);
  expires.setMonth(expires.getMonth() + 1);

  await db.from("subscriptions").update({ status: "expired" }).eq("user_id", userId).eq("status", "active");

  const { error: subErr } = await db.from("subscriptions").insert({
    user_id: userId,
    plan_id: planId,
    payment_id: paymentId ?? null,
    status: "active",
    started_at: now.toISOString(),
    expires_at: expires.toISOString(),
    auto_renew: false,
  });
  if (subErr) throw new Error(`Could not create subscription: ${subErr.message}`);

  const { error: profErr } = await db
    .from("profiles")
    .update({ plan_id: planId, plan_expires_at: expires.toISOString() })
    .eq("id", userId);
  if (profErr) throw new Error(`Could not update profile plan: ${profErr.message}`);

  await db.from("notifications").insert({
    user_id: userId,
    kind: "membership",
    title: "Membership activated",
    body: `Your ${planId} membership is now active. Welcome to Datevra.`,
    link: "/membership",
  });

  await db.from("activity_logs").insert({
    actor_id: userId,
    actor_role: "system",
    action: "payment.verify",
    detail: `Membership '${planId}' activated after verified Razorpay payment.`,
  });
}

/** Small JSON response helper. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
