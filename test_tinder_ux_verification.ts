import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import {
  validateBasicIdentity,
  toggleTag,
  addCustomTagItem,
  isProfileSetupComplete,
  determineInitialOnboardingStep,
} from "./src/lib/profileFields";
import {
  BROAD_DEFAULT_PREFS,
  matchesPreferences,
  activeFilterLabels,
  rankCandidates,
  computeCompatibility,
} from "./src/lib/compat";
import { profileCompleteness, unmapProfilePatch } from "./src/lib/supabase/mappers";
import * as mockDb from "./src/lib/mockDb";
import type { MatchPreferences, UserProfile } from "./src/lib/types";

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: "u-test",
    email: "test@example.com",
    firstName: "Aanya",
    age: 26,
    gender: "woman",
    interestedIn: "men",
    city: "Mumbai",
    bio: "Architectural photographer and coffee enthusiast.",
    interests: ["Architecture", "Coffee", "Cinema", "Jazz", "Travel"],
    hobbies: ["Sketching", "Cycling"],
    relationshipIntent: "A serious relationship",
    lifestyle: ["Non-smoker", "Early riser"],
    photos: ["https://example.com/1.jpg", "https://example.com/2.jpg"],
    verified: true,
    online: false,
    lastActive: new Date().toISOString(),
    profileComplete: 100,
    plan: null,
    planExpiresAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("DATEVRA TINDER-STYLE UX UPGRADE VERIFICATION SUITE", () => {
  /* -------------------------------------------------------------
   * Phase 1: Account Creation, Guided Onboarding & Profile Parity
   * ----------------------------------------------------------- */
  describe("Phase 1: Onboarding & Profile Parity", () => {
    it("validates basic identity rules (non-empty first name and age 18–100)", () => {
      assert.ok(validateBasicIdentity("", 25).firstName, "Empty name fails");
      assert.ok(validateBasicIdentity("   ", 25).firstName, "Whitespace name fails");
      assert.ok(validateBasicIdentity("Riya", 17).age, "Under 18 fails");
      assert.ok(validateBasicIdentity("Riya", 101).age, "Over 100 fails");
      assert.ok(validateBasicIdentity("Riya", Number.NaN).age, "NaN fails");
      assert.deepEqual(validateBasicIdentity("Riya", 18), {}, "Minimum adult age 18 passes");
      assert.deepEqual(validateBasicIdentity("Riya", 100), {}, "Age 100 passes");
    });

    it("handles shared tag toggles and deduplicated custom additions", () => {
      assert.deepEqual(toggleTag(["Jazz", "Travel"], "Jazz"), ["Travel"]);
      assert.deepEqual(toggleTag(["Travel"], "Jazz"), ["Travel", "Jazz"]);
      assert.deepEqual(
        addCustomTagItem(["Filter Coffee"], "  filter coffee "),
        ["Filter Coffee"],
        "Case-insensitive duplicate custom tag ignored",
      );
      assert.deepEqual(
        addCustomTagItem(["Travel"], "Vinyl Records"),
        ["Travel", "Vinyl Records"],
      );
    });

    it("resumes onboarding at the first missing step and respects completion parity", () => {
      const bare = makeProfile({
        firstName: "Member",
        bio: "",
        relationshipIntent: "",
        interests: [],
        photos: [],
      });
      assert.equal(determineInitialOnboardingStep(bare), 1);
      assert.equal(isProfileSetupComplete(bare), false);

      const step2 = makeProfile({ bio: "", relationshipIntent: "", interests: [], photos: [] });
      assert.equal(determineInitialOnboardingStep(step2), 2);

      const step3 = makeProfile({ relationshipIntent: "", interests: [], photos: [] });
      assert.equal(determineInitialOnboardingStep(step3), 3);

      const step4 = makeProfile({ interests: [], photos: [] });
      assert.equal(determineInitialOnboardingStep(step4), 4);

      const step5 = makeProfile({ photos: [] });
      assert.equal(determineInitialOnboardingStep(step5), 5);
      assert.equal(isProfileSetupComplete(step5), false, "Missing photos stays incomplete");

      const full = makeProfile();
      assert.equal(profileCompleteness(full), 100);
      assert.equal(isProfileSetupComplete(full), true);
      assert.equal(determineInitialOnboardingStep(full), 6);
    });

    it("preserves untouched profile fields in partial step patches", () => {
      const step1Patch = unmapProfilePatch({
        firstName: "Ishaan",
        age: 27,
        gender: "man",
        city: "Mumbai",
      });
      assert.deepEqual(Object.keys(step1Patch).sort(), [
        "age",
        "city",
        "first_name",
        "gender",
      ]);
      assert.equal("bio" in step1Patch, false, "Step 1 patch must not clobber bio");
      assert.equal("photos" in step1Patch, false, "Step 1 patch must not clobber photos");
    });

    it("wires /onboarding route, single-hydration guard, and auth metadata persistence", () => {
      const appSrc = fs.readFileSync("src/App.tsx", "utf-8");
      assert.match(appSrc, /path="onboarding"/, "/onboarding route exists");

      const onboardingSrc = fs.readFileSync("src/pages/user/Onboarding.tsx", "utf-8");
      assert.match(onboardingSrc, /hydratedUserIdRef/, "Single hydration guard present");
      assert.match(onboardingSrc, /savingRef\.current/, "Concurrent save lock present");
      assert.match(onboardingSrc, /navigator\.onLine === false/, "Offline preservation guard present");
      assert.match(onboardingSrc, /isProfileSetupComplete\(user\)/, "Completed-member bypass check present");
      assert.match(onboardingSrc, /PhotoManager/, "Uses real PhotoManager storage pipeline");

      const authSrc = fs.readFileSync("src/lib/supabase/auth.ts", "utf-8");
      assert.match(authSrc, /first_name:\s*input\.firstName/, "Stores first_name in signup metadata");
      assert.match(authSrc, /interested_in:\s*input\.interestedIn/, "Stores interested_in in signup metadata");
    });
  });

  /* -------------------------------------------------------------
   * Phase 2: Discovery Filtering, Card Stack & Photo Polish
   * ----------------------------------------------------------- */
  describe("Phase 2: Discovery Filtering & Swipe Deck", () => {
    const me = makeProfile({
      id: "me-1",
      age: 27,
      gender: "man",
      interestedIn: "women",
      city: "Mumbai",
      interests: ["Architecture", "Jazz", "Filter coffee"],
      hobbies: ["Cycling"],
    });

    const cMatch = makeProfile({
      id: "c-1",
      firstName: "Meera",
      age: 26,
      gender: "woman",
      city: "Mumbai",
      relationshipIntent: "A serious relationship",
      interests: ["Jazz", "Poetry"],
      hobbies: ["Cycling"],
    });
    const cTooOld = makeProfile({ id: "c-2", firstName: "Kavya", age: 41, gender: "woman", city: "Mumbai" });
    const cWrongCity = makeProfile({ id: "c-3", firstName: "Anaya", age: 27, gender: "woman", city: "Bengaluru" });
    const cWrongGender = makeProfile({ id: "c-4", firstName: "Kabir", age: 28, gender: "man", city: "Mumbai" });
    const cZeroShared = makeProfile({
      id: "c-5",
      firstName: "Diya",
      age: 27,
      gender: "woman",
      city: "Mumbai",
      interests: ["Cricket", "Gaming"],
      hobbies: ["Astrology"],
    });

    it("enforces age, gender orientation, city, intent, and minSharedInterests filters truthfully", () => {
      const strictPrefs: MatchPreferences = {
        ageMin: 23,
        ageMax: 32,
        interestedIn: "women",
        cities: ["Mumbai"],
        maxDistanceKm: 50,
        relationshipIntents: ["A serious relationship"],
        minSharedInterests: 1,
      };
      assert.equal(matchesPreferences(me, cMatch, strictPrefs), true);
      assert.equal(matchesPreferences(me, cTooOld, strictPrefs), false, "Age > ageMax filtered out");
      assert.equal(matchesPreferences(me, cWrongCity, strictPrefs), false, "Non-matching city filtered out");
      assert.equal(matchesPreferences(me, cWrongGender, strictPrefs), false, "Non-matching gender filtered out");
      assert.equal(matchesPreferences(me, cZeroShared, strictPrefs), false, "Insufficient shared interests filtered out");

      const ranked = rankCandidates(
        me,
        [me, cMatch, cTooOld, cWrongCity, cWrongGender, cZeroShared],
        strictPrefs,
        new Set(["excluded-other"]),
      );
      assert.deepEqual(ranked.map((r) => r.profile.id), ["c-1"]);
      assert.equal(
        rankCandidates(me, [cTooOld], strictPrefs, new Set()).length,
        0,
        "Zero synthetic fallback candidates invented when all filtered out",
      );
    });

    it("synchronizes activeFilterLabels cleanly with BROAD_DEFAULT_PREFS", () => {
      assert.deepEqual(activeFilterLabels(BROAD_DEFAULT_PREFS), []);
      const labels = activeFilterLabels({
        ageMin: 24,
        ageMax: 32,
        interestedIn: "women",
        cities: ["Mumbai"],
        maxDistanceKm: 50,
        relationshipIntents: [],
        minSharedInterests: 2,
      });
      assert.equal(labels.length, 4);
    });

    it("verifies Discover.tsx swipe safety, photo tap zones, reduced motion, and keyboard guards", () => {
      const discoverSrc = fs.readFileSync("src/pages/user/Discover.tsx", "utf-8");
      assert.equal(
        (discoverSrc.match(/\bconst swipe\s*=/g) ?? []).length,
        1,
        "No duplicate swipe handler declarations",
      );
      assert.match(discoverSrc, /busyActionRef\.current/, "Concurrent swipe/like lock present");
      assert.match(discoverSrc, /useReducedMotion/, "Respects prefers-reduced-motion");
      assert.match(discoverSrc, /aria-live="polite"/, "Screen reader live announcements present");
      assert.match(discoverSrc, /draggingRef\.current/, "Photo tap zones guarded against swipe drags");
      assert.match(discoverSrc, /Previous photo of/, "Accessible previous photo control present");
      assert.match(discoverSrc, /Next photo of/, "Accessible next photo control present");
      assert.match(discoverSrc, /activeEl\.closest\('\[role="dialog"\]'\)/, "Keyboard shortcut modal guard present");
      assert.match(discoverSrc, /Reset all filters/, "Filter reset action present");
    });
  });

  /* -------------------------------------------------------------
   * Phase 3: Likes, Mutual Matches & Compatibility
   * ----------------------------------------------------------- */
  describe("Phase 3: Likes & Matches Flow", () => {
    it("creates a real mutual match only when both users like each other in mockDb", () => {
      const users = mockDb.allUsers();
      assert.ok(users.length >= 3);
      const a = users[0];
      const freshTarget = users.find(
        (u) =>
          u.id !== a.id &&
          !mockDb.likesSent(a.id).some((l) => l.toUserId === u.id) &&
          !mockDb.matchesFor(a.id).some((m) => m.userA === u.id || m.userB === u.id),
      );
      assert.ok(freshTarget, "Found unliked target in mockDb");

      const oneWay = mockDb.sendLike(a.id, freshTarget.id);
      assert.equal(oneWay.match, null, "One-way like does not fabricate a match");

      const twoWay = mockDb.sendLike(freshTarget.id, a.id);
      assert.ok(twoWay.match, "Reciprocal like creates mutual match");
      const matchesA = mockDb.matchesFor(a.id);
      assert.ok(matchesA.some((m) => m.id === twoWay.match!.id), "Match persisted in matchesFor");
    });

    it("enforces Full Profile preview, real compat score, and action locks in Likes & Matches", () => {
      const likesSrc = fs.readFileSync("src/pages/user/Likes.tsx", "utf-8");
      assert.match(likesSrc, /<Modal[\s\S]*viewing/, "Likes page renders Full Profile Modal");
      assert.match(likesSrc, /computeCompatibility\(me,\s*viewing\.profile,\s*data\.prefs\)/, "Uses real compatibility calculation");
      assert.match(likesSrc, /busyRef\.current/, "Likes actions protected by concurrency ref lock");
      assert.match(likesSrc, /DAILY_LIKE_LIMIT_REACHED/, "Handles daily like limit gracefully");

      const matchesSrc = fs.readFileSync("src/pages/user/Matches.tsx", "utf-8");
      assert.match(matchesSrc, /busyProposalRef\.current/, "Proposal responses protected by lock");
      assert.match(matchesSrc, /unmatchingRef\.current/, "Unmatch protected by lock");
      assert.match(matchesSrc, /viewing\.profile\.hobbies/, "Match profile modal renders hobbies");
      assert.match(matchesSrc, /viewing\.profile\.lifestyle/, "Match profile modal renders lifestyle");
    });

    it("computes deterministic compatibility score bounded 0–100 with visible reasons", () => {
      const a = makeProfile();
      const b = makeProfile({ id: "u-b", interests: ["Architecture", "Jazz"] });
      const res = computeCompatibility(a, b, BROAD_DEFAULT_PREFS);
      assert.ok(res.score >= 0 && res.score <= 100);
      assert.ok(res.factors.length > 0);
    });
  });

  /* -------------------------------------------------------------
   * Phase 4: Navigation & Chat Mobile Polish
   * ----------------------------------------------------------- */
  describe("Phase 4: Navigation & Chat", () => {
    it("configures member bottom tabs cleanly without disturbing AdminShell or ProtectedRoute", () => {
      const layoutSrc = fs.readFileSync("src/components/layout.tsx", "utf-8");
      assert.match(
        layoutSrc,
        /BOTTOM_TABS\s*=\s*\[\s*\{\s*to:\s*"\/discover"[\s\S]*\{\s*to:\s*"\/likes"[\s\S]*\{\s*to:\s*"\/matches"[\s\S]*\{\s*to:\s*"\/chat"[\s\S]*\{\s*to:\s*"\/profile"/,
        "Bottom nav exposes Discover, Likes, Matches, Chat, Profile",
      );
      assert.match(layoutSrc, /to:\s*"\/app",\s*label:\s*"Dashboard"/, "Full member sidebar preserves /app Dashboard");
      assert.match(layoutSrc, /to:\s*"\/experiences"/, "Full member sidebar preserves Experiences");
      assert.match(layoutSrc, /to:\s*"\/cafes"/, "Full member sidebar preserves Cafés");
      assert.match(layoutSrc, /export function AdminShell/, "AdminShell preserved");
      assert.match(layoutSrc, /export function ProtectedRoute/, "ProtectedRoute preserved");
    });

    it("prevents typing channel leaks and preserves failed chat message for retry", () => {
      const dbSrc = fs.readFileSync("src/lib/supabase/db.ts", "utf-8");
      assert.match(dbSrc, /if \(cbs\.size === 0\)[\s\S]*removeChannel\(ch\)/, "subscribeTyping removes channel when last listener leaves");
      assert.match(dbSrc, /isTyping\s*\?\s*typingChannel\(conversationId\)\s*:\s*typingChannels\.get\(conversationId\)/, "setTyping(false) will not recreate closed channel");

      const chatSrc = fs.readFileSync("src/pages/user/Chat.tsx", "utf-8");
      assert.match(chatSrc, /failedText/, "Retains failed message text for retry");
      assert.match(chatSrc, /\[overflow-wrap:anywhere\]/, "Prevents long unbroken words/URLs from overflowing");
      assert.match(chatSrc, /sendingRef\.current/, "Prevents duplicate message sends on double click/retry");
      assert.match(chatSrc, /useReducedMotion/, "Respects reduced motion in Chat");
    });
  });

  /* -------------------------------------------------------------
   * Phase 5: Accessibility, Route Preservation & Admin Isolation
   * ----------------------------------------------------------- */
  describe("Phase 5: Accessibility & Legacy Preservation", () => {
    it("enhances Modal with focus restoration and aria-labelledby", () => {
      const uiSrc = fs.readFileSync("src/components/ui.tsx", "utf-8");
      assert.match(uiSrc, /previousFocusRef/, "Saves and restores focus when Modal closes");
      assert.match(uiSrc, /aria-labelledby/, "Connects dialog title via aria-labelledby");
      assert.match(uiSrc, /useReducedMotion/, "Modal respects reduced motion");
    });

    it("preserves legacy member routes and Admin routes/files", () => {
      const appSrc = fs.readFileSync("src/App.tsx", "utf-8");
      for (const route of ["app", "profile", "settings", "privacy", "cafes", "experiences", "admin"]) {
        assert.ok(appSrc.includes(`path="${route}"`), `Route ${route} preserved in App.tsx`);
      }
      const authCtxSrc = fs.readFileSync("src/context/AuthContext.tsx", "utf-8");
      assert.match(
        authCtxSrc,
        /finalRole:\s*"user"\s*\|\s*"admin"\s*=\s*role\s*===\s*"admin"\s*\|\|\s*Boolean\(profile\?\.isAdmin\)/,
        "AuthContext admin reconciliation preserved",
      );
    });
  });
});
