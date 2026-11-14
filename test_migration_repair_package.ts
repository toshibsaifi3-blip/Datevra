import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";

const REPAIR_DIR = "datevra_migration_repair_package";

const PREFLIGHT_SQL = `${REPAIR_DIR}/00_READ_ONLY_PREFLIGHT.sql`;
const GATE_SQL_FILES = [
  `${REPAIR_DIR}/01_gate2_schema_compatibility_repairs.sql`,
  `${REPAIR_DIR}/02_gate3_matchmaking_and_passes.sql`,
  `${REPAIR_DIR}/03_gate4_membership_passes_and_verification.sql`,
  `${REPAIR_DIR}/04_gate5_payments_and_subscription_lifecycle.sql`,
  `${REPAIR_DIR}/05_gate6_reports_and_final_hardening.sql`,
  `${REPAIR_DIR}/06_gate7_seed_curated_experiences.sql`,
] as const;

const HISTORICAL_ROOT_SQL = [
  "db/schema.sql",
  "db/realtime_setup.sql",
  "db/000_full_setup.sql",
  "db/000_full_setup_LATEST_2026-10-04.sql",
  "db/000_full_setup_LATEST_2026-10-04_v2.sql",
] as const;

const HISTORICAL_MIGRATIONS = [
  "db/migrations/002_client_parity.sql",
  "db/migrations/003_discovery_function.sql",
  "db/migrations/004_security_hardening.sql",
  "db/migrations/005_account_deletion.sql",
  "db/migrations/006_match_integrity.sql",
  "db/migrations/007_admin_bootstrap.sql",
  "db/migrations/008_payment_retention.sql",
  "db/migrations/009_daily_limits.sql",
  "db/migrations/010_passes_proposals.sql",
  "db/migrations/011_membership_passes.sql",
  "db/migrations/012_proposal_block_protection.sql",
  "db/migrations/013_proposal_block_decline_persistence.sql",
  "db/migrations/014_match_proposal_integrity.sql",
  "db/migrations/015_matchmaking_pair_serialization.sql",
  "db/migrations/016_matchmaking_lock_order_hardening.sql",
  "db/migrations/017_atomic_report_status_audit.sql",
  "db/migrations/018_verification_status_and_rpc.sql",
  "db/migrations/019_verification_defense_in_depth.sql",
  "db/migrations/020_enforce_audited_report_status.sql",
  "db/migrations/021_atomic_payment_operations.sql",
  "db/migrations/022_subscription_admin_operations.sql",
  "db/migrations/023_reports_audit_privilege_correction.sql",
  "db/migrations/024_subscription_operations_lock_order_and_cancellation_fix.sql",
  "db/migrations/025_admin_consolidated_security_and_integrity.sql",
  "db/migrations/026_seed_delhi_cafes.sql",
  "db/migrations/026_verify_seed_delhi_cafes.sql",
  "db/migrations/027_seed_curated_experiences.sql",
] as const;

const HISTORICAL_PACKAGE = [
  "datevra_migration_package/01_010_passes_proposals.sql",
  "datevra_migration_package/02_014_match_proposal_integrity.sql",
  "datevra_migration_package/03_015_matchmaking_pair_serialization.sql",
  "datevra_migration_package/04_016_matchmaking_lock_order_hardening.sql",
  "datevra_migration_package/05_011_membership_passes.sql",
  "datevra_migration_package/06_post_011_reconciliation.sql",
  "datevra_migration_package/07_027_seed_curated_experiences.sql",
] as const;

function stripSqlCommentsAndStrings(sql: string): string {
  // Preserve comment-free SQL for structural DDL/DML checks while keeping block boundaries clean.
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ");
}

function normalizeSig(sig: string): string {
  return sig
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/doubleprecision/g, "double precision");
}

