/**
 * DATEVRA — Master Implementation Automated Verification Suite (30 Scenarios)
 *
 * Covers all 9 client requirements + Phase 10 Razorpay repair & security +
 * regression checks for 75% compatibility and designated admin-only mode.
 *
 * Run with: npx tsx --test test_master_requirements.ts
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Minimal localStorage polyfill for Node execution of mockDb
const memoryStore = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() {
    return memoryStore.size;
  },
  clear() {
    memoryStore.clear();
  },
  getItem(key: string) {
    return memoryStore.has(key) ? memoryStore.get(key)! : null;
  },
  key(index: number) {
    return Array.from(memoryStore.keys())[index] ?? null;
  },
  removeItem(key: string) {
    memoryStore.delete(key);
  },
  setItem(key: string, value: string) {
    memoryStore.set(key, String(value));
  },
};

import * as mockDb from "./src/lib/mockDb";
import {
  isMemberEligibleForOutsideDelhiVoucher,
  isOutsideDelhiCity,
  normalizeCityName,
} from "./src/lib/voucherPolicy";
import { MIN_COMPATIBILITY_SCORE } from "./src/lib/compat";
import {
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from "./supabase/functions/_shared/crypto";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const futureDate = (daysAhead: number) =>
  new Date(Date.now() + daysAhead * 86_400_000).toISOString().slice(0, 10);

function makeHighCompatProfile(id: string, firstName: string, city: string, idx: number) {
  return {
    id,
    email: `${id}@test.datevra.com`,
    firstName,
    age: 26 + (idx % 4),
    gender: idx % 2 === 0 ? ("Woman" as const) : ("Man" as const),
    city,
    registeredCity: city,
    bio: "Thoughtful conversations over artisanal coffee and quiet evenings.",
    interests: ["Coffee", "Art", "Travel", "Books", "Music"],
    hobbies: ["Reading", "Photography", "Cooking"],
    lifestyle: "Non-smoker · Social drinker · Active",
    relationshipGoal: "Long-term" as const,
    photos: [],
    verified: true,
    verificationStatus: "verified" as const,
    planId: null,
    planExpiresAt: null,
    onboardingComplete: true,
    blockedIds: [] as string[],
    createdAt: new Date(Date.now() - 86400000 * 30).toISOString(),
    lastActive: new Date().toISOString(),
  };
}

/** Seed N distinct eligible mutual matches (with reciprocal likes) into mockDb cleanly. */
function seedEligibleMatches(count: number, alreadyBookedCount = 0) {
  mockDb.resetDemo();
  // Trigger initial load so localStorage is populated under datevra-db-v1
  mockDb.allUsers();
  const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
  raw.matches = [];
  raw.likes = [];
  raw.automaticDateOffers = [];
  raw.autoDateOfferBatch = null;
  raw.manualDateOffers = [];
  raw.bookings = [];
  raw.blocks = [];

  const neededUsers = count * 2;
  for (let i = 0; i < neededUsers; i++) {
    const uid = `auto-u-${i}`;
    if (!raw.users.some((u: { id: string }) => u.id === uid)) {
      raw.users.push(makeHighCompatProfile(uid, `Member${i}`, "Mumbai", i));
    }
  }

  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const ua = `auto-u-${i * 2}`;
    const ub = `auto-u-${i * 2 + 1}`;
    const ts = new Date(now - (count - i) * 60000).toISOString();
    raw.likes.push({ id: `lk-a-${i}`, fromUserId: ua, toUserId: ub, createdAt: ts });
    raw.likes.push({ id: `lk-b-${i}`, fromUserId: ub, toUserId: ua, createdAt: ts });
    raw.matches.push({
      id: `m-auto-${i}`,
      userA: ua,
      userB: ub,
      compatibility: 85 + (i % 14),
      factors: ["Shared interests", "Compatible pace"],
      createdAt: ts,
    });
    if (i < alreadyBookedCount) {
      raw.bookings.push({
        id: `bk-existing-${i}`,
        userId: ua,
        partnerId: ub,
        experienceId: raw.experiences?.[0]?.id ?? "e-golden-hour",
        venue: "Existing Venue",
        date: futureDate(10),
        time: "19:30",
        status: "upcoming",
        paymentStatus: "paid",
        amount: 0,
        createdAt: ts,
      });
    }
  }

  mockDb.resetDemo();
  localStorage.setItem("datevra-db-v1", JSON.stringify(raw));
}

/* ==================== REQ 1: DATABASE MIGRATIONS ==================== */

