import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

(globalThis as unknown as { React: typeof React }).React = React;

import {
  ALL_HOBBY_OPTIONS,
  HOBBY_CATEGORIES,
  HOBBY_MAX_SELECTION,
  HOBBY_MIN_SELECTION,
  isCatalogHobby,
  matchCanonicalHobby,
  normalizeSavedHobbies,
  searchHobbies,
  validateHobbySelection,
} from "./src/data/hobbies";
import { HobbiesPicker } from "./src/components/HobbiesPicker";
import About from "./src/pages/public/About";
import {
  getAllIndiaLocations,
  getDeduplicatedIndiaLocationCount,
  INDIA_LOCATION_DATASET_META,
} from "./src/data/indiaLocations";
import {
  getVerifiedPartnerCafeCount,
  VERIFIED_CAFE_RESEARCH,
} from "./src/data/cafesVerified";
import { mapProfile, unmapProfilePatch } from "./src/lib/supabase/mappers";
import * as mockDb from "./src/lib/mockDb";

/* ============================================================================
 * 1. CHANGE 1: CURATED HOBBIES CATALOGUE INTEGRITY
 * ============================================================================ */

test("Hobbies catalogue has 36 categories, 200+ unique hobbies, zero duplicates, and non-selectable category headings", () => {
  assert.equal(HOBBY_CATEGORIES.length, 36, "Expected all 36 hobby browsing categories");
  assert.ok(
    ALL_HOBBY_OPTIONS.length >= 200,
    `Expected >= 200 unique hobbies, got ${ALL_HOBBY_OPTIONS.length}`,
  );

  // Zero case-insensitive duplicates across all categories
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const cat of HOBBY_CATEGORIES) {
    assert.ok(cat.items.length >= 7, `Category "${cat.label}" should have rich options`);
    for (const item of cat.items) {
      const trimmed = item.trim();
      assert.ok(trimmed.length > 0, "Empty hobby item found");
      const key = trimmed.toLowerCase();
      if (seen.has(key)) duplicates.push(item);
      seen.add(key);
    }
  }
  assert.deepEqual(duplicates, [], `Duplicate hobbies found: ${duplicates.join(", ")}`);

  // Category labels themselves are headings/filters — not duplicated as broad hobby items
  const categoryLabelsLower = new Set(HOBBY_CATEGORIES.map((c) => c.label.toLowerCase()));
  for (const item of ALL_HOBBY_OPTIONS) {
    assert.equal(
      categoryLabelsLower.has(item.toLowerCase()),
      false,
      `Category heading "${item}" must not appear as a selectable hobby item`,
    );
  }

  // Spot-check representative hobbies across all 36 categories
  const expectedHobbies = [
    "Cricket",
    "Yoga",
    "Trekking",
    "Solo travel",
    "Singing",
    "Bollywood dance",
    "Sketching",
    "Street photography",
    "Poetry",
    "Book clubs",
    "Indian cooking",
    "Sourdough baking",
    "Coffee brewing",
    "PC gaming",
    "Chess",
    "Film appreciation",
    "K-dramas",
    "Watching anime",
    "Coding",
    "Astronomy",
    "Indian history",
    "Learning languages",
    "Indoor plants",
    "Dog training",
    "Fashion styling",
    "Skincare routines",
    "Woodworking",
    "Watch collecting",
    "Motorcycle touring",
    "Safari trips",
    "Meditation",
    "Volunteering",
    "Scuba diving",
    "Stand-up comedy",
    "Interior decorating",
    "Side projects",
  ];
  for (const h of expectedHobbies) {
    assert.ok(isCatalogHobby(h), `Expected catalog hobby "${h}" to exist`);
  }

  // Search works across categories, by category label, and returns empty for unmatched queries
  assert.ok(searchHobbies("photo").includes("Film photography"));
  assert.ok(searchHobbies("coffee").includes("Coffee brewing"));
  assert.ok(searchHobbies("Baking & Desserts").includes("Cake baking"));
  assert.deepEqual(searchHobbies("zzzz-nonexistent-hobby-xyz"), []);
  assert.ok(searchHobbies("", "music").includes("Guitar"));
  assert.equal(searchHobbies("", "music").includes("Cricket"), false);
});