function extractCreatedFunctionSigs(sql: string): string[] {
  const results: string[] = [];
  const cleanSql = stripSqlCommentsAndStrings(sql);
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+((?:public|datevra_internal)\.[a-z0-9_]+)\s*\(/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleanSql)) !== null) {
    const fnName = m[1].toLowerCase();
    let depth = 1;
    let i = re.lastIndex;
    while (i < cleanSql.length && depth > 0) {
      if (cleanSql[i] === "(") depth++;
      else if (cleanSql[i] === ")") depth--;
      i++;
    }
    const rawArgs = cleanSql.slice(re.lastIndex, i - 1).trim();
    if (!rawArgs) {
      results.push(`${fnName}()`);
      continue;
    }
    const argTypes = rawArgs.split(",").map((part) => {
      const cleaned = part
        .trim()
        .replace(/\bDEFAULT\b[\s\S]*$/i, "")
        .replace(/\b(?:IN|OUT|INOUT|VARIADIC)\b\s+/gi, "")
        .trim();
      const tokens = cleaned.split(/\s+/);
      if (tokens.length >= 2 && /^(p_|a|b)/i.test(tokens[0])) {
        return tokens.slice(1).join(" ").toLowerCase();
      }
      return cleaned.toLowerCase();
    });
    results.push(normalizeSig(`${fnName}(${argTypes.join(",")})`));
  }
  return results;
}

function extractGrantRevokeFunctionSigs(sql: string): string[] {
  const results: string[] = [];
  const cleanSql = stripSqlCommentsAndStrings(sql);
  const re = /(?:GRANT|REVOKE)\s+(?:ALL|EXECUTE)\s+ON\s+FUNCTION\s+((?:public|datevra_internal)\.[a-z0-9_]+)\s*\(([^)]*)\)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleanSql)) !== null) {
    const fnName = m[1].toLowerCase();
    const rawArgs = m[2].trim();
    if (!rawArgs) {
      results.push(`${fnName}()`);
      continue;
    }
    const argTypes = rawArgs.split(",").map((t) => t.trim().toLowerCase());
    results.push(normalizeSig(`${fnName}(${argTypes.join(",")})`));
  }
  return results;
}