test("T01: Migrations 030-034 exist, are additive only, and enable RLS on all new tables", () => {
  const files = [
    "db/migrations/030_date_offers_and_invitations.sql",
    "db/migrations/031_membership_pass_revocation_and_celebration.sql",
    "db/migrations/032_outside_delhi_vouchers_and_otp.sql",
    "db/migrations/033_razorpay_payments_and_webhooks.sql",
    "db/migrations/034_verify_master_migrations_READ_ONLY.sql",
  ];
  for (const f of files) {
    const content = read(f);
    assert.ok(content.length > 200, `${f} should be non-empty`);
    assert.doesNotMatch(content, /\bDROP\s+TABLE\b/i, `${f} must not drop tables`);
    assert.doesNotMatch(content, /\bTRUNCATE\b/i, `${f} must not truncate tables`);
    assert.doesNotMatch(content, /\bDELETE\s+FROM\s+public\.profiles\b/i, `${f} must not delete profiles`);
  }

  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");
  for (const tbl of [
    "public.auto_date_offer_batches",
    "public.automatic_date_offers",
    "public.manual_date_offers",
    "public.date_offer_events",
    "public.date_invitations",
    "public.date_invitation_recipients",
  ]) {
    const escaped = tbl.replace(".", "\\.");
    assert.match(
      m030,
      new RegExp(`ALTER\\s+TABLE\\s+${escaped}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"),
      `RLS must be enabled on ${tbl}`,
    );
  }
});

test("T02: Migration 034 verification script is strictly read-only", () => {
  const sql = read("db/migrations/034_verify_master_migrations_READ_ONLY.sql");
  const stripped = sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(
    stripped,
    /\b(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i,
    "034 must contain only read-only SELECT queries",
  );
  assert.match(stripped, /\bSELECT\b/i);
});

test("T03: Migrations 030-033 grant zero anon execution and isolate OTP & webhook tables", () => {
  for (const f of [
    "db/migrations/030_date_offers_and_invitations.sql",
    "db/migrations/031_membership_pass_revocation_and_celebration.sql",
    "db/migrations/032_outside_delhi_vouchers_and_otp.sql",
    "db/migrations/033_razorpay_payments_and_webhooks.sql",
  ]) {
    const sql = read(f);
    assert.doesNotMatch(sql, /\bGRANT\b[^\n;]*\bTO\s+[^\n;]*\banon\b/i, `${f} must not grant to anon`);
  }
  const m032 = read("db/migrations/032_outside_delhi_vouchers_and_otp.sql");
  assert.match(
    m032,
    /REVOKE ALL ON TABLE datevra_internal\.voucher_otp_challenges FROM PUBLIC, anon, authenticated/i,
  );
  const m033 = read("db/migrations/033_razorpay_payments_and_webhooks.sql");
  assert.match(
    m033,
    /REVOKE ALL ON TABLE public\.payment_webhook_events FROM PUBLIC, anon, authenticated/i,
  );
});

/* ==================== REQ 2: BACKEND DUAL-MODE PARITY ==================== */

test("T04: Dual-mode backend parity across data.ts, supabase/db.ts, mappers.ts, and mockDb.ts", () => {
  const dataTs = read("src/lib/data.ts");
  const sbDb = read("src/lib/supabase/db.ts");
  const methods = [
    "getAutoDateOfferSummary",
    "evaluateInitialAutoDateOffers",
    "respondToAutomaticDateOffer",
    "createManualDateOffer",
    "cancelManualDateOffer",
    "respondToManualDateOffer",
    "createDateInvitation",
    "cancelDateInvitation",
    "respondToDateInvitation",
    "acknowledgeMembershipCelebration",
    "getVoucherSettings",
    "updateVoucherSettings",
    "requestVoucherOtp",
    "verifyVoucherOtpAndClaim",
    "redeemVoucher",
    "revokeVoucher",
  ];
  for (const m of methods) {
    assert.ok(dataTs.includes(m), `data.ts missing ${m}`);
    assert.ok(sbDb.includes(m), `supabase/db.ts missing ${m}`);
    assert.equal(typeof (mockDb as Record<string, unknown>)[m], "function", `mockDb missing ${m}`);
  }
});

/* ==================== REQ 3: AUTOMATIC 100-MATCH DATE OFFERS ==================== */

test("T05: Below 100 eligible matches does NOT trigger automatic date offers", () => {
  seedEligibleMatches(99);
  const res = mockDb.evaluateInitialAutoDateOffers();
  assert.equal(res.triggered, false);
  const summary = mockDb.getAutoDateOfferSummary();
  assert.equal(summary.totalEligibleMatches, 99);
  assert.equal(summary.batchStatus, "not_triggered");
  assert.equal(summary.offersCreated, 0);
});

test("T06: Reaching 100 eligible matches triggers initial batch of exactly 10 unique-pair offers", () => {
  seedEligibleMatches(100);
  const res = mockDb.evaluateInitialAutoDateOffers();
  assert.equal(res.triggered, true);
  assert.equal(res.created_offers, 10);
  assert.equal(res.shortfall, 0);
  const offers = mockDb.listAutomaticDateOffers();
  assert.equal(offers.length, 10);
  const usedUsers = new Set<string>();
  for (const o of offers) {
    assert.ok(!usedUsers.has(o.userA) && !usedUsers.has(o.userB), "Each pair/user in initial batch must be unique");
    usedUsers.add(o.userA);
    usedUsers.add(o.userB);
  }
});

test("T07: Automatic 100-match milestone is strictly one-time and never re-runs", () => {
  seedEligibleMatches(120);
  const first = mockDb.evaluateInitialAutoDateOffers();
  assert.equal(first.triggered, true);
  assert.equal(first.created_offers, 10);

  const second = mockDb.evaluateInitialAutoDateOffers();
  assert.equal(second.triggered, false);
  assert.equal(second.already_completed, true);
  assert.equal(mockDb.listAutomaticDateOffers().length, 10);
});

test("T08: Fewer than 10 available eligible pairs records shortfall without padding ineligible pairs", () => {
  // 100 eligible mutual matches where 94 pairs already have an upcoming booking -> only 6 available
  seedEligibleMatches(100, 94);
  const res = mockDb.evaluateInitialAutoDateOffers();
  assert.equal(res.triggered, true);
  assert.equal(res.created_offers, 6);
  assert.equal(res.shortfall, 4);
  const summary = mockDb.getAutoDateOfferSummary();
  assert.equal(summary.shortfallCount, 4);
});

test("T09: Automatic date offer requires dual acceptance and creates single zero-charge booking", () => {
  seedEligibleMatches(100);
  mockDb.evaluateInitialAutoDateOffers();
  const offer = mockDb.listAutomaticDateOffers()[0];
  assert.ok(offer);

  const bookingsBefore = mockDb.allBookings().length;
  const afterA = mockDb.respondToAutomaticDateOffer(offer.id, offer.userA, true);
  assert.equal(afterA.status, "pending");
  assert.equal(afterA.bookingId, null);
  assert.equal(mockDb.allBookings().length, bookingsBefore);

  const afterB = mockDb.respondToAutomaticDateOffer(offer.id, offer.userB, true);
  assert.equal(afterB.status, "accepted");
  assert.ok(afterB.bookingId);
  assert.equal(mockDb.allBookings().length, bookingsBefore + 1);
  const createdBooking = mockDb.allBookings().find((b) => b.id === afterB.bookingId);
  assert.ok(createdBooking);
  assert.equal(createdBooking.amount, 0, "Automatic offer must never auto-charge");
});

test("T10: Declining an automatic date offer marks it declined and creates zero bookings", () => {
  seedEligibleMatches(100);
  mockDb.evaluateInitialAutoDateOffers();
  const offer = mockDb.listAutomaticDateOffers()[0];
  const bookingsBefore = mockDb.allBookings().length;

  const declined = mockDb.respondToAutomaticDateOffer(offer.id, offer.userA, false);
  assert.equal(declined.status, "declined");
  assert.equal(declined.bookingId, null);
  assert.equal(mockDb.allBookings().length, bookingsBefore);
});

/* ==================== REQ 4: MANUAL DATE OFFER ==================== */

test("T11: Non-admin cannot create or cancel a manual date offer", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  assert.throws(
    () =>
      mockDb.createManualDateOffer(
        {
          userAId: users[0].id,
          userBId: users[1].id,
          experienceId: exp.id,
          date: futureDate(5),
          time: "19:30",
          venue: "The Rose Room",
        },
        users[0].id,
      ),
    /PERMISSION_DENIED/,
  );
});

test("T12: Admin manual date offer rejects blocked pairs", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  mockDb.blockUser(users[0].id, users[1].id);
  assert.throws(
    () =>
      mockDb.createManualDateOffer(
        {
          userAId: users[0].id,
          userBId: users[1].id,
          experienceId: exp.id,
          date: futureDate(5),
          time: "19:30",
          venue: "The Rose Room",
        },
        "admin-1",
      ),
    /PAIR_BLOCKED/,
  );
});

test("T13: Duplicate active manual date offer for same pair and date is prevented", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const d = futureDate(7);
  mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: d,
      time: "20:00",
      venue: "Velvet Terrace",
    },
    "admin-1",
  );
  assert.throws(
    () =>
      mockDb.createManualDateOffer(
        {
          userAId: users[1].id,
          userBId: users[0].id,
          experienceId: exp.id,
          date: d,
          time: "21:00",
          venue: "Another Terrace",
        },
        "admin-1",
      ),
    /DUPLICATE_ACTIVE_OFFER/,
  );
});

test("T14: Manual date offer dual acceptance creates one booking and cancel logs audit event", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const offer = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: futureDate(9),
      time: "19:00",
      venue: "Champagne Salon",
    },
    "admin-1",
  );
  const beforeCount = mockDb.allBookings().length;
  const r1 = mockDb.respondToManualDateOffer(offer.id, users[0].id, true);
  assert.equal(r1.status, "pending");
  assert.equal(mockDb.allBookings().length, beforeCount);

  const r2 = mockDb.respondToManualDateOffer(offer.id, users[1].id, true);
  assert.equal(r2.status, "accepted");
  assert.ok(r2.bookingId);
  assert.equal(mockDb.allBookings().length, beforeCount + 1);

  const offer2 = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: futureDate(14),
      time: "19:00",
      venue: "Evening Conservatory",
    },
    "admin-1",
  );
  const cancelled = mockDb.cancelManualDateOffer(offer2.id, "Venue closed", "admin-1");
  assert.equal(cancelled.status, "cancelled");
  const events = mockDb.listDateOfferEvents(offer2.id);
  assert.ok(events.some((e) => e.eventType === "cancelled"));
});

test("T15: Manual date offers stay strictly separate from match_proposals and automatic_date_offers", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const proposalsBefore = mockDb.listMatchProposals().length;
  const autoBefore = mockDb.listAutomaticDateOffers().length;

  mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: futureDate(16),
      time: "19:30",
      venue: "Moonlight Lounge",
    },
    "admin-1",
  );

  assert.equal(mockDb.listMatchProposals().length, proposalsBefore);
  assert.equal(mockDb.listAutomaticDateOffers().length, autoBefore);
  assert.equal(mockDb.listManualDateOffers().length, 1);
});

/* ==================== REQ 5: INVITATION DATES ==================== */

test("T16: Individual invitation acceptance records response only and NEVER creates a 2-person booking", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const bookingsBefore = mockDb.allBookings().length;

  const inv = mockDb.createDateInvitation(
    {
      title: "Private Jazz Evening",
      invitationMode: "individual",
      userIds: [users[0].id],
      date: futureDate(18),
      time: "20:00",
      venue: "Blue Note Salon",
      message: "You are warmly invited.",
    },
    "admin-1",
  );
  const resp = mockDb.respondToDateInvitation(inv.id, users[0].id, true);
  assert.equal(resp.response, "accepted");
  assert.equal(resp.bookingId, null);
  assert.equal(mockDb.allBookings().length, bookingsBefore);
});

test("T17: Group invitation enforces recipient privacy and never creates a 2-person booking", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const bookingsBefore = mockDb.allBookings().length;

  const inv = mockDb.createDateInvitation(
    {
      title: "Datevra Autumn Mixer",
      invitationMode: "group",
      userIds: [users[0].id, users[1].id, users[2].id],
      date: futureDate(20),
      time: "19:00",
      venue: "The Glasshouse",
    },
    "admin-1",
  );

  // Member 0 must ONLY see their own recipient row — never Member 1 or Member 2
  const memberView = mockDb.myDateInvitations(users[0].id);
  assert.equal(memberView.length, 1);
  assert.equal(memberView[0].recipients.length, 1);
  assert.equal(memberView[0].recipients[0].userId, users[0].id);

  const resp = mockDb.respondToDateInvitation(inv.id, users[0].id, true);
  assert.equal(resp.response, "accepted");
  assert.equal(mockDb.allBookings().length, bookingsBefore);
});

test("T18: Paired invitation requires dual acceptance before creating one 2-person booking and blocks blocked pairs", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const bookingsBefore = mockDb.allBookings().length;

  const inv = mockDb.createDateInvitation(
    {
      title: "Paired Candlelight Tasting",
      invitationMode: "pair",
      userIds: [users[0].id, users[1].id],
      experienceId: exp.id,
      date: futureDate(22),
      time: "20:00",
      venue: "Bordeaux Room",
    },
    "admin-1",
  );

  const r1 = mockDb.respondToDateInvitation(inv.id, users[0].id, true);
  assert.equal(r1.response, "accepted");
  assert.equal(r1.bookingId, null);
  assert.equal(mockDb.allBookings().length, bookingsBefore);

  const r2 = mockDb.respondToDateInvitation(inv.id, users[1].id, true);
  assert.equal(r2.response, "accepted");
  assert.ok(r2.bookingId);
  assert.equal(mockDb.allBookings().length, bookingsBefore + 1);

  mockDb.blockUser(users[2].id, users[3].id);
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Blocked Pair Invite",
          invitationMode: "pair",
          userIds: [users[2].id, users[3].id],
          experienceId: exp.id,
          date: futureDate(24),
          time: "19:00",
          venue: "Salon",
        },
        "admin-1",
      ),
    /PAIR_BLOCKED/,
  );

  // Pair invitation without experienceId must be rejected (date_bookings.experience_id is NOT NULL)
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Missing Experience Pair Invite",
          invitationMode: "pair",
          userIds: [users[0].id, users[1].id],
          date: futureDate(25),
          time: "19:00",
          venue: "Salon",
        },
        "admin-1",
      ),
    /EXPERIENCE_REQUIRED/,
  );
});

test("T19: Cancelling an active invitation prevents subsequent acceptance", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const inv = mockDb.createDateInvitation(
    {
      title: "Cancelled Preview",
      invitationMode: "individual",
      userIds: [users[0].id],
      date: futureDate(26),
      time: "19:00",
      venue: "Atelier",
    },
    "admin-1",
  );
  const cancelled = mockDb.cancelDateInvitation(inv.id, "admin-1");
  assert.equal(cancelled.status, "cancelled");
  assert.throws(() => mockDb.respondToDateInvitation(inv.id, users[0].id, true), /INVITATION_CLOSED/);
});

/* ==================== REQ 6: PASS GENERATION & REVOCATION ==================== */

test("T20: Membership pass preserves MEM-XXXX-XXXX-XXXX format and records revokedAt + revocationReason", () => {
  const m031 = read("db/migrations/031_membership_pass_revocation_and_celebration.sql");
  assert.match(m031, /ADD COLUMN IF NOT EXISTS revoked_at timestamptz/i);
  assert.match(m031, /ADD COLUMN IF NOT EXISTS revocation_reason text/i);

  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const pass = mockDb.createMembershipPass(
    { planId: "elite", durationDays: 30, expiresAt: new Date(Date.now() + 86400000 * 30).toISOString() },
    "admin-1",
  );
  assert.match(pass.code, /^MEM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);

  const revoked = mockDb.revokeMembershipPass(pass.id, "Issued in error", "admin-1");
  assert.equal(revoked.status, "revoked");
  assert.ok(revoked.revokedAt);
  assert.equal(revoked.revocationReason, "Issued in error");

  const redeemAttempt = mockDb.redeemMembershipPass(pass.code, users[0].id);
  assert.equal(redeemAttempt.success, false);
});

test("T21: Existing complimentary café passes continue working without regression", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const cafe = mockDb.listCafes()[0];
  const comp = mockDb.createComplimentaryPass({ cafeId: cafe.id, issuedToUserId: users[0].id }, "admin-1");
  assert.match(comp.code, /^DVR-[A-Z0-9]{6}$/);
  const redeemed = mockDb.redeemComplimentaryPass(comp.code, users[0].id);
  assert.equal(redeemed.status, "redeemed");
});

/* ==================== REQ 7: MEMBERSHIP CELEBRATION ==================== */

test("T22: Celebration only triggers for verified membership payment + active subscription (never pending/failed)", () => {
  mockDb.resetDemo();
  const member = mockDb.allUsers().find((u) => !u.isAdmin)!;
  const pending = mockDb.purchaseMembership(member.id, "plus", 1299);
  assert.equal(pending.status, "pending");

  // Attempting to acknowledge celebration on a pending payment must fail closed
  assert.throws(
    () => mockDb.acknowledgeMembershipCelebration(pending.id, member.id),
    /PAYMENT_NOT_ELIGIBLE/,
  );

  const verified = mockDb.verifyPayment(pending.id, "admin-1");
  assert.ok(verified);
  assert.equal(verified.status, "verified");
  assert.ok(verified.verifiedAt);
  assert.equal(verified.celebrationShownAt ?? null, null);
  const sub = mockDb.activeSubscription(member.id);
  assert.ok(sub && sub.status === "active");
});

test("T23: Celebration acknowledgment is idempotent and enforces ownership", () => {
  mockDb.resetDemo();
  const members = mockDb.allUsers().filter((u) => !u.isAdmin);
  const pending = mockDb.purchaseMembership(members[0].id, "elite", 2999);
  mockDb.verifyPayment(pending.id, "admin-1");

  // Another user cannot acknowledge someone else's celebration
  assert.throws(
    () => mockDb.acknowledgeMembershipCelebration(pending.id, members[1].id),
    /PAYMENT_NOT_ELIGIBLE/,
  );

  const ts1 = mockDb.acknowledgeMembershipCelebration(pending.id, members[0].id);
  assert.ok(ts1);
  const ts2 = mockDb.acknowledgeMembershipCelebration(pending.id, members[0].id);
  assert.equal(ts2, ts1, "Second acknowledgement must be idempotent");
});

test("T24: MembershipCelebrationOverlay enforces 5-6s duration, reduced-motion, and safe dismiss", () => {
  const overlaySrc = read("src/components/MembershipCelebrationOverlay.tsx");
  const membershipSrc = read("src/pages/user/Membership.tsx");
  assert.match(overlaySrc, /durationMs\s*=\s*5500/);
  assert.match(overlaySrc, /useReducedMotion/);
  assert.match(overlaySrc, /Escape/);
  assert.match(membershipSrc, /p\.status === "verified"/);
  assert.match(membershipSrc, /acknowledgeMembershipCelebration/);
});

/* ==================== REQ 8: OUTSIDE-DELHI VOUCHERS & OTP ==================== */

test("T25: Outside-Delhi voucher program starts disabled with NULL value until admin configures an approved value", () => {
  mockDb.resetDemo();
  const s = mockDb.getVoucherSettings();
  assert.equal(s.enabled, false);
  assert.equal(s.voucherValueInr, null);

  // Admin cannot enable without positive voucher value
  assert.throws(
    () => mockDb.updateVoucherSettings({ enabled: true, voucherValueInr: null }, "admin-1"),
    /VALUE_REQUIRED/,
  );

  const mumbaiUser = mockDb.allUsers().find((u) => !u.isAdmin && isOutsideDelhiCity(u.city))!;
  assert.throws(() => mockDb.requestVoucherOtp(mumbaiUser.id, "email"), /VOUCHER_PROGRAM_DISABLED/);
});

test("T26: Outside-Delhi city policy excludes Delhi/New Delhi and blocks city-spoofing via immutable registeredCity", () => {
  assert.equal(normalizeCityName("  New   Delhi "), "new delhi");
  assert.equal(isOutsideDelhiCity("Delhi"), false);
  assert.equal(isOutsideDelhiCity("  NEW  DELHI "), false);
  assert.equal(isOutsideDelhiCity("Mumbai"), true);
  assert.equal(isOutsideDelhiCity("Jaipur"), true);

  // Anti-spoofing check: registered in Delhi, later changes profile city to Mumbai -> still INELIGIBLE
  const spoofCheck = isMemberEligibleForOutsideDelhiVoucher("Mumbai", "New Delhi");
  assert.equal(spoofCheck.eligible, false);

  mockDb.resetDemo();
  mockDb.updateVoucherSettings({ enabled: true, voucherValueInr: 500 }, "admin-1");
  const delhiUser = mockDb.allUsers().find((u) => !u.isAdmin && !isOutsideDelhiCity(u.city));
  if (delhiUser) {
    const originalCity = delhiUser.city;
    // Attempt to spoof city to Mumbai
    mockDb.updateUser(delhiUser.id, { city: "Mumbai" });
    const updated = mockDb.getUser(delhiUser.id)!;
    assert.equal(normalizeCityName(updated.registeredCity), normalizeCityName(originalCity));
    assert.throws(() => mockDb.requestVoucherOtp(delhiUser.id, "email"), /INELIGIBLE_CITY/);
  }
});

test("T27: Server OTP security (lockout on wrong OTP, single-use, claim cap, single-use redeem, masked admin status, CSPRNG provider)", () => {
  mockDb.resetDemo();
  mockDb.updateVoucherSettings({ enabled: true, voucherValueInr: 500, maxClaimsPerUser: 1 }, "admin-1");
  const member = mockDb.allUsers().find((u) => !u.isAdmin && isOutsideDelhiCity(u.city))!;

  // 1. Request OTP -> 5 wrong attempts lock challenge
  const c1 = mockDb.requestVoucherOtp(member.id, "email");
  assert.ok(c1.challengeId);
  for (let i = 0; i < 5; i++) {
    assert.throws(
      () => mockDb.verifyVoucherOtpAndClaim(member.id, c1.challengeId, "000000"),
      /OTP_MISMATCH/,
    );
  }
  assert.throws(
    () => mockDb.verifyVoucherOtpAndClaim(member.id, c1.challengeId, "000000"),
    /OTP_LOCKED/,
  );

  // 2. Fresh OTP -> valid verification issues voucher
  const c2 = mockDb.requestVoucherOtp(member.id, "email");
  const rawDb = JSON.parse(localStorage.getItem("datevra-db-v1")!);
  const storedChallenge = rawDb.voucherOtpChallenges.find((x: { id: string }) => x.id === c2.challengeId);
  const validOtp: string = storedChallenge.otpCode;
  assert.match(validOtp, /^\d{6}$/);

  const voucher = mockDb.verifyVoucherOtpAndClaim(member.id, c2.challengeId, validOtp);
  assert.match(voucher.code, /^DVR-VCH-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  assert.equal(voucher.valueInr, 500);
  assert.equal(voucher.status, "issued");

  // 3. Reusing consumed OTP fails
  assert.throws(
    () => mockDb.verifyVoucherOtpAndClaim(member.id, c2.challengeId, validOtp),
    /OTP_ALREADY_USED/,
  );

  // 4. Exceeding maxClaimsPerUser fails
  assert.throws(() => mockDb.requestVoucherOtp(member.id, "email"), /CLAIM_LIMIT_REACHED/);

  // 5. Single-use redemption
  const redeemed = mockDb.redeemVoucher(voucher.code, member.id, "ref-1");
  assert.equal(redeemed.status, "redeemed");
  assert.throws(() => mockDb.redeemVoucher(voucher.code, member.id, "ref-2"), /ALREADY_REDEEMED/);

  // 6. Admin status listing NEVER leaks raw OTP codes
  const statuses = mockDb.listVoucherOtpStatus();
  for (const row of statuses) {
    assert.equal("otpCode" in row, false, "Admin OTP status must never expose raw OTP");
  }

  // 7. Edge Function OTP provider uses CSPRNG + HMAC-SHA256 and never hardcodes OTP
  const otpProviderSrc = read("supabase/functions/_shared/otpProvider.ts");
  assert.match(otpProviderSrc, /crypto\.getRandomValues/);
  assert.match(otpProviderSrc, /HMAC/);
  assert.doesNotMatch(otpProviderSrc, /123456/);
});

/* ==================== REQ 9: AUTOMATIC ZOOM FIX (ACCESSIBLE) ==================== */

test("T28: Auto-zoom root causes fixed without disabling pinch-to-zoom", () => {
  const html = read("index.html");
  assert.match(html, /width=device-width,\s*initial-scale=1\.0/);
  assert.doesNotMatch(html, /user-scalable\s*=\s*no/i, "Must NEVER disable pinch-to-zoom");
  assert.doesNotMatch(html, /maximum-scale\s*=\s*1(\.0)?\b/i, "Must NEVER lock maximum-scale=1");

  const css = read("src/index.css");
  assert.match(css, /@media\s*\(pointer:\s*coarse\),\s*\(max-width:\s*1024px\)/);
  assert.match(css, /font-size:\s*16px\s*!important/);

  const uiTsx = read("src/components/ui.tsx");
  assert.match(uiTsx, /export const inputCls\s*=\s*"[^"]*\btext-base\b/);

  const layoutTsx = read("src/components/layout.tsx");
  assert.doesNotMatch(layoutTsx, /\bautoFocus\b/, "Unconditional autoFocus must be removed");
});

/* ==================== PHASE 10: RAZORPAY REPAIR & REGRESSIONS ==================== */

test("T29: Razorpay HMAC-SHA256 verification, webhook idempotency, verified_at, and refund reconciliation", async () => {
  const secret = "rzp_test_unit_secret_only";
  const orderId = "order_Test123456";
  const paymentId = "pay_Test987654";
  const validSig = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");

  assert.equal(await verifyRazorpayPaymentSignature(secret, orderId, paymentId, validSig), true);
  assert.equal(await verifyRazorpayPaymentSignature(secret, orderId, paymentId, "0".repeat(64)), false);

  const webhookSecret = "whsec_test_unit_only";
  const rawPayload = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { order_id: orderId, id: paymentId, amount: 129900, currency: "INR" } } } });
  const validWebhookSig = crypto.createHmac("sha256", webhookSecret).update(rawPayload).digest("hex");
  assert.equal(await verifyRazorpayWebhookSignature(webhookSecret, rawPayload, validWebhookSig), true);
  assert.equal(await verifyRazorpayWebhookSignature(webhookSecret, `${rawPayload} `, validWebhookSig), false);

  const verifyFn = read("supabase/functions/verify-payment/index.ts");
  const webhookFn = read("supabase/functions/razorpay-webhook/index.ts");
  const sharedFn = read("supabase/functions/_shared/supabase.ts");
  assert.match(verifyFn, /activateVerifiedPayment/);
  assert.match(webhookFn, /payment_webhook_events/);
  assert.match(webhookFn, /reconcileRefundedPayment/);
  assert.match(webhookFn, /refund\.processed/);
  assert.match(sharedFn, /service_activate_verified_payment/);
  assert.doesNotMatch(sharedFn, /\/app\/membership/, "Legacy broken /app/membership link must be replaced with /membership");
});

test("T30: Existing 75% compatibility threshold, designated admin-only mode, and protected member routes preserved", () => {
  assert.equal(MIN_COMPATIBILITY_SCORE, 75);
  const authCtx = read("src/context/AuthContext.tsx");
  assert.ok(authCtx.includes("e0934a1e-cbf4-434d-93f1-56ead67e8df7"), "Designated admin-only UUID must be preserved");
  const appTsx = read("src/App.tsx");
  assert.match(appTsx, /path="bookings"/);
  assert.match(appTsx, /path="admin\/date-offers"/);
  assert.match(appTsx, /path="admin\/invitations"/);
  assert.doesNotMatch(appTsx, /path="admin\/vouchers"/);
});

/* ==================== MIGRATION 030 HARDENING & CONCURRENCY SUITE ==================== */

test("T31: Migration 030 evaluates existing 100+ matches at install time and protects concurrent/failed batch evaluation", () => {
  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");

  // Install-time evaluation block must exist so existing 100+ matches fire on install
  assert.match(
    m030,
    /DO\s+\$\$[\s\S]*?PERFORM\s+public\.evaluate_initial_auto_date_offers\('migration_030_install'\);[\s\S]*?END;\s*\$\$;/i,
    "Migration 030 must evaluate existing 100+ matches during installation",
  );

  // Batch singleton lock + v_has_existing := FOUND saved immediately (never relies on stale FOUND after SELECT count(*))
  assert.match(m030, /PERFORM\s+pg_advisory_xact_lock\(hashtext\('datevra:initial_auto_date_offer_batch'\)\);/i);
  assert.match(m030, /SELECT\s+\*\s+INTO\s+v_existing[\s\S]*?FOR\s+UPDATE;\s*v_has_existing\s*:=\s*FOUND;/i);
  assert.match(m030, /IF\s+v_has_existing\s+AND\s+v_existing\.status\s*=\s*'processing'\s+THEN/i);
  assert.match(m030, /IF\s+v_has_existing\s+AND\s+v_existing\.status\s*=\s*'failed'\s+THEN/i);
  assert.match(m030, /v_remaining_quota\s*:=\s*GREATEST\(0,\s*v_target_offers\s*-\s*v_created_count\);/i);
  assert.match(m030, /EXIT\s+WHEN\s+v_created_count\s*>=\s*v_target_offers;/i);
});

test("T32: Expired automatic offer, manual offer, and invitation persist expired state without rollback", () => {
  // 1. Automatic offer expiry persists and returns expired row
  seedEligibleMatches(100);
  mockDb.evaluateInitialAutoDateOffers();
  const autoOffer = mockDb.listAutomaticDateOffers()[0];
  {
    const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
    const row = raw.automaticDateOffers.find((o: { id: string }) => o.id === autoOffer.id);
    row.expiresAt = new Date(Date.now() - 60_000).toISOString();
    mockDb.resetDemo();
    localStorage.setItem("datevra-db-v1", JSON.stringify(raw));
  }
  const bookingsBeforeAuto = mockDb.allBookings().length;
  const expiredAuto = mockDb.respondToAutomaticDateOffer(autoOffer.id, autoOffer.userA, true);
  assert.equal(expiredAuto.status, "expired");
  assert.equal(expiredAuto.bookingId, null);
  assert.equal(mockDb.allBookings().length, bookingsBeforeAuto);
  assert.equal(
    mockDb.listAutomaticDateOffers().find((o) => o.id === autoOffer.id)?.status,
    "expired",
    "Expired status must persist in storage",
  );
  assert.ok(mockDb.listDateOfferEvents(autoOffer.id).some((e) => e.eventType === "expired"));

  // 2. Manual offer expiry persists and allows replacement offer for the same pair and date
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const d1 = futureDate(10);
  const manualOffer = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: d1,
      time: "19:30",
      venue: "Ivory Courtyard",
    },
    "admin-1",
  );
  {
    const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
    const row = raw.manualDateOffers.find((o: { id: string }) => o.id === manualOffer.id);
    row.expiresAt = new Date(Date.now() - 60_000).toISOString();
    mockDb.resetDemo();
    localStorage.setItem("datevra-db-v1", JSON.stringify(raw));
  }
  const bookingsBeforeManual = mockDb.allBookings().length;
  const expiredManual = mockDb.respondToManualDateOffer(manualOffer.id, users[0].id, true);
  assert.equal(expiredManual.status, "expired");
  assert.equal(mockDb.allBookings().length, bookingsBeforeManual);
  assert.ok(mockDb.listDateOfferEvents(manualOffer.id).some((e) => e.eventType === "expired"));

  // Replacement manual offer for the exact same pair and date must succeed once prior offer expired
  const replacement = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: d1,
      time: "20:30",
      venue: "Ivory Courtyard",
    },
    "admin-1",
  );
  assert.equal(replacement.status, "pending");
  assert.notEqual(replacement.id, manualOffer.id);

  // 3. Invitation expiry persists on invitation AND pending recipients without throwing
  const inv = mockDb.createDateInvitation(
    {
      title: "Expiring Salon Invite",
      invitationMode: "pair",
      userIds: [users[0].id, users[1].id],
      experienceId: exp.id,
      date: futureDate(12),
      time: "20:00",
      venue: "Rose Salon",
    },
    "admin-1",
  );
  {
    const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
    const row = raw.dateInvitations.find((i: { id: string }) => i.id === inv.id);
    row.expiresAt = new Date(Date.now() - 60_000).toISOString();
    mockDb.resetDemo();
    localStorage.setItem("datevra-db-v1", JSON.stringify(raw));
  }
  const expiredRec = mockDb.respondToDateInvitation(inv.id, users[0].id, true);
  assert.equal(expiredRec.response, "expired");
  assert.equal(expiredRec.bookingId, null);
  const persistedInv = mockDb.listDateInvitations().find((i) => i.id === inv.id)!;
  assert.equal(persistedInv.status, "expired");
  assert.ok(persistedInv.recipients.every((r) => r.response === "expired"));
});

test("T33: Blocked pair cannot accept automatic offer, manual offer, or paired invitation and persists cancelled state", () => {
  // 1. Automatic offer blocked after creation
  seedEligibleMatches(100);
  mockDb.evaluateInitialAutoDateOffers();
  const autoOffer = mockDb.listAutomaticDateOffers()[0];
  mockDb.blockUser(autoOffer.userA, autoOffer.userB);
  const bBefore1 = mockDb.allBookings().length;
  const autoRes = mockDb.respondToAutomaticDateOffer(autoOffer.id, autoOffer.userA, true);
  assert.equal(autoRes.status, "cancelled");
  assert.equal(autoRes.bookingId, null);
  assert.equal(mockDb.allBookings().length, bBefore1);
  assert.ok(mockDb.listDateOfferEvents(autoOffer.id).some((e) => e.eventType === "cancelled_blocked"));

  // 2. Manual offer blocked after creation
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const manualOffer = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: futureDate(15),
      time: "19:00",
      venue: "Champagne Lounge",
    },
    "admin-1",
  );
  mockDb.blockUser(users[0].id, users[1].id);
  const bBefore2 = mockDb.allBookings().length;
  const manualRes = mockDb.respondToManualDateOffer(manualOffer.id, users[0].id, true);
  assert.equal(manualRes.status, "cancelled");
  assert.equal(manualRes.bookingId, null);
  assert.equal(mockDb.allBookings().length, bBefore2);
  assert.ok(mockDb.listDateOfferEvents(manualOffer.id).some((e) => e.eventType === "cancelled_blocked"));

  // 3. Pair invitation blocked after first acceptance -> second acceptance cancels invitation & creates 0 bookings
  const inv = mockDb.createDateInvitation(
    {
      title: "Paired Evening",
      invitationMode: "pair",
      userIds: [users[2].id, users[3].id],
      experienceId: exp.id,
      date: futureDate(18),
      time: "20:00",
      venue: "Velvet Room",
    },
    "admin-1",
  );
  mockDb.respondToDateInvitation(inv.id, users[2].id, true);
  mockDb.blockUser(users[2].id, users[3].id);
  const bBefore3 = mockDb.allBookings().length;
  const blockedRec = mockDb.respondToDateInvitation(inv.id, users[3].id, true);
  assert.equal(blockedRec.response, "declined");
  assert.equal(blockedRec.bookingId, null);
  assert.equal(mockDb.allBookings().length, bBefore3);
  assert.equal(mockDb.listDateInvitations().find((i) => i.id === inv.id)?.status, "cancelled");
});

test("T34: Migration 030 never pairs UPDATE + RAISE EXCEPTION on expiry or pair-block paths", () => {
  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");

  // Ensure none of the expiry/block error codes that caused rollback remain
  assert.doesNotMatch(m030, /RAISE\s+EXCEPTION\s+'OFFER_EXPIRED/i);
  assert.doesNotMatch(m030, /RAISE\s+EXCEPTION\s+'INVITATION_EXPIRED/i);
  assert.doesNotMatch(m030, /RAISE\s+EXCEPTION\s+'PAIR_BLOCKED:\s*Cannot accept/i);

  // Verify expiry & block paths persist and return row cleanly
  assert.match(m030, /'Offer expired before response\.'\);\s*RETURN\s+v_offer;/i);
  assert.match(m030, /'Manual offer expired before response\.'\);\s*RETURN\s+v_offer;/i);
  assert.match(m030, /'Offer cancelled due to an active block between participants\.'\);\s*RETURN\s+v_offer;/i);
  assert.match(m030, /'Cancelled due to active block between participants\.'\);\s*RETURN\s+v_offer;/i);
});

test("T35: Migration 030 enforces canonical lock ordering and prevents duplicate bookings under concurrency", () => {
  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");

  // Unique partial indexes on booking_id
  assert.match(m030, /idx_auto_date_offers_unique_booking_id/i);
  assert.match(m030, /idx_manual_date_offers_unique_booking_id/i);

  // Pair invitation locks canonical pair + invitation row + recipients in deterministic user_id ASC order
  assert.match(m030, /IF\s+v_mode\s*=\s*'pair'\s+AND\s+v_partner_id\s+IS\s+NOT\s+NULL\s+THEN\s+PERFORM\s+public\.lock_matchmaking_pair\(v_uid,\s*v_partner_id\);/i);
  assert.match(m030, /FROM\s+public\.date_invitation_recipients\s+WHERE\s+invitation_id\s*=\s*p_invitation_id\s+ORDER\s+BY\s+user_id\s+ASC\s+FOR\s+UPDATE;/i);
  assert.match(m030, /AND\s+v_rec\.booking_id\s+IS\s+NULL\s+AND\s+v_partner_rec\.booking_id\s+IS\s+NULL/i);

  // Bookings created with confirmed live schema values: status 'upcoming', amount 0, payment_status 'pending'
  const bookingInserts = m030.match(/INSERT\s+INTO\s+public\.date_bookings[\s\S]*?RETURNING\s+id\s+INTO\s+v_booking_id;/gi) ?? [];
  assert.equal(bookingInserts.length, 3, "Expected exactly 3 booking insert paths (auto, manual, pair invitation)");
  for (const ins of bookingInserts) {
    assert.match(ins, /'upcoming',\s*0,\s*'pending'/i);
  }

  // All 3 booking-creation RPCs check for an existing active booking (pending/confirmed/upcoming) with FOR UPDATE after canonical pair lock
  const activeChecks =
    m030.match(/SELECT\s+b\.id\s+INTO\s+v_existing_booking_id\s+FROM\s+public\.date_bookings\s+b\s+WHERE\s+b\.status\s+IN\s+\('pending',\s*'confirmed',\s*'upcoming'\)[\s\S]*?FOR\s+UPDATE;/gi) ?? [];
  assert.equal(activeChecks.length, 3, "Expected active-booking duplicate check in all 3 booking-creation RPCs");
});

test("T36: Invitation input validation rejects null/invalid mode, invalid schedule, unknown FKs, and missing profiles", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const validFuture = futureDate(20);

  // Invalid mode
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Bad Mode",
          invitationMode: "invalid" as unknown as "individual",
          userIds: [users[0].id],
          date: validFuture,
          time: "19:00",
          venue: "Salon",
        },
        "admin-1",
      ),
    /INVALID_MODE/,
  );

  // Unknown profile
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Ghost Invitee",
          invitationMode: "individual",
          userIds: ["00000000-0000-0000-0000-000000000099"],
          date: validFuture,
          time: "19:00",
          venue: "Salon",
        },
        "admin-1",
      ),
    /PROFILE_NOT_FOUND/,
  );

  // Invalid calendar date (Feb 30)
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Bad Date",
          invitationMode: "individual",
          userIds: [users[0].id],
          date: "2027-02-30",
          time: "19:00",
          venue: "Salon",
        },
        "admin-1",
      ),
    /INVALID_SCHEDULE/,
  );

  // Unknown experience ID
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Bad Exp",
          invitationMode: "pair",
          userIds: [users[0].id, users[1].id],
          experienceId: "non-existent-exp",
          date: validFuture,
          time: "19:00",
          venue: "Salon",
        },
        "admin-1",
      ),
    /EXPERIENCE_NOT_FOUND/,
  );

  // Unknown cafe ID
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Bad Cafe",
          invitationMode: "pair",
          userIds: [users[0].id, users[1].id],
          experienceId: exp.id,
          cafeId: "non-existent-cafe",
          date: validFuture,
          time: "19:00",
          venue: "Salon",
        },
        "admin-1",
      ),
    /CAFE_NOT_FOUND/,
  );

  // SQL explicitly rejects NULL invitation_mode and checks profiles BEFORE inserting date_invitations
  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");
  assert.match(m030, /IF\s+p_invitation_mode\s+IS\s+NULL\s+OR\s+p_invitation_mode\s+NOT\s+IN\s+\('individual',\s*'group',\s*'pair'\)/i);
  const profileCheckIdx = m030.indexOf("FROM public.profiles\n  WHERE id = ANY(v_clean_ids)");
  const insertInvIdx = m030.indexOf("INSERT INTO public.date_invitations");
  assert.ok(profileCheckIdx > 0 && insertInvIdx > profileCheckIdx, "Profile validation must occur BEFORE INSERT INTO date_invitations");
});

test("T37: Non-admin cannot cancel manual offers or create/cancel invitations", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];

  const offer = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: futureDate(25),
      time: "19:00",
      venue: "Salon",
    },
    "admin-1",
  );
  assert.throws(() => mockDb.cancelManualDateOffer(offer.id, "Attempt", users[0].id), /PERMISSION_DENIED/);

  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Unauthorized Invite",
          invitationMode: "individual",
          userIds: [users[1].id],
          date: futureDate(25),
          time: "19:00",
          venue: "Salon",
        },
        users[0].id,
      ),
    /PERMISSION_DENIED/,
  );

  const inv = mockDb.createDateInvitation(
    {
      title: "Admin Invite",
      invitationMode: "individual",
      userIds: [users[0].id],
      date: futureDate(26),
      time: "19:00",
      venue: "Salon",
    },
    "admin-1",
  );
  assert.throws(() => mockDb.cancelDateInvitation(inv.id, users[0].id), /PERMISSION_DENIED/);
});

test("T38: Migration 030 enforces least-privilege grants, zero direct client DML, safe search_path, and valid actor_role", () => {
  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");

  const tables = [
    "public.auto_date_offer_batches",
    "public.automatic_date_offers",
    "public.manual_date_offers",
    "public.date_offer_events",
    "public.date_invitations",
    "public.date_invitation_recipients",
  ];
  for (const tbl of tables) {
    const esc = tbl.replace(".", "\\.");
    assert.match(m030, new RegExp(`REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+${esc}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated;`, "i"));
    assert.match(m030, new RegExp(`GRANT\\s+SELECT\\s+ON\\s+TABLE\\s+${esc}\\s+TO\\s+authenticated;`, "i"));
    assert.doesNotMatch(
      m030,
      new RegExp(`GRANT\\s+[^;]*(INSERT|UPDATE|DELETE|ALL)[^;]*ON\\s+TABLE\\s+${esc}\\s+TO\\s+[^;]*(anon|authenticated)`, "i"),
      `No direct client DML allowed on ${tbl}`,
    );
  }

  // Recipient privacy RLS policy
  assert.match(
    m030,
    /CREATE\s+POLICY\s+"date_invitation_recipients_own_or_admin_select"[\s\S]*?USING\s*\(user_id\s*=\s*auth\.uid\(\)\s+OR\s+public\.is_admin\(\)\)/i,
  );

  // Every SECURITY DEFINER function sets safe search_path (strip SQL comments first)
  const m030NoComments = m030.replace(/--.*$/gm, "");
  const secDefCount = (m030NoComments.match(/SECURITY\s+DEFINER/gi) ?? []).length;
  const safePathCount = (m030NoComments.match(/SECURITY\s+DEFINER\s*\n\s*SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/gi) ?? []).length;
  assert.ok(secDefCount >= 10, "Expected >= 10 SECURITY DEFINER functions in Migration 030");
  assert.equal(safePathCount, secDefCount, "Every SECURITY DEFINER function must set search_path = pg_catalog, public, pg_temp");

  // Privileged internal/trigger functions must not be executable by authenticated/anon/PUBLIC
  for (const fn of [
    "public.validate_date_offer_schedule(text, text)",
    "public.expire_stale_date_offers()",
    "public.is_eligible_mutual_match_row(uuid)",
    "public.pair_has_active_offer_or_booking(uuid, uuid)",
    "public.evaluate_initial_auto_date_offers(text)",
    "public.trg_check_auto_date_offer_threshold()",
  ]) {
    const esc = fn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(m030, new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+${esc}\\s+FROM\\s+PUBLIC,\\s*anon,\\s*authenticated;`, "i"));
  }

  // Notifications inserts always specify the confirmed live columns (user_id, kind, title, body, link, read)
  const notifInserts = m030.match(/INSERT\s+INTO\s+public\.notifications\s*\([^)]+\)/gi) ?? [];
  assert.ok(notifInserts.length >= 6);
  for (const ni of notifInserts) {
    assert.match(ni, /\(user_id,\s*kind,\s*title,\s*body,\s*link,\s*read\)/i);
  }

  // Activity logs only use confirmed valid actor_role values ('admin', 'system', 'user')
  assert.doesNotMatch(m030, /actor_role\s*=\s*'(member|concierge|moderator)'/i);

  // Never reference nonexistent profiles.active or profiles.status columns
  assert.doesNotMatch(m030NoComments, /\b(p|pa|profiles)\.(active|status)\b/i);
});

