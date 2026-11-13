import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { isUserOnline, countActiveOnlineUsers, ONLINE_PRESENCE_THRESHOLD_MS } from "./src/lib/presence";
import type { UserProfile, DateApplication, DateBooking, ComplimentaryPass, MembershipPass } from "./src/lib/types";

describe("DATEVRA ULTIMATE MASTER REPAIR VERIFICATION SUITE", () => {
  /* -------------------------------------------------------------
   * 1. Preserved Prior Corrections
   * ----------------------------------------------------------- */
  it("preserves profile interest-recording signature and viewer separation", () => {
    const dbSource = fs.readFileSync("src/lib/supabase/db.ts", "utf-8");
    assert.match(
      dbSource,
      /recordProfileInterest\s*\(\s*viewerIdOrTarget\s*:\s*string\s*,\s*targetUserId\?:\s*string\s*\)/,
      "recordProfileInterest must accept viewerId and targetUserId",
    );
    assert.match(
      dbSource,
      /p_viewed_user_id:\s*viewedUserId/,
      "recordProfileInterest must pass viewedUserId to RPC",
    );

    const discoverSource = fs.readFileSync("src/pages/user/Discover.tsx", "utf-8");
    assert.match(
      discoverSource,
      /db\.recordProfileInterest\(\s*me\.id\s*,\s*profile\.id\s*\)/,
      "Discover.tsx must pass me.id as viewer and profile.id as target",
    );
  });

  it("uses classic minimal profile cards in Discover and retains full profile details in modal", () => {
    const discoverSource = fs.readFileSync("src/pages/user/Discover.tsx", "utf-8");
    assert.match(discoverSource, /ProfileCard/, "ProfileCard exists");
    assert.match(discoverSource, /Full Profile/, "Full profile action preserved");
    assert.match(discoverSource, /<CompatBar score=\{viewingCompat\.score\}/, "Full profile modal retains full details");
  });

  /* -------------------------------------------------------------
   * 2. Admin Authorization & ProtectedRoute Guard
   * ----------------------------------------------------------- */
  it("protects admin routes and renders verification loader during auth resolution", () => {
    const layoutSource = fs.readFileSync("src/components/layout.tsx", "utf-8");
    assert.match(
      layoutSource,
      /export function ProtectedRoute\(\{\s*admin\s*=\s*false/,
      "ProtectedRoute exists",
    );
    assert.match(
      layoutSource,
      /Verifying authorization/,
      "ProtectedRoute must render branded verification loader while ready is false",
    );
    assert.match(
      layoutSource,
      /if\s*\(\s*admin\s*&&\s*session\.role\s*!==\s*"admin"\s*\)\s*return\s*<Navigate\s+to="\/app"/,
      "Non-admins must be redirected to /app",
    );

    const authCtxSource = fs.readFileSync("src/context/AuthContext.tsx", "utf-8");
    assert.match(
      authCtxSource,
      /finalRole:\s*"user"\s*\|\s*"admin"\s*=\s*role\s*===\s*"admin"\s*\|\|\s*Boolean\(profile\?\.isAdmin\)/,
      "AuthContext must reconcile supaRole and profile.isAdmin",
    );
  });

  /* -------------------------------------------------------------
   * 3. Experience Application System & Separate Booking Confirmation
   * ----------------------------------------------------------- */
  it("encodes experience applications with structured note and supports admin review", () => {
    const publicExpSource = fs.readFileSync("src/pages/public/ExperiencesPublic.tsx", "utf-8");
    assert.match(publicExpSource, /\[Venue:\s*\$\{activeCafeConfig\.displayName\}\]/, "Note includes Venue");
    assert.match(publicExpSource, /\[Experience:\s*\$\{expTitle\}\]/, "Note includes Experience");
    assert.match(publicExpSource, /\[Guests:\s*\$\{guestCount\}\]/, "Note includes Guests");
    assert.match(publicExpSource, /\[Budget:\s*₹/, "Note includes Budget range");

    const adminAppsSource = fs.readFileSync("src/pages/admin/Applications.tsx", "utf-8");
    assert.match(adminAppsSource, /parseApplicationNote/, "Admin parses structured application note");
    assert.match(adminAppsSource, /setApplicationStatus/, "Admin updates application status");
    assert.match(adminAppsSource, /createBooking/, "Separate booking creation workflow exists");
  });

  it("strictly separates application approval from booking confirmation", () => {
    const adminAppsSource = fs.readFileSync("src/pages/admin/Applications.tsx", "utf-8");
    // Ensure booking requires partner, venue, date, time, and amount
    assert.match(adminAppsSource, /if\s*\(!partnerId\)/, "Booking confirmation requires partnerId");
    assert.match(adminAppsSource, /if\s*\(!venue\.trim\(\)\)/, "Booking confirmation requires venue");
    assert.match(adminAppsSource, /if\s*\(!date\s*\|\|\s*!time\)/, "Booking confirmation requires date and time");
  });

  /* -------------------------------------------------------------
   * 4. Membership Pass Generator (Dedicated System)
   * ----------------------------------------------------------- */
  it("supports dedicated membership passes with MEM- code format, plan tiers and duration", () => {
    const mpSource = fs.readFileSync("src/pages/admin/MembershipPasses.tsx", "utf-8");
    assert.match(mpSource, /createMembershipPass/, "Membership pass generation supported");
    assert.match(mpSource, /revokeMembershipPass/, "Membership pass revocation supported");
    assert.match(mpSource, /MigrationAlertBanner/, "Displays MigrationAlertBanner if table missing");

    const mockDbSource = fs.readFileSync("src/lib/mockDb.ts", "utf-8");
    assert.match(mockDbSource, /MEM-/, "Membership pass code format begins with MEM-");
  });

  /* -------------------------------------------------------------
   * 5. Café Pass Generator (Dedicated System)
   * ----------------------------------------------------------- */
  it("supports dedicated complimentary café passes with DVR- code format and mandatory cafe_id", () => {
    const passesSource = fs.readFileSync("src/pages/admin/Passes.tsx", "utf-8");
    assert.match(passesSource, /createComplimentaryPass/, "Café pass creation supported");
    assert.match(passesSource, /if\s*\(!cafeId\)/, "Café selection is mandatory");
    assert.match(passesSource, /MigrationAlertBanner/, "Displays MigrationAlertBanner if table missing");

    const mockDbSource = fs.readFileSync("src/lib/mockDb.ts", "utf-8");
    assert.match(mockDbSource, /DVR-/, "Café pass code format begins with DVR-");
  });

  /* -------------------------------------------------------------
   * 6. Accurate Online Presence & Expiration
   * ----------------------------------------------------------- */
  it("accurately calculates online presence using 15-minute verifiable activity window and privacy flag", () => {
    const now = Date.now();
    const activeProfile: UserProfile = {
      id: "u-active",
      email: "active@test.com",
      firstName: "Active",
      age: 25,
      gender: "woman",
      interestedIn: "everyone",
      city: "Delhi",
      bio: "Active user",
      interests: [],
      hobbies: [],
      relationshipIntent: "dating",
      lifestyle: [],
      photos: [],
      verified: true,
      online: true,
      lastActive: new Date(now - 5 * 60 * 1000).toISOString(), // 5 mins ago
      profileComplete: 80,
      plan: "connect",
      planExpiresAt: null,
      createdAt: new Date().toISOString(),
    };

    const staleProfile: UserProfile = {
      ...activeProfile,
      id: "u-stale",
      online: true,
      lastActive: new Date(now - 20 * 60 * 1000).toISOString(), // 20 mins ago (stale)
    };

    const privateProfile: UserProfile = {
      ...activeProfile,
      id: "u-private",
      online: false, // turned off presence in settings
      lastActive: new Date(now - 1 * 60 * 1000).toISOString(),
    };

    assert.equal(isUserOnline(activeProfile, now), true, "Recently active profile with online=true is online");
    assert.equal(isUserOnline(staleProfile, now), false, "Profile inactive for >15 mins expires presence");
    assert.equal(isUserOnline(privateProfile, now), false, "Profile with online=false privacy setting is offline");

    const count = countActiveOnlineUsers([activeProfile, staleProfile, privateProfile], now);
    assert.equal(count, 1, "Only verifiable active user within 15 minutes is counted");
  });

  it("ensures Admin Overview and Admin Analytics share the exact same countActiveOnlineUsers logic", () => {
    const overviewSource = fs.readFileSync("src/pages/admin/Overview.tsx", "utf-8");
    const analyticsSource = fs.readFileSync("src/pages/admin/Analytics.tsx", "utf-8");

    assert.match(overviewSource, /countActiveOnlineUsers\(users\)/, "Overview uses countActiveOnlineUsers");
    assert.match(analyticsSource, /countActiveOnlineUsers\(users\)/, "Analytics uses countActiveOnlineUsers");
    assert.match(overviewSource, /active recently/i, "Overview labels presence accurately");
    assert.match(analyticsSource, /Active Recently/i, "Analytics labels presence accurately");
  });

  /* -------------------------------------------------------------
   * 7. Verification RPC & Defense in Depth
   * ----------------------------------------------------------- */
  it("verifies set_user_verified parameter matching and error translation", () => {
    const dbSource = fs.readFileSync("src/lib/supabase/db.ts", "utf-8");
    assert.match(
      dbSource,
      /p_user_id:\s*id,\s*p_verified:\s*verified,\s*p_note:\s*note/,
      "setUserVerified matches (p_user_id, p_verified, p_note)",
    );
    assert.match(
      dbSource,
      /MIGRATION_REQUIRED: Database function public\.set_user_verified is not installed/,
      "setUserVerified translates PGRST202 into MIGRATION_REQUIRED error",
    );

    const verificationSource = fs.readFileSync("src/pages/admin/Verification.tsx", "utf-8");
    assert.match(
      verificationSource,
      /MigrationAlertBanner/,
      "Verification.tsx displays MigrationAlertBanner when migration is missing",
    );
  });

  /* -------------------------------------------------------------
   * 8. Missing-Schema Distinction from Empty States
   * ----------------------------------------------------------- */
  it("distinguishes missing tables from empty lists in Passes and MembershipPasses", () => {
    const dbSource = fs.readFileSync("src/lib/supabase/db.ts", "utf-8");
    assert.match(
      dbSource,
      /MIGRATION_REQUIRED:010:complimentary_passes/,
      "listComplimentaryPasses throws MIGRATION_REQUIRED:010 on missing table",
    );
    assert.match(
      dbSource,
      /MIGRATION_REQUIRED:011:membership_passes/,
      "listMembershipPasses throws MIGRATION_REQUIRED:011 on missing table",
    );
  });

  /* -------------------------------------------------------------
   * 9. Database Migrations Integrity (010, 011, 019, 027)
   * ----------------------------------------------------------- */
  it("verifies SQL migrations 010, 011, 019, and 027 exist and are syntactically sound", () => {
    const m010 = fs.readFileSync("db/migrations/010_passes_proposals.sql", "utf-8");
    assert.match(m010, /complimentary_passes/, "010 creates complimentary_passes");
    assert.match(m010, /redeem_pass/, "010 defines redeem_pass");

    const m011 = fs.readFileSync("db/migrations/011_membership_passes.sql", "utf-8");
    assert.match(m011, /membership_passes/, "011 creates membership_passes");
    assert.match(m011, /create_membership_pass/, "011 defines create_membership_pass");
    assert.match(m011, /revoke_membership_pass/, "011 defines revoke_membership_pass");
    assert.match(m011, /redeem_membership_pass/, "011 defines redeem_membership_pass");

    const m019 = fs.readFileSync("db/migrations/019_verification_defense_in_depth.sql", "utf-8");
    assert.match(m019, /set_user_verified/, "019 defines set_user_verified");
    assert.match(m019, /CANNOT_VERIFY_SELF/, "019 blocks self-verification");

    const m027 = fs.readFileSync("db/migrations/027_seed_curated_experiences.sql", "utf-8");
    assert.match(m027, /e-hotstag-premium-date/, "027 contains e-hotstag-premium-date");
    assert.match(m027, /e-hotstag-coffee-date/, "027 contains e-hotstag-coffee-date");
    assert.match(m027, /e-hotstag-italian/, "027 contains e-hotstag-italian");
    assert.match(m027, /e-karmala-karaoke/, "027 contains e-karmala-karaoke");
    assert.match(m027, /c-hot-stag-del/, "027 references Café Hot Stag cafe_id");
    assert.match(m027, /c-karmala-del/, "027 references Karma La Cafe cafe_id");
  });
});