/* ============================================================================
 * 2. CHANGE 1: MIN 3 / MAX 5 VALIDATION, ORDER PRESERVATION & CUSTOM/LEGACY
 * ============================================================================ */

test("Hobbies validation enforces min 3 / max 5 and preserves exact selection order and legacy/custom hobbies", () => {
  assert.equal(HOBBY_MIN_SELECTION, 3);
  assert.equal(HOBBY_MAX_SELECTION, 5);

  // < 3 fails
  for (const count of [0, 1, 2]) {
    const res = validateHobbySelection(ALL_HOBBY_OPTIONS.slice(0, count));
    assert.equal(res.valid, false, `Expected ${count} hobbies to fail min validation`);
    assert.equal(res.remainingToMin, 3 - count);
    assert.ok(res.reason && res.reason.includes("at least 3"));
  }

  // 3, 4, 5 pass
  for (const count of [3, 4, 5]) {
    const res = validateHobbySelection(ALL_HOBBY_OPTIONS.slice(0, count));
    assert.equal(res.valid, true, `Expected ${count} hobbies to pass validation`);
    assert.equal(res.remainingToMin, 0);
  }

  // > 5 fails
  const overMax = validateHobbySelection(ALL_HOBBY_OPTIONS.slice(0, 6));
  assert.equal(overMax.valid, false);
  assert.ok(overMax.reason && overMax.reason.includes("up to 5"));

  // Legacy / custom preservation + case-insensitive deduplication + strict order preservation
  assert.equal(matchCanonicalHobby("film photography"), "Film photography");
  assert.equal(matchCanonicalHobby("  Weekend   cycling "), "Weekend cycling");

  const normalized = normalizeSavedHobbies([
    "Chess",
    "Weekend cycling",
    "cricket",
    "CHESS",
    "weekend cycling",
    "Film photography",
  ]);
  assert.deepEqual(normalized, ["Chess", "Weekend cycling", "Cricket", "Film photography"]);
});

/* ============================================================================
 * 3. CHANGE 1: TINDER-STYLE HOBBIES PICKER RENDERING
 * ============================================================================ */

test("HobbiesPicker renders empty state without placeholder tags, displays ordered tags, and renders full Tinder-style modal", () => {
  // Empty state: no empty placeholder chips
  const emptyHtml = renderToStaticMarkup(
    React.createElement(HobbiesPicker, {
      value: [],
      onSave: () => {},
    }),
  );
  assert.ok(emptyHtml.includes("Choose hobbies"));
  assert.ok(emptyHtml.includes("(0 of 5)"));
  assert.equal(emptyHtml.includes('aria-label="Selected hobbies"'), false);

  // Saved summary: preserves exact order
  const savedHtml = renderToStaticMarkup(
    React.createElement(HobbiesPicker, {
      value: ["Chess", "Weekend cycling", "Cricket"],
      onSave: () => {},
    }),
  );
  assert.ok(savedHtml.includes("Edit hobbies"));
  assert.ok(savedHtml.includes("(3 of 5)"));
  const idxChess = savedHtml.indexOf("Chess");
  const idxCustom = savedHtml.indexOf("Weekend cycling");
  const idxCricket = savedHtml.indexOf("Cricket");
  assert.ok(idxChess > -1 && idxCustom > idxChess && idxCricket > idxCustom, "Saved hobbies must preserve exact order");

  // Open modal with 3 selected (including 1 custom/legacy)
  const openValidHtml = renderToStaticMarkup(
    React.createElement(HobbiesPicker, {
      value: ["Chess", "Weekend cycling", "Cricket"],
      onSave: () => {},
      defaultOpen: true,
    }),
  );
  assert.ok(openValidHtml.includes("Your Hobbies"));
  assert.ok(openValidHtml.includes("Choose the hobbies you enjoy. Show people what you love doing."));
  assert.ok(openValidHtml.includes("3 of 5 selected"));
  assert.ok(openValidHtml.includes('placeholder="Search hobbies..."'));
  assert.ok(openValidHtml.includes("All (36)"));
  assert.ok(openValidHtml.includes("Custom (1)"));
  assert.ok(openValidHtml.includes("Your Custom Hobbies"));
  assert.ok(openValidHtml.includes("Weekend cycling"));
  assert.ok(openValidHtml.includes("Can&#x27;t find your hobby? Add your own."));
  assert.ok(openValidHtml.includes("Cancel"));
  assert.ok(openValidHtml.includes("Done"));
  assert.ok(openValidHtml.includes('aria-disabled="false"'), "Done should be enabled when 3 hobbies selected");

  // Open modal with < 3 selected: shows remaining count and marks Done aria-disabled
  const openTooFewHtml = renderToStaticMarkup(
    React.createElement(HobbiesPicker, {
      value: ["Cricket", "Chess"],
      onSave: () => {},
      defaultOpen: true,
    }),
  );
  assert.ok(openTooFewHtml.includes("2 of 5 selected"));
  assert.ok(openTooFewHtml.includes("Select 1 more (minimum 3)"));
  assert.ok(openTooFewHtml.includes('aria-disabled="true"'), "Done must be aria-disabled when < 3 selected");
});