test("T39: Two simultaneous accepted offers or offer+pair-invitation for the same pair create strictly ONE active booking", () => {
  // Scenario A: Two manual offers on different dates for the same pair accepted concurrently
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const bookingsBefore = mockDb.allBookings().length;

  const offer1 = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: futureDate(6),
      time: "19:00",
      venue: "Rose Salon",
    },
    "admin-1",
  );
  const offer2 = mockDb.createManualDateOffer(
    {
      userAId: users[0].id,
      userBId: users[1].id,
      experienceId: exp.id,
      date: futureDate(8),
      time: "20:00",
      venue: "Champagne Conservatory",
    },
    "admin-1",
  );

  // Partner A accepts both offers before any booking exists
  mockDb.respondToManualDateOffer(offer1.id, users[0].id, true);
  mockDb.respondToManualDateOffer(offer2.id, users[0].id, true);

  // Partner B accepts both offers back-to-back / simultaneously
  const res1 = mockDb.respondToManualDateOffer(offer1.id, users[1].id, true);
  const res2 = mockDb.respondToManualDateOffer(offer2.id, users[1].id, true);

  assert.equal(res1.status, "accepted");
  assert.ok(res1.bookingId);
  assert.equal(res2.status, "cancelled", "Second simultaneous offer must be cancelled when an active booking already exists");
  assert.equal(res2.bookingId, null);
  assert.equal(mockDb.allBookings().length, bookingsBefore + 1, "Strictly ONE active booking must be created for the pair");
  assert.ok(mockDb.listDateOfferEvents(offer2.id).some((e) => e.eventType === "cancelled_active_booking_exists"));

  // Scenario B: Paired invitation accepted when pair ALREADY has an active booking -> cancelled, no 2nd booking
  const pairInv = mockDb.createDateInvitation(
    {
      title: "Second Evening Invite",
      invitationMode: "pair",
      userIds: [users[0].id, users[1].id],
      experienceId: exp.id,
      date: futureDate(11),
      time: "19:30",
      venue: "Velvet Courtyard",
    },
    "admin-1",
  );
  mockDb.respondToDateInvitation(pairInv.id, users[0].id, true);
  const invRes2 = mockDb.respondToDateInvitation(pairInv.id, users[1].id, true);
  assert.equal(invRes2.response, "declined");
  assert.equal(invRes2.bookingId, null);
  assert.equal(mockDb.listDateInvitations().find((i) => i.id === pairInv.id)?.status, "cancelled");
  assert.equal(mockDb.allBookings().length, bookingsBefore + 1, "Paired invitation must not create a second active booking");

  // Scenario C: Automatic offer accepted when pair already has an active booking (pending/confirmed/upcoming) -> cancelled
  seedEligibleMatches(100);
  mockDb.evaluateInitialAutoDateOffers();
  const autoOffer = mockDb.listAutomaticDateOffers()[0];
  const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
  raw.bookings.push({
    id: "bk-confirmed-existing",
    userId: autoOffer.userA,
    partnerId: autoOffer.userB,
    experienceId: autoOffer.experienceId,
    venue: "Existing Confirmed Booking",
    date: futureDate(9),
    time: "20:00",
    status: "confirmed",
    paymentStatus: "pending",
    amount: 0,
    createdAt: new Date().toISOString(),
  });
  mockDb.resetDemo();
  localStorage.setItem("datevra-db-v1", JSON.stringify(raw));

  const autoBookingsBefore = mockDb.allBookings().length;
  mockDb.respondToAutomaticDateOffer(autoOffer.id, autoOffer.userA, true);
  const autoRes2 = mockDb.respondToAutomaticDateOffer(autoOffer.id, autoOffer.userB, true);
  assert.equal(autoRes2.status, "cancelled");
  assert.equal(autoRes2.bookingId, null);
  assert.equal(mockDb.allBookings().length, autoBookingsBefore);
  assert.ok(mockDb.listDateOfferEvents(autoOffer.id).some((e) => e.eventType === "cancelled_active_booking_exists"));
});

