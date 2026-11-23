/**
 * Edge Function: voucher-otp-verify
 *
 * Verifies a member's 6-digit OTP challenge server-side using constant-time
 * HMAC comparison, enforces expiry and max attempts, and atomically issues
 * the Outside-Delhi limited-value voucher via
 * `public.service_issue_verified_outside_delhi_voucher()`.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { timingSafeEqual } from "../_shared/crypto.ts";
import { getAuthenticatedUser, getServiceClient } from "../_shared/supabase.ts";
import { hashOtp } from "../_shared/otpProvider.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
  env: { get(key: string): string | undefined };
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authUser = await getAuthenticatedUser(req);
    if (!authUser) {
      return json({ error: "Authentication required" }, 401);
    }

    const pepper = Deno.env.get("VOUCHER_OTP_PEPPER");
    if (!pepper || pepper.length < 16) {
      return json(
        { error: "OTP verification service is not configured (missing VOUCHER_OTP_PEPPER)." },
        503,
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      challenge_id?: string;
      otp?: string;
    };

    const challengeId = (body.challenge_id ?? "").trim();
    const otp = (body.otp ?? "").trim();

    if (!challengeId || !/^\d{6}$/.test(otp)) {
      return json({ error: "A valid challenge ID and 6-digit OTP code are required." }, 400);
    }

    const admin = getServiceClient();

    const { data: challenge, error: chalErr } = await admin
      .schema("datevra_internal")
      .from("voucher_otp_challenges")
      .select("*")
      .eq("id", challengeId)
      .eq("user_id", authUser.id)
      .maybeSingle();

    if (chalErr || !challenge) {
      return json({ error: "OTP challenge not found." }, 404);
    }

    if (challenge.status === "consumed") {
      return json({ error: "This OTP has already been used." }, 409);
    }
    if (challenge.status === "locked") {
      return json({ error: "Too many failed OTP attempts. Please request a new code." }, 429);
    }
    if (challenge.status !== "pending") {
      return json({ error: "This OTP challenge is no longer active." }, 400);
    }
    if (new Date(challenge.expires_at as string).getTime() <= Date.now()) {
      await admin
        .schema("datevra_internal")
        .from("voucher_otp_challenges")
        .update({ status: "expired" })
        .eq("id", challengeId);
      return json({ error: "This OTP has expired. Please request a new code." }, 400);
    }

    const attemptCount = Number(challenge.attempt_count ?? 0);
    const maxAttempts = Number(challenge.max_attempts ?? 5);
    if (attemptCount >= maxAttempts) {
      await admin
        .schema("datevra_internal")
        .from("voucher_otp_challenges")
        .update({ status: "locked" })
        .eq("id", challengeId);
      return json({ error: "Maximum OTP verification attempts exceeded." }, 429);
    }

    const providedHash = await hashOtp(pepper, challengeId, otp);
    const valid = timingSafeEqual(providedHash, String(challenge.otp_hash ?? ""));

    if (!valid) {
      const nextAttempts = attemptCount + 1;
      const nextStatus = nextAttempts >= maxAttempts ? "locked" : "pending";
      await admin
        .schema("datevra_internal")
        .from("voucher_otp_challenges")
        .update({ attempt_count: nextAttempts, status: nextStatus })
        .eq("id", challengeId);

      const remaining = Math.max(0, maxAttempts - nextAttempts);
      return json(
        {
          error:
            remaining > 0
              ? `Invalid OTP code. ${remaining} attempt(s) remaining.`
              : "Maximum OTP verification attempts exceeded. Please request a new code.",
        },
        400,
      );
    }

    // Mark challenge verified atomically (guarding status = 'pending')
    const { data: verifiedRow, error: verifyErr } = await admin
      .schema("datevra_internal")
      .from("voucher_otp_challenges")
      .update({ status: "verified", verified_at: new Date().toISOString() })
      .eq("id", challengeId)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (verifyErr || !verifiedRow) {
      return json({ error: "OTP challenge could not be verified (already used or expired)." }, 409);
    }

    // Atomically issue voucher via service-role RPC
    const { data: voucher, error: issueErr } = await admin.rpc(
      "service_issue_verified_outside_delhi_voucher",
      {
        p_user_id: authUser.id,
        p_otp_challenge_id: challengeId,
      },
    );

    if (issueErr || !voucher) {
      return json(
        { error: issueErr?.message ?? "Could not issue voucher after OTP verification." },
        400,
      );
    }

    return json({ verified: true, voucher });
  } catch (err) {
    console.error("[voucher-otp-verify] error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "Unable to verify OTP." }, 500);
  }
});
