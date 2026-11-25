/**
 * Core HTTP handler for the `expire-stale-date-offers` Supabase Edge Function.
 *
 * Uses only Web-standard APIs (Request, Response, WebCrypto via `_shared/crypto.ts`)
 * so it runs identically in Supabase Edge Functions (Deno) and Node.js unit tests.
 *
 * Security invariants:
 * - Accepts POST requests only (405 + Allow: POST for any other method).
 * - Requires the `x-expire-secret` header, verified in constant time (via
 *   HMAC-SHA256 digest + timingSafeEqual) against `EXPIRE_STALE_DATE_OFFERS_SECRET`.
 * - Ignores request body and query parameters; never accepts arbitrary SQL,
 *   table names, or function names.
 * - Calls strictly `supabase.rpc("expire_stale_date_offers")` with no arguments
 *   on the server-side service-role client.
 * - Never logs or returns secret values.
 */

import { hmacSha256Hex, timingSafeEqual } from "../_shared/crypto.ts";

export const EXPIRE_SECRET_HEADER = "x-expire-secret";
export const EXPIRE_SECRET_ENV = "EXPIRE_STALE_DATE_OFFERS_SECRET";
export const EXPIRE_RPC_NAME = "expire_stale_date_offers";

export interface ExpireRpcError {
  message: string;
  code?: string;
}

export interface ExpireRpcResult {
  data?: unknown;
  error: ExpireRpcError | null;
}

export interface ExpireRpcClient {
  rpc(fn: string): PromiseLike<ExpireRpcResult>;
}

export interface ExpireHandlerDeps {
  getSecret: () => string | undefined;
  createServiceClient: () => ExpireRpcClient;
  json?: (body: unknown, status?: number) => Response;
  logger?: Pick<Console, "error" | "warn">;
  now?: () => Date;
}

/**
 * Constant-time verification of the scheduled-expiry secret header.
 *
 * Hashing both strings with HMAC-SHA256 keyed by `expectedSecret` produces
 * fixed-length 64-character hex digests before `timingSafeEqual`, preventing
 * both character-by-character timing leaks and secret-length oracle leaks.
 */
export async function verifyExpirySecret(
  expectedSecret: string,
  providedSecret: string | null,
): Promise<boolean> {
  if (!expectedSecret || !providedSecret) return false;
  const [expectedDigest, providedDigest] = await Promise.all([
    hmacSha256Hex(expectedSecret, expectedSecret),
    hmacSha256Hex(expectedSecret, providedSecret),
  ]);
  return timingSafeEqual(expectedDigest, providedDigest);
}

function buildJsonResponse(
  body: unknown,
  status: number,
  jsonHelper?: (body: unknown, status?: number) => Response,
  extraHeaders?: Record<string, string>,
): Response {
  const base = jsonHelper
    ? jsonHelper(body, status)
    : new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

  const headers = new Headers(base.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      headers.set(k, v);
    }
  }

  return new Response(base.body, { status: base.status, headers });
}

export function createExpireStaleDateOffersHandler(
  deps: ExpireHandlerDeps,
): (req: Request) => Promise<Response> {
  const logger = deps.logger ?? console;
  const now = deps.now ?? (() => new Date());

  return async (req: Request): Promise<Response> => {
    // 1. Accept POST requests only.
    if (req.method !== "POST") {
      return buildJsonResponse(
        { ok: false, error: "Method not allowed. Use POST." },
        405,
        deps.json,
        { Allow: "POST" },
      );
    }

    // 2. Ensure dedicated server-side secret is configured.
    const expectedSecret = (deps.getSecret() ?? "").trim();
    if (!expectedSecret) {
      logger.error(`[expire-stale-date-offers] ${EXPIRE_SECRET_ENV} is not configured.`);
      return buildJsonResponse(
        { ok: false, error: "Scheduled expiry endpoint is not configured." },
        503,
        deps.json,
      );
    }

    // 3. Require and securely compare the dedicated secret header.
    const providedSecret = req.headers.get(EXPIRE_SECRET_HEADER);
    const authorized = await verifyExpirySecret(expectedSecret, providedSecret);
    if (!authorized) {
      logger.warn("[expire-stale-date-offers] Rejected unauthorized request.");
      return buildJsonResponse(
        { ok: false, error: "Unauthorized." },
        401,
        deps.json,
      );
    }

    // 4. Invoke strictly `public.expire_stale_date_offers()` via the service-role client.
    //    Request body and query parameters are intentionally ignored.
    try {
      const supabase = deps.createServiceClient();
      const { error } = await supabase.rpc(EXPIRE_RPC_NAME);

      if (error) {
        logger.error(
          "[expire-stale-date-offers] RPC execution failed:",
          error.code ?? "UNKNOWN_CODE",
        );
        return buildJsonResponse(
          { ok: false, error: "Failed to expire stale date offers." },
          500,
          deps.json,
        );
      }

      return buildJsonResponse(
        {
          ok: true,
          rpc: EXPIRE_RPC_NAME,
          executedAt: now().toISOString(),
        },
        200,
        deps.json,
      );
    } catch {
      logger.error("[expire-stale-date-offers] Unexpected error invoking expiry RPC.");
      return buildJsonResponse(
        { ok: false, error: "Failed to expire stale date offers." },
        500,
        deps.json,
      );
    }
  };
}