test("T40: Duplicate active pair invitations on the same date are rejected and allowed once expired", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const d = futureDate(14);

  const first = mockDb.createDateInvitation(
    {
      title: "First Paired Salon",
      invitationMode: "pair",
      userIds: [users[0].id, users[1].id],
      experienceId: exp.id,
      date: d,
      time: "19:30",
      venue: "Ivory Room",
    },
    "admin-1",
  );

  // Reversed user order on same date must still be rejected as duplicate
  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Duplicate Paired Salon",
          invitationMode: "pair",
          userIds: [users[1].id, users[0].id],
          experienceId: exp.id,
          date: d,
          time: "20:00",
          venue: "Ivory Room",
        },
        "admin-1",
      ),
    /DUPLICATE_ACTIVE_INVITATION/,
  );

  // Expire first invitation -> replacement on same date must succeed
  const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
  const invRow = raw.dateInvitations.find((i: { id: string }) => i.id === first.id);
  invRow.expiresAt = new Date(Date.now() - 60_000).toISOString();
  mockDb.resetDemo();
  localStorage.setItem("datevra-db-v1", JSON.stringify(raw));

  const replacement = mockDb.createDateInvitation(
    {
      title: "Replacement Paired Salon",
      invitationMode: "pair",
      userIds: [users[0].id, users[1].id],
      experienceId: exp.id,
      date: d,
      time: "20:30",
      venue: "Ivory Room",
    },
    "admin-1",
  );
  assert.equal(replacement.status, "active");
  assert.notEqual(replacement.id, first.id);
  assert.equal(mockDb.listDateInvitations().find((i) => i.id === first.id)?.status, "expired");
});

