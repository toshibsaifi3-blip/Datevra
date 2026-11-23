/**
 * DATEVRA — Post-Hardening Booking Workflows & Security Boundary Test Suite
 *
 * Verifies:
 *   1. Zero direct client INSERT/UPDATE/DELETE against public.date_bookings
 *   2. Member booking workflows (applications, automatic offers, manual offers, paired invitations)
 *   3. Admin booking creation & status transitions (complete, cancel, notifications, terminal guard)
 *   4. Duplicate active booking prevention across all 4 booking-creation paths (normal & reversed pair order)
 *   5. Consistent dual-recipient updates on ALL paired invitation cancellation paths
 *   6. Permission boundaries, canonical lock_matchmaking_pair() ordering, and SQL grant hardening
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Provide in-memory localStorage for mockDb in Node test runtime
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

import * as mockDb from "./src/lib/mockDb";
import { mapBooking } from "./src/lib/supabase/mappers";

const ROOT = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

function futureDate(daysAhead: number): string {
  const d = new Date(Date.now() + daysAhead * 86400000);
  return d.toISOString().slice(0, 10);
}

function resetState() {
  memStorage.clear();
  mockDb.resetDemo();
}

function getMembers() {
  return mockDb.allUsers().filter((u) => !u.isAdmin && u.id !== "admin-1");
}

function getExperienceId(): string {
  const exps = mockDb.listExperiences();
  assert.ok(exps.length > 0, "Expected seeded experiences");
  return exps[0].id;
}

function getCafeId(): string | null {
  const cafes = mockDb.listCafes();
  return cafes[0]?.id ?? null;
}

/* ============================================================================
 * 1. STATIC SECURITY AUDIT — ZERO DIRECT CLIENT WRITES TO public.date_bookings
 * ============================================================================ */

