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

  it("matches Migration 028 SQL normalization exactly: case-insensitive deduplication and empty-string ignoring", () => {
    // 1. Case variants in them's interests + hobbies must deduplicate case-insensitively
    //    (e.g., "Jazz", "jazz", "JAZZ" = 1 shared interest = 9 pts, NOT 3 = 27 pts).
    const meCase = makeProfile({
      id: "case-me",
      city: "Mumbai",
      interests: ["Jazz", "Coffee"],
      hobbies: [],
      relationshipIntent: "A serious relationship",
      lifestyle: ["Non-smoker"],
      profileComplete: 100,
    });
    const themCase = makeProfile({
      id: "case-them",
      city: "Pune",
      age: 26,
      interests: ["Jazz", "jazz", "JAZZ"],
      hobbies: ["coffee", "COFFEE"],
      relationshipIntent: "A serious relationship",
      lifestyle: ["non-smoker"],
      profileComplete: 80,
    });
    // Expected: 18 (2 unique case-insensitive interests) + 25 (intent) + 15 (age) + 0 (city) + 4 (lifestyle) + 4 (80% complete) = 66 (< 75)
    // Without case-normalized dedup, 5 raw strings would have inflated to 35 pts -> 83% (false positive!).
    const caseRes = computeCompatibility(meCase, themCase, STANDARD_PREFS);
    assert.equal(caseRes.score, 66);
    assert.equal(isCompatibilityEligible(caseRes.score), false);
    assert.ok(
      caseRes.factors.some((f) => f.includes("2 shared interests")),
      `Expected 2 shared interests factor, got: ${caseRes.factors.join(" | ")}`,
    );

    // 2. Empty strings in interests, hobbies, lifestyle, city, and prefs.cities must award 0 points
    const meEmpty = makeProfile({
      id: "empty-me",
      age: 27,
      city: "",
      interests: ["", ""],
      hobbies: [""],
      relationshipIntent: "",
      lifestyle: ["", ""],
      profileComplete: 0,
    });
    const themEmpty = makeProfile({
      id: "empty-them",
      age: 40, // outside STANDARD_PREFS 23-32 -> 0 age pts
      city: "",
      interests: [""],
      hobbies: ["", ""],
      relationshipIntent: "",
      lifestyle: [""],
      verified: false,
      profileComplete: 0,
    });
    const prefsWithEmptyCity: MatchPreferences = {
      ...STANDARD_PREFS,
      cities: [""],
    };
    const emptyRes = computeCompatibility(meEmpty, themEmpty, prefsWithEmptyCity);
    assert.equal(
      emptyRes.score,
      0,
      "Empty strings across city, prefs.cities, interests, hobbies, and lifestyle must contribute 0 points",
    );
    assert.equal(emptyRes.factors.length, 0);

    // 3. Valid values mixed with empty strings score identically to the clean array
    const meMixed = makeProfile({
      id: "mixed-me",
      city: "Mumbai",
      interests: ["", "Cinema", "Jazz", ""],
      hobbies: ["Coffee", ""],
      lifestyle: ["", "Non-smoker"],
    });
    const themMixed = makeProfile({
      id: "mixed-them",
      age: 26,
      city: "Pune",
      interests: ["", "cinema", "CINEMA", "jazz"],
      hobbies: ["coffee", ""],
      lifestyle: ["", "non-smoker", ""],
      profileComplete: 80,
    });
    // Expected: 27 (3 unique: cinema, jazz, coffee) + 25 (intent) + 15 (age) + 0 (city) + 4 (1 lifestyle) + 4 (80% complete) = 75
    const mixedRes = computeCompatibility(meMixed, themMixed, STANDARD_PREFS);
    assert.equal(mixedRes.score, 75);
    assert.equal(isCompatibilityEligible(mixedRes.score), true);
  });

  it("safely retries and unlocks an existing reciprocal like when compatibility improves from 74% to 75%, stays idempotent under repeated/concurrent retries, and keeps blocked users blocked", async () => {
    // Helper: seed both directional likes directly (simulating pre-existing reciprocal likes
    // created while compatibility was < 75% without a match row).
    const seedExistingReciprocalLikes = (userAId: string, userBId: string) => {
      const raw = localStorage.getItem("datevra-db-v1");
      assert.ok(raw, "Expected demo DB in localStorage");
      const parsed = JSON.parse(raw) as {
        likes: Array<{ id: string; fromUserId: string; toUserId: string; createdAt: string }>;
      };
      const now = new Date().toISOString();
      if (!parsed.likes.some((l) => l.fromUserId === userAId && l.toUserId === userBId)) {
        parsed.likes.push({ id: `seed-lk-ab-${Date.now()}`, fromUserId: userAId, toUserId: userBId, createdAt: now });
      }
      if (!parsed.likes.some((l) => l.fromUserId === userBId && l.toUserId === userAId)) {
        parsed.likes.push({ id: `seed-lk-ba-${Date.now()}`, fromUserId: userBId, toUserId: userAId, createdAt: now });
      }
      // Clear mockDb's in-memory cache so the next call rehydrates from localStorage
      mockDb.resetDemo();
      localStorage.setItem("datevra-db-v1", JSON.stringify(parsed));
    };

    // Case 1: Both likes already exist at 74% -> retries remain rejected
    mockDb.resetDemo();
    const pair74 = createScorePair(74);
    const uA = registerProfile(pair74.me, "retry.a@datevra.test");
    mockDb.savePrefs(uA.id, pair74.prefs);
    const uB = registerProfile(pair74.them, "retry.b@datevra.test");
    seedExistingReciprocalLikes(uA.id, uB.id);

    assert.equal(mockDb.hasLiked(uA.id, uB.id), true);
    assert.equal(mockDb.hasLiked(uB.id, uA.id), true);

    const retryAt74 = mockDb.sendLike(uA.id, uB.id);
    assert.equal(retryAt74.match, null);
    assert.equal(retryAt74.compatibilityBlocked, true);
    assert.equal(retryAt74.compatibility, 74);
    assert.equal(retryAt74.minCompatibility, 75);
    assert.equal(mockDb.matchesFor(uA.id).length, 0);
    assert.equal(mockDb.conversationsFor(uA.id).length, 0);
    assert.equal(mockDb.notificationsFor(uA.id).filter((n) => n.kind === "match").length, 0);
    assert.equal(mockDb.notificationsFor(uB.id).filter((n) => n.kind === "match").length, 0);

    // Case 2: Profile improves from 74% -> 75%; retrying with BOTH likes already existing unlocks match once
    mockDb.updateUser(uB.id, {
      bio: "Completed bio",
      photos: ["https://example.com/p1.jpg"],
    });
    const likeNotifsBefore = mockDb.notificationsFor(uB.id).filter((n) => n.kind === "like").length;
    const likesCountBefore = mockDb.likesSent(uA.id).length;

    const unlocked = mockDb.sendLike(uA.id, uB.id);
    assert.ok(unlocked.match, "Existing reciprocal like MUST unlock when score improves to 75%");
    assert.equal(unlocked.compatibilityBlocked, undefined);
    assert.equal(unlocked.match!.compatibility, 75);
    assert.equal(mockDb.likesSent(uA.id).length, likesCountBefore, "No duplicate like row inserted");
    assert.equal(
      mockDb.notificationsFor(uB.id).filter((n) => n.kind === "like").length,
      likeNotifsBefore,
      "No duplicate like notification on retry",
    );
    assert.equal(mockDb.matchesFor(uA.id).length, 1);
    assert.equal(mockDb.conversationsFor(uA.id).length, 1);
    assert.equal(mockDb.notificationsFor(uA.id).filter((n) => n.kind === "match").length, 1);
    assert.equal(mockDb.notificationsFor(uB.id).filter((n) => n.kind === "match").length, 1);

    // Case 3: Repeated & concurrent retries from both sides remain idempotent (no duplicate matches/conversations/notifications)
    const concurrentResults = await Promise.all([
      Promise.resolve().then(() => mockDb.sendLike(uA.id, uB.id)),
      Promise.resolve().then(() => mockDb.sendLike(uB.id, uA.id)),
      Promise.resolve().then(() => mockDb.sendLike(uA.id, uB.id)),
      Promise.resolve().then(() => mockDb.sendLike(uB.id, uA.id)),
    ]);
    for (const r of concurrentResults) {
      assert.equal(r.match?.id, unlocked.match!.id);
    }
    assert.equal(mockDb.matchesFor(uA.id).length, 1, "Exactly 1 match after repeated/concurrent retries");
    assert.equal(mockDb.conversationsFor(uA.id).length, 1, "Exactly 1 conversation after repeated/concurrent retries");
    assert.equal(
      mockDb.notificationsFor(uA.id).filter((n) => n.kind === "match").length,
      1,
      "Exactly 1 match notification for user A",
    );
    assert.equal(
      mockDb.notificationsFor(uB.id).filter((n) => n.kind === "match").length,
      1,
      "Exactly 1 match notification for user B",
    );

    // Case 4: Blocked users with existing reciprocal likes (even at 90% compatibility) MUST remain blocked
    mockDb.resetDemo();
    const pair90 = createScorePair(90);
    const bA = registerProfile(pair90.me, "blocked.a@datevra.test");
    mockDb.savePrefs(bA.id, pair90.prefs);
    const bB = registerProfile(pair90.them, "blocked.b@datevra.test");
    seedExistingReciprocalLikes(bA.id, bB.id);
    mockDb.blockUser(bB.id, bA.id);

    const blockedRetryAB = mockDb.sendLike(bA.id, bB.id);
    const blockedRetryBA = mockDb.sendLike(bB.id, bA.id);
    assert.equal(blockedRetryAB.match, null);
    assert.equal(blockedRetryBA.match, null);
    assert.equal(mockDb.matchesFor(bA.id).length, 0);
    assert.equal(mockDb.conversationsFor(bA.id).length, 0);
    assert.equal(mockDb.notificationsFor(bA.id).filter((n) => n.kind === "match").length, 0);
    assert.equal(mockDb.notificationsFor(bB.id).filter((n) => n.kind === "match").length, 0);
  });

  it("verifies Migration 028 & 029 SQL enforcement, security search_path, canonical lock ordering, and notification idempotency", () => {
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

    // Verify Migration 029 retry RPC & duplicate-notification hardening
    const sql029 = fs.readFileSync("db/migrations/029_reciprocal_like_match_retry.sql", "utf-8");
    assert.match(sql029, /CREATE OR REPLACE FUNCTION public\.retry_mutual_like_match\(/);
    assert.match(sql029, /v_caller\s+uuid\s*:=\s*auth\.uid\(\);/);
    assert.match(sql029, /REVOKE ALL ON FUNCTION public\.retry_mutual_like_match\(uuid\) FROM PUBLIC, anon;/);
    assert.match(sql029, /GRANT EXECUTE ON FUNCTION public\.retry_mutual_like_match\(uuid\) TO authenticated;/);
    assert.match(sql029, /SET search_path = pg_catalog, public, pg_temp/);
    assert.doesNotMatch(sql029, /INSERT INTO public\.likes/, "retry_mutual_like_match must NEVER insert into public.likes");
    assert.doesNotMatch(sql029, /CREATE OR REPLACE FUNCTION public\.respond_to_proposal/, "Migration 029 must keep manual admin proposals separate");

    const retryFn = sql029
      .slice(
        sql029.indexOf("CREATE OR REPLACE FUNCTION public.retry_mutual_like_match("),
        sql029.indexOf("CREATE OR REPLACE FUNCTION public.handle_mutual_like()"),
      )
      .replace(/--.*$/gm, "");
    const rLock = retryFn.indexOf("PERFORM public.lock_matchmaking_pair(a, b);");
    const rBlock = retryFn.indexOf("public.blocked_pair(a, b)");
    const rExisting = retryFn.indexOf("FROM public.matches");
    const rFirstConvoInsert = retryFn.indexOf("INSERT INTO public.conversations");
    const rAlreadyMatched = retryFn.indexOf("'already_matched'");
    const rLikes = retryFn.indexOf("FROM public.likes");
    const rCompat = retryFn.indexOf("public.is_compatibility_eligible(v_compat)");
    const rInsert = retryFn.indexOf("INSERT INTO public.matches");
    const rNullGuard = retryFn.indexOf("IF m_id IS NULL THEN");
    const rNotif = retryFn.indexOf("INSERT INTO public.notifications");

    assert.ok(rLock > 0 && rBlock > rLock, "Retry RPC acquires advisory pair lock before block check");
    assert.ok(rExisting > rBlock, "Block check precedes existing-match lookup");
    assert.ok(rFirstConvoInsert > rBlock && rAlreadyMatched > rBlock, "Blocked pair exits before conversation creation or already_matched return");
    assert.ok(rLikes > rExisting, "Existing-match idempotency check precedes mutual-like check");
    assert.ok(rCompat > rLikes && rInsert > rCompat, "Mutual-like and 75% compatibility gate precede match insert");
    assert.ok(rNullGuard > rInsert && rNotif > rNullGuard, "Notifications only emitted when m_id IS NOT NULL (newly inserted match)");

    // Ensure the old duplicate blocked_pair check was removed
    const blockMatches = retryFn.match(/public\.blocked_pair\(a,\s*b\)/g) ?? [];
    assert.equal(blockMatches.length, 1, "retry_mutual_like_match must contain exactly one blocked_pair(a, b) check");

    const trigger029 = sql029
      .slice(sql029.indexOf("CREATE OR REPLACE FUNCTION public.handle_mutual_like()"))
      .replace(/--.*$/gm, "");
    const tInsert = trigger029.indexOf("INSERT INTO public.matches");
    const tNullGuard = trigger029.indexOf("IF m_id IS NULL THEN");
    const tNotif = trigger029.indexOf("INSERT INTO public.notifications");
    assert.ok(tNullGuard > tInsert && tNotif > tNullGuard, "handle_mutual_like skips notifications when match already existed");
  });

  it("proves a blocked pair with an existing match cannot cause conversation creation or return already_matched through retry", () => {
    // 1. SQL-level contract proof on Migration 029 retry_mutual_like_match():
    //    Verify the exact executable control flow immediately following lock_matchmaking_pair(a, b)
    //    returns status='blocked' with NULL match_id and NULL compatibility before any
    //    existing-match lookup, conversation insert, or 'already_matched' return is reachable.
    const sql029 = fs.readFileSync("db/migrations/029_reciprocal_like_match_retry.sql", "utf-8");
    const retryFn = sql029
      .slice(
        sql029.indexOf("CREATE OR REPLACE FUNCTION public.retry_mutual_like_match("),
        sql029.indexOf("CREATE OR REPLACE FUNCTION public.handle_mutual_like()"),
      )
      .replace(/--.*$/gm, "");

    const lockStmt = "PERFORM public.lock_matchmaking_pair(a, b);";
    const lockEnd = retryFn.indexOf(lockStmt) + lockStmt.length;
    const existingLookupIdx = retryFn.indexOf("FROM public.matches");
    const betweenLockAndExisting = retryFn.slice(lockEnd, existingLookupIdx);

    assert.match(
      betweenLockAndExisting,
      /IF public\.blocked_pair\(a, b\) THEN[\s\S]*?'status',\s*'blocked'[\s\S]*?'match_id',\s*NULL[\s\S]*?'compatibility',\s*NULL[\s\S]*?END IF;/,
      "Blocked-pair guard must immediately follow lock_matchmaking_pair and return status='blocked' with NULL match_id & compatibility before existing-match lookup",
    );
    assert.doesNotMatch(
      betweenLockAndExisting,
      /INSERT INTO public\.conversations|'already_matched'/,
      "No conversation insert or already_matched return may appear before the blocked_pair early return",
    );

    // 2. Runtime behavioral proof (even if a stale match row exists alongside a block record
    //    without a conversation, retrying must NOT return the match or create a conversation).
    mockDb.resetDemo();
    const pair90 = createScorePair(90);
    const uA = registerProfile(pair90.me, "blocked.existing.a@datevra.test");
    mockDb.savePrefs(uA.id, pair90.prefs);
    const uB = registerProfile(pair90.them, "blocked.existing.b@datevra.test");

    const raw = localStorage.getItem("datevra-db-v1");
    assert.ok(raw, "Expected demo DB in localStorage");
    const parsed = JSON.parse(raw) as {
      likes: Array<{ id: string; fromUserId: string; toUserId: string; createdAt: string }>;
      matches: Array<{ id: string; userA: string; userB: string; compatibility: number; factors: string[]; createdAt: string }>;
      blocks: Array<{ id: string; blockerId: string; blockedId: string; createdAt: string }>;
      conversations: Array<{ id: string; matchId: string; participantIds: string[] }>;
    };
    const now = new Date().toISOString();
    parsed.likes.push(
      { id: "lk-ab", fromUserId: uA.id, toUserId: uB.id, createdAt: now },
      { id: "lk-ba", fromUserId: uB.id, toUserId: uA.id, createdAt: now },
    );
    parsed.matches.push({
      id: "stale-match-blocked",
      userA: uA.id,
      userB: uB.id,
      compatibility: 90,
      factors: [],
      createdAt: now,
    });
    parsed.blocks.push({
      id: "blk-ba",
      blockerId: uB.id,
      blockedId: uA.id,
      createdAt: now,
    });
    // Ensure zero conversations exist before retry
    parsed.conversations = parsed.conversations.filter((c) => c.matchId !== "stale-match-blocked");
    mockDb.resetDemo();
    localStorage.setItem("datevra-db-v1", JSON.stringify(parsed));

    const resAB = mockDb.sendLike(uA.id, uB.id);
    const resBA = mockDb.sendLike(uB.id, uA.id);
    assert.equal(resAB.match, null, "Blocked user A must NOT receive stale existing match");
    assert.equal(resBA.match, null, "Blocked user B must NOT receive stale existing match");
    assert.equal(
      mockDb.conversationsFor(uA.id).length,
      0,
      "Blocked pair with existing match must NOT cause conversation creation",
    );
    assert.equal(
      mockDb.conversationsFor(uB.id).length,
      0,
      "Blocked pair with existing match must NOT cause conversation creation for partner",
    );
  });

  it("verifies Supabase adapter and UI surfaces wire centralized threshold, safe retry RPC, and friendly message cleanly", () => {
    const sbSrc = fs.readFileSync("src/lib/supabase/db.ts", "utf-8");
    assert.match(sbSrc, /evaluateMatchEligibility/);
    assert.match(sbSrc, /MIN_COMPATIBILITY_SCORE/);
    assert.match(sbSrc, /compatibilityBlocked:\s*true/);
    assert.match(sbSrc, /rpc\("retry_mutual_like_match"/);
    assert.match(sbSrc, /PGRST202/);

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
