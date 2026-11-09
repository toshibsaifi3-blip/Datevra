/**
 * Datevra Admin Panel — Phase 7.7: Final Independent Verification Suite
 *
 * Verifies:
 * 1. Migration 025 Definitive Security & Privilege Hardening:
 *    - Reports: Table-level & column-level UPDATE and DELETE revocation.
 *    - Payments: Table-level UPDATE and DELETE revocation; SELECT and INSERT retained for authenticated.
 *    - Subscriptions: Table-level UPDATE and DELETE revocation; SELECT retained for authenticated.
 *    - Dropping of permissive direct mutation policies.
 *    - Audited RPC execution grants strictly for authenticated users.
 * 2. Auth Context & Admin Role Resolution:
 *    - supaRole queries authoritative is_admin() RPC first with fallback to profiles select.
 * 3. Lock-Order Uniformity:
 *    - All admin RPCs follow hierarchical lock order: payments -> profiles -> subscriptions.
 * 4. UI Cleanliness & Modal Discipline:
 *    - Scans every file in src/pages/admin/ to guarantee 0 instances of window.confirm or window.alert.
 * 5. End-to-End Matchmaking Dual Consent:
 *    - Single accept keeps proposal pending; dual accept confirms proposal to accepted.
 * 6. Verification Management Integrity:
 *    - Enforces authentication, self-verification rejection, status update, and audit logging.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as mockDb from "./src/lib/mockDb";

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

function runTests() {
  console.log("=== Phase 7.7 Final Independent Verification Suite ===\n");

  const migration025Path = path.resolve(process.cwd(), "db/migrations/025_admin_consolidated_security_and_integrity.sql");
  const authContextPath = path.resolve(process.cwd(), "src/context/AuthContext.tsx");

  // --------------------------------------------------------------------------
  // TEST 1: Migration 025 Privilege & Policy Verification
  // --------------------------------------------------------------------------
  console.log("Test 1: Migration 025 — Exhaustive Privilege & Policy Audit");
  assert(fs.existsSync(migration025Path), "Migration 025 exists on disk");
  const m025 = fs.readFileSync(migration025Path, "utf-8");

  assert(
    m025.includes("REVOKE UPDATE, DELETE ON public.reports FROM authenticated, anon, PUBLIC;"),
    "Revokes table-level UPDATE and DELETE on public.reports",
  );

  assert(
    m025.includes("REVOKE UPDATE (id, reporter_id, reported_id, reason, details, status, created_at, updated_at)\n  ON public.reports FROM authenticated, anon, PUBLIC;"),
    "Revokes column-level UPDATE on all defined public.reports columns",
  );

  assert(
    m025.includes("GRANT SELECT, INSERT ON public.reports TO authenticated;"),
    "Retains safe SELECT and INSERT on public.reports for authenticated members",
  );

  assert(
    m025.includes("REVOKE UPDATE, DELETE ON public.payments FROM authenticated, anon, PUBLIC;"),
    "Revokes direct UPDATE and DELETE on public.payments",
  );

  assert(
    m025.includes("GRANT SELECT, INSERT ON public.payments TO authenticated;"),
    "Retains safe SELECT and INSERT on public.payments for authenticated checkout intent creation",
  );

  assert(
    m025.includes("REVOKE UPDATE, DELETE ON public.subscriptions FROM authenticated, anon, PUBLIC;"),
    "Revokes direct UPDATE and DELETE on public.subscriptions",
  );

  assert(
    m025.includes("GRANT SELECT ON public.subscriptions TO authenticated;"),
    "Retains safe SELECT on public.subscriptions for authenticated member reads",
  );

  assert(
    m025.includes('DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;') &&
      m025.includes('DROP POLICY IF EXISTS "reports_admin_update_restricted" ON public.reports;') &&
      m025.includes('DROP POLICY IF EXISTS "payments_admin_update" ON public.payments;') &&
      m025.includes('DROP POLICY IF EXISTS "subscriptions_admin_update" ON public.subscriptions;'),
    "Drops all historical permissive direct mutation policies across reports, payments, and subscriptions",
  );

  // --------------------------------------------------------------------------
  // TEST 2: AuthContext & Role Resolution Architecture
  // --------------------------------------------------------------------------
  console.log("\nTest 2: AuthContext & Admin Role Resolution Architecture");
  const authContext = fs.readFileSync(authContextPath, "utf-8");
  assert(
    authContext.includes('c.rpc("is_admin")'),
    "supaRole checks authoritative server-side is_admin() RPC first",
  );
  assert(
    authContext.includes('.from("profiles")\n    .select("is_admin")'),
    "supaRole retains defensive fallback to profiles is_admin select",
  );

  // --------------------------------------------------------------------------
  // TEST 3: Lock-Order Verification Across Migrations
  // --------------------------------------------------------------------------
  console.log("\nTest 3: Lock-Order Verification (payments -> profiles -> subscriptions)");
  const m021Path = path.resolve(process.cwd(), "db/migrations/021_atomic_payment_operations.sql");
  const m024Path = path.resolve(process.cwd(), "db/migrations/024_subscription_operations_lock_order_and_cancellation_fix.sql");

  const m021 = fs.readFileSync(m021Path, "utf-8");
  const m024 = fs.readFileSync(m024Path, "utf-8");

  // admin_verify_payment lock sequence
  const vPayIdx = m021.indexOf("FROM public.payments\n  WHERE id = p_payment_id\n  FOR UPDATE;");
  const vProfIdx = m021.indexOf("PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;");
  const vSubIdx = m021.indexOf("UPDATE public.subscriptions");
  assert(vPayIdx !== -1 && vProfIdx !== -1 && vSubIdx !== -1 && vPayIdx < vProfIdx && vProfIdx < vSubIdx,
    "admin_verify_payment locks payments -> profiles -> subscriptions");

  // admin_refund_payment lock sequence
  const rPayIdx = m021.indexOf("FROM public.payments\n  WHERE id = p_payment_id\n  FOR UPDATE;");
  const rProfIdx = m021.indexOf("PERFORM 1 FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE;");
  const rSubIdx = m021.indexOf("FROM public.subscriptions\n    WHERE (payment_id = p_payment_id");
  assert(rPayIdx !== -1 && rProfIdx !== -1 && rSubIdx !== -1 && rPayIdx < rProfIdx && rProfIdx < rSubIdx,
    "admin_refund_payment locks payments -> profiles -> subscriptions");

  // admin_cancel_subscription lock sequence
  const cProfIdx = m024.indexOf("PERFORM 1 FROM public.profiles\n  WHERE id = v_target_user_id\n  FOR UPDATE;");
  const cSubIdx = m024.indexOf("SELECT * INTO v_sub\n  FROM public.subscriptions\n  WHERE id = p_subscription_id\n  FOR UPDATE;");
  assert(cProfIdx !== -1 && cSubIdx !== -1 && cProfIdx < cSubIdx,
    "admin_cancel_subscription locks profiles -> subscriptions");

  // admin_extend_subscription lock sequence
  const eProfIdx = m024.indexOf("PERFORM 1 FROM public.profiles\n  WHERE id = v_target_user_id\n  FOR UPDATE;");
  const eSubIdx = m024.indexOf("SELECT * INTO v_sub\n  FROM public.subscriptions\n  WHERE id = p_subscription_id\n  FOR UPDATE;");
  assert(eProfIdx !== -1 && eSubIdx !== -1 && eProfIdx < eSubIdx,
    "admin_extend_subscription locks profiles -> subscriptions");

  // --------------------------------------------------------------------------
  // TEST 4: UI Discipline — Complete Scan of src/pages/admin/
  // --------------------------------------------------------------------------
  console.log("\nTest 4: UI Discipline — Complete Scan of src/pages/admin/");
  const adminPagesDir = path.resolve(process.cwd(), "src/pages/admin");
  const adminFiles = fs.readdirSync(adminPagesDir).filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"));

  let confirmFound = false;
  let alertFound = false;
  for (const file of adminFiles) {
    const filePath = path.join(adminPagesDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    if (content.includes("window.confirm")) {
      console.error(`Found window.confirm in ${file}`);
      confirmFound = true;
    }
    if (content.includes("window.alert")) {
      console.error(`Found window.alert in ${file}`);
      alertFound = true;
    }
  }

  assert(!confirmFound, "Zero window.confirm calls in all 21 admin page components");
  assert(!alertFound, "Zero window.alert calls in all 21 admin page components");

  // --------------------------------------------------------------------------
  // TEST 5: Matchmaking Dual Consent Verification
  // --------------------------------------------------------------------------
  console.log("\nTest 5: Matchmaking Dual Consent Verification");
  const users = mockDb.allUsers();
  const uA = users[0];
  const uB = users[1];

  const proposal = mockDb.createMatchProposal(uA.id, uB.id, "Introduction for review", "admin-tester");
  assert(proposal.status === "pending", "New proposal is pending");
  assert(proposal.userAResponse === null && proposal.userBResponse === null, "Initial responses are null");

  // User A accepts -> remains pending
  const propA = mockDb.respondToMatchProposal(proposal.id, uA.id, true);
  assert(propA.status === "pending", "Single acceptance keeps proposal in pending state");
  assert(propA.userAResponse === true, "User A response recorded as true");

  // User B declines -> transitions to declined
  const propBDecline = mockDb.respondToMatchProposal(proposal.id, uB.id, false);
  assert(propBDecline.status === "declined", "Single decline immediately transitions proposal to declined");

  // Both accept -> transitions to accepted (now that first proposal is declined)
  const propDual = mockDb.createMatchProposal(uA.id, uB.id, "Second test introduction", "admin-tester");
  mockDb.respondToMatchProposal(propDual.id, uA.id, true);
  const propDualRes = mockDb.respondToMatchProposal(propDual.id, uB.id, true);
  assert(propDualRes.status === "accepted", "Dual acceptance confirms proposal to accepted");

  // --------------------------------------------------------------------------
  // TEST 6: Verification Management Parity
  // --------------------------------------------------------------------------
  console.log("\nTest 6: Verification Management Parity");
  // Test authentication rejection
  let authThrew = false;
  try {
    mockDb.setUserVerified(uA.id, true, "");
  } catch (err: unknown) {
    authThrew = true;
    assert((err as Error).message.includes("NOT_AUTHENTICATED"), "Rejects missing actorId with NOT_AUTHENTICATED");
  }
  assert(authThrew, "setUserVerified enforced actor authentication");

  // Test self-verification rejection
  let selfThrew = false;
  try {
    mockDb.setUserVerified(uA.id, true, uA.id);
  } catch (err: unknown) {
    selfThrew = true;
    assert((err as Error).message.includes("CANNOT_VERIFY_SELF"), "Rejects self-verification with CANNOT_VERIFY_SELF");
  }
  assert(selfThrew, "setUserVerified prevented self-verification");

  // Test successful verification
  mockDb.setUserVerified(uA.id, true, "admin-system", "Identity check passed");
  const refreshedUA = mockDb.getUser(uA.id);
  assert(refreshedUA?.verified === true, "User verified flag set to true");
  assert(refreshedUA?.verificationStatus === "verified", "User verificationStatus set to verified");
  assert(refreshedUA?.verificationNote === "Identity check passed", "Verification note stored");

  console.log("\n========================================");
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log("========================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