describe("Datevra Migration Repair Package — Static & Deterministic Validation Suite", () => {
  const preflightSql = fs.readFileSync(PREFLIGHT_SQL, "utf-8");
  const gateSqls = GATE_SQL_FILES.map((f) => ({
    file: f,
    sql: fs.readFileSync(f, "utf-8"),
  }));

  it("verifies complete migration file inventory (39 historical SQL + 8 repair package files) with zero phantom names", () => {
    const allHistorical = [...HISTORICAL_ROOT_SQL, ...HISTORICAL_MIGRATIONS, ...HISTORICAL_PACKAGE];
    assert.equal(allHistorical.length, 39, "Expected 39 historical SQL files");

    for (const file of allHistorical) {
      assert.ok(fs.existsSync(file), `Missing historical file: ${file}`);
    }
    for (const file of [PREFLIGHT_SQL, `${REPAIR_DIR}/00_PREFLIGHT_EXPECTED_RESULTS.md`, ...GATE_SQL_FILES]) {
      assert.ok(fs.existsSync(file), `Missing repair package file: ${file}`);
    }

    // Confirm phantom name never exists
    assert.equal(fs.existsSync("db/migrations/021_atomic_payment_verification.sql"), false);
    assert.equal(fs.existsSync("db/migrations/021_atomic_payment_operations.sql"), true);

    // Ensure no filename collisions inside repair package or prefix numbers
    const repairDirFiles = fs.readdirSync(REPAIR_DIR).sort();
    const prefixes = repairDirFiles
      .filter((n) => n.endsWith(".sql"))
      .map((n) => n.slice(0, 2));
    assert.equal(new Set(prefixes).size, prefixes.length, "SQL numeric prefixes in repair package must be unique");
  });

  it("enforces strictly SELECT-only read-only preflight with zero mutations or PII leakage", () => {
    const codeOnly = stripSqlCommentsAndStrings(preflightSql);
    assert.equal(/\b(CREATE|ALTER|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|MERGE|COPY)\b/i.test(codeOnly), false, "Preflight SQL must contain zero DDL/DML/DCL");
    assert.equal(/\bFOR\s+UPDATE\b/i.test(codeOnly), false, "Preflight SQL must not acquire row locks");
    assert.equal(/\bBEGIN\s*;/i.test(codeOnly), false, "Preflight SQL must not open write transactions");
    assert.equal(/bootstrap_first_admin/i.test(preflightSql.replace("('public.bootstrap_first_admin(text)')", "")), false, "Preflight SQL must never call bootstrap_first_admin");

    // Verify zero email/phone/raw user-record queries in preflight SELECT columns
    assert.equal(/\bp\.email\b/i.test(codeOnly), false, "Preflight must not query profiles.email");
    assert.equal(/\bSELECT\s+\*\s+FROM\s+public\.(profiles|payments|subscriptions|reports)\b/i.test(codeOnly), false, "Preflight must not dump raw rows");

    // Verify all 12 labeled sections exist
    for (let i = 1; i <= 12; i++) {
      assert.ok(preflightSql.includes(`SECTION ${i} [READ-ONLY]`), `Preflight missing SECTION ${i}`);
    }

    // Verify Section 10.4 and 10.5 guard BOTH match_proposals existence AND required columns
    // (user_a_id, user_b_id, status) in information_schema.columns, and never return 0 when absent.
    const sec10Start = preflightSql.indexOf("SECTION 10 [READ-ONLY]");
    const sec11Start = preflightSql.indexOf("SECTION 11 [READ-ONLY]");
    const sec10Sql = preflightSql.slice(sec10Start, sec11Start);
    const check104 = sec10Sql.slice(
      sec10Sql.indexOf("'match_proposals_duplicate_pending_pairs'"),
      sec10Sql.indexOf("'match_proposals_pending_for_existing_matches'"),
    );
    const check105 = sec10Sql.slice(
      sec10Sql.indexOf("'match_proposals_pending_for_existing_matches'"),
      sec10Sql.indexOf("'orphan_date_applications_missing_experience'"),
    );
    for (const [label, block] of [["10.4", check104], ["10.5", check105]] as const) {
      assert.match(block, /to_regclass\('public\.match_proposals'\)\s+IS\s+(?:NOT\s+)?NULL/, `Section ${label} must guard on match_proposals table`);
      assert.match(block, /information_schema\.columns/i, `Section ${label} must inspect information_schema.columns`);
      assert.match(block, /'user_a_id',\s*'user_b_id',\s*'status'/, `Section ${label} must verify all 3 required match_proposals columns`);
      assert.match(block, /ELSE NULL::bigint/, `Section ${label} must return NULL issue_count when table or columns are absent`);
      assert.match(block, /'TABLE_ABSENT'/, `Section ${label} must return explicit TABLE_ABSENT status`);
      assert.match(block, /'REQUIRED_COLUMNS_ABSENT'/, `Section ${label} must return explicit REQUIRED_COLUMNS_ABSENT status`);
      assert.equal(/EXPECTED_0_OR_TABLE_ABSENT/.test(block), false, `Section ${label} must not collapse missing table/columns into EXPECTED_0_OR_TABLE_ABSENT`);
    }
  });

  it("enforces transactional BEGIN/COMMIT boundaries on every executable repair gate SQL file", () => {
    for (const { file, sql } of gateSqls) {
      const cleaned = stripSqlCommentsAndStrings(sql).trim();
      assert.match(cleaned, /^BEGIN\s*;/i, `${file} must start with BEGIN;`);
      assert.match(cleaned, /COMMIT\s*;$/i, `${file} must end with COMMIT;`);
      assert.equal(/\bDROP\b[^;]*\bCASCADE\b/i.test(cleaned), false, `${file} must never use DROP ... CASCADE`);
      assert.equal(/\bEXCEPTION\s+WHEN\s+OTHERS\b/i.test(cleaned), false, `${file} must never swallow WHEN OTHERS errors`);
    }
  });

  it("verifies DAG dependency order and that every GRANT/REVOKE target function exists at that point in the sequence", () => {
    // Baseline functions known from db/schema.sql + 002..009
    const availableFunctions = new Set<string>([
      "public.is_admin()",
      "public.set_updated_at()",
      "public.order_match_pair()",
      "public.handle_mutual_like()",
      "public.blocked_pair(uuid,uuid)",
      "public.enforce_application_rules()",
      "public.freeze_match_participants()",
      "public.freeze_message_content()",
    ]);

    for (const { file, sql } of gateSqls) {
      for (const createdSig of extractCreatedFunctionSigs(sql)) {
        availableFunctions.add(createdSig);
      }
      for (const referencedSig of extractGrantRevokeFunctionSigs(sql)) {
        assert.ok(
          availableFunctions.has(referencedSig),
          `${file} references GRANT/REVOKE on ${referencedSig} before it is created`,
        );
      }
    }
  });

  it("verifies schema compatibility dependencies across Gates 2-6 and excludes nonexistent payments.verified_at", () => {
    const [g2, g3, g4, g5, g6] = gateSqls.map((x) => x.sql);

    // Gate 2 provides required columns before downstream gates use them
    assert.match(g2, /ALTER TABLE public\.cafes[\s\S]*?ADD COLUMN menu text NOT NULL DEFAULT ''/);
    assert.match(g2, /ALTER TABLE public\.subscriptions[\s\S]*?ADD COLUMN auto_renew boolean NOT NULL DEFAULT false/);
    assert.match(g2, /ALTER TABLE public\.subscriptions[\s\S]*?ADD COLUMN created_at timestamptz/);
    assert.match(g2, /ALTER TABLE public\.subscriptions[\s\S]*?ADD COLUMN updated_at timestamptz/);
    assert.match(g2, /ALTER TABLE public\.reports[\s\S]*?ADD COLUMN updated_at timestamptz/);
    assert.match(g2, /ON DELETE SET NULL/);
    assert.match(g2, /payments_one_pending_per_user_plan/);

    // Gate 3 preconditions cafes.menu and blocked_pair before creating tables/triggers
    assert.match(g3, /blocked_pair\(uuid,uuid\)/);
    assert.match(g3, /table_name = 'cafes' AND column_name = 'menu'/);

    // Gate 4 preconditions subscriptions.auto_renew before redeem_membership_pass inserts auto_renew
    assert.match(g4, /table_name = 'subscriptions' AND column_name = 'auto_renew'/);

    // Gate 5 adds subscriptions.payment_id BEFORE redeem_membership_pass inserts payment_id
    const addPaymentIdIdx = g5.indexOf("ADD COLUMN IF NOT EXISTS payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL");
    const redeemPaymentIdInsertIdx = g5.indexOf("user_id, plan_id, payment_id, status, started_at, expires_at, auto_renew");
    assert.ok(addPaymentIdIdx !== -1 && redeemPaymentIdInsertIdx !== -1 && addPaymentIdIdx < redeemPaymentIdInsertIdx);
    // Gate 5 payment_id index must NOT be UNIQUE
    assert.equal(/CREATE\s+UNIQUE\s+INDEX[\s\S]*idx_subscriptions_payment_id/i.test(g5), false, "idx_subscriptions_payment_id must be non-unique");

    // Gate 6 preconditions reports.updated_at and Gate 5 admin RPCs
    assert.match(g6, /table_name = 'reports' AND column_name = 'updated_at'/);
    assert.match(g6, /admin_verify_payment\(uuid\)/);

    // Confirm verified_at is never added or written by repair SQL (remains Gate 5B BLOCKED)
    for (const { file, sql } of gateSqls) {
      assert.equal(/ADD\s+COLUMN[^;]*verified_at/i.test(sql), false, `${file} must not add payments.verified_at`);
      assert.equal(/\bverified_at\s*=/i.test(sql), false, `${file} must not assign payments.verified_at`);
    }
  });

  it("proves Gate 4 pass-code generator eliminates % 32 bias, covers all 256 bytes cleanly, and matches Membership.tsx regex", () => {
    const g4 = gateSqls[2].sql;
    const membershipSrc = fs.readFileSync("src/pages/user/Membership.tsx", "utf-8");

    // Ensure % 32 does not appear in executable SQL anywhere in repair package
    for (const { file, sql } of gateSqls) {
      assert.equal(/%\s*32\b/.test(stripSqlCommentsAndStrings(sql)), false, `${file} must never use % 32 modulo on a 31-char alphabet`);
    }

    const alphabetMatch = g4.match(/v_chars CONSTANT text := '([^']+)';/);
    assert.ok(alphabetMatch, "v_chars constant present in Gate 4");
    const vChars = alphabetMatch[1];
    assert.equal(vChars.length, 31, "Alphabet must have exact length 31");
    assert.equal(new Set(vChars.split("")).size, 31, "Alphabet characters must be unique");
    assert.match(g4, /IF v_byte < 248 THEN/, "Unbiased rejection boundary < 248 must be enforced");
    assert.match(g4, /\(v_byte % 31\) \+ 1/, "Exact modulo 31 indexing must be used");

    // Deterministic exhaustive check across all 256 byte values 0..255
    const hitCounts = new Array<number>(vChars.length).fill(0);
    let rejectedCount = 0;
    for (let b = 0; b < 256; b++) {
      if (b < 248) {
        const idx = b % 31;
        const ch = vChars.charAt(idx);
        assert.equal(ch.length, 1, `Byte ${b} produced non-1-char output`);
        hitCounts[idx]++;
      } else {
        rejectedCount++;
      }
    }
    assert.equal(rejectedCount, 8, "Exactly 8 byte values (248..255) rejected");
    for (let i = 0; i < 31; i++) {
      assert.equal(hitCounts[i], 8, `Index ${i} must occur exact 8 times for uniform 1/31 distribution`);
    }

    // Deterministic PRNG byte stream test (1,000 generated codes) against Membership.tsx PASS_REGEX
    const regexMatch = membershipSrc.match(/PASS_REGEX\s*=\s*(\/[^/]+\/);/);
    assert.ok(regexMatch, "Membership.tsx PASS_REGEX extracted");
    const passRegex = new RegExp(regexMatch[1].slice(1, -1));

    let state = 0x13579bdf;
    const nextByte = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return (state >>> 24) & 0xff;
    };
    for (let n = 0; n < 1000; n++) {
      let raw = "";
      while (raw.length < 12) {
        const b = nextByte();
        if (b < 248) raw += vChars.charAt(b % 31);
      }
      const code = `MEM-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
      assert.equal(code.length, 18);
      assert.ok(passRegex.test(code), `Generated code ${code} must satisfy Membership.tsx PASS_REGEX`);
    }
  });

  it("enforces fail-closed payment verification, no fabricated Razorpay IDs, and exact payment-linked refund reconciliation", () => {
    const g5 = gateSqls[3].sql;

    // Zero mock gateway ID generation
    assert.equal(/pay_'\s*\|\|\s*replace\(gen_random_uuid/i.test(g5), false, "Must NEVER fabricate pay_ UUIDs");

    // Extract admin_verify_payment body
    const verifyStart = g5.indexOf("CREATE OR REPLACE FUNCTION public.admin_verify_payment");
    const refundStart = g5.indexOf("CREATE OR REPLACE FUNCTION public.admin_refund_payment");
    const verifyBody = g5.slice(verifyStart, refundStart);
    assert.match(verifyBody, /order_pending_%/, "admin_verify_payment must reject placeholder order_pending_% orders");
    assert.match(verifyBody, /NOT LIKE 'pay_%'/, "admin_verify_payment must require authentic pay_ gateway ID");
    assert.match(verifyBody, /GATEWAY_VERIFICATION_REQUIRED/);
    assert.match(verifyBody, /AMOUNT_MISMATCH/);

    // Extract admin_refund_payment body
    const cancelStart = g5.indexOf("CREATE OR REPLACE FUNCTION public.admin_cancel_subscription");
    const refundBody = g5.slice(refundStart, cancelStart);
    assert.match(refundBody, /WHERE payment_id = p_payment_id\s+AND user_id = v_payment\.user_id/, "Refund must match ONLY strictly linked payment_id");
    assert.equal(/OR\s*\(\s*user_id\s*=\s*v_payment\.user_id\s+AND\s+plan_id\s*=/i.test(refundBody), false, "Dangerous fallback sweep must be removed");
    assert.match(refundBody, /IF v_payment\.user_id IS NOT NULL THEN/, "Must guard notification insert for anonymized rows (008)");
    assert.match(refundBody, /ledger-only/i, "Must explicitly document ledger-only nature without claiming gateway refund");

    // Cancel & extend must NEVER insert NULL into plan_update_intents
    const redeemStart = g5.indexOf("CREATE OR REPLACE FUNCTION public.redeem_membership_pass");
    const subOpsBody = g5.slice(cancelStart, redeemStart);
    assert.equal(/plan_update_intents/i.test(subOpsBody), false, "Admin cancel/extend must not write to datevra_internal.plan_update_intents");
  });

  it("preserves all 9 protected profile columns, 9-column trigger definition, and fresh intent expiry", () => {
    const g4 = gateSqls[2].sql;
    const expectedCols = [
      "is_admin",
      "plan_id",
      "plan_expires_at",
      "verified",
      "verification_status",
      "verification_reviewed_at",
      "verification_reviewed_by",
      "verification_note",
      "email",
    ];

    const fnStart = g4.indexOf("CREATE OR REPLACE FUNCTION public.protect_profile_fields()");
    const trgStart = g4.indexOf("CREATE TRIGGER trg_protect_profile_fields");
    const verifyRpcStart = g4.indexOf("CREATE OR REPLACE FUNCTION public.set_user_verified");
    const protectFnBody = g4.slice(fnStart, trgStart);
    const protectTrgSql = g4.slice(trgStart, verifyRpcStart);

    for (const col of expectedCols) {
      assert.ok(protectFnBody.includes(`OLD.${col} IS DISTINCT FROM NEW.${col}`), `protect_profile_fields missing OLD/NEW check for ${col}`);
      assert.ok(protectTrgSql.includes(col), `trg_protect_profile_fields BEFORE UPDATE OF missing ${col}`);
    }
    assert.match(protectFnBody, /created_at >= now\(\) - interval '5 minutes'/, "Intent consumption must require < 5 minute freshness");

    // Ensure Gate 5, Gate 6 & Gate 7 executable SQL does not replace protect_profile_fields() or downgrade trg_protect_profile_fields
    for (const later of [gateSqls[3], gateSqls[4], gateSqls[5]]) {
      assert.equal(/protect_profile_fields/.test(stripSqlCommentsAndStrings(later.sql)), false, `${later.file} must not alter protect_profile_fields`);
    }

    // set_user_verified checks p_verified IS NULL and cannot self-verify
    const verifyRpcBody = g4.slice(verifyRpcStart, g4.indexOf("CREATE OR REPLACE FUNCTION datevra_internal.generate_secure_pass_code"));
    assert.match(verifyRpcBody, /IF p_verified IS NULL THEN/);
    assert.match(verifyRpcBody, /IF p_user_id = v_admin_id THEN/);
  });

  it("verifies canonical pair lock ordering (Gate 3) and billing lock ordering (Gates 4 & 5)", () => {
    const g3 = gateSqls[1].sql;
    const g4 = gateSqls[2].sql;
    const g5 = gateSqls[3].sql;

    // Gate 3 matchmaking
    assert.match(g3, /REVOKE ALL ON FUNCTION public\.lock_matchmaking_pair\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    const respondStart = g3.indexOf("CREATE OR REPLACE FUNCTION public.respond_to_proposal");
    const mutualStart = g3.indexOf("CREATE OR REPLACE FUNCTION public.handle_mutual_like");
    const respondBody = g3.slice(respondStart, mutualStart);
    const mutualBody = g3.slice(mutualStart);

    const lockCallIdx = respondBody.indexOf("PERFORM public.lock_matchmaking_pair(v_u1, v_u2);");
    const forUpdateIdx = respondBody.indexOf("FOR UPDATE;");
    assert.ok(lockCallIdx !== -1 && forUpdateIdx !== -1 && lockCallIdx < forUpdateIdx, "respond_to_proposal must acquire advisory lock BEFORE FOR UPDATE");
    assert.match(respondBody, /IF p_accept IS NULL THEN/, "respond_to_proposal must reject NULL p_accept");
    assert.match(respondBody, /You have already responded to this proposal/, "respond_to_proposal must enforce one-time vote");
    assert.match(respondBody, /IF public\.blocked_pair\(v_prop\.user_a_id, v_prop\.user_b_id\) THEN[\s\S]*status = 'declined'/);

    // Static structural assertion (NOT a live Postgres concurrency test):
    // handle_mutual_like() MUST acquire lock_matchmaking_pair(a, b) BEFORE querying public.likes
    // for the reciprocal row, then re-verify blocked_pair(a, b) before creating matches.
    const cleanMutualBody = stripSqlCommentsAndStrings(mutualBody);
    const mutualLockIdx = cleanMutualBody.indexOf("PERFORM public.lock_matchmaking_pair(a, b);");
    const mutualLikesCheckIdx = cleanMutualBody.indexOf("FROM public.likes");
    const mutualBlockCheckIdx = cleanMutualBody.indexOf("IF public.blocked_pair(a, b) THEN");
    const mutualInsertMatchIdx = cleanMutualBody.indexOf("INSERT INTO public.matches");
    assert.ok(mutualLockIdx !== -1, "handle_mutual_like must call lock_matchmaking_pair(a, b)");
    assert.ok(mutualLikesCheckIdx !== -1, "handle_mutual_like must query public.likes for reciprocal like");
    assert.ok(mutualBlockCheckIdx !== -1, "handle_mutual_like must check blocked_pair(a, b)");
    assert.ok(mutualInsertMatchIdx !== -1, "handle_mutual_like must insert into public.matches");
    assert.ok(
      mutualLockIdx < mutualLikesCheckIdx &&
        mutualLikesCheckIdx < mutualBlockCheckIdx &&
        mutualBlockCheckIdx < mutualInsertMatchIdx,
      "handle_mutual_like order must be lock_matchmaking_pair -> reciprocal public.likes check -> blocked_pair -> INSERT matches",
    );
    assert.match(cleanMutualBody, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public, pg_temp/);
    assert.match(cleanMutualBody, /AFTER INSERT ON public\.likes[\s\S]*EXECUTE FUNCTION public\.handle_mutual_like\(\)/);

    // Canonical billing lock order checks:
    // 1) redeem_membership_pass (in both Gate 4 & Gate 5): profiles -> subscriptions -> attempts -> membership_passes
    for (const [label, src] of [["Gate 4", g4], ["Gate 5", g5]] as const) {
      const rStart = src.indexOf("CREATE OR REPLACE FUNCTION public.redeem_membership_pass");
      const rBody = src.slice(rStart);
      const pIdx = rBody.indexOf("FROM public.profiles WHERE id = v_uid FOR UPDATE");
      const sIdx = rBody.indexOf("FROM public.subscriptions");
      const aIdx = rBody.indexOf("FROM datevra_internal.pass_redemption_attempts");
      const mIdx = rBody.indexOf("FROM public.membership_passes");
      assert.ok(pIdx < sIdx && sIdx < aIdx && aIdx < mIdx, `${label} redeem_membership_pass lock order must be profiles -> subscriptions -> attempts -> membership_passes`);
    }

    // 2) admin_verify_payment & admin_refund_payment: payments -> profiles -> subscriptions
    for (const [name, startMarker, endMarker] of [
      ["admin_verify_payment", "CREATE OR REPLACE FUNCTION public.admin_verify_payment", "CREATE OR REPLACE FUNCTION public.admin_refund_payment"],
      ["admin_refund_payment", "CREATE OR REPLACE FUNCTION public.admin_refund_payment", "CREATE OR REPLACE FUNCTION public.admin_cancel_subscription"],
    ] as const) {
      const body = g5.slice(g5.indexOf(startMarker), g5.indexOf(endMarker));
      const payIdx = body.indexOf("FROM public.payments\n  WHERE id = p_payment_id\n  FOR UPDATE");
      const profIdx = body.indexOf("FROM public.profiles WHERE id = v_payment.user_id FOR UPDATE");
      const subIdx = body.indexOf("FROM public.subscriptions");
      assert.ok(payIdx !== -1 && profIdx !== -1 && subIdx !== -1 && payIdx < profIdx && profIdx < subIdx, `${name} must lock payments -> profiles -> subscriptions`);
    }

    // 3) admin_cancel_subscription & admin_extend_subscription: profiles -> subscriptions
    for (const [name, startMarker, endMarker] of [
      ["admin_cancel_subscription", "CREATE OR REPLACE FUNCTION public.admin_cancel_subscription", "CREATE OR REPLACE FUNCTION public.admin_extend_subscription"],
      ["admin_extend_subscription", "CREATE OR REPLACE FUNCTION public.admin_extend_subscription", "CREATE OR REPLACE FUNCTION public.redeem_membership_pass"],
    ] as const) {
      const body = g5.slice(g5.indexOf(startMarker), g5.indexOf(endMarker));
      const profIdx = body.indexOf("FROM public.profiles WHERE id = v_target_user_id FOR UPDATE");
      const subIdx = body.indexOf("FOR UPDATE", profIdx + 1);
      assert.ok(profIdx !== -1 && subIdx !== -1 && profIdx < subIdx, `${name} must lock profiles -> subscriptions`);
    }
  });

  it("confirms Gate 6 eliminates direct client UPDATE/DELETE on reports/payments/subscriptions while preserving app cash & report inserts", () => {
    const g6 = gateSqls[4].sql;
    assert.match(g6, /trg_report_status_audit_guard/);
    assert.match(g6, /datevra\.in_audited_report_status_rpc/);

    for (const tbl of ["reports", "payments", "subscriptions"]) {
      assert.match(g6, new RegExp(`REVOKE UPDATE, DELETE ON public\\.${tbl} FROM authenticated, anon, PUBLIC`));
      assert.match(g6, new RegExp(`REVOKE UPDATE \\([^)]+\\)\\s*\\n\\s*ON public\\.${tbl} FROM authenticated, anon, PUBLIC`));
      assert.match(g6, new RegExp(`REVOKE ALL ON public\\.${tbl} FROM anon`));
    }

    // Closes stale 002 policies in addition to 020/schema policies
    for (const pol of [
      "reports_admin_update",
      "reports_admin_update_restricted",
      "payments_admin_update",
      "payments_admin_write",
      "subscriptions_admin_update",
      "subscriptions_admin_write",
    ]) {
      assert.match(g6, new RegExp(`DROP POLICY IF EXISTS "${pol}"`));
    }

    // Preserves app inserts (user report filing, user pending payment, admin cash payment)
    assert.match(g6, /GRANT SELECT, INSERT ON public\.reports TO authenticated/);
    assert.match(g6, /GRANT SELECT, INSERT ON public\.payments TO authenticated/);
    assert.match(g6, /CREATE POLICY "payments_admin_insert" ON public\.payments\s*\n\s*FOR INSERT TO authenticated\s*\n\s*WITH CHECK \(public\.is_admin\(\)\)/);
    assert.match(g6, /GRANT SELECT ON public\.subscriptions TO authenticated/);

    // Hardens search_path on 004/006 trigger functions
    assert.match(g6, /ALTER FUNCTION public\.enforce_application_rules\(\)\s*\n\s*SET search_path = pg_catalog, public, pg_temp/);
    assert.match(g6, /ALTER FUNCTION public\.freeze_match_participants\(\)\s*\n\s*SET search_path = pg_catalog, public, pg_temp/);
    assert.match(g6, /ALTER FUNCTION public\.freeze_message_content\(\)\s*\n\s*SET search_path = pg_catalog, public, pg_temp/);
  });

  it("verifies Gate 7 seed checks all 10 experience fields before no-op and aligns with ExperiencesPublic.tsx", () => {
    const g7 = gateSqls[5].sql;
    const expPublicSrc = fs.readFileSync("src/pages/public/ExperiencesPublic.tsx", "utf-8");

    assert.equal(/ON CONFLICT[^;]*DO NOTHING/i.test(stripSqlCommentsAndStrings(g7)), false, "Gate 7 must check exact fields rather than blind ON CONFLICT DO NOTHING");
    assert.match(g7, /GATE7_SEED_CONFLICT/);

    for (const col of ["title", "kind", "city", "description", "image", "price_from", "duration_mins", "eligibility", "slots", "elite_only"]) {
      assert.ok(g7.includes(`v_existing.${col} IS DISTINCT FROM v_seed.${col}`), `Gate 7 must compare ${col} on pre-existing row`);
    }

    for (const id of ["e-hotstag-premium-date", "e-hotstag-coffee-date", "e-hotstag-italian", "e-karmala-karaoke"]) {
      assert.ok(g7.includes(id), `Gate 7 missing ${id}`);
      assert.ok(expPublicSrc.includes(id), `ExperiencesPublic.tsx missing ${id}`);
    }
  });
});
