/**
 * Shared crypto helpers for the Datevra Razorpay Edge Functions.
 *
 * Uses only `crypto.subtle` (WebCrypto) — available in Deno Deploy and in
 * Supabase Edge Functions, and also in Node 18+. No npm dependencies, so
 * this module can be unit-tested outside Deno.
 */

/** HMAC-SHA256 of `data` with `secret`, returned as lowercase hex. */
export async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison to avoid timing side-channels. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Verifies a Razorpay checkout payment signature.
 * Razorpay computes: HMAC_SHA256(order_id + "|" + payment_id, key_secret).
 */
export async function verifyRazorpayPaymentSignature(
  keySecret: string,
  orderId: string,
  paymentId: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(keySecret, `${orderId}|${paymentId}`);
  return timingSafeEqual(expected, signature);
}

/**
 * Verifies a Razorpay webhook signature.
 * Razorpay computes: HMAC_SHA256(raw_request_body, webhook_secret),
 * sent in the `x-razorpay-signature` header.
 */
export async function verifyRazorpayWebhookSignature(
  webhookSecret: string,
  rawBody: string,
  signature: string,
): Promise<boolean> {
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqual(expected, signature);
}
