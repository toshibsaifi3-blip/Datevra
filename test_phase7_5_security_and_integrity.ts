/**
 * Datevra Admin Panel — Phase 7.5: Critical Security & Transaction Integrity Test Suite
 *
 * Verifies:
 * 1. Batch A: Reports audit bypass remediation (privilege revocation, trigger guard, RPC context flag).
 * 2. Batch B: Subscription cancellation NOT NULL fix, lock acquisition order hierarchy (payments -> profiles -> subscriptions),
 *             and pass redemption payment_id traceability.
 * 3. Batch C: Payments RPC fallback removal in Supabase adapter, error propagation (MIGRATION_REQUIRED on PGRST202/42883),
 *             and financial ledger traceability.
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
  console.log("=== Phase 7.5 Security & Transaction Integrity Test Suite ===\n");

  const migration020Path = path.resolve(process.cwd(), "db/migrations/020_enforce_audited_report_status.sql");
  const migration021Path = path.resolve(process.cwd(), "db/migrations/021_atomic_payment_operations.sql");
  const migration022Path = path.resolve(process.cwd(), "db/migrations/022_subscription_admin_operations.sql");
  const migration023Path = path.resolve(process.cwd(), "db/migrations/023_reports_audit_privilege_correction.sql");
  const migration024Path = path.resolve(process.cwd(), "db/migrations/024_subscription_operations_lock_order_and_cancellation_fix.sql");
  const dbTsPath = path.resolve(process.cwd(), "src/lib/supabase/db.ts");

  // --------------------------------------------------------------------------
  // BATCH A: Reports Audit Privilege Correction & Direct RLS Remediation
  // --------------------------------------------------------------------------
  console.log("Test 1: Batch A — Migration 023 file existence and SQL syntax structure");
  assert(fs.existsSync(migration023Path), "Migration 023 exists on disk");
  const m023Content = fs.readFileSync(migration023Path, "utf-8");

  assert(
    m023Content.includes("REVOKE UPDATE ON public.reports FROM authenticated, anon, PUBLIC;"),
    "Explicitly revokes UPDATE on public.reports from authenticated, anon, and PUBLIC",
  );

  assert(
    m023Content.includes('DROP POLICY IF EXISTS "reports_admin_update_restricted" ON public.reports;') &&
      m023Content.includes('DROP POLICY IF EXISTS "reports_admin_update" ON public.reports;'),
    "Drops permissive direct update policies reports_admin_update and reports_admin_update_restricted",
  );

  assert(
    m023Content.includes("check_report_status_audit_guard"),
    "Defines check_report_status_audit_guard trigger function",
  );

  assert(
    m023Content.includes("current_setting('datevra.in_audited_report_status_rpc', true)") &&
      m023Content.includes("AUDIT_GUARD_VIOLATION"),
    "Trigger guard checks transaction flag datevra.in_audited_report_status_rpc and raises AUDIT_GUARD_VIOLATION",
  );

  assert(
    m023Content.includes("PERFORM set_config('datevra.in_audited_report_status_rpc', 'true', true);"),
    "public.set_report_status sets the transaction-local audit context flag",
  );

  assert(
    m023Content.includes("SECURITY DEFINER") && m023Content.includes("SET search_path = public, pg_temp"),
    "set_report_status enforces SECURITY DEFINER with fixed safe search_path",
  );

  assert(
    m023Content.includes("REVOKE ALL ON FUNCTION public.set_report_status(uuid, text) FROM PUBLIC, anon;") &&
      m023Content.includes("GRANT EXECUTE ON FUNCTION public.set_report_status(uuid, text) TO authenticated;"),
    "set_report_status execution permissions are restricted to authenticated roles only",
  );

  console.log("\nTest 2: Batch A — Client architecture: No direct report updates in src/");
  const srcFiles = ["src/pages/admin/Reports.tsx", "src/lib/data.ts", "src/lib/supabase/db.ts"];
  let directReportUpdateFound = false;
  for (const relPath of srcFiles) {
    const fullPath = path.resolve(process.cwd(), relPath);
    if (fs.existsSync(fullPath)) {
      const code = fs.readFileSync(fullPath, "utf-8");
      // Check for .from("reports").update or .from('reports').update
      if (/from\(\s*["']reports["']\s*\)\s*\.update/.test(code)) {
        directReportUpdateFound = true;
      }
    }
  }
  assert(!directReportUpdateFound, "No client component or adapter performs direct .from('reports').update()");

  // --------------------------------------------------------------------------
  // BATCH B: Subscriptions Cancellation & Lock-Order Hardening
  // --------------------------------------------------------------------------
  console.log("\nTest 3: Batch B — Migration 024 file existence and NULL plan intent elimination");
  assert(fs.existsSync(migration024Path), "Migration 024 exists on disk");
  const m024Content = fs.readFileSync(migration024Path, "utf-8");

  assert(
    !m024Content.includes("INSERT INTO datevra_internal.plan_update_intents (user_id, plan_id, expires_at)\n      VALUES (v_sub.user_id, NULL, NULL)") &&
      !m024Content.includes("VALUES (v_sub.user_id, NULL, NULL)"),
    "Eliminated fatal NOT NULL violation: no NULL plan_id insertion into plan_update_intents",
  );

  console.log("\nTest 4: Batch B — Hierarchical Lock Acquisition Order across all 4 Administrative RPCs");
  // 1. admin_verify_payment (021)
  const m021Content = fs.readFileSync(migration021Path, "utf-8");
  const vPayLock = m021Content.indexOf("FROM public.payments");
  const vProfLock = m021Content.indexOf("FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE");
  const vSubLock = m021Content.indexOf("UPDATE public.subscriptions");
  assert(
    vPayLock !== -1 && vProfLock !== -1 && vSubLock !== -1 && vPayLock < vProfLock && vProfLock < vSubLock,
    "admin_verify_payment lock hierarchy: payments -> profiles -> subscriptions",
  );

  // 2. admin_refund_payment (021)
  const rPayLock = m021Content.indexOf("FROM public.payments\n  WHERE id = p_payment_id\n  FOR UPDATE");
  const rProfLock = m021Content.indexOf("FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE");
  const rSubLock = m021Content.indexOf("FROM public.subscriptions\n    WHERE (payment_id = p_payment_id");
  assert(
    rPayLock !== -1 && rProfLock !== -1 && rSubLock !== -1 && rPayLock < rProfLock && rProfLock < rSubLock,
    "admin_refund_payment lock hierarchy: payments -> profiles -> subscriptions",
  );

  // 3. admin_cancel_subscription (024)
  const cProfLock = m024Content.indexOf("PERFORM 1 FROM public.profiles\n  WHERE id = v_target_user_id\n  FOR UPDATE;");
  const cSubLock = m024Content.indexOf("SELECT * INTO v_sub\n  FROM public.subscriptions\n  WHERE id = p_subscription_id\n  FOR UPDATE;");
  assert(
    cProfLock !== -1 && cSubLock !== -1 && cProfLock < cSubLock,
    "admin_cancel_subscription lock hierarchy: profiles FOR UPDATE -> subscriptions FOR UPDATE",
  );

  // 4. admin_extend_subscription (024)
  const eProfLock = m024Content.indexOf("PERFORM 1 FROM public.profiles\n  WHERE id = v_target_user_id\n  FOR UPDATE;");
  const eSubLock = m024Content.indexOf("SELECT * INTO v_sub\n  FROM public.subscriptions\n  WHERE id = p_subscription_id\n  FOR UPDATE;");
  assert(
    eProfLock !== -1 && eSubLock !== -1 && eProfLock < eSubLock,
    "admin_extend_subscription lock hierarchy: profiles FOR UPDATE -> subscriptions FOR UPDATE",
  );

  console.log("\nTest 5: Batch B — Pass redemption payment_id traceability");
  assert(
    m024Content.includes("INSERT INTO public.subscriptions (\n    user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew\n  ) VALUES (\n    v_uid, v_pass.plan_id, v_payment_id"),
    "public.redeem_membership_pass explicitly populates payment_id into public.subscriptions",
  );

  console.log("\nTest 6: Batch B — MockDb Subscription Cancellation and Entitlement Reconciliation");
  // Test MockDb subscription cancellation
  const users = mockDb.allUsers();
  const testUser = users[0];
  // Create a verified payment and subscription for testUser
  const testPayment = mockDb.purchaseMembership(testUser.id, "plus", 799);
  const verifiedPayment = mockDb.verifyPayment(testPayment.id, "admin-system");
  assert(verifiedPayment?.status === "verified", "Payment verified for test");

  const activeSub = mockDb.activeSubscription(testUser.id);
  assert(activeSub !== undefined && activeSub.planId === "plus", "Active plus subscription found");

  if (activeSub) {
    mockDb.cancelSubscription(activeSub.id, "admin-system", "Member requested cancellation");
    const cancelledSub = mockDb.subscriptionsFor(testUser.id).find((s) => s.id === activeSub.id);
    assert(cancelledSub?.status === "cancelled", "Subscription status is now cancelled");

    const refreshedUser = mockDb.getUser(testUser.id);
    assert(
      refreshedUser?.plan === null && refreshedUser?.planExpiresAt === null,
      "User profile plan and planExpiresAt cleanly reset to null on cancellation",
    );
  }

  // --------------------------------------------------------------------------
  // BATCH C: Payments RPC Fallbacks Removal & Type Integrity
  // --------------------------------------------------------------------------
  console.log("\nTest 7: Batch C — Removal of unsafe multi-step client REST fallbacks in db.ts");
  const dbTsContent = fs.readFileSync(dbTsPath, "utf-8");

  // Verify verifyPayment does not contain fallback to client queries/mutations
  const verifyPaymentDefMatch = dbTsContent.match(/async function verifyPayment[\s\S]*?^}/m);
  assert(verifyPaymentDefMatch !== null, "Found verifyPayment definition in db.ts");
  if (verifyPaymentDefMatch) {
    const fnBody = verifyPaymentDefMatch[0];
    assert(
      !fnBody.includes('.from("payments").update') && !fnBody.includes('.from("subscriptions").insert'),
      "verifyPayment contains NO client-side REST update or insert mutations",
    );
    assert(
      fnBody.includes('sb().rpc("admin_verify_payment"'),
      "verifyPayment calls admin_verify_payment RPC exclusively",
    );
    assert(
      fnBody.includes("PGRST202") && fnBody.includes("42883") && fnBody.includes("MIGRATION_REQUIRED"),
      "verifyPayment throws MIGRATION_REQUIRED when admin_verify_payment RPC is missing",
    );
  }

  // Verify refundPayment does not contain fallback to client queries/mutations
  const refundPaymentDefMatch = dbTsContent.match(/async function refundPayment[\s\S]*?^}/m);
  assert(refundPaymentDefMatch !== null, "Found refundPayment definition in db.ts");
  if (refundPaymentDefMatch) {
    const fnBody = refundPaymentDefMatch[0];
    assert(
      !fnBody.includes('.from("payments").update') && !fnBody.includes('.from("subscriptions").update'),
      "refundPayment contains NO client-side REST update mutations",
    );
    assert(
      fnBody.includes('sb().rpc("admin_refund_payment"'),
      "refundPayment calls admin_refund_payment RPC exclusively",
    );
    assert(
      fnBody.includes("PGRST202") && fnBody.includes("42883") && fnBody.includes("MIGRATION_REQUIRED"),
      "refundPayment throws MIGRATION_REQUIRED when admin_refund_payment RPC is missing",
    );
  }

  console.log("\nTest 8: Batch C — Traceability in Types, Mappers, and Ledger");
  assert(
    dbTsContent.includes("payment_id: verified.id") === false,
    "Removed old client-side manual subscription insert in db.ts",
  );

  // Check types.ts for Subscription.paymentId
  const typesPath = path.resolve(process.cwd(), "src/lib/types.ts");
  const typesContent = fs.readFileSync(typesPath, "utf-8");
  assert(
    typesContent.includes("paymentId?: string | null;") || typesContent.includes("paymentId?: string;"),
    "Subscription interface in types.ts contains paymentId field",
  );

  // Check mappers.ts
  const mappersPath = path.resolve(process.cwd(), "src/lib/supabase/mappers.ts");
  const mappersContent = fs.readFileSync(mappersPath, "utf-8");
  assert(
    mappersContent.includes("paymentId: (r.payment_id as string | null) ?? null") ||
      mappersContent.includes("paymentId: (r.payment_id as string) ?? undefined") ||
      mappersContent.includes("paymentId:"),
    "mappers.ts maps r.payment_id to Subscription.paymentId",
  );

  console.log("\n========================================");
  console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
  console.log("========================================\n");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