test("T41: Past dates and past times on the current date are rejected in both mockDb and Migration 030 SQL", () => {
  mockDb.resetDemo();
  const users = mockDb.allUsers().filter((u) => !u.isAdmin);
  const exp = mockDb.listExperiences()[0];
  const yesterdayUtc = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

  // Past date rejected on manual offer and invitation
  assert.throws(
    () =>
      mockDb.createManualDateOffer(
        {
          userAId: users[0].id,
          userBId: users[1].id,
          experienceId: exp.id,
          date: yesterdayUtc,
          time: "19:30",
          venue: "Past Venue",
        },
        "admin-1",
      ),
    /INVALID_SCHEDULE/,
  );

  assert.throws(
    () =>
      mockDb.createDateInvitation(
        {
          title: "Past Invitation",
          invitationMode: "individual",
          userIds: [users[0].id],
          date: yesterdayUtc,
          time: "19:30",
          venue: "Past Venue",
        },
        "admin-1",
      ),
    /INVALID_SCHEDULE/,
  );

  // Past time on today's UTC date rejected (pick 00:00 unless we are literally at 00:00:00 UTC)
  const now = new Date();
  const todayUtc = now.toISOString().slice(0, 10);
  if (now.getUTCHours() > 0 || now.getUTCMinutes() > 0) {
    assert.throws(
      () =>
        mockDb.createManualDateOffer(
          {
            userAId: users[0].id,
            userBId: users[1].id,
            experienceId: exp.id,
            date: todayUtc,
            time: "00:00",
            venue: "Earlier Today Venue",
          },
          "admin-1",
        ),
      /INVALID_SCHEDULE/,
    );
  }

  // SQL validate_date_offer_schedule enforces both past date and past time on today's UTC date
  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");
  assert.match(m030, /IF\s+v_parsed\s*<\s*v_now_utc::date\s+THEN/i);
  assert.match(m030, /IF\s+v_parsed\s*=\s*v_now_utc::date\s+AND\s+v_time_val\s*<=\s*v_now_utc::time\s+THEN/i);
});

