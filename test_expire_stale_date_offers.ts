/**
 * DATEVRA — Scheduled Expiry Edge Function (`expire-stale-date-offers`) Test Suite
 *
 * Covers:
 *  - Wrong HTTP methods (GET, PUT, DELETE, PATCH, OPTIONS, HEAD) -> 405 + Allow: POST
 *  - Unconfigured EXPIRE_STALE_DATE_OFFERS_SECRET -> 503
 *  - Missing or invalid x-expire-secret header -> 401 (no RPC call, no secret in logs)
 *  - Constant-time secret verification helper edge cases
 *  - Successful POST invoking strictly `supabase.rpc("expire_stale_date_offers")`
 *    with zero arguments while ignoring untrusted body/query parameters
 *  - RPC error return & thrown exception handling -> 500 clean JSON (no secret leakage)
 *  - Static boundary verification: Edge Function wiring & zero frontend secret exposure
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  createExpireStaleDateOffersHandler,
  verifyExpirySecret,
  EXPIRE_RPC_NAME,
  EXPIRE_SECRET_ENV,
  EXPIRE_SECRET_HEADER,
  type ExpireRpcResult,
} from "./supabase/functions/expire-stale-date-offers/handler.ts";

const TEST_SECRET = "dvr_test_secret_8a7f9c2e4b1d6a3f5c8e0b2d4a6f9e1c";
const ENDPOINT = "https://example.supabase.co/functions/v1/expire-stale-date-offers";

function createCapturedLogger() {
  const entries: string[] = [];
  return {
    entries,
    logger: {
      warn: (...args: unknown[]) => entries.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => entries.push(args.map(String).join(" ")),
    },
  };
}

function assertNoSecretsLogged(entries: string[], secrets: string[]) {
  const joined = entries.join("\n");
  for (const s of secrets) {
    assert.ok(!joined.includes(s), `Log output must never contain secret value`);
  }
}

test("E1: Rejects non-POST HTTP methods with 405 and Allow: POST without calling RPC", async () => {
  const disallowedMethods = ["GET", "PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"];
  let rpcCalls = 0;
  let clientCreated = 0;

  const { logger } = createCapturedLogger();
  const handler = createExpireStaleDateOffersHandler({
    getSecret: () => TEST_SECRET,
    createServiceClient: () => {
      clientCreated++;
      return {
        rpc: async () => {
          rpcCalls++;
          return { error: null };
        },
      };
    },
    logger,
  });

  for (const method of disallowedMethods) {
    const req = new Request(ENDPOINT, {
      method,
      headers: { [EXPIRE_SECRET_HEADER]: TEST_SECRET },
    });
    const res = await handler(req);
    assert.equal(res.status, 405, `Expected 405 for ${method}`);
    assert.equal(res.headers.get("allow"), "POST", `Expected Allow: POST for ${method}`);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /Method not allowed/i);
  }

  assert.equal(clientCreated, 0);
  assert.equal(rpcCalls, 0);
});

test("E2: Returns 503 when EXPIRE_STALE_DATE_OFFERS_SECRET is unset or blank", async () => {
  for (const configuredSecret of [undefined, "", "   "]) {
    let clientCreated = 0;
    const { entries, logger } = createCapturedLogger();
    const handler = createExpireStaleDateOffersHandler({
      getSecret: () => configuredSecret,
      createServiceClient: () => {
        clientCreated++;
        return { rpc: async () => ({ error: null }) };
      },
      logger,
    });

    const req = new Request(ENDPOINT, {
      method: "POST",
      headers: { [EXPIRE_SECRET_HEADER]: TEST_SECRET },
    });
    const res = await handler(req);
    assert.equal(res.status, 503);
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /not configured/i);
    assert.equal(clientCreated, 0);
    assertNoSecretsLogged(entries, [TEST_SECRET]);
  }
});

test("E3: Rejects missing or invalid x-expire-secret header with 401 and never logs secrets", async () => {
  const invalidHeaders: Array<Record<string, string>> = [
    {},
    { [EXPIRE_SECRET_HEADER]: "" },
    { [EXPIRE_SECRET_HEADER]: "wrong-secret" },
    { [EXPIRE_SECRET_HEADER]: `${TEST_SECRET}x` },
    { [EXPIRE_SECRET_HEADER]: TEST_SECRET.slice(0, -1) },
    { [EXPIRE_SECRET_HEADER]: `${TEST_SECRET.slice(0, 10)} ${TEST_SECRET.slice(10)}` },
    { [EXPIRE_SECRET_HEADER]: TEST_SECRET.toUpperCase() },
    { Authorization: `Bearer ${TEST_SECRET}` },
  ];

  let clientCreated = 0;
  let rpcCalls = 0;
  const { entries, logger } = createCapturedLogger();

  const handler = createExpireStaleDateOffersHandler({
    getSecret: () => TEST_SECRET,
    createServiceClient: () => {
      clientCreated++;
      return {
        rpc: async () => {
          rpcCalls++;
          return { error: null };
        },
      };
    },
    logger,
  });

  for (const headers of invalidHeaders) {
    const req = new Request(ENDPOINT, { method: "POST", headers });
    const res = await handler(req);
    assert.equal(res.status, 401);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = (await res.json()) as { ok: boolean; error: string };
    assert.deepEqual(body, { ok: false, error: "Unauthorized." });
  }

  assert.equal(clientCreated, 0);
  assert.equal(rpcCalls, 0);
  assertNoSecretsLogged(entries, [TEST_SECRET, "wrong-secret", `${TEST_SECRET}x`]);
});

test("E4: verifyExpirySecret compares secrets accurately including different lengths and empty inputs", async () => {
  assert.equal(await verifyExpirySecret(TEST_SECRET, TEST_SECRET), true);
  assert.equal(await verifyExpirySecret(TEST_SECRET, null), false);
  assert.equal(await verifyExpirySecret(TEST_SECRET, ""), false);
  assert.equal(await verifyExpirySecret("", TEST_SECRET), false);
  assert.equal(await verifyExpirySecret(TEST_SECRET, "short"), false);
  assert.equal(await verifyExpirySecret(TEST_SECRET, ` ${TEST_SECRET} `), false);
  assert.equal(
    await verifyExpirySecret(TEST_SECRET, `${TEST_SECRET.slice(0, -1)}0`),
    false,
  );
});

test("E5: Valid POST calls strictly supabase.rpc('expire_stale_date_offers') with no arguments and ignores request payload", async () => {
  const rpcCalls: unknown[][] = [];
  const fixedDate = new Date("2026-11-23T12:00:00.000Z");
  const { entries, logger } = createCapturedLogger();

  const handler = createExpireStaleDateOffersHandler({
    getSecret: () => TEST_SECRET,
    createServiceClient: () => ({
      rpc: async (...args: unknown[]): Promise<ExpireRpcResult> => {
        rpcCalls.push(args);
        return { data: null, error: null };
      },
    }),
    logger,
    now: () => fixedDate,
  });

  // Deliberately supply untrusted query params & JSON body trying to override SQL/table/function name
  const req = new Request(`${ENDPOINT}?fn=drop_everything&table=profiles`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      [EXPIRE_SECRET_HEADER]: TEST_SECRET,
    },
    body: JSON.stringify({
      sql: "DROP TABLE public.profiles;",
      table: "profiles",
      functionName: "malicious_rpc",
      rpc: "other_fn",
    }),
  });

  const res = await handler(req);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/json");
  assert.equal(res.headers.get("cache-control"), "no-store");
  assert.equal(res.headers.get("access-control-allow-origin"), null);

  const body = (await res.json()) as { ok: boolean; rpc: string; executedAt: string };
  assert.deepEqual(body, {
    ok: true,
    rpc: EXPIRE_RPC_NAME,
    executedAt: "2026-11-23T12:00:00.000Z",
  });

  assert.equal(rpcCalls.length, 1, "RPC must be invoked exactly once");
  assert.deepEqual(rpcCalls[0], ["expire_stale_date_offers"], "RPC must be called with only the hardcoded function name");
  assert.equal(entries.length, 0);
});

test("E6: Returns 500 JSON error when expire_stale_date_offers RPC returns a database error", async () => {
  const { entries, logger } = createCapturedLogger();
  const handler = createExpireStaleDateOffersHandler({
    getSecret: () => TEST_SECRET,
    createServiceClient: () => ({
      rpc: async (fn: string) => {
        assert.equal(fn, "expire_stale_date_offers");
        return {
          data: null,
          error: {
            code: "42501",
            message: `permission denied for function expire_stale_date_offers`,
          },
        };
      },
    }),
    logger,
  });

  const req = new Request(ENDPOINT, {
    method: "POST",
    headers: { [EXPIRE_SECRET_HEADER]: TEST_SECRET },
  });
  const res = await handler(req);
  assert.equal(res.status, 500);
  const body = (await res.json()) as { ok: boolean; error: string };
  assert.deepEqual(body, { ok: false, error: "Failed to expire stale date offers." });
  assert.ok(entries.some((line) => line.includes("42501")));
  assertNoSecretsLogged(entries, [TEST_SECRET]);
});

test("E7: Returns 500 JSON error when service client creation or RPC throws unexpectedly", async () => {
  const fakeServiceKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake-service-role-key";
  const { entries, logger } = createCapturedLogger();

  const handler = createExpireStaleDateOffersHandler({
    getSecret: () => TEST_SECRET,
    createServiceClient: () => {
      throw new Error(`Unexpected failure involving ${fakeServiceKey}`);
    },
    logger,
  });

  const req = new Request(ENDPOINT, {
    method: "POST",
    headers: { [EXPIRE_SECRET_HEADER]: TEST_SECRET },
  });
  const res = await handler(req);
  assert.equal(res.status, 500);
  const body = (await res.json()) as { ok: boolean; error: string };
  assert.deepEqual(body, { ok: false, error: "Failed to expire stale date offers." });
  assertNoSecretsLogged(entries, [TEST_SECRET, fakeServiceKey]);
});

test("E8: Static security boundary check — Edge Function wiring and zero frontend secret exposure", () => {
  const root = process.cwd();
  const indexSource = fs.readFileSync(
    path.join(root, "supabase/functions/expire-stale-date-offers/index.ts"),
    "utf8",
  );
  const handlerSource = fs.readFileSync(
    path.join(root, "supabase/functions/expire-stale-date-offers/handler.ts"),
    "utf8",
  );

  // Entrypoint uses existing repo conventions & shared utilities
  assert.match(indexSource, /from\s+"\.\.\/_shared\/supabase\.ts"/);
  assert.match(indexSource, /\bserviceRole\b/);
  assert.match(indexSource, /\bjson\b/);
  assert.match(indexSource, /Deno\.env\.get\(EXPIRE_SECRET_ENV\)/);
  assert.match(handlerSource, /from\s+"\.\.\/_shared\/crypto\.ts"/);
  assert.match(handlerSource, /EXPIRE_RPC_NAME\s*=\s*"expire_stale_date_offers"/);
  assert.match(handlerSource, /EXPIRE_SECRET_ENV\s*=\s*"EXPIRE_STALE_DATE_OFFERS_SECRET"/);
  assert.match(handlerSource, /supabase\.rpc\(EXPIRE_RPC_NAME\)/);

  // Ensure neither EXPIRE_STALE_DATE_OFFERS_SECRET nor SUPABASE_SERVICE_ROLE_KEY exists in frontend src/
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx|js|jsx|html)$/.test(entry.name)) out.push(full);
    }
    return out;
  };

  const frontendFiles = walk(path.join(root, "src"));
  for (const file of frontendFiles) {
    const content = fs.readFileSync(file, "utf8");
    assert.ok(
      !content.includes(EXPIRE_SECRET_ENV),
      `${file} must not reference ${EXPIRE_SECRET_ENV}`,
    );
    assert.ok(
      !content.includes("SUPABASE_SERVICE_ROLE_KEY"),
      `${file} must not reference SUPABASE_SERVICE_ROLE_KEY`,
    );
  }
});
