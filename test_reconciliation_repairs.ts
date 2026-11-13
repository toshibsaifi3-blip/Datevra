import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";

describe("DATEVRA Master Reconciliation & Targeted Repair Regression Suite", () => {
  const expPublicSrc = fs.readFileSync("src/pages/public/ExperiencesPublic.tsx", "utf-8");
  const dbSrc = fs.readFileSync("src/lib/supabase/db.ts", "utf-8");
  const discoverSrc = fs.readFileSync("src/pages/user/Discover.tsx", "utf-8");
  const passesSrc = fs.readFileSync("src/pages/admin/Passes.tsx", "utf-8");
  const membershipPassesSrc = fs.readFileSync("src/pages/admin/MembershipPasses.tsx", "utf-8");
  const verificationSrc = fs.readFileSync("src/pages/admin/Verification.tsx", "utf-8");
  const m009 = fs.readFileSync("db/migrations/009_daily_limits.sql", "utf-8");
  const m010 = fs.readFileSync("db/migrations/010_passes_proposals.sql", "utf-8");
  const m011 = fs.readFileSync("db/migrations/011_membership_passes.sql", "utf-8");
  const m019 = fs.readFileSync("db/migrations/019_verification_defense_in_depth.sql", "utf-8");
  const m026 = fs.readFileSync("db/migrations/026_seed_delhi_cafes.sql", "utf-8");
  const m027 = fs.readFileSync("db/migrations/027_seed_curated_experiences.sql", "utf-8");

  it("replaces misleading venue schedule synchronization toast on FK error and preserves form state", () => {
    assert.equal(
      expPublicSrc.includes("currently being synchronized with the venue"),
      false,
      "Misleading venue schedule synchronization copy must not appear",
    );

    const catchStart = expPublicSrc.indexOf("} catch (e) {");
    const catchEnd = expPublicSrc.indexOf("} finally {", catchStart);
    assert.ok(catchStart !== -1 && catchEnd !== -1, "submitApplication catch/finally block exists");
    const catchBody = expPublicSrc.slice(catchStart, catchEnd);

    assert.match(catchBody, /msgLower\.includes\("foreign key"\)/, "Case-insensitive foreign key match present");
    assert.match(catchBody, /msgLower\.includes\("date_applications_experience_id_fkey"\)/, "Constraint name match present");
    assert.match(
      catchBody,
      /This curated experience is not yet available for applications in the live catalogue/,
      "User-safe unavailable package message is rendered",
    );
    assert.equal(
      /toast\([^)]*(?:027|public\.|date_applications|SQL)/i.test(catchBody),
      false,
      "User-facing toast must not leak SQL table names or migration numbers",
    );
    assert.equal(
      /setSelectedDate\(|setNote\(|setSelectedExperience\(|setIsReviewStep\(false\)/.test(catchBody),
      false,
      "Error path must preserve user form inputs and review state for retry",
    );
  });

  it("aligns EXPERIENCES_CONFIG cafe and experience IDs strictly with Migrations 026 and 027", () => {
    const expectedPairs = [
      { cafeId: "c-hot-stag-del", expId: "e-hotstag-premium-date", title: "Premium Date" },
      { cafeId: "c-hot-stag-del", expId: "e-hotstag-coffee-date", title: "Premium Coffee Date" },
      { cafeId: "c-hot-stag-del", expId: "e-hotstag-italian", title: "Italian Cuisine Date with Premium Experience" },
      { cafeId: "c-karmala-del", expId: "e-karmala-karaoke", title: "Premium Date with Live Karaoke" },
    ];

    for (const pair of expectedPairs) {
      assert.ok(expPublicSrc.includes(pair.cafeId), `ExperiencesPublic references ${pair.cafeId}`);
      assert.ok(expPublicSrc.includes(pair.expId), `ExperiencesPublic references ${pair.expId}`);
      assert.ok(expPublicSrc.includes(pair.title), `ExperiencesPublic includes title '${pair.title}'`);
      assert.ok(m026.includes(pair.cafeId), `Migration 026 seeds ${pair.cafeId}`);
      assert.ok(m027.includes(pair.expId), `Migration 027 seeds ${pair.expId}`);
      assert.ok(m027.includes(pair.title), `Migration 027 preserves title '${pair.title}'`);
    }
  });

  it("renders MigrationAlertBanner cleanly for missing Migrations 010, 011, and 019", () => {
    assert.match(passesSrc, /<MigrationAlertBanner[\s\S]*?migrationId="010"/, "Passes.tsx maps 010 banner");
    assert.match(membershipPassesSrc, /<MigrationAlertBanner[\s\S]*?migrationId="011"/, "MembershipPasses.tsx maps 011 banner");
    assert.match(verificationSrc, /<MigrationAlertBanner[\s\S]*?migrationId="019"/, "Verification.tsx maps 019 banner");
  });

  it("verifies frontend RPC parameter names match SQL definitions across 009, 010, 011, and 019", () => {
    // 009: record_profile_interest(p_viewed_user_id uuid)
    assert.match(m009, /CREATE OR REPLACE FUNCTION public\.record_profile_interest\(p_viewed_user_id uuid\)/);
    assert.match(dbSrc, /recordProfileInterest\(viewerIdOrTarget: string, targetUserId\?: string\)/);
    assert.match(dbSrc, /rpc\("record_profile_interest",\s*\{\s*p_viewed_user_id:\s*viewedUserId\s*\}\)/);
    assert.match(discoverSrc, /db\.recordProfileInterest\(me\.id,\s*profile\.id\)/);

    // 010: redeem_pass(p_code text)
    assert.match(m010, /CREATE OR REPLACE FUNCTION public\.redeem_pass\(p_code text\)/);
    assert.match(dbSrc, /rpc\("redeem_pass",\s*\{\s*p_code:\s*normalized\s*\}\)/);

    // 011: create_membership_pass, revoke_membership_pass, redeem_membership_pass
    assert.match(m011, /CREATE OR REPLACE FUNCTION public\.create_membership_pass\(/);
    assert.match(dbSrc, /rpc\("create_membership_pass",\s*\{[\s\S]*?p_plan_id:[\s\S]*?p_duration_days:[\s\S]*?p_expires_at:[\s\S]*?p_issued_to_user_id:[\s\S]*?p_note:/);
    assert.match(m011, /CREATE OR REPLACE FUNCTION public\.revoke_membership_pass\(/);
    assert.match(dbSrc, /rpc\("revoke_membership_pass",\s*\{\s*p_pass_id:\s*passId,\s*p_reason:/);
    assert.match(m011, /CREATE OR REPLACE FUNCTION public\.redeem_membership_pass\(p_code text\)/);
    assert.match(dbSrc, /rpc\("redeem_membership_pass",\s*\{\s*p_code:\s*normalized\s*\}\)/);

    // 019: set_user_verified(p_user_id uuid, p_verified boolean, p_note text)
    assert.match(m019, /CREATE OR REPLACE FUNCTION public\.set_user_verified\(/);
    assert.match(dbSrc, /rpc\("set_user_verified",\s*\{\s*p_user_id:\s*id,\s*p_verified:\s*verified,\s*p_note:\s*note\s*\?\?\s*null,?\s*\}\)/);
  });
});
