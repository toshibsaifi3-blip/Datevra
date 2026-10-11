/**
 * Shared Supabase helpers for the Datevra Razorpay Edge Functions.
 *
 * Two clients are used on purpose:
 *  - `callerUserId(req)` — anon client carrying the member's JWT, only to
 *    identify WHO is calling. Never trusted for privileged writes.
 *  - `serviceRole()` — service-role client for privileged DB writes
 *    (payments, subscriptions, profiles, notifications, activity logs).
 *    The service-role key lives ONLY in Edge Function secrets, never in
 *    the browser bundle.
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

/** Privileged client for server-side writes. */
export function serviceRole(): SupabaseClient {
  return createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

/**
 * Activate a membership after a verified payment. Idempotent-safe to call
 * once per payment: expires any active subscription, creates the new one,
 * updates the profile plan, and notifies the member.
 */
export async function activateMembership(
  db: SupabaseClient,
  userId: string,
  planId: string,
): Promise<void> {
  const now = new Date();
  const expires = new Date(now);
  expires.setMonth(expires.getMonth() + 1);

  await db.from("subscriptions").update({ status: "expired" }).eq("user_id", userId).eq("status", "active");

  const { error: subErr } = await db.from("subscriptions").insert({
    user_id: userId,
    plan_id: planId,
    status: "active",
    started_at: now.toISOString(),
    expires_at: expires.toISOString(),
    auto_renew: true,
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
    link: "/app/membership",
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