/* ============================================================================
 * 4. CHANGE 1: PERSISTENCE ACROSS RELOAD & LOGOUT/LOGIN + SUPABASE MAPPERS
 * ============================================================================ */

test("Hobbies persist in exact selection order across reload and logout/login in mockDb and Supabase mappers", () => {
  const store = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  };
  const prevStorage = (globalThis as { localStorage?: Storage }).localStorage;
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage as unknown as Storage;

  try {
    const reg = mockDb.register({
      email: "hobbies.member@datevra.test",
      password: "Password123!",
      firstName: "Kabir",
      age: 27,
      gender: "man",
      interestedIn: "women",
      city: "Delhi",
    });
    assert.equal(reg.ok, true, "Expected test registration to succeed");
    if (!reg.ok) return;
    const uid = reg.session.userId;

    // Save 4 hobbies including a custom hobby in specific order
    const ordered4 = ["Coffee brewing", "Weekend cycling", "Chess", "Astrophotography"];
    const updated4 = mockDb.updateUser(uid, { hobbies: ordered4 });
    assert.ok(updated4);
    assert.deepEqual(updated4.hobbies, ordered4);

    // Reload read
    assert.deepEqual(mockDb.getUser(uid)?.hobbies, ordered4);

    // Logout & login again
    mockDb.logout();
    assert.equal(mockDb.getSession(), null);
    const loggedIn = mockDb.login("hobbies.member@datevra.test", "Password123!");
    assert.equal(loggedIn.ok, true, "Expected re-login to succeed");
    if (!loggedIn.ok) return;
    assert.deepEqual(
      mockDb.getUser(loggedIn.session.userId)?.hobbies,
      ordered4,
      "Hobbies must survive logout/login in exact order",
    );

    // Edit to 5 then trim back to 3
    const ordered5 = [...ordered4, "Stand-up comedy"];
    mockDb.updateUser(uid, { hobbies: ordered5 });
    assert.deepEqual(mockDb.getUser(uid)?.hobbies, ordered5);

    const ordered3 = ["Chess", "Astrophotography", "Weekend cycling"];
    mockDb.updateUser(uid, { hobbies: ordered3 });
    assert.deepEqual(mockDb.getUser(uid)?.hobbies, ordered3);
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = prevStorage;
    }
  }

  // Supabase mapper round-trip keeps hobbies strictly separate from interests & lifestyle
  const patch = unmapProfilePatch({
    hobbies: ["Chess", "Weekend cycling", "Coffee brewing"],
    interests: ["Chai", "Bollywood"],
    lifestyle: ["Non-smoker"],
  });
  const mapped = mapProfile({
    id: "u-v2-test",
    email: "v2@example.com",
    first_name: "Ananya",
    age: 26,
    gender: "woman",
    interested_in: "men",
    ...patch,
    created_at: new Date().toISOString(),
  });
  assert.deepEqual(mapped.hobbies, ["Chess", "Weekend cycling", "Coffee brewing"]);
  assert.deepEqual(mapped.interests, ["Chai", "Bollywood"]);
  assert.deepEqual(mapped.lifestyle, ["Non-smoker"]);
});

/* ============================================================================
 * 5. CHANGES 2 & 3: ALL-INDIA CITIES COUNT (5,262) & EXACT 3 PARTNER CAFÉS
 * ============================================================================ */

