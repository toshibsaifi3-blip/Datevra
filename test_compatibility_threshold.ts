import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";

// Lightweight in-memory localStorage polyfill for Node execution of mockDb
if (typeof globalThis.localStorage === "undefined") {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

import {
  MIN_COMPATIBILITY_SCORE,
  COMPATIBILITY_THRESHOLD_MESSAGE,
  computeCompatibility,
  evaluateMatchEligibility,
  isCompatibilityEligible,
} from "./src/lib/compat";
import * as mockDb from "./src/lib/mockDb";
import type { MatchPreferences, UserProfile } from "./src/lib/types";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u-base",
    email: "base@datevra.test",
    firstName: "Aarav",
    age: 27,
    gender: "man",
    interestedIn: "women",
    city: "Mumbai",
    bio: "Curated profile",
    interests: ["Cinema", "Jazz", "Coffee", "Travel"],
    hobbies: [],
    relationshipIntent: "A serious relationship",
    lifestyle: ["Non-smoker", "Early riser", "Fitness"],
    photos: ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
    verified: true,
    online: true,
    lastActive: new Date().toISOString(),
    profileComplete: 100,
    plan: null,
    planExpiresAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

const STANDARD_PREFS: MatchPreferences = {
  ageMin: 23,
  ageMax: 32,
  interestedIn: "women",
  cities: [],
  maxDistanceKm: 50,
  relationshipIntents: [],
  minSharedInterests: 0,
};

function createScorePair(targetScore: number): {
  me: UserProfile;
  them: UserProfile;
  prefs: MatchPreferences;
} {
  const me = makeProfile({ id: `me-${targetScore}` });
  const prefs = { ...STANDARD_PREFS };
  switch (targetScore) {
    case 100:
      // 35 (4 shared) + 25 (same intent) + 15 (age) + 10 (same city) + 10 (3 lifestyle) + 5 (profileComplete>=95) = 100
      return {
        me,
        prefs,
        them: makeProfile({
          id: "them-100",
          firstName: "Naina",
          gender: "woman",
          age: 26,
          city: "Mumbai",
          interests: ["Cinema", "Jazz", "Coffee", "Travel"],
          relationshipIntent: "A serious relationship",
          lifestyle: ["Non-smoker", "Early riser", "Fitness"],
          photos: ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
          profileComplete: 100,
        }),
      };
    case 90:
      // 35 (4 shared) + 25 (same intent) + 15 (age) + 0 (diff city) + 10 (3 lifestyle) + 5 (profileComplete>=95) = 90
      return {
        me,
        prefs,
        them: makeProfile({
          id: "them-90",
          firstName: "Tara",
          gender: "woman",
          age: 26,
          city: "Pune",
          interests: ["Cinema", "Jazz", "Coffee", "Travel"],
          relationshipIntent: "A serious relationship",
          lifestyle: ["Non-smoker", "Early riser", "Fitness"],
          photos: ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
          profileComplete: 95,
        }),
      };
    case 75:
      // 27 (3 shared) + 25 (same intent) + 15 (age) + 0 (diff city) + 4 (1 lifestyle) + 4 (80% complete) = 75
      return {
        me,
        prefs,
        them: makeProfile({
          id: "them-75",
          firstName: "Diya",
          gender: "woman",
          age: 26,
          city: "Pune",
          interests: ["Cinema", "Jazz", "Coffee"],
          relationshipIntent: "A serious relationship",
          lifestyle: ["Non-smoker"],
          photos: ["https://example.com/p1.jpg"],
          profileComplete: 80,
        }),
      };
    case 74:
      // 27 (3 shared) + 25 (same intent) + 15 (age) + 0 (diff city) + 4 (1 lifestyle) + 3 (60% complete) = 74
      return {
        me,
        prefs,
        them: makeProfile({
          id: "them-74",
          firstName: "Rhea",
          gender: "woman",
          age: 26,
          city: "Pune",
          bio: "",
          interests: ["Cinema", "Jazz", "Coffee"],
          relationshipIntent: "A serious relationship",
          lifestyle: ["Non-smoker"],
          photos: [],
          profileComplete: 60,
        }),
      };
    case 50:
      // 0 (0 shared) + 25 (same intent) + 15 (age) + 0 (diff city) + 8 (2 lifestyle) + 2 (45% complete) = 50
      return {
        me,
        prefs,
        them: makeProfile({
          id: "them-50",
          firstName: "Sana",
          gender: "woman",
          age: 26,
          city: "Jaipur",
          bio: "",
          interests: [],
          hobbies: ["Cricket"],
          relationshipIntent: "A serious relationship",
          lifestyle: ["Non-smoker", "Early riser"],
          photos: [],
          profileComplete: 45,
        }),
      };
    case 30:
      // 0 (0 shared) + 25 (same intent) + 0 (age 40 outside) + 0 (diff city) + 0 (lifestyle) + 5 (100% complete) = 30
      return {
        me,
        prefs,
        them: makeProfile({
          id: "them-30",
          firstName: "Ira",
          gender: "woman",
          age: 40,
          city: "Jaipur",
          interests: ["Cricket", "Chess", "Singing", "Pottery", "Reading"],
          relationshipIntent: "A serious relationship",
          lifestyle: [],
          photos: ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
          profileComplete: 100,
        }),
      };
    case 0:
      // 0 (0 shared) + 0 (empty intent) + 0 (age 40 outside) + 0 (diff city) + 0 (lifestyle) + 0 (0% complete) = 0
      return {
        me,
        prefs,
        them: makeProfile({
          id: "them-0",
          firstName: "Zoya",
          gender: "woman",
          age: 40,
          city: "Jaipur",
          bio: "",
          interests: [],
          relationshipIntent: "",
          lifestyle: [],
          photos: [],
          profileComplete: 0,
        }),
      };
    default:
      throw new Error(`Unsupported targetScore: ${targetScore}`);
  }
}

function registerProfile(profile: UserProfile, email: string): UserProfile {
  const res = mockDb.register({
    firstName: profile.firstName,
    email,
    password: "Password123!",
    age: profile.age,
    gender: profile.gender,
    interestedIn: profile.interestedIn,
    city: profile.city,
  });
  assert.equal(res.ok, true, `Failed to register ${email}`);
  if (!res.ok) throw new Error(res.error);
  const updated = mockDb.updateUser(res.session.userId, {
    bio: profile.bio,
    interests: profile.interests,
    hobbies: profile.hobbies,
    relationshipIntent: profile.relationshipIntent,
    lifestyle: profile.lifestyle,
    photos: profile.photos,
    verified: profile.verified,
  });
  assert.ok(updated);
  return updated;
}

describe("DATEVRA 75% MINIMUM COMPATIBILITY THRESHOLD SUITE", () => {
  beforeEach(() => {
    mockDb.resetDemo();
  });

  it("exposes a single centralized 75% constant and exact boundary threshold semantics", () => {
    assert.equal(MIN_COMPATIBILITY_SCORE, 75);
    assert.ok(COMPATIBILITY_THRESHOLD_MESSAGE.includes("75%"));

    const expected: Array<[number | null | undefined, boolean]> = [
      [100, true],
      [90, true],
      [75, true],
      [74, false],
      [50, false],
      [30, false],
      [0, false],
      [-5, false],
      [null, false],
      [undefined, false],
      [Number.NaN, false],
      [Number.POSITIVE_INFINITY, false],
    ];

    for (const [score, allowed] of expected) {
      assert.equal(
        isCompatibilityEligible(score),
        allowed,
        `Score ${String(score)} should be ${allowed ? "allowed" : "blocked"}`,
      );
    }
  });

  it("verifies exact dynamic compatibility calculation and threshold boundary across 100, 90, 75, 74, 50, 30, 0, and unavailable", () => {
    const cases: Array<[number, boolean]> = [
      [100, true],
      [90, true],
      [75, true],
      [74, false],
      [50, false],
      [30, false],
      [0, false],
    ];

    for (const [score, expectedEligible] of cases) {
      const { me, them, prefs } = createScorePair(score);
      const computed = computeCompatibility(me, them, prefs);
      assert.equal(computed.score, score, `Constructed pair must compute exact score ${score}`);
      const evalRes = evaluateMatchEligibility(me, them, prefs);
      assert.equal(evalRes.score, score);
      assert.equal(evalRes.eligible, expectedEligible);
    }

    // Missing / unavailable profile or numeric fields must fail closed
    assert.deepEqual(evaluateMatchEligibility(null, makeProfile(), STANDARD_PREFS), {
      eligible: false,
      score: null,
      factors: [],
    });
    assert.deepEqual(evaluateMatchEligibility(makeProfile(), undefined, STANDARD_PREFS), {
      eligible: false,
      score: null,
      factors: [],
    });
    const invalidNumeric = makeProfile({ age: Number.NaN });
    assert.deepEqual(evaluateMatchEligibility(makeProfile(), invalidNumeric, STANDARD_PREFS), {
      eligible: false,
      score: null,
      factors: [],
    });
  });

  it("blocks mutual likes below 75% (74%, 50%, 30%, 2%) without creating match, conversation, or match notifications", () => {
    for (const targetScore of [74, 50, 30, 0]) {
      mockDb.resetDemo();
      const pair = createScorePair(targetScore);
      const uMe = registerProfile(pair.me, `me.${targetScore}@datevra.test`);
      mockDb.savePrefs(uMe.id, pair.prefs);
      const uThem = registerProfile(pair.them, `them.${targetScore}@datevra.test`);

      const expectedScore = computeCompatibility(uMe, uThem, pair.prefs).score;
      assert.equal(expectedScore < 75, true, `Score ${expectedScore} must remain below 75`);

      // One-way like (uThem -> uMe) works normally without creating a match
      const firstLike = mockDb.sendLike(uThem.id, uMe.id);
      assert.equal(firstLike.match, null);
      assert.equal(firstLike.compatibilityBlocked, undefined);

      // Reciprocal like from uMe -> uThem must be blocked at score < 75
      const mutualAttempt = mockDb.sendLike(uMe.id, uThem.id);
      assert.equal(mutualAttempt.match, null, `Score ${expectedScore}% must NOT create a match`);
      assert.equal(mutualAttempt.compatibilityBlocked, true, `Score ${expectedScore}% must flag compatibilityBlocked`);
      assert.equal(mutualAttempt.compatibility, expectedScore);
      assert.equal(mutualAttempt.minCompatibility, 75);

      assert.equal(mockDb.matchesFor(uMe.id).length, 0, "No Match record created");
      assert.equal(mockDb.matchesFor(uThem.id).length, 0, "No Match record created for partner");
      assert.equal(mockDb.conversationsFor(uMe.id).length, 0, "No Conversation created");
      assert.equal(
        mockDb.notificationsFor(uMe.id).some((n) => n.kind === "match"),
        false,
        "No match notification created for initiator",
      );
      assert.equal(
        mockDb.notificationsFor(uThem.id).some((n) => n.kind === "match"),
        false,
        "No match notification created for partner",
      );
    }
  });

  it("allows mutual likes at or above 75% (75%, 90%, 100%) and unlocks match if profile compatibility improves", () => {
    for (const score of [75, 90, 100]) {
      mockDb.resetDemo();
      const pair = createScorePair(score);
      const uMe = registerProfile(pair.me, `me.${score}@datevra.test`);
      mockDb.savePrefs(uMe.id, pair.prefs);
      const uThem = registerProfile(pair.them, `them.${score}@datevra.test`);

      mockDb.sendLike(uThem.id, uMe.id);
      const mutual = mockDb.sendLike(uMe.id, uThem.id);
      assert.ok(mutual.match, `Score ${score}% MUST create a mutual match`);
      assert.equal(mutual.compatibilityBlocked, undefined);
      assert.equal(mutual.match!.compatibility, score);
      assert.equal(mockDb.matchesFor(uMe.id).length, 1);
      assert.equal(mockDb.conversationsFor(uMe.id).length, 1);
      assert.equal(
        mockDb.notificationsFor(uMe.id).filter((n) => n.kind === "match").length,
        1,
      );

      // Re-sending like returns existing match idempotently without duplicate rows
      const replay = mockDb.sendLike(uMe.id, uThem.id);
      assert.equal(replay.match?.id, mutual.match?.id);
      assert.equal(mockDb.matchesFor(uMe.id).length, 1);
    }

    // Improvement case: blocked at 74%, then allowed when profile rises to 75%+
    mockDb.resetDemo();
    const pair74 = createScorePair(74);
    const uA = registerProfile(pair74.me, "upgrade.a@datevra.test");
    mockDb.savePrefs(uA.id, pair74.prefs);
    const uB = registerProfile(pair74.them, "upgrade.b@datevra.test");

    mockDb.sendLike(uB.id, uA.id);
    const blockedRes = mockDb.sendLike(uA.id, uB.id);
    assert.equal(blockedRes.compatibilityBlocked, true);
    assert.equal(blockedRes.compatibility, 74);

    // Adding bio + photo completes profile (60 -> 80), lifting score from 74 -> 75
    mockDb.updateUser(uB.id, {
      bio: "Completed bio",
      photos: ["https://example.com/p1.jpg"],
    });
    const unlockedRes = mockDb.sendLike(uA.id, uB.id);
    assert.ok(unlockedRes.match, "Retrying after reaching 75% creates the match");
    assert.equal(unlockedRes.match!.compatibility, 75);
  });

  it("preserves separate manual Admin curated proposal workflow (dual consent)", () => {
    const prop = mockDb.createMatchProposal("u-meera", "u-rohan", "Curated intro", "admin-1");
    assert.equal(prop.status, "pending");
    mockDb.respondToMatchProposal(prop.id, "u-meera", true);
    const accepted = mockDb.respondToMatchProposal(prop.id, "u-rohan", true);
    assert.equal(accepted.status, "accepted");
  });

  it("verifies Migration 028 SQL enforcement, security search_path, and canonical lock ordering", () => {
    const sql = fs.readFileSync("db/migrations/028_minimum_compatibility_threshold.sql", "utf-8");
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.min_match_compatibility\(\)/);
    assert.match(sql, /SELECT 75;/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.is_compatibility_eligible\(p_score integer\)/);
    assert.match(sql, /p_score IS NOT NULL AND p_score >= public\.min_match_compatibility\(\)/);
    assert.match(sql, /CREATE OR REPLACE FUNCTION public\.calculate_pair_compatibility\(/);
    assert.match(sql, /REVOKE ALL ON FUNCTION public\.calculate_pair_compatibility\(uuid, uuid\) FROM PUBLIC, anon, authenticated;/);
    assert.match(sql, /SET search_path = pg_catalog, public, pg_temp/);

    const triggerFn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.handle_mutual_like()"));
    const lockIdx = triggerFn.indexOf("PERFORM public.lock_matchmaking_pair(a, b);");
    const recIdx = triggerFn.indexOf("FROM public.likes");
    const blockIdx = triggerFn.indexOf("public.blocked_pair(a, b)");
    const compatIdx = triggerFn.indexOf("public.is_compatibility_eligible(v_compat)");
    const insertMatchIdx = triggerFn.indexOf("INSERT INTO public.matches");

    assert.ok(lockIdx > 0 && recIdx > lockIdx, "Advisory pair lock precedes reciprocal like check");
    assert.ok(blockIdx > recIdx, "Block check precedes match creation");
    assert.ok(compatIdx > blockIdx && insertMatchIdx > compatIdx, "Compatibility gate precedes match, conversation, and notification creation");
  });

  it("verifies Supabase adapter and UI surfaces wire centralized threshold and friendly message cleanly", () => {
    const sbSrc = fs.readFileSync("src/lib/supabase/db.ts", "utf-8");
    assert.match(sbSrc, /evaluateMatchEligibility/);
    assert.match(sbSrc, /MIN_COMPATIBILITY_SCORE/);
    assert.match(sbSrc, /compatibilityBlocked:\s*true/);

    for (const file of [
      "src/pages/user/Discover.tsx",
      "src/pages/user/Likes.tsx",
      "src/pages/user/Dashboard.tsx",
      "src/pages/public/Home.tsx",
    ]) {
      const src = fs.readFileSync(file, "utf-8");
      assert.match(src, /CompatibilityBlockedModal/, `${file} renders CompatibilityBlockedModal`);
      assert.match(src, /compatibilityBlocked/, `${file} handles compatibilityBlocked response`);
    }
  });
});
