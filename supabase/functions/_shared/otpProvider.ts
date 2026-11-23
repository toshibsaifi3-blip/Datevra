/**
 * Server-side OTP generation, cryptographic hashing, destination masking, and
 * external provider dispatch for Datevra's Outside-Delhi Voucher flow.
 *
 * Security guarantees:
 * - Never hardcodes OTPs.
 * - Never logs OTP values.
 * - Uses CSPRNG rejection sampling for uniform 6-digit codes.
 * - Stores only HMAC-SHA256(pepper, `${challengeId}:${otp}`) in PostgreSQL.
 * - Fails closed when no external provider credentials are configured.
 */

import { hmacSha256Hex } from "./crypto.ts";

declare const Deno: {
  env: { get(key: string): string | undefined };
};

export function generateSixDigitOtp(): string {
  const limit = 4_294_000_000; // multiple of 1_000_000 under 2^32 for rejection sampling
  const buf = new Uint32Array(1);
  while (true) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) {
      return String(buf[0] % 1_000_000).padStart(6, "0");
    }
  }
}

export function maskDestination(channel: "email" | "sms", destination: string): string {
  const clean = destination.trim();
  if (channel === "email") {
    const [local, domain] = clean.split("@");
    if (!local || !domain) return "***";
    const visible = local.length <= 2 ? local[0] ?? "*" : local.slice(0, 2);
    return `${visible}***@${domain}`;
  }
  const digits = clean.replace(/\D/g, "");
  if (digits.length < 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

export async function hashOtp(pepper: string, challengeId: string, otp: string): Promise<string> {
  return hmacSha256Hex(pepper, `${challengeId}:${otp.trim()}`);
}

export async function hashDestination(pepper: string, destination: string): Promise<string> {
  return hmacSha256Hex(pepper, `dest:${destination.trim().toLowerCase()}`);
}

export interface OtpDispatchResult {
  delivered: boolean;
  provider: string;
  error?: string;
}

/**
 * Dispatches the OTP via configured external email (Resend) or SMS (Twilio / MSG91).
 * Fails closed with a clear operator message if provider credentials are not configured.
 */
export async function dispatchOtp(
  channel: "email" | "sms",
  destination: string,
  otpCode: string,
  expiryMinutes: number,
): Promise<OtpDispatchResult> {
  if (channel === "email") {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("OTP_EMAIL_FROM") ?? "Datevra Verification <verify@datevra.in>";
    if (!resendKey) {
      return {
        delivered: false,
        provider: "resend",
        error: "OTP email provider is not configured (missing RESEND_API_KEY).",
      };
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [destination],
        subject: "Your Datevra Voucher Verification Code",
        text: `Your Datevra verification code is ${otpCode}. It expires in ${expiryMinutes} minutes. Do not share this code with anyone.`,
      }),
    });

    if (!res.ok) {
      return {
        delivered: false,
        provider: "resend",
        error: `Email provider returned status ${res.status}.`,
      };
    }
    return { delivered: true, provider: "resend" };
  }

  // SMS channel: Twilio or MSG91
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");

  if (twilioSid && twilioToken && twilioFrom) {
    const body = new URLSearchParams({
      To: destination,
      From: twilioFrom,
      Body: `Your Datevra verification code is ${otpCode}. Valid for ${expiryMinutes} minutes.`,
    });
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: "Basic " + btoa(`${twilioSid}:${twilioToken}`),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );
    if (!res.ok) {
      return {
        delivered: false,
        provider: "twilio",
        error: `SMS provider returned status ${res.status}.`,
      };
    }
    return { delivered: true, provider: "twilio" };
  }

  const msg91Key = Deno.env.get("MSG91_AUTH_KEY");
  const msg91TemplateId = Deno.env.get("MSG91_OTP_TEMPLATE_ID");
  if (msg91Key && msg91TemplateId) {
    const res = await fetch("https://control.msg91.com/api/v5/otp", {
      method: "POST",
      headers: {
        authkey: msg91Key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: msg91TemplateId,
        mobile: destination.replace(/[^\d]/g, ""),
        otp: otpCode,
      }),
    });
    if (!res.ok) {
      return {
        delivered: false,
        provider: "msg91",
        error: `MSG91 returned status ${res.status}.`,
      };
    }
    return { delivered: true, provider: "msg91" };
  }

  return {
    delivered: false,
    provider: "unconfigured",
    error: "OTP SMS provider is not configured (set TWILIO_* or MSG91_* secrets).",
  };
}
