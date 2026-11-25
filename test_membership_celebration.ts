/**
 * DATEVRA — Membership Purchase Celebration Validation Suite
 *
 * Covers:
 *  - Eligibility: verified membership payment + active subscription only
 *  - Ownership: client filter, controller guard, mockDb RPC parity, and SQL auth.uid() check
 *  - Durable server idempotency: celebration_shown_at is sole durable marker (no localStorage suppression)
 *  - Failed acknowledgement retry: transient failure never suppresses future retry (on dismiss, refresh, or reload)
 *  - Duplicate-celebration prevention: in-flight dedupe + single overlay per session
 *  - Missing RPC error handling: PGRST202 / 42883 and empty/invalid responses throw (never silent success)
 *  - UI behavior & design preservation: MembershipCelebrationOverlay & Membership.tsx wiring
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// In-memory localStorage shim for mockDb in Node runtime
const memStorage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (k: string) => memStorage.get(k) ?? null,
    setItem: (k: string, v: string) => memStorage.set(k, String(v)),
    removeItem: (k: string) => memStorage.delete(k),
    clear: () => memStorage.clear(),
  },
  configurable: true,
});

import {
  createCelebrationSessionController,
  findEligibleCelebrationPayment,
  unwrapCelebrationAckRpcResult,
} from "./src/lib/membershipCelebration";
import * as mockDb from "./src/lib/mockDb";
import type { Payment, Subscription } from "./src/lib/types";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function makeSub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: "sub-1",
    userId: "user-a",
    planId: "plus",
    status: "active",
    startedAt: "2026-11-20T10:00:00.000Z",
    expiresAt: "2026-12-20T10:00:00.000Z",
    autoRenew: false,
    ...overrides,
  };
}

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: "pay-1",
    userId: "user-a",
    kind: "membership",
    planId: "plus",
    amount: 1299,
    status: "verified",
    method: "razorpay",
    verifiedAt: "2026-11-20T10:00:05.000Z",
    celebrationShownAt: null,
    createdAt: "2026-11-20T10:00:00.000Z",
    ...overrides,
  };
}

test("C1: Eligibility requires active subscription + owned verified membership payment with null celebrationShownAt", () => {
  const activeSub = makeSub();
  const validPayment = makePayment();

  // Happy path
  assert.equal(findEligibleCelebrationPayment("user-a", activeSub, [validPayment])?.id, "pay-1");

  // Inactive / missing subscription -> ineligible
  assert.equal(findEligibleCelebrationPayment("user-a", undefined, [validPayment]), undefined);
  assert.equal(
    findEligibleCelebrationPayment("user-a", makeSub({ status: "expired" }), [validPayment]),
    undefined,
  );
  assert.equal(
    findEligibleCelebrationPayment("user-a", makeSub({ status: "cancelled" }), [validPayment]),
    undefined,
  );

  // Non-verified payment statuses -> ineligible
  for (const status of ["pending", "failed", "refunded"] as const) {
    assert.equal(
      findEligibleCelebrationPayment("user-a", activeSub, [makePayment({ status })]),
      undefined,
      `Payment with status=${status} must not trigger celebration`,
    );
  }

  // Non-membership payment -> ineligible
  assert.equal(
    findEligibleCelebrationPayment("user-a", activeSub, [makePayment({ kind: "experience" })]),
    undefined,
  );

  // Already durably acknowledged on server -> ineligible
  assert.equal(
    findEligibleCelebrationPayment("user-a", activeSub, [
      makePayment({ celebrationShownAt: "2026-11-20T10:01:00.000Z" }),
    ]),
    undefined,
  );
});

test("C2: Ownership is enforced on client selection, mockDb acknowledgement, and Migration 031 SQL", () => {
  const activeSub = makeSub({ userId: "user-a" });
  const foreignPayment = makePayment({ id: "pay-foreign", userId: "user-b" });

  // Client helper refuses payment belonging to another user
  assert.equal(findEligibleCelebrationPayment("user-a", activeSub, [foreignPayment]), undefined);

  // mockDb enforces payment ownership and verified membership state
  mockDb.resetDemo();
  const members = mockDb.allUsers().filter((u) => !u.isAdmin && u.id !== "admin-1");
  const owner = members[0];
  const other = members[1];
  const pending = mockDb.purchaseMembership(owner.id, "plus", 1299);
  mockDb.verifyPayment(pending.id, "admin-1");

  assert.throws(
    () => mockDb.acknowledgeMembershipCelebration(pending.id, other.id),
    /PAYMENT_NOT_ELIGIBLE/,
  );

  // Migration 031 SQL binds ownership strictly to auth.uid()
  const m031 = read("db/migrations/031_membership_pass_revocation_and_celebration.sql");
  assert.match(m031, /v_uid\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(m031, /WHERE\s+id\s*=\s*p_payment_id[\s\S]*?AND\s+user_id\s*=\s*v_uid/i);
  assert.match(m031, /SET\s+celebration_shown_at\s*=\s*COALESCE\(celebration_shown_at,\s*now\(\)\)/i);
});

test("C3: Missing RPC errors (PGRST202, 42883) and invalid/empty responses throw and are NEVER silently treated as success", () => {
  assert.throws(
    () =>
      unwrapCelebrationAckRpcResult({
        data: null,
        error: { code: "PGRST202", message: "Could not find the function public.acknowledge_membership_celebration" },
      }),
    /MIGRATION_REQUIRED/,
  );

  assert.throws(
    () =>
      unwrapCelebrationAckRpcResult({
        data: null,
        error: { code: "42883", message: "function public.acknowledge_membership_celebration(uuid) does not exist" },
      }),
    /MIGRATION_REQUIRED/,
  );

  assert.throws(
    () =>
      unwrapCelebrationAckRpcResult({
        data: null,
        error: { code: "P0001", message: "PAYMENT_NOT_ELIGIBLE: Verified membership payment not found for caller." },
      }),
    /PAYMENT_NOT_ELIGIBLE/,
  );

  for (const invalidData of [null, undefined, "", "   ", 12345, {}]) {
    assert.throws(
      () => unwrapCelebrationAckRpcResult({ data: invalidData, error: null }),
      /INVALID_ACK_RESPONSE/,
      `Expected INVALID_ACK_RESPONSE for data=${JSON.stringify(invalidData)}`,
    );
  }

  const serverTs = "2026-11-25T10:25:00.000Z";
  assert.equal(unwrapCelebrationAckRpcResult({ data: serverTs, error: null }), serverTs);

  // Confirm supabase/db.ts delegates to unwrapCelebrationAckRpcResult and has no PGRST202/42883 silent fallback
  const supabaseDbSrc = read("src/lib/supabase/db.ts");
  const fnSlice = supabaseDbSrc.slice(
    supabaseDbSrc.indexOf("async function acknowledgeMembershipCelebration"),
    supabaseDbSrc.indexOf("/* ---------------- outside-Delhi vouchers"),
  );
  assert.match(fnSlice, /unwrapCelebrationAckRpcResult/);
  assert.doesNotMatch(fnSlice, /new Date\(\)\.toISOString\(\)/);
});

test("C4: Failed acknowledgement does NOT permanently suppress future retries (dismiss retry, same-session refresh, and full reload)", async () => {
  memStorage.clear();
  const sub = makeSub();
  const payment = makePayment();
  const controller = createCelebrationSessionController();

  let shownCount = 0;
  let ackAttempts = 0;
  let acknowledgedTs: string | null = null;
  let lastError: unknown = null;

  // Attempt 1: server fails (e.g., network drop or missing RPC)
  const first = await controller.evaluateAndAcknowledge({
    userId: "user-a",
    sub,
    payments: [payment],
    acknowledge: async () => {
      ackAttempts++;
      throw new Error("MIGRATION_REQUIRED: RPC unavailable");
    },
    onShow: () => {
      shownCount++;
    },
    onAcknowledged: (_id, ts) => {
      acknowledgedTs = ts;
    },
    onError: (_id, err) => {
      lastError = err;
    },
  });

  assert.equal(first.shownOverlay, true);
  assert.equal(first.acknowledged, false);
  assert.equal(shownCount, 1);
  assert.equal(ackAttempts, 1);
  assert.equal(acknowledgedTs, null);
  assert.ok(lastError instanceof Error);
  assert.equal(controller.isAcknowledgedInSession("pay-1"), false);
  assert.equal(controller.isAckInFlight("pay-1"), false);
  assert.equal(memStorage.size, 0, "Must never write permanent localStorage suppression on failure");

  // Attempt 2: Retry on overlay dismiss succeeds WITHOUT showing a duplicate overlay
  const retriedOk = await controller.retryAcknowledgeIfPending({
    paymentId: "pay-1",
    userId: "user-a",
    acknowledge: async () => {
      ackAttempts++;
      return "2026-11-25T10:30:00.000Z";
    },
    onAcknowledged: (_id, ts) => {
      acknowledgedTs = ts;
    },
  });

  assert.equal(retriedOk, true);
  assert.equal(ackAttempts, 2);
  assert.equal(shownCount, 1, "Retry must not duplicate the celebration overlay");
  assert.equal(acknowledgedTs, "2026-11-25T10:30:00.000Z");
  assert.equal(controller.isAcknowledgedInSession("pay-1"), true);

  // Attempt 3: Subsequent dismiss/refresh is a no-op once acknowledged
  const retriedAgain = await controller.retryAcknowledgeIfPending({
    paymentId: "pay-1",
    userId: "user-a",
    acknowledge: async () => {
      ackAttempts++;
      return "2026-11-25T10:31:00.000Z";
    },
  });
  assert.equal(retriedAgain, false);
  assert.equal(ackAttempts, 2);

  // Simulate full page reload BEFORE server persistence (server still returns celebrationShownAt = null)
  const reloadedController = createCelebrationSessionController();
  let reloadAckCalls = 0;
  const reloadOutcome = await reloadedController.evaluateAndAcknowledge({
    userId: "user-a",
    sub,
    payments: [makePayment({ celebrationShownAt: null })],
    acknowledge: async () => {
      reloadAckCalls++;
      return "2026-11-25T10:35:00.000Z";
    },
    onShow: () => {},
  });
  assert.equal(reloadOutcome.acknowledged, true);
  assert.equal(reloadAckCalls, 1);

  // Simulate full page reload AFTER server persisted celebration_shown_at -> durable suppression
  const postPersistController = createCelebrationSessionController();
  let postPersistShows = 0;
  let postPersistAcks = 0;
  const postPersistOutcome = await postPersistController.evaluateAndAcknowledge({
    userId: "user-a",
    sub,
    payments: [makePayment({ celebrationShownAt: "2026-11-25T10:35:00.000Z" })],
    acknowledge: async () => {
      postPersistAcks++;
      return "2026-11-25T10:35:00.000Z";
    },
    onShow: () => {
      postPersistShows++;
    },
  });
  assert.equal(postPersistOutcome.paymentId, null);
  assert.equal(postPersistShows, 0);
  assert.equal(postPersistAcks, 0);
});

test("C5: Concurrent renders during in-flight acknowledgement show strictly one overlay and send one RPC", async () => {
  const sub = makeSub();
  const payment = makePayment();
  const controller = createCelebrationSessionController();

  let resolveAck!: (ts: string) => void;
  let rpcCount = 0;
  let showCount = 0;

  const ack = () => {
    rpcCount++;
    return new Promise<string>((resolve) => {
      resolveAck = resolve;
    });
  };

  const p1 = controller.evaluateAndAcknowledge({
    userId: "user-a",
    sub,
    payments: [payment],
    acknowledge: ack,
    onShow: () => {
      showCount++;
    },
  });

  // Second concurrent effect run while first RPC is still in flight
  const p2 = controller.evaluateAndAcknowledge({
    userId: "user-a",
    sub,
    payments: [payment],
    acknowledge: ack,
    onShow: () => {
      showCount++;
    },
  });

  const o2 = await p2;
  assert.equal(o2.inFlightSkipped, true);
  assert.equal(o2.shownOverlay, false);
  assert.equal(rpcCount, 1);
  assert.equal(showCount, 1);

  resolveAck("2026-11-25T10:40:00.000Z");
  const o1 = await p1;
  assert.equal(o1.shownOverlay, true);
  assert.equal(o1.acknowledged, true);
  assert.equal(rpcCount, 1);
  assert.equal(showCount, 1);
});

test("C6: Membership.tsx removes localStorage permanent suppression and preserves MembershipCelebrationOverlay UI", () => {
  const membershipSrc = read("src/pages/user/Membership.tsx");
  const overlaySrc = read("src/components/MembershipCelebrationOverlay.tsx");

  assert.doesNotMatch(membershipSrc, /localStorage/);
  assert.doesNotMatch(membershipSrc, /CELEBRATION_KEY_PREFIX/);
  assert.match(membershipSrc, /p\.userId === user\.id && p\.status === "verified" && p\.kind === "membership"/);
  assert.match(membershipSrc, /createCelebrationSessionController/);
  assert.match(membershipSrc, /retryAcknowledgeIfPending/);
  assert.match(membershipSrc, /acknowledgeMembershipCelebration/);
  assert.match(membershipSrc, /durationMs=\{5500\}/);

  // Overlay design & accessibility invariants preserved
  assert.match(overlaySrc, /durationMs = 5500/);
  assert.match(overlaySrc, /useReducedMotion/);
  assert.match(overlaySrc, /Escape/);
  assert.match(overlaySrc, /bg-midnight\/90/);
  assert.match(overlaySrc, /text-gradient-gold/);
});