test("T42: Automatic batch iterates without premature LIMIT and locks pairs so avoidable conflicts never short-change 10 offers", () => {
  const m030 = read("db/migrations/030_date_offers_and_invitations.sql");
  const batchFn = m030.slice(
    m030.indexOf("CREATE OR REPLACE FUNCTION public.evaluate_initial_auto_date_offers"),
    m030.indexOf("CREATE OR REPLACE FUNCTION public.admin_evaluate_initial_auto_date_offers"),
  );
  assert.doesNotMatch(batchFn, /LIMIT\s+v_remaining_quota/i, "Candidate loop must not prematurely LIMIT before conflict handling");
  assert.match(batchFn, /SELECT\s+DISTINCT\s+ON\s*\(LEAST\(m\.user_a,\s*m\.user_b\),\s*GREATEST\(m\.user_a,\s*m\.user_b\)\)/i);
  assert.match(batchFn, /PERFORM\s+public\.lock_matchmaking_pair\(v_match\.ua,\s*v_match\.ub\);/i);
  assert.match(batchFn, /EXIT\s+WHEN\s+v_created_count\s*>=\s*v_target_offers;/i);

  // Runtime: batch with only 3 available pairs out of 100 eligible matches creates 3 offers & records shortfall 7
  seedEligibleMatches(100, 97);
  const res = mockDb.evaluateInitialAutoDateOffers();
  assert.equal(res.triggered, true);
  assert.equal(res.created_offers, 3);
  assert.equal(res.shortfall, 7);
});