test("B1: Zero direct client INSERT/UPDATE/UPSERT/DELETE against date_bookings in src/ and supabase/", () => {
  const roots = [path.join(ROOT, "src"), path.join(ROOT, "supabase")];
  const files: string[] = [];

  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) files.push(full);
    }
  };
  roots.forEach(walk);

  const directWriteRegex = /\.from\(\s*["']date_bookings["']\s*\)\s*\.(?:insert|update|upsert|delete)\s*\(/g;
  const offenders: string[] = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (directWriteRegex.test(src)) {
      offenders.push(path.relative(ROOT, file));
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Found forbidden direct client writes to public.date_bookings: ${offenders.join(", ")}`,
  );

  // Confirm Supabase adapter routes createBooking & setBookingStatus through hardened RPCs
  const sbDb = read("src/lib/supabase/db.ts");
  assert.match(sbDb, /sb\(\)\.rpc\(\s*["']admin_create_booking["']/);
  assert.match(sbDb, /sb\(\)\.rpc\(\s*["']admin_set_booking_status["']/);

  // Confirm neither RPC call sends client-supplied actor_id / is_admin
  const createBlock = sbDb.slice(
    sbDb.indexOf("async function createBooking("),
    sbDb.indexOf("async function setBookingStatus("),
  );
  const statusBlock = sbDb.slice(
    sbDb.indexOf("async function setBookingStatus("),
    sbDb.indexOf("/* ---------------- cafes ---------------- */"),
  );
  assert.doesNotMatch(createBlock, /p_actor_id|actor_id|is_admin|logActivity\(/);
  assert.doesNotMatch(statusBlock, /p_actor_id|actor_id|is_admin|logActivity\(/);
});

test("B2: Migration 035 preserves SELECT-only date_bookings grant, enforces server-side auth & canonical locks, and fixes paired invitation cancel", () => {
  const m035 = read("db/migrations/035_booking_rpc_hardening.sql");

  // 1. Does NOT weaken date_bookings privileges
  assert.match(m035, /REVOKE\s+ALL\s+ON\s+TABLE\s+public\.date_bookings\s+FROM\s+PUBLIC,\s*anon,\s*authenticated;/i);
  assert.match(m035, /GRANT\s+SELECT\s+ON\s+TABLE\s+public\.date_bookings\s+TO\s+authenticated;/i);
  assert.match(m035, /GRANT\s+ALL\s+ON\s+TABLE\s+public\.date_bookings\s+TO\s+postgres,\s*service_role;/i);
  assert.doesNotMatch(
    m035,
    /GRANT\s+[^;]*(?:INSERT|UPDATE|DELETE|ALL)[^;]*ON\s+TABLE\s+public\.date_bookings\s+TO\s+(?:authenticated|anon|PUBLIC)/i,
  );
  assert.doesNotMatch(m035, /DROP\s+POLICY\s+.*ON\s+public\.date_bookings/i);

  // 2. All 4 RPCs use SECURITY DEFINER, safe search_path, server-side auth.uid(), and least-privilege grants
  const requiredFns = [
    "admin_create_booking",
    "admin_set_booking_status",
    "admin_cancel_date_invitation",
    "respond_to_date_invitation",
  ];
  for (const fn of requiredFns) {
    assert.match(m035, new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+public\\.${fn}\\s*\\(`, "i"));
    assert.match(m035, new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\([^)]*\\)\\s+FROM\\s+PUBLIC,\\s*anon;`, "i"));
    assert.match(m035, new RegExp(`GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${fn}\\([^)]*\\)\\s+TO\\s+authenticated;`, "i"));
  }

  // Every function pins search_path = pg_catalog, public, pg_temp
  const searchPaths = m035.match(/SET\s+search_path\s*=\s*pg_catalog,\s*public,\s*pg_temp/gi) ?? [];
  assert.equal(searchPaths.length, 4, "All 4 RPCs in Migration 035 must pin search_path = pg_catalog, public, pg_temp");

  // 3. Admin RPCs verify auth.uid() and public.is_admin() server-side
  const adminCreateBody = m035.slice(
    m035.indexOf("FUNCTION public.admin_create_booking"),
    m035.indexOf("FUNCTION public.admin_set_booking_status"),
  );
  const adminStatusBody = m035.slice(
    m035.indexOf("FUNCTION public.admin_set_booking_status"),
    m035.indexOf("FUNCTION public.admin_cancel_date_invitation"),
  );
  assert.match(adminCreateBody, /auth\.uid\(\)/);
  assert.match(adminCreateBody, /public\.is_admin\(\)/);
  assert.match(adminCreateBody, /PERFORM\s+public\.lock_matchmaking_pair\(v_a,\s*v_b\);/i);
  assert.match(adminCreateBody, /status\s+IN\s+\('pending',\s*'confirmed',\s*'upcoming'\)[\s\S]*?FOR\s+UPDATE;/i);
  assert.match(adminCreateBody, /ACTIVE_BOOKING_EXISTS/);
  assert.match(adminCreateBody, /INSERT\s+INTO\s+public\.activity_logs/i);

  assert.match(adminStatusBody, /auth\.uid\(\)/);
  assert.match(adminStatusBody, /public\.is_admin\(\)/);
  assert.match(adminStatusBody, /PERFORM\s+public\.lock_matchmaking_pair\(v_user_id,\s*v_partner_id\);/i);
  assert.match(adminStatusBody, /INVALID_STATUS_TRANSITION/);
  assert.match(adminStatusBody, /IF\s+v_status\s*=\s*'cancelled'\s+THEN[\s\S]*?INSERT\s+INTO\s+public\.notifications/i);

  // 4. Paired invitation cancellation updates BOTH recipients (no WHERE id = v_rec.id or AND response = 'pending' on pair cancels)
  const adminCancelInvBody = m035.slice(
    m035.indexOf("FUNCTION public.admin_cancel_date_invitation"),
    m035.indexOf("FUNCTION public.respond_to_date_invitation"),
  );
  assert.match(adminCancelInvBody, /PERFORM\s+public\.lock_matchmaking_pair\(v_pair_a,\s*v_pair_b\);/i);
  assert.match(
    adminCancelInvBody,
    /IF\s+v_inv\.invitation_mode\s*=\s*'pair'\s+THEN[\s\S]*?UPDATE\s+public\.date_invitation_recipients[\s\S]*?SET\s+response\s*=\s*'declined',\s*booking_id\s*=\s*NULL[\s\S]*?WHERE\s+invitation_id\s*=\s*v_inv\.id;/i,
  );

  const respondInvBody = m035.slice(m035.indexOf("FUNCTION public.respond_to_date_invitation"));
  // All 3 paired cancellation branches (blocked, partner decline, active booking exists) update WHERE invitation_id = v_inv.id
  const dualRecipientCancels =
    respondInvBody.match(
      /UPDATE\s+public\.date_invitation_recipients\s+SET\s+response\s*=\s*'declined',\s*booking_id\s*=\s*NULL,\s*responded_at\s*=\s*COALESCE\(responded_at,\s*now\(\)\),\s*updated_at\s*=\s*now\(\)\s+WHERE\s+invitation_id\s*=\s*v_inv\.id;/gi,
    ) ?? [];
  assert.equal(
    dualRecipientCancels.length,
    3,
    "All 3 paired invitation cancellation paths in respond_to_date_invitation must update BOTH recipients",
  );
  assert.doesNotMatch(respondInvBody, /SET\s+response\s*=\s*'declined'[\s\S]{0,120}WHERE\s+id\s*=\s*v_rec\.id/i);

  // 5. Never references nonexistent profiles.active or profiles.status
  assert.doesNotMatch(m035, /\bprofiles\b[^;]*\b(?:active|status)\b/i);
  assert.doesNotMatch(m035, /\b(?:p|pa|pb)\.(?:active|status)\b/i);
});

/* ============================================================================
 * 2. ADMIN BOOKING CREATION, STATUS LIFECYCLE & MAPPER PARITY
 * ============================================================================ */

test("B3: Admin creates booking from member application, notifies both participants, and transitions status cleanly", () => {
  resetState();
  const members = getMembers();
  const [u1, u2] = members;
  const expId = getExperienceId();
  const cafeId = getCafeId();
  const d1 = futureDate(6);

  // Member submits experience application (no direct write to date_bookings)
  const app = mockDb.applyForExperience({
    userId: u1.id,
    experienceId: expId,
    slotDate: d1,
    slotTime: "19:30",
    note: "[Venue: Café Hot Stag] · [Experience: Premium Date]",
  });
  assert.equal(app.status, "submitted");

  const notifBefore1 = mockDb.notificationsFor(u1.id).length;
  const notifBefore2 = mockDb.notificationsFor(u2.id).length;

  // Admin confirms booking via createBooking (backed by admin_create_booking RPC on Supabase)
  const booking = mockDb.createBooking(
    {
      userId: u1.id,
      partnerId: u2.id,
      experienceId: expId,
      cafeId,
      date: d1,
      time: "19:30",
      venue: "Café Hot Stag, Delhi",
      status: "upcoming",
      amount: 3500,
      paymentStatus: "pending",
    },
    "admin-1",
  );

  assert.ok(booking.id);
  assert.equal(booking.status, "upcoming");
  assert.equal(booking.amount, 3500);
  assert.equal(booking.paymentStatus, "pending");

  // Both participants see the booking via bookingsFor (SELECT-only) and got confirmation notifications
  assert.ok(mockDb.bookingsFor(u1.id).some((b) => b.id === booking.id));
  assert.ok(mockDb.bookingsFor(u2.id).some((b) => b.id === booking.id));
  assert.equal(mockDb.notificationsFor(u1.id).length, notifBefore1 + 1);
  assert.equal(mockDb.notificationsFor(u2.id).length, notifBefore2 + 1);

  // Admin cancels booking -> both participants receive cancellation notification
  mockDb.setBookingStatus(booking.id, "cancelled", "admin-1");
  const updated = mockDb.allBookings().find((b) => b.id === booking.id)!;
  assert.equal(updated.status, "cancelled");
  assert.equal(mockDb.notificationsFor(u1.id).length, notifBefore1 + 2);
  assert.equal(mockDb.notificationsFor(u2.id).length, notifBefore2 + 2);
  assert.ok(mockDb.notificationsFor(u1.id).some((n) => n.title === "Booking cancelled"));
  assert.ok(mockDb.notificationsFor(u2.id).some((n) => n.title === "Booking cancelled"));

  // Terminal booking cannot be reopened to active status
  assert.throws(
    () => mockDb.setBookingStatus(booking.id, "upcoming", "admin-1"),
    /INVALID_STATUS_TRANSITION/,
  );

  // Once cancelled, the pair CAN have a fresh booking created and completed
  const booking2 = mockDb.createBooking(
    {
      userId: u2.id,
      partnerId: u1.id,
      experienceId: expId,
      cafeId,
      date: futureDate(8),
      time: "20:00",
      venue: "Karma La Cafe, Delhi",
      status: "upcoming",
      amount: 4500,
      paymentStatus: "paid",
    },
    "admin-1",
  );
  mockDb.setBookingStatus(booking2.id, "completed", "admin-1");
  assert.equal(mockDb.allBookings().find((b) => b.id === booking2.id)?.status, "completed");
  assert.throws(
    () => mockDb.setBookingStatus(booking2.id, "upcoming", "admin-1"),
    /INVALID_STATUS_TRANSITION/,
  );
});

test("B4: mapBooking normalizes live database status and payment_status values cleanly", () => {
  const mappedConfirmedVerified = mapBooking({
    id: "bk-1",
    user_id: "u1",
    partner_id: "u2",
    experience_id: "e1",
    cafe_id: "c1",
    date: futureDate(5),
    time: "19:00",
    venue: "Venue",
    status: "confirmed",
    amount: 3200,
    payment_status: "verified",
    created_at: new Date().toISOString(),
  });
  assert.equal(mappedConfirmedVerified.status, "upcoming");
  assert.equal(mappedConfirmedVerified.paymentStatus, "paid");

  const mappedRefunded = mapBooking({
    id: "bk-2",
    user_id: "u1",
    partner_id: "u2",
    experience_id: "e1",
    cafe_id: null,
    date: futureDate(5),
    time: "19:00",
    venue: "Venue",
    status: "cancelled",
    amount: 0,
    payment_status: "refunded",
    created_at: new Date().toISOString(),
  });
  assert.equal(mappedRefunded.status, "cancelled");
  assert.equal(mappedRefunded.paymentStatus, "refunded");
});

/* ============================================================================
 * 3. PERMISSION BOUNDARIES & INPUT VALIDATION
 * ============================================================================ */

test("B5: Permission boundaries reject non-admin members from admin booking creation, status updates, and invitation cancellation", () => {
  resetState();
  const [u1, u2, u3] = getMembers();
  const expId = getExperienceId();
  const d1 = futureDate(5);

  // Non-admin member cannot call createBooking
  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u1.id,
          partnerId: u2.id,
          experienceId: expId,
          cafeId: null,
          date: d1,
          time: "19:00",
          venue: "Test Venue",
          status: "upcoming",
          amount: 1000,
          paymentStatus: "pending",
        },
        u1.id,
      ),
    /PERMISSION_DENIED/,
  );

  // Empty actorId rejected
  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u1.id,
          partnerId: u2.id,
          experienceId: expId,
          cafeId: null,
          date: d1,
          time: "19:00",
          venue: "Test Venue",
          status: "upcoming",
          amount: 1000,
          paymentStatus: "pending",
        },
        "",
      ),
    /PERMISSION_DENIED/,
  );

  // Admin creates booking legitimately
  const bk = mockDb.createBooking(
    {
      userId: u1.id,
      partnerId: u2.id,
      experienceId: expId,
      cafeId: null,
      date: d1,
      time: "19:00",
      venue: "Test Venue",
      status: "upcoming",
      amount: 1000,
      paymentStatus: "pending",
    },
    "admin-1",
  );

  // Neither participant nor unrelated member can mutate booking status
  assert.throws(() => mockDb.setBookingStatus(bk.id, "cancelled", u1.id), /PERMISSION_DENIED/);
  assert.throws(() => mockDb.setBookingStatus(bk.id, "completed", u2.id), /PERMISSION_DENIED/);
  assert.throws(() => mockDb.setBookingStatus(bk.id, "cancelled", u3.id), /PERMISSION_DENIED/);

  // Blocked pair cannot receive an admin booking
  mockDb.blockUser(u2.id, u3.id);
  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u2.id,
          partnerId: u3.id,
          experienceId: expId,
          cafeId: null,
          date: d1,
          time: "19:00",
          venue: "Test Venue",
          status: "upcoming",
          amount: 1000,
          paymentStatus: "pending",
        },
        "admin-1",
      ),
    /PAIR_BLOCKED/,
  );

  // Self-pair, negative amount, past date rejected
  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u1.id,
          partnerId: u1.id,
          experienceId: expId,
          cafeId: null,
          date: d1,
          time: "19:00",
          venue: "Test Venue",
          status: "upcoming",
          amount: 0,
          paymentStatus: "pending",
        },
        "admin-1",
      ),
    /INVALID_PAIR/,
  );

  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u1.id,
          partnerId: u3.id,
          experienceId: expId,
          cafeId: null,
          date: "2020-01-01",
          time: "19:00",
          venue: "Test Venue",
          status: "upcoming",
          amount: 0,
          paymentStatus: "pending",
        },
        "admin-1",
      ),
    /INVALID_SCHEDULE/,
  );

  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u1.id,
          partnerId: u3.id,
          experienceId: expId,
          cafeId: null,
          date: d1,
          time: "19:00",
          venue: "Test Venue",
          status: "upcoming",
          amount: -100,
          paymentStatus: "pending",
        },
        "admin-1",
      ),
    /INVALID_AMOUNT/,
  );
});

/* ============================================================================
 * 4. DUPLICATE ACTIVE BOOKING PREVENTION ACROSS ALL 4 CREATION PATHS
 * ============================================================================ */

test("B6: Duplicate active booking prevention holds across admin booking, manual offer, automatic offer, and paired invitation (both pair orders)", () => {
  resetState();
  const [u1, u2, u3, u4] = getMembers();
  const expId = getExperienceId();
  const d1 = futureDate(7);
  const d2 = futureDate(9);

  // Path 1: Admin creates an active booking for (u1, u2)
  const b1 = mockDb.createBooking(
    {
      userId: u1.id,
      partnerId: u2.id,
      experienceId: expId,
      cafeId: null,
      date: d1,
      time: "19:00",
      venue: "Salon One",
      status: "upcoming",
      amount: 3000,
      paymentStatus: "pending",
    },
    "admin-1",
  );
  assert.ok(b1.id);

  // Second admin booking for SAME pair in REVERSED order (u2, u1) MUST be rejected
  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u2.id,
          partnerId: u1.id,
          experienceId: expId,
          cafeId: null,
          date: d2,
          time: "20:00",
          venue: "Salon Two",
          status: "upcoming",
          amount: 3000,
          paymentStatus: "pending",
        },
        "admin-1",
      ),
    /ACTIVE_BOOKING_EXISTS/,
  );

  // Path 2: Manual offer dual-accept for (u1, u2) must NOT create a second active booking; cancels offer cleanly
  const manualOffer = mockDb.createManualDateOffer(
    {
      userAId: u1.id,
      userBId: u2.id,
      experienceId: expId,
      date: d2,
      time: "20:00",
      venue: "Manual Lounge",
    },
    "admin-1",
  );
  mockDb.respondToManualDateOffer(manualOffer.id, u1.id, true);
  const manualRes2 = mockDb.respondToManualDateOffer(manualOffer.id, u2.id, true);
  assert.equal(manualRes2.status, "cancelled");
  assert.equal(manualRes2.bookingId, null);

  // Path 3: Paired invitation dual-accept for (u1, u2) must NOT create a second active booking AND updates BOTH recipients
  const pairInv = mockDb.createDateInvitation(
    {
      title: "Private Wine Evening",
      invitationMode: "pair",
      userIds: [u1.id, u2.id],
      experienceId: expId,
      date: d2,
      time: "20:30",
      venue: "Bordeaux Cellar",
    },
    "admin-1",
  );
  mockDb.respondToDateInvitation(pairInv.id, u1.id, true);
  const invRes2 = mockDb.respondToDateInvitation(pairInv.id, u2.id, true);
  assert.equal(invRes2.response, "declined");
  assert.equal(invRes2.bookingId, null);
  const persistedPairInv = mockDb.listDateInvitations().find((i) => i.id === pairInv.id)!;
  assert.equal(persistedPairInv.status, "cancelled");
  assert.ok(
    persistedPairInv.recipients.every((r) => r.response === "declined" && r.bookingId === null),
    "BOTH recipients must be consistently updated to declined with null bookingId when paired invitation cancels on active booking",
  );

  // Strictly ONE active booking exists for (u1, u2)
  const pairBookings = mockDb
    .allBookings()
    .filter(
      (b) =>
        b.status === "upcoming" &&
        ((b.userId === u1.id && b.partnerId === u2.id) || (b.userId === u2.id && b.partnerId === u1.id)),
    );
  assert.equal(pairBookings.length, 1);

  // Path 4: Automatic date offer dual-accept when a 'pending' booking already exists for (u3, u4)
  {
    const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
    const [ca, cb] = u3.id < u4.id ? [u3.id, u4.id] : [u4.id, u3.id];
    raw.bookings.push({
      id: "bk-pending-live-state",
      userId: ca,
      partnerId: cb,
      experienceId: expId,
      cafeId: null,
      date: d1,
      time: "18:00",
      venue: "Pending Venue",
      status: "pending",
      amount: 0,
      paymentStatus: "pending",
      createdAt: new Date().toISOString(),
    });
    raw.automaticDateOffers.push({
      id: "ado-conflict-check",
      batchId: "batch-1",
      matchId: "m-auto-conflict",
      userA: ca,
      userB: cb,
      experienceId: expId,
      cafeId: null,
      suggestedDate: d2,
      suggestedTime: "19:30",
      venue: "Auto Venue",
      message: null,
      status: "pending",
      userAResponse: true,
      userBResponse: null,
      userARespondedAt: new Date().toISOString(),
      userBRespondedAt: null,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      bookingId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockDb.resetDemo();
    localStorage.setItem("datevra-db-v1", JSON.stringify(raw));
  }
  const autoRes = mockDb.respondToAutomaticDateOffer("ado-conflict-check", u3.id < u4.id ? u4.id : u3.id, true);
  assert.equal(autoRes.status, "cancelled");
  assert.equal(autoRes.bookingId, null);

  // Admin booking against existing 'pending' status booking must ALSO be rejected
  assert.throws(
    () =>
      mockDb.createBooking(
        {
          userId: u3.id,
          partnerId: u4.id,
          experienceId: expId,
          cafeId: null,
          date: d2,
          time: "21:00",
          venue: "Another Venue",
          status: "upcoming",
          amount: 1500,
          paymentStatus: "pending",
        },
        "admin-1",
      ),
    /ACTIVE_BOOKING_EXISTS/,
  );
});

/* ============================================================================
 * 5. PAIRED INVITATION CANCELLATION — CONSISTENT BOTH-RECIPIENT UPDATES
 * ============================================================================ */

test("B7: Paired invitation cancellation updates BOTH recipients consistently across admin cancel, block, and partner decline", () => {
  resetState();
  const [u1, u2, u3, u4, u5, u6] = getMembers();
  const expId = getExperienceId();
  const d1 = futureDate(5);

  // Case A: Admin cancels paired invitation AFTER u1 already accepted
  const invAdminCancel = mockDb.createDateInvitation(
    {
      title: "Admin Cancel Pair",
      invitationMode: "pair",
      userIds: [u1.id, u2.id],
      experienceId: expId,
      date: d1,
      time: "19:00",
      venue: "Courtyard A",
    },
    "admin-1",
  );
  mockDb.respondToDateInvitation(invAdminCancel.id, u1.id, true);
  const cancelledByAdmin = mockDb.cancelDateInvitation(invAdminCancel.id, "admin-1");
  assert.equal(cancelledByAdmin.status, "cancelled");
  assert.equal(cancelledByAdmin.recipients.length, 2);
  assert.ok(
    cancelledByAdmin.recipients.every((r) => r.response === "declined" && r.bookingId === null && r.respondedAt !== null),
    "Admin cancelling a paired invitation must update BOTH recipients consistently (including one who already accepted)",
  );

  // Case B: Partner declines paired invitation AFTER u3 already accepted
  const invPartnerDecline = mockDb.createDateInvitation(
    {
      title: "Partner Decline Pair",
      invitationMode: "pair",
      userIds: [u3.id, u4.id],
      experienceId: expId,
      date: d1,
      time: "19:30",
      venue: "Courtyard B",
    },
    "admin-1",
  );
  mockDb.respondToDateInvitation(invPartnerDecline.id, u3.id, true);
  const declRec = mockDb.respondToDateInvitation(invPartnerDecline.id, u4.id, false);
  assert.equal(declRec.response, "declined");
  assert.equal(declRec.bookingId, null);
  const afterDecline = mockDb.listDateInvitations().find((i) => i.id === invPartnerDecline.id)!;
  assert.equal(afterDecline.status, "cancelled");
  assert.ok(
    afterDecline.recipients.every((r) => r.response === "declined" && r.bookingId === null),
    "Declining a paired invitation must cancel it and update BOTH recipients consistently",
  );

  // Case C: Block occurs AFTER u5 accepted, then u6 tries to accept
  const invBlocked = mockDb.createDateInvitation(
    {
      title: "Blocked Pair Invite",
      invitationMode: "pair",
      userIds: [u5.id, u6.id],
      experienceId: expId,
      date: d1,
      time: "20:00",
      venue: "Courtyard C",
    },
    "admin-1",
  );
  mockDb.respondToDateInvitation(invBlocked.id, u5.id, true);
  mockDb.blockUser(u5.id, u6.id);
  const blockRec = mockDb.respondToDateInvitation(invBlocked.id, u6.id, true);
  assert.equal(blockRec.response, "declined");
  assert.equal(blockRec.bookingId, null);
  const afterBlock = mockDb.listDateInvitations().find((i) => i.id === invBlocked.id)!;
  assert.equal(afterBlock.status, "cancelled");
  assert.ok(
    afterBlock.recipients.every((r) => r.response === "declined" && r.bookingId === null),
    "Blocked pair cancellation must update BOTH recipients consistently (including prior acceptor)",
  );

  // Case D: Group invitation decline by one member does NOT cancel invitation for other members
  const invGroup = mockDb.createDateInvitation(
    {
      title: "Evening Mixer",
      invitationMode: "group",
      userIds: [u1.id, u2.id, u3.id],
      experienceId: null,
      date: futureDate(10),
      time: "18:30",
      venue: "Rooftop Salon",
    },
    "admin-1",
  );
  mockDb.respondToDateInvitation(invGroup.id, u1.id, false);
  const grpAccept = mockDb.respondToDateInvitation(invGroup.id, u2.id, true);
  assert.equal(grpAccept.response, "accepted");
  assert.equal(grpAccept.bookingId, null);
  const afterGroup = mockDb.listDateInvitations().find((i) => i.id === invGroup.id)!;
  assert.equal(afterGroup.status, "active");
});

/* ============================================================================
 * 6. MEMBER AUTOMATIC & MANUAL OFFERS + PAIRED INVITATION HAPPY PATHS
 * ============================================================================ */

test("B8: Automatic offer, manual offer, and paired invitation dual-acceptance each create strictly one booking", () => {
  resetState();
  const [u1, u2, u3, u4, u5, u6] = getMembers();
  const expId = getExperienceId();
  const d1 = futureDate(6);

  // 1. Manual offer dual accept -> 1 booking
  const manual = mockDb.createManualDateOffer(
    {
      userAId: u1.id,
      userBId: u2.id,
      experienceId: expId,
      date: d1,
      time: "19:00",
      venue: "Manual Bistro",
    },
    "admin-1",
  );
  const m1 = mockDb.respondToManualDateOffer(manual.id, u1.id, true);
  assert.equal(m1.status, "pending");
  assert.equal(m1.bookingId, null);
  const m2 = mockDb.respondToManualDateOffer(manual.id, u2.id, true);
  assert.equal(m2.status, "accepted");
  assert.ok(m2.bookingId);

  // 2. Paired invitation dual accept -> 1 booking shared on both recipients
  const pairInv = mockDb.createDateInvitation(
    {
      title: "Curated Pair Dinner",
      invitationMode: "pair",
      userIds: [u3.id, u4.id],
      experienceId: expId,
      date: d1,
      time: "19:30",
      venue: "Pair Terrace",
    },
    "admin-1",
  );
  const p1 = mockDb.respondToDateInvitation(pairInv.id, u3.id, true);
  assert.equal(p1.response, "accepted");
  assert.equal(p1.bookingId, null);
  const p2 = mockDb.respondToDateInvitation(pairInv.id, u4.id, true);
  assert.equal(p2.response, "accepted");
  assert.ok(p2.bookingId);
  const completedInv = mockDb.listDateInvitations().find((i) => i.id === pairInv.id)!;
  assert.equal(completedInv.status, "completed");
  assert.ok(completedInv.recipients.every((r) => r.bookingId === p2.bookingId));

  // 3. Automatic offer dual accept -> 1 booking
  {
    const raw = JSON.parse(localStorage.getItem("datevra-db-v1")!);
    const [ca, cb] = u5.id < u6.id ? [u5.id, u6.id] : [u6.id, u5.id];
    raw.automaticDateOffers.push({
      id: "ado-happy-path",
      batchId: "batch-happy",
      matchId: "m-happy",
      userA: ca,
      userB: cb,
      experienceId: expId,
      cafeId: null,
      suggestedDate: d1,
      suggestedTime: "20:00",
      venue: "Milestone Lounge",
      message: null,
      status: "pending",
      userAResponse: null,
      userBResponse: null,
      userARespondedAt: null,
      userBRespondedAt: null,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      bookingId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    mockDb.resetDemo();
    localStorage.setItem("datevra-db-v1", JSON.stringify(raw));
  }
  const a1 = mockDb.respondToAutomaticDateOffer("ado-happy-path", u5.id, true);
  assert.equal(a1.status, "pending");
  assert.equal(a1.bookingId, null);
  const a2 = mockDb.respondToAutomaticDateOffer("ado-happy-path", u6.id, true);
  assert.equal(a2.status, "accepted");
  assert.ok(a2.bookingId);
});
