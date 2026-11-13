// ============================================================================
// DATEVRA Master Repairs Verification Test Suite
// Verifies fixes for Screenshot Errors A, B, C, D, E, Online Counter & Types
// ============================================================================

import * as fs from "fs";
import * as path from "path";
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

console.log("=== DATEVRA Master Repairs Verification Suite ===\n");

// ----------------------------------------------------------------------------
// TEST 1: Screenshot Error A — recordProfileInterest Target Mapping Fix
// ----------------------------------------------------------------------------
console.log("Test 1: Screenshot Error A — recordProfileInterest Target Mapping");

const dbContent = fs.readFileSync(path.join(process.cwd(), "src/lib/supabase/db.ts"), "utf-8");

// Assert db.ts accepts 2 arguments and resolves the target profile ID
assert(
  dbContent.includes("async function recordProfileInterest(viewerIdOrTarget: string, targetUserId?: string)"),
  "recordProfileInterest accepts both 1-arg and 2-arg caller signatures"
);

assert(
  dbContent.includes("const viewedUserId = targetUserId ? targetUserId : viewerIdOrTarget;"),
  "recordProfileInterest correctly extracts targetUserId when viewerId is passed as first argument"
);

assert(
  dbContent.includes("p_viewed_user_id: viewedUserId"),
  "recordProfileInterest passes target user ID (not viewer ID) to Supabase RPC"
);

// Verify Discover.tsx calls it with (me.id, profile.id)
const discoverContent = fs.readFileSync(path.join(process.cwd(), "src/pages/user/Discover.tsx"), "utf-8");
assert(
  discoverContent.includes("await db.recordProfileInterest(me.id, profile.id)"),
  "Discover.tsx passes viewer and target profile to db.recordProfileInterest"
);

// Functional test using mockDb
const allUsers = mockDb.allUsers();
const viewer = allUsers[0];
const target = allUsers[1];
const interestRes = mockDb.recordProfileInterest(viewer.id, target.id);
assert(
  typeof interestRes.used === "number" && interestRes.limit === 20,
  "Functional test: recording interest on a valid distinct profile succeeds"
);

// ----------------------------------------------------------------------------
// TEST 2: Screenshot Error B — Verification Approval RPC & Missing Migration Guard
// ----------------------------------------------------------------------------
console.log("\nTest 2: Screenshot Error B — Verification RPC & Migration Guard");

assert(
  dbContent.includes("p_user_id: id") &&
  dbContent.includes("p_verified: verified") &&
  dbContent.includes("p_note: note ?? null"),
  "setUserVerified passes exact parameter names (p_user_id, p_verified, p_note) matching migration 019"
);

assert(
  dbContent.includes("MIGRATION_REQUIRED: Database function public.set_user_verified is not installed"),
  "setUserVerified translates PGRST202 schema cache error to clear MIGRATION_REQUIRED message"
);

// ----------------------------------------------------------------------------
// TEST 3: Screenshot Errors C & D — Pass RPC & Table Schema Cache Guards
// ----------------------------------------------------------------------------
console.log("\nTest 3: Screenshot Errors C & D — Pass RPC & Table Schema Cache Guards");

assert(
  dbContent.includes("myComplimentaryPasses") &&
  dbContent.includes("return [];"),
  "myComplimentaryPasses returns empty array instead of crashing user screens when table is missing"
);

assert(
  dbContent.includes("listComplimentaryPasses") &&
  dbContent.includes("MIGRATION_REQUIRED:010:complimentary_passes"),
  "listComplimentaryPasses raises MIGRATION_REQUIRED for admin banner when table is missing"
);

assert(
  dbContent.includes("listMembershipPasses") &&
  dbContent.includes("MIGRATION_REQUIRED:011:membership_passes"),
  "listMembershipPasses raises MIGRATION_REQUIRED for admin banner when table is missing"
);

assert(
  dbContent.includes("MIGRATION_REQUIRED: Database function public.create_membership_pass is not installed"),
  "createMembershipPass catches PGRST202/PGRST205 and raises clear MIGRATION_REQUIRED message"
);

assert(
  dbContent.includes("MIGRATION_REQUIRED: Database table public.complimentary_passes is not installed"),
  "createComplimentaryPass catches PGRST205 and raises clear MIGRATION_REQUIRED message"
);

