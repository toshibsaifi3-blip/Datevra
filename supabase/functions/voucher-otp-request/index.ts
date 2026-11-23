/**
 * Edge Function: voucher-otp-request
 *
 * Initiates a server-side OTP verification challenge for an eligible
 * Outside-Delhi member claiming a limited-value Datevra voucher.
 *
 * Safeguards:
 * - Authenticates user via Supabase JWT.
 * - Verifies voucher program is enabled & has an admin-approved value.
 * - Verifies BOTH registered_city and current city are outside excluded Delhi cities.
 * - Enforces per-user claim limits and strict OTP request rate limiting
 *   (max 3 requests / 15 minutes, max 6 requests / 24 hours).
 * - Stores ONLY salted HMAC-SHA256 hash in datevra_internal.voucher_otp_challenges.
 * - Dispatches OTP via configured external provider; never logs or returns the OTP.
 */

import { corsHeaders, json } from "../_shared/cors.ts";
import { getAuthenticatedUser, getServiceClient } from "../_shared/supabase.ts";
import {
  dispatchOtp,
  generateSixDigitOtp,
  hashDestination,
  hashOtp,
  maskDestination,
} from "../_shared/otpProvider.ts";

declare const Deno: {
  serve: (handler: (req: Request) => Promise<Response> | Response) => void;
  env: { get(key: string): string | undefined };
};

const OTP_TTL_MINUTES = 10;
const MAX_REQUESTS_15_MIN = 3;
const MAX_REQUESTS_24_HR = 6;

function normalizeCity(city: string | null | undefined): string {
  return (city ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function isOutsideExcluded(city: string | null | undefined, excluded: string[]): boolean {
  const norm = normalizeCity(city);
  if (!norm) return false;
  const set = new Set(excluded.map(normalizeCity).filter(Boolean));
  return !set.has(norm);
}

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
      channel?: "email" | "sms";
      phone?: string;
    };
    const channel: "email" | "sms" = body.channel === "sms" ? "sms" : "email";

    const admin = getServiceClient();

    // 1. Check voucher settings (disabled by default until admin configures approved value)
    const { data: settings, error: settingsErr } = await admin
      .from("voucher_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (settingsErr || !settings || !settings.enabled || !settings.voucher_value_inr) {
      return json(
        { error: "Outside-Delhi voucher issuance is currently disabled until configured by an administrator." },
        403,
      );
    }

    // 2. Check member profile & anti-spoofing city eligibility
    const { data: profile, error: profErr } = await admin
      .from("profiles")
      .select("id, email, city, registered_city")
      .eq("id", authUser.id)
      .single();

    if (profErr || !profile) {
      return json({ error: "Member profile not found." }, 404);
    }

    const excluded: string[] = Array.isArray(settings.excluded_cities)
      ? settings.excluded_cities
      : ["delhi", "new delhi"];
    const regCity = (profile.registered_city as string | null) || (profile.city as string | null);

    if (!isOutsideExcluded(regCity, excluded) || !isOutsideExcluded(profile.city as string | null, excluded)) {
      return json(
        { error: "This voucher is only available to members registered and residing outside Delhi." },
        403,
      );
    }

    // 3. Enforce per-user claim limit before sending OTP
    const { count: existingClaims } = await admin
      .from("user_vouchers")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authUser.id)
      .in("status", ["issued", "redeemed", "expired"]);

    if ((existingClaims ?? 0) >= Number(settings.max_claims_per_user ?? 1)) {
      return json({ error: "You have already claimed your maximum allowed voucher(s)." }, 409);
    }

    // 4. Determine destination (email from verified auth profile, or validated E.164 phone for SMS)
    let destination = "";
    if (channel === "email") {
      destination = (authUser.email || (profile.email as string) || "").trim();
      if (!destination || !destination.includes("@")) {
        return json({ error: "A verified account email address is required for email OTP." }, 400);
      }
    } else {
      const rawPhone = (body.phone ?? "").trim();
      if (!/^\+?[1-9]\d{9,14}$/.test(rawPhone)) {
        return json({ error: "Enter a valid mobile number (10–15 digits, e.g. +919876543210)." }, 400);
      }
      destination = rawPhone.startsWith("+") ? rawPhone : `+91${rawPhone}`;
    }

    // 5. Rate-limit OTP requests (datevra_internal schema)
    const now = Date.now();
    const fifteenMinAgo = new Date(now - 15 * 60 * 1000).toISOString();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000).toISOString();

    const { count: recent15 } = await admin
      .schema("datevra_internal")
      .from("voucher_otp_challenges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authUser.id)
      .gte("created_at", fifteenMinAgo);

    if ((recent15 ?? 0) >= MAX_REQUESTS_15_MIN) {
      return json(
        { error: "Too many OTP requests. Please wait 15 minutes before requesting another code." },
        429,
      );
    }

    const { count: recent24 } = await admin
      .schema("datevra_internal")
      .from("voucher_otp_challenges")
      .select("id", { count: "exact", head: true })
      .eq("user_id", authUser.id)
      .gte("created_at", dayAgo);

    if ((recent24 ?? 0) >= MAX_REQUESTS_24_HR) {
      return json(
        { error: "Daily OTP request limit reached. Please try again tomorrow." },
        429,
      );
    }

    // Expire previous pending challenges for this user
    await admin
      .schema("datevra_internal")
      .from("voucher_otp_challenges")
      .update({ status: "expired" })
      .eq("user_id", authUser.id)
      .eq("status", "pending");

    // 6. Generate OTP, hash with pepper, persist challenge, then dispatch
    const challengeId = crypto.randomUUID();
    const otpCode = generateSixDigitOtp();
    const otpHash = await hashOtp(pepper, challengeId, otpCode);
    const destHash = await hashDestination(pepper, destination);
    const masked = maskDestination(channel, destination);
    const expiresAt = new Date(now + OTP_TTL_MINUTES * 60 * 1000).toISOString();

    const { error: insertErr } = await admin
      .schema("datevra_internal")
      .from("voucher_otp_challenges")
      .insert({
        id: challengeId,
        user_id: authUser.id,
        channel,
        destination_masked: masked,
        destination_hash: destHash,
        otp_hash: otpHash,
        attempt_count: 0,
        max_attempts: 5,
        status: "pending",
        expires_at: expiresAt,
      });

    if (insertErr) {
      console.error("[voucher-otp-request] insert failed:", insertErr.message);
      return json({ error: "Could not create OTP challenge." }, 500);
    }

    const dispatch = await dispatchOtp(channel, destination, otpCode, OTP_TTL_MINUTES);
    if (!dispatch.delivered) {
      await admin
        .schema("datevra_internal")
        .from("voucher_otp_challenges")
        .update({ status: "expired" })
        .eq("id", challengeId);
      return json({ error: dispatch.error ?? "Failed to deliver OTP." }, 503);
    }

    return json({
      challenge_id: challengeId,
      channel,
      destination_masked: masked,
      expires_at: expiresAt,
    });
  } catch (err) {
    console.error("[voucher-otp-request] error:", err instanceof Error ? err.message : "unknown");
    return json({ error: "Unable to process OTP request." }, 500);
  }
});