test("About page displays WORLDWIDE cities stat (while India dataset preserves 5,262 deduplicated cities) and exact 3 verified partner cafés", () => {
  // Independent deduplication check by (stateCode, normalized canonical name)
  const uniqueKeys = new Set<string>();
  for (const loc of getAllIndiaLocations()) {
    uniqueKeys.add(`${loc.stateCode}|${loc.name.trim().toLowerCase()}`);
  }
  const deduplicatedCount = getDeduplicatedIndiaLocationCount();
  assert.equal(deduplicatedCount, uniqueKeys.size);
  assert.equal(deduplicatedCount, INDIA_LOCATION_DATASET_META.uniqueCityStateCount);
  assert.equal(deduplicatedCount, 5262, "Expected exact deduplicated India city/town count of 5,262");

  // Exact 3 verified partner cafés
  const cafeCount = getVerifiedPartnerCafeCount();
  assert.equal(cafeCount, 3);
  assert.deepEqual(
    Object.values(VERIFIED_CAFE_RESEARCH)
      .map((c) => c.name)
      .sort(),
    ["Café Hot Stag", "KARMALA CAFE & RESTAURANT", "The Yumm Club"],
  );

  // Render About page and verify visible output
  const aboutHtml = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(About)),
  );
  assert.ok(aboutHtml.includes("WORLDWIDE"), "About page must display WORLDWIDE for Cities stat");
  assert.ok(
    aboutHtml.includes("Explore cities and towns around the world"),
    "About page must display worldwide supporting copy",
  );
  assert.equal(aboutHtml.includes("5,262"), false, "About page Cities stat must no longer display 5,262");
  assert.equal(
    aboutHtml.includes("Across India&#x27;s cities and towns"),
    false,
    "About page must replace India-specific supporting copy",
  );
  assert.ok(aboutHtml.includes("Partner cafés"), "About page must keep Partner cafés stat card");
  assert.ok(aboutHtml.includes(">3<"), "About page must display exact count 3 for Partner cafés");
  assert.ok(
    aboutHtml.includes("Curated partner venues"),
    "About page must display accurate partner cafés supporting copy",
  );

  // Ensure old claims are completely removed
  assert.equal(aboutHtml.includes("180+"), false, "Old '180+' claim must be removed");
  assert.equal(
    aboutHtml.includes("Mumbai · Delhi · Bengaluru · Pune · Jaipur · Hyderabad"),
    false,
    "Old 6-city subtitle must be removed",
  );
  assert.equal(
    aboutHtml.includes("held tables &amp; concierge booking"),
    false,
    "Old partner café subtitle must be replaced",
  );
});

/* ============================================================================
 * 6. SOURCE CODE AUDIT: ZERO OLD HOBBIES INPUTS OR OUTDATED PUBLIC STATS
 * ============================================================================ */

test("Profile and Onboarding mount HobbiesPicker with zero old free-text hobby inputs; public pages have zero old claims", () => {
  for (const rel of ["src/pages/user/Profile.tsx", "src/pages/user/Onboarding.tsx"]) {
    const src = fs.readFileSync(path.resolve(rel), "utf8");
    assert.ok(src.includes("<HobbiesPicker"), `${rel} must mount <HobbiesPicker />`);
    assert.ok(src.includes("saveHobbies"), `${rel} must persist hobbies immediately on Done`);
    assert.equal(src.includes("hobbyInput"), false, `${rel} must not retain old hobbyInput state`);
    assert.equal(
      src.includes("Weekend cycling, film photography"),
      false,
      `${rel} must not retain old free-text hobbies placeholder`,
    );
  }

  const publicDir = path.resolve("src/pages/public");
  for (const file of fs.readdirSync(publicDir)) {
    if (!file.endsWith(".tsx")) continue;
    const src = fs.readFileSync(path.join(publicDir, file), "utf8");
    assert.equal(src.includes("180+"), false, `Public page ${file} must not contain '180+'`);
    assert.equal(
      src.includes("Mumbai · Delhi · Bengaluru · Pune · Jaipur · Hyderabad"),
      false,
      `Public page ${file} must not contain old 6-city list`,
    );
  }
});