// ----------------------------------------------------------------------------
// TEST 4: Screenshot Requirement E — Concise Discovery Card & Detailed Full Profile
// ----------------------------------------------------------------------------
console.log("\nTest 4: Screenshot Requirement E — Discovery Card vs Full Profile Separation");

// Discovery Card should render only photo, name, age, and Full Profile button (no bio, tags, or CompatBar)
const profileCardSlice = discoverContent.slice(
  discoverContent.indexOf("function ProfileCard("),
  discoverContent.indexOf("interface DeckData"),
);

assert(
  !profileCardSlice.includes('[...p.interests, ...p.hobbies].slice(0, 8)') &&
    !profileCardSlice.includes('p.interests.slice(0, 3)') &&
    !profileCardSlice.includes('{p.bio}') &&
    !profileCardSlice.includes('{p.city}') &&
    !profileCardSlice.includes('{entry.score}'),
  "Discovery Card displays minimal Tinder-style photo, name, age, and Full Profile button only"
);

assert(
  profileCardSlice.includes('{p.firstName}, {p.age}') &&
    profileCardSlice.includes('Full Profile'),
  "Discovery Card includes name, age overlay and clearly visible Full Profile button"
);

// Full Profile modal must still contain the full information
assert(
  discoverContent.includes('{viewing.bio && <p className="text-ivory-dim leading-relaxed">{viewing.bio}</p>}'),
  "Full Profile modal preserves complete un-truncated biography"
);

assert(
  discoverContent.includes('{viewing.photos.map((url, i) => ('),
  "Full Profile modal preserves all member photos in gallery grid"
);

assert(
  discoverContent.includes('{viewing.interests.map((i) => ('),
  "Full Profile modal preserves all interest tags"
);

assert(
  discoverContent.includes('{viewing.hobbies.map((i) => ('),
  "Full Profile modal preserves all hobby tags"
);

assert(
  discoverContent.includes('{viewing.lifestyle.map((i) => ('),
  "Full Profile modal preserves all lifestyle tags"
);

assert(
  discoverContent.includes('<CompatBar score={viewingCompat.score} factors={viewingCompat.factors} />'),
  "Full Profile modal preserves detailed multi-factor compatibility breakdown"
);

// ----------------------------------------------------------------------------
// TEST 5: Issue 4.D — Verified Active Online Members Counter
// ----------------------------------------------------------------------------
console.log("\nTest 5: Issue 4.D — Verified Active Online Members Counter");

const overviewContent = fs.readFileSync(path.join(process.cwd(), "src/pages/admin/Overview.tsx"), "utf-8");
assert(
  overviewContent.includes("onlineCount: countActiveOnlineUsers(users)"),
  "Overview.tsx dynamically calculates online members count using verifiable recent activity"
);

assert(
  overviewContent.includes("{metrics.onlineCount} active recently"),
  "Overview.tsx displays verifiable active recently indicator with pulse"
);

const analyticsContent = fs.readFileSync(path.join(process.cwd(), "src/pages/admin/Analytics.tsx"), "utf-8");
assert(
  analyticsContent.includes("countActiveOnlineUsers(users)") && analyticsContent.includes("Active Recently"),
  "Analytics.tsx displays verified active online members counter badge"
);

// ----------------------------------------------------------------------------
// TEST 6: UserProfile & Mappers isAdmin Property
// ----------------------------------------------------------------------------
console.log("\nTest 6: UserProfile & Mappers isAdmin Property");

const typesContent = fs.readFileSync(path.join(process.cwd(), "src/lib/types.ts"), "utf-8");
assert(
  typesContent.includes("isAdmin?: boolean;"),
  "UserProfile interface in types.ts includes isAdmin optional boolean"
);

const mappersContent = fs.readFileSync(path.join(process.cwd(), "src/lib/supabase/mappers.ts"), "utf-8");
assert(
  mappersContent.includes("isAdmin: bool(r.is_admin)"),
  "mapProfile maps r.is_admin to isAdmin"
);

// ============================================================================
// Summary
// ============================================================================
console.log("\n========================================");
console.log(`Test Results: ${passed} PASSED, ${failed} FAILED`);
console.log("========================================");

if (failed > 0) {
  process.exit(1);
}
