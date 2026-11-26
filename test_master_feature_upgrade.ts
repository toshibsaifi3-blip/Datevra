import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ALL_LIFESTYLE_OPTIONS,
  LIFESTYLE_CATEGORIES,
  searchLifestyleOptions,
} from "./src/data/lifestyle";
import {
  ALL_INTEREST_OPTIONS,
  INTEREST_CATEGORIES,
  searchInterestOptions,
} from "./src/data/interests";
import {
  isCanonicalRelationshipGoal,
  mapLegacyRelationshipGoal,
  RELATIONSHIP_GOALS,
  relationshipGoalOptionsWithLegacy,
} from "./src/data/relationshipGoals";
import {
  findIndiaLocationByCity,
  getAllIndiaLocations,
  getIndiaDistricts,
  getIndiaStatesAndUTs,
  getLocationsByStateCode,
  INDIA_LOCATION_DATASET_META,
  searchIndiaLocations,
} from "./src/data/indiaLocations";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as unknown as { React: typeof React }).React = React;
import { getVerifiedCafeResearch, VERIFIED_CAFE_RESEARCH } from "./src/data/cafesVerified";
import { IndiaLocationPicker } from "./src/components/IndiaLocationPicker";
import { CatalogTagPicker } from "./src/components/CatalogTagPicker";
import { mapProfile, unmapProfilePatch } from "./src/lib/supabase/mappers";
import * as mockDb from "./src/lib/mockDb";
import { ALL_INTERESTS, CITIES, RELATIONSHIP_INTENTS, SEED_CAFES } from "./src/data/seed";
import { enrichCafeWithVerifiedResearch, isDemoCafe, sanitizeCafeList } from "./src/lib/cafeFilter";
import {
  computeCompatibility,
  evaluateMatchEligibility,
  matchesPreferences,
  MIN_COMPATIBILITY_SCORE,
} from "./src/lib/compat";
import { isOutsideDelhiCity } from "./src/lib/voucherPolicy";
import { addCustomTagItem, toggleTag } from "./src/lib/profileFields";
import type { MatchPreferences, UserProfile } from "./src/lib/types";

/* ============================================================================
 * 1. LIFESTYLE CATALOGUE CHECKS (Checks 1–3)
 * ============================================================================ */

test("Lifestyle catalogue has 150+ unique options across 20+ categories with zero duplicates", () => {
  assert.ok(
    LIFESTYLE_CATEGORIES.length >= 20,
    `Expected >= 20 lifestyle categories, got ${LIFESTYLE_CATEGORIES.length}`,
  );
  assert.equal(LIFESTYLE_CATEGORIES.length, 34, "Expected all 34 requested lifestyle categories");
  assert.ok(
    ALL_LIFESTYLE_OPTIONS.length >= 150,
    `Expected >= 150 lifestyle options, got ${ALL_LIFESTYLE_OPTIONS.length}`,
  );

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const opt of ALL_LIFESTYLE_OPTIONS) {
    const norm = opt.trim().toLowerCase();
    assert.ok(norm.length > 0, "Empty lifestyle option found");
    if (seen.has(norm)) duplicates.push(opt);
    seen.add(norm);
  }
  assert.deepEqual(duplicates, [], `Found duplicate lifestyle options: ${duplicates.join(", ")}`);

  // Verify key required example values are present verbatim
  const requiredExamples = [
    "Non-smoker",
    "Social smoker",
    "Smoker",
    "Trying to quit",
    "Non-drinker",
    "Social drinker",
    "Drinker",
    "Sober / Teetotaller",
    "Daily workout",
    "Gym regular",
    "Active lifestyle",
    "Occasional workout",
    "Vegetarian",
    "Non-vegetarian",
    "Eggetarian",
    "Vegan",
    "Plant-based",
    "Foodie",
    "Home cook",
    "Dog lover",
    "Cat lover",
    "Pet parent",
    "Open to pets",
    "Early riser",
    "Night owl",
    "Flexible sleeper",
    "Morning person",
    "Introvert",
    "Extrovert",
    "Ambivert",
    "Socially active",
    "Weekend traveller",
    "Frequent traveller",
    "Slow traveller",
    "Mountain lover",
    "Beach person",
    "Spiritual",
    "Mindful living",
    "Career-focused",
    "Entrepreneurial",
    "Lifelong learner",
    "Family-oriented",
    "Wants children",
    "Open to children",
    "Doesn't want children",
    "Words of affirmation",
    "Quality time",
    "Physical touch",
    "Acts of service",
    "Tea or chai lover",
    "Coffee person",
    "Eco-conscious",
    "Minimalist living",
  ];
  for (const ex of requiredExamples) {
    assert.ok(
      ALL_LIFESTYLE_OPTIONS.includes(ex),
      `Missing required lifestyle option: "${ex}"`,
    );
  }

  assert.ok(searchLifestyleOptions("vegetarian").length >= 2);
  assert.ok(searchLifestyleOptions("", "pets").includes("Dog lover"));
});

/* ============================================================================
 * 2. INTERESTS CATALOGUE CHECKS (Checks 4–6)
 * ============================================================================ */

test("Interests catalogue has 400+ distinct interests across 30+ categories with zero duplicates", () => {
  assert.ok(
    INTEREST_CATEGORIES.length >= 30,
    `Expected >= 30 interest categories, got ${INTEREST_CATEGORIES.length}`,
  );
  assert.ok(
    ALL_INTEREST_OPTIONS.length >= 400,
    `Expected >= 400 interests, got ${ALL_INTEREST_OPTIONS.length}`,
  );
  assert.equal(ALL_INTERESTS.length, ALL_INTEREST_OPTIONS.length);

  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const item of ALL_INTEREST_OPTIONS) {
    const norm = item.trim().toLowerCase();
    assert.ok(norm.length > 0, "Empty interest found");
    if (seen.has(norm)) duplicates.push(item);
    seen.add(norm);
  }
  assert.deepEqual(duplicates, [], `Found duplicate interests: ${duplicates.join(", ")}`);

  // Verify every required Indian & cultural interest is present verbatim
  const requiredIndianInterests = [
    "Chai",
    "Filter Coffee",
    "Bollywood",
    "Tollywood",
    "Kollywood",
    "Indie Indian Music",
    "Classical Music",
    "Cricket",
    "Badminton",
    "Kabaddi",
    "Yoga",
    "Meditation",
    "Ayurveda",
    "Indian Street Food",
    "Regional Cuisine",
    "Festivals",
    "Diwali",
    "Holi",
    "Navratri",
    "Garba",
    "Kathak",
    "Bharatanatyam",
    "Tabla",
    "Sitar",
    "Road Trips",
    "Himalayan Treks",
    "Monsoon Drives",
    "Heritage Walks",
    "Literature",
    "Poetry",
    "Shayari",
    "Art Galleries",
    "Handlooms",
    "Startups",
    "Photography",
    "Stand-up Comedy",
    "Board Games",
    "Cafés",
  ];
  for (const item of requiredIndianInterests) {
    assert.ok(
      ALL_INTEREST_OPTIONS.includes(item),
      `Missing required interest: "${item}"`,
    );
  }

  assert.ok(searchInterestOptions("bollywood").includes("Bollywood"));
  assert.ok(searchInterestOptions("chai").includes("Chai"));
});

/* ============================================================================
 * 3. RELATIONSHIP GOALS — EXACT 6 OPTIONS + LEGACY COMPATIBILITY (Check 7)
 * ============================================================================ */

test("Relationship goals use exact 6 Tinder labels and preserve legacy saved values", () => {
  assert.deepEqual([...RELATIONSHIP_GOALS], [
    "Long-term partner",
    "Long-term, open to short",
    "Short-term, open to long",
    "Short-term fun",
    "New friends",
    "Still figuring it out",
  ]);
  assert.deepEqual(RELATIONSHIP_INTENTS, [...RELATIONSHIP_GOALS]);

  for (const goal of RELATIONSHIP_GOALS) {
    assert.equal(isCanonicalRelationshipGoal(goal), true);
  }

  // Legacy values are preserved in picker options so existing members never lose their selection
  const legacyValues = [
    "Dating with intention",
    "Open to something meaningful",
    "A serious relationship",
    "Marriage-minded",
  ];
  for (const legacy of legacyValues) {
    assert.equal(isCanonicalRelationshipGoal(legacy), false);
    const opts = relationshipGoalOptionsWithLegacy(legacy);
    assert.equal(opts[0], legacy, `Legacy value "${legacy}" must be preserved`);
    assert.equal(opts.length, 7);
    assert.ok(mapLegacyRelationshipGoal(legacy) !== null);
  }
});

/* ============================================================================
 * 4. INDIA-WIDE LOCATIONS — ALL 28 STATES + ALL 8 UTs + LGD COVERAGE (Checks 8–15, 23)
 * ============================================================================ */

test("India locations cover ALL 28 States, ALL 8 Union Territories, and ALL 790 official LGD districts with zero duplicates", () => {
  const statesAndUTs = getIndiaStatesAndUTs();
  const states = statesAndUTs.filter((s) => s.kind === "State");
  const uts = statesAndUTs.filter((s) => s.kind === "Union Territory");

  assert.equal(states.length, 28, "Must include all 28 Indian States");
  assert.equal(uts.length, 8, "Must include all 8 Indian Union Territories");
  assert.equal(INDIA_LOCATION_DATASET_META.stateCount, 28);
  assert.equal(INDIA_LOCATION_DATASET_META.utCount, 8);

  // Every single state and UT must have >= 1 district and >= 1 verified location
  for (const s of statesAndUTs) {
    assert.ok(s.districtCount >= 1, `${s.name} has 0 districts`);
    assert.ok(s.locationCount >= 1, `${s.name} has 0 locations`);
    assert.equal(getLocationsByStateCode(s.code).length, s.locationCount);
  }

  const allDistricts = getIndiaDistricts();
  assert.equal(allDistricts.length, 790, "Must include all 790 official LGD districts");

  const allLocations = getAllIndiaLocations();
  assert.ok(allLocations.length >= 5000, `Expected >= 5000 verified LGD locations, got ${allLocations.length}`);

  // Check zero duplicate (stateCode, districtCode, name) tuples
  const dedup = new Set<string>();
  for (const loc of allLocations) {
    const key = `${loc.stateCode}|${loc.districtCode}|${loc.name.toLowerCase()}`;
    assert.equal(dedup.has(key), false, `Duplicate location detected: ${key}`);
    dedup.add(key);
  }

  // Verify every one of the 790 districts is covered by at least one location
  const coveredDistrictCodes = new Set(allLocations.map((l) => l.districtCode));
  assert.equal(coveredDistrictCodes.size, allDistricts.length);
});

test("India location search handles major metros, smaller towns, UTs, aliases, state-first and city-first searches rapidly", () => {
  const t0 = performance.now();

  // Major cities
  for (const city of ["Mumbai", "Delhi", "New Delhi", "Bengaluru", "Hyderabad", "Chennai", "Kolkata", "Pune", "Jaipur"]) {
    const res = searchIndiaLocations(city, { limit: 5 });
    assert.ok(res.length > 0, `Expected search hit for ${city}`);
    assert.equal(res[0].name, city, `Expected "${city}" as top result, got "${res[0].name}"`);
  }

  // Smaller towns & Union Territory locations
  const smallerTargets = [
    { q: "Kavaratti", expectedState: "Lakshadweep" },
    { q: "Leh", expectedState: "Ladakh" },
    { q: "Kargil", expectedState: "Ladakh" },
    { q: "Kupwara", expectedState: "Jammu and Kashmir" },
    { q: "Silvassa", expectedState: "Dadra and Nagar Haveli and Daman and Diu" },
    { q: "Gangtok", expectedState: "Sikkim" },
    { q: "Kohima", expectedState: "Nagaland" },
    { q: "Aizawl", expectedState: "Mizoram" },
    { q: "Agartala", expectedState: "Tripura" },
    { q: "Shillong", expectedState: "Meghalaya" },
    { q: "Itanagar", expectedState: "Arunachal Pradesh" },
    { q: "Panaji", expectedState: "Goa" },
    { q: "Darjeeling", expectedState: "West Bengal" },
  ];
  for (const { q, expectedState } of smallerTargets) {
    const res = searchIndiaLocations(q, { limit: 5 });
    assert.ok(
      res.some((r) => r.name.toLowerCase() === q.toLowerCase() && r.state === expectedState),
      `Expected "${q}" in "${expectedState}"`,
    );
  }

  // Renamed cities & aliases
  const aliasCases: [string, string][] = [
    ["Bombay", "Mumbai"],
    ["Bangalore", "Bengaluru"],
    ["Allahabad", "Prayagraj"],
    ["Gurgaon", "Gurugram"],
    ["Calcutta", "Kolkata"],
    ["Madras", "Chennai"],
    ["Port Blair", "Sri Vijaya Puram"],
    ["Pondicherry", "Puducherry"],
    ["Aurangabad", "Chhatrapati Sambhajinagar"],
    ["Trivandrum", "Thiruvananthapuram"],
    ["Cochin", "Kochi"],
    ["Ooty", "Udhagamandalam"],
  ];
  for (const [alias, canonical] of aliasCases) {
    const res = searchIndiaLocations(alias, { limit: 5 });
    assert.ok(
      res.some((r) => r.name === canonical),
      `Alias "${alias}" should resolve to "${canonical}", got: ${res.map((r) => r.name).join(", ")}`,
    );
  }

  // State-first search (Kerala stateCode = "32")
  const keralaResults = searchIndiaLocations("Kochi", { stateCode: "32", limit: 5 });
  assert.ok(keralaResults.length > 0);
  assert.ok(keralaResults.every((r) => r.state === "Kerala"));

  // City resolution helper & voucher policy compatibility
  assert.equal(findIndiaLocationByCity("Bangalore")?.name, "Bengaluru");
  assert.equal(isOutsideDelhiCity("Delhi"), false);
  assert.equal(isOutsideDelhiCity("New Delhi"), false);
  assert.equal(isOutsideDelhiCity("Kavaratti"), true);
  assert.equal(isOutsideDelhiCity("Gurugram"), true);

  const elapsed = performance.now() - t0;
  assert.ok(elapsed < 250, `Search suite took too long: ${elapsed.toFixed(1)}ms`);
  assert.ok(CITIES.includes("Delhi") && CITIES.includes("Mumbai") && CITIES.includes("Bengaluru"));
});

/* ============================================================================
 * 5. PROFILE, ONBOARDING, LEGACY PRESERVATION & MATCHING REGRESSION (Checks 16–18, 22)
 * ============================================================================ */

test("Profile & onboarding helpers prevent duplicates, preserve order, and preserve 75% compatibility threshold", () => {
  // Tag order preservation & case-insensitive deduplication
  let tags: string[] = [];
  tags = toggleTag(tags, "Chai");
  tags = toggleTag(tags, "Himalayan Treks");
  tags = addCustomTagItem(tags, "chai"); // duplicate case-insensitive ignored
  tags = addCustomTagItem(tags, "Vintage Vinyl");
  assert.deepEqual(tags, ["Chai", "Himalayan Treks", "Vintage Vinyl"]);

  // Compatibility threshold remains strictly 75%
  assert.equal(MIN_COMPATIBILITY_SCORE, 75);

  const mkProfile = (overrides: Partial<UserProfile>): UserProfile => ({
    id: "u-1",
    email: "u1@example.com",
    firstName: "Aarav",
    age: 27,
    gender: "man",
    interestedIn: "women",
    city: "Kochi",
    bio: "Loves slow mornings and regional cinema.",
    interests: ["Chai", "Filter Coffee", "Malayalam Cinema", "Himalayan Treks"],
    hobbies: ["Photography"],
    relationshipIntent: "Long-term partner",
    lifestyle: ["Non-smoker", "Early riser", "Vegetarian"],
    photos: ["https://example.com/1.jpg"],
    verified: true,
    online: true,
    lastActive: new Date().toISOString(),
    profileComplete: 100,
    plan: null,
    planExpiresAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  });

  const me = mkProfile({ id: "u-me" });
  const strongMatch = mkProfile({
    id: "u-strong",
    firstName: "Meera",
    gender: "woman",
    interestedIn: "men",
  });
  const weakMatch = mkProfile({
    id: "u-weak",
    firstName: "Riya",
    gender: "woman",
    interestedIn: "men",
    city: "Gangtok",
    interests: ["Origami & Paper Craft"],
    hobbies: [],
    relationshipIntent: "Short-term fun",
    lifestyle: ["Night owl"],
    profileComplete: 40,
  });

  const prefs: MatchPreferences = {
    ageMin: 22,
    ageMax: 32,
    interestedIn: "women",
    cities: ["Kochi"],
    maxDistanceKm: 100,
    relationshipIntents: ["Long-term partner"],
    minSharedInterests: 1,
  };

  assert.equal(matchesPreferences(me, strongMatch, prefs), true);
  assert.equal(matchesPreferences(me, weakMatch, prefs), false);

  const eligStrong = evaluateMatchEligibility(me, strongMatch, prefs);
  assert.equal(eligStrong.eligible, true);
  assert.ok((eligStrong.score ?? 0) >= 75);

  const eligWeak = evaluateMatchEligibility(me, weakMatch, null);
  assert.equal(eligWeak.eligible, false);
  assert.ok((eligWeak.score ?? 100) < 75);

  // Legacy profile with old relationshipIntent still computes compatibility cleanly without error
  const legacyProfile = mkProfile({
    id: "u-legacy",
    gender: "woman",
    relationshipIntent: "Marriage-minded",
  });
  const legacyCompat = computeCompatibility(me, legacyProfile, null);
  assert.ok(Number.isFinite(legacyCompat.score) && legacyCompat.score > 0);
});

/* ============================================================================
 * 6. CAFÉ STATIC RESEARCH, HONEST VERIFICATION & ZERO EXTERNAL API CHECKS (Checks 19–21)
 * ============================================================================ */

test("Cafés preserve strictly the 3 genuine Delhi venues with static client-supplied Google ratings (4.8, 4.4, 5.0), null review counts, verified hours, and stale-cache immunity", () => {
  assert.equal(SEED_CAFES.length, 3);
  const ids = SEED_CAFES.map((c) => c.id).sort();
  assert.deepEqual(ids, ["c-hot-stag-del", "c-karmala-del", "c-yumm-club-del"]);

  const expectedRatings: Record<string, number> = {
    "c-hot-stag-del": 4.8,
    "c-karmala-del": 4.4,
    "c-yumm-club-del": 5.0,
  };

  for (const cafe of SEED_CAFES) {
    assert.equal(isDemoCafe(cafe), false);
    const research = VERIFIED_CAFE_RESEARCH[cafe.id];
    assert.ok(research, `Missing static research record for ${cafe.id}`);
    assert.equal(cafe.address, research.verifiedAddress);
    assert.ok(cafe.openingHours.length > 0, `Expected verified opening hours for ${cafe.name}`);
    assert.ok(cafe.weeklyHours && Object.keys(cafe.weeklyHours).length === 7, `Expected 7-day hours for ${cafe.name}`);
    assert.equal(cafe.hoursVerified, true);
    assert.equal(cafe.priceVerified, false);
    assert.equal(cafe.priceStatusLabel, "Price information unavailable");
    assert.equal(cafe.infoCheckedAt, "2026-11-26");

    // Client-supplied static numerical Google ratings, no fabricated review counts
    assert.equal(typeof research.googleRating, "number");
    assert.equal(research.googleRating, expectedRatings[cafe.id]);
    assert.equal(cafe.googleRating, expectedRatings[cafe.id]);
    assert.equal(cafe.rating, expectedRatings[cafe.id]);
    assert.equal(cafe.ratingVerified, true);
    assert.equal(cafe.googleReviewCount, null);
    assert.equal(cafe.ratingSource, "Google (supplied by client)");
    assert.equal(cafe.googleRating!.toFixed(1), expectedRatings[cafe.id].toFixed(1));
  }

  // Resilient lookup even if a Supabase row has a different ID
  const byName = getVerifiedCafeResearch({
    id: "custom-supabase-id-1",
    name: "KARMALA CAFE & RESTAURANT",
    address: "Majnu Ka Tilla, Delhi",
  });
  assert.equal(byName?.id, "c-karmala-del");
  assert.equal(byName?.googleRating, 4.4);
  assert.equal(byName?.openingHoursSummary, "10:00 AM – 10:30 PM (Daily)");

  // Stale localStorage / DB rows with rating: 0, googleRating: null, ratingVerified: false
  // must NEVER overwrite the verified static client-supplied ratings (4.8, 4.4, 5.0)
  const sanitized = sanitizeCafeList([
    {
      ...SEED_CAFES[0],
      openingHours: "",
      rating: 0,
      googleRating: null,
      googleReviewCount: null,
      ratingVerified: false,
      ratingStatusLabel: "Google rating unavailable",
    },
    {
      ...SEED_CAFES[1],
      openingHours: "",
      rating: 0,
      googleRating: null,
      ratingVerified: false,
      ratingStatusLabel: "Google rating unavailable",
    },
    {
      ...SEED_CAFES[2],
      openingHours: "",
      rating: 0,
      googleRating: null,
      ratingVerified: false,
      ratingStatusLabel: "Google rating unavailable",
    },
    {
      ...SEED_CAFES[0],
      id: "c-lodhi-del",
      name: "Lodhi Art House",
      address: "Lodhi Colony Market, New Delhi",
    },
  ]);
  assert.equal(sanitized.length, 3);
  assert.ok(sanitized.every((c) => !isDemoCafe(c)));

  for (const c of sanitized) {
    const exp = expectedRatings[c.id];
    assert.equal(c.googleRating, exp, `Stale cache overwrote googleRating for ${c.id}`);
    assert.equal(c.rating, exp, `Stale cache overwrote rating for ${c.id}`);
    assert.equal(c.ratingVerified, true, `Stale cache overwrote ratingVerified for ${c.id}`);
    assert.equal(c.googleReviewCount, null, `Review count must remain null for ${c.id}`);
    assert.equal(c.ratingStatusLabel, `${exp.toFixed(1)} / 5 Google`);
    assert.equal(c.priceVerified, false);
    assert.equal(c.priceStatusLabel, "Price information unavailable");
  }

  const enrichedHotStag = enrichCafeWithVerifiedResearch({
    ...SEED_CAFES[0],
    openingHours: "",
    rating: 0,
    googleRating: null,
    ratingVerified: false,
    ratingStatusLabel: "Google rating unavailable",
  });
  assert.equal(enrichedHotStag.openingHours, "12:00 PM – 11:00 PM (Daily)");
  assert.equal(enrichedHotStag.googleRating, 4.8);
  assert.equal(enrichedHotStag.rating, 4.8);
  assert.equal(enrichedHotStag.ratingVerified, true);
  assert.equal(enrichedHotStag.googleReviewCount, null);
  assert.equal(enrichedHotStag.ratingSource, "Google (supplied by client)");
  assert.equal(enrichedHotStag.priceVerified, false);
  assert.equal(enrichedHotStag.priceStatusLabel, "Price information unavailable");
});

test("Rendered shared pickers and profile mapper round-trip work end-to-end with legacy preservation and hobbies separation", () => {
  // 1. Render IndiaLocationPicker with a smaller UT city & legacy city
  const htmlCity = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "Kavaratti",
      onChange: () => {},
    }),
  );
  assert.ok(htmlCity.includes("Kavaratti"), "IndiaLocationPicker must render current city");
  assert.ok(htmlCity.includes("Lakshadweep"), "IndiaLocationPicker must display state/UT context");

  const htmlLegacyCity = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "Old Custom Town",
      onChange: () => {},
    }),
  );
  assert.ok(htmlLegacyCity.includes("Old Custom Town"), "IndiaLocationPicker must preserve legacy saved city");

  // 2. Render CatalogTagPicker for Interests (421 options / 36 categories)
  const htmlInterests = renderToStaticMarkup(
    React.createElement(CatalogTagPicker, {
      categories: INTEREST_CATEGORIES,
      selected: ["Chai", "Bollywood", "Legacy Custom Interest"],
      onChange: () => {},
      tone: "gold",
    }),
  );
  assert.ok(htmlInterests.includes("All (36)"), "Interests picker must expose all 36 categories");
  assert.ok(htmlInterests.includes("of 421 options"), "Interests picker must expose all 421 options");
  assert.ok(htmlInterests.includes("Legacy Custom Interest"), "Interests picker must preserve legacy custom items");

  // 3. Render CatalogTagPicker for Lifestyle (216 options / 34 categories)
  const htmlLifestyle = renderToStaticMarkup(
    React.createElement(CatalogTagPicker, {
      categories: LIFESTYLE_CATEGORIES,
      selected: ["Non-smoker", "Early riser", "Legacy Lifestyle Note"],
      onChange: () => {},
      tone: "rose",
    }),
  );
  assert.ok(htmlLifestyle.includes("All (34)"), "Lifestyle picker must expose all 34 categories");
  assert.ok(htmlLifestyle.includes("of 216 options"), "Lifestyle picker must expose all 216 options");
  assert.ok(htmlLifestyle.includes("Legacy Lifestyle Note"), "Lifestyle picker must preserve legacy lifestyle items");

  // 4. Verify Supabase profile mapper save/reload round-trip keeps hobbies strictly separate
  const patch = unmapProfilePatch({
    city: "Kochi",
    relationshipIntent: "Long-term partner",
    interests: ["Chai", "Himalayan Treks"],
    hobbies: ["Weekend cycling", "Film photography"],
    lifestyle: ["Non-smoker", "Vegetarian", "Early riser"],
  });
  const reloaded = mapProfile({
    id: "u-roundtrip",
    email: "member@example.com",
    first_name: "Aarav",
    age: 28,
    gender: "man",
    interested_in: "women",
    ...patch,
    created_at: new Date().toISOString(),
  });
  assert.equal(reloaded.city, "Kochi");
  assert.equal(reloaded.relationshipIntent, "Long-term partner");
  assert.deepEqual(reloaded.interests, ["Chai", "Himalayan Treks"]);
  assert.deepEqual(reloaded.hobbies, ["Weekend cycling", "Film photography"]);
  assert.deepEqual(reloaded.lifestyle, ["Non-smoker", "Vegetarian", "Early riser"]);
});

test("Active UI screens have zero old controls, zero fabricated cafe pricing, and zero Google Maps/Places API calls", () => {
  const walk = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const files = walk(path.resolve("src"));
  const forbiddenApi = /maps\.googleapis\.com|places\.googleapis\.com|GOOGLE_PLACES_API_KEY|VITE_GOOGLE_MAPS|VITE_GOOGLE_PLACES/;
  const forbiddenCopy = /relaxed fine-café pricing|Google rating unverified/;
  for (const f of files) {
    const content = fs.readFileSync(f, "utf8");
    assert.equal(forbiddenApi.test(content), false, `Forbidden Google Maps/Places API reference in ${f}`);
    assert.equal(forbiddenCopy.test(content), false, `Forbidden outdated cafe copy in ${f}`);
  }

  // Verify Profile.tsx & Onboarding.tsx directly mount IndiaLocationPicker, CatalogTagPicker, and relationshipGoalOptionsWithLegacy
  for (const screenPath of ["src/pages/user/Profile.tsx", "src/pages/user/Onboarding.tsx"]) {
    const src = fs.readFileSync(path.resolve(screenPath), "utf8");
    assert.ok(src.includes("<IndiaLocationPicker"), `${screenPath} must render IndiaLocationPicker`);
    assert.ok(src.includes("categories={INTEREST_CATEGORIES}"), `${screenPath} must wire INTEREST_CATEGORIES`);
    assert.ok(src.includes("categories={LIFESTYLE_CATEGORIES}"), `${screenPath} must wire LIFESTYLE_CATEGORIES`);
    assert.ok(src.includes("relationshipGoalOptionsWithLegacy"), `${screenPath} must wire relationshipGoalOptionsWithLegacy`);
    assert.ok(src.includes("Hobbies"), `${screenPath} must preserve separate Hobbies field`);
  }

  // Verify CafeDetail.tsx, CafesPublic.tsx, and SavedCafes.tsx display verified static Google ratings cleanly
  const cafeDetailSrc = fs.readFileSync(path.resolve("src/pages/public/CafeDetail.tsx"), "utf8");
  assert.ok(cafeDetailSrc.includes("cafe.googleRating.toFixed(1)"), "CafeDetail must format googleRating to 1 decimal place");
  assert.ok(cafeDetailSrc.includes("Google rating unavailable"), "CafeDetail must keep fallback for unrated cafés");
  assert.ok(cafeDetailSrc.includes("Hours not verified"), "CafeDetail must use 'Hours not verified'");
  assert.ok(cafeDetailSrc.includes("Price information unavailable"), "CafeDetail must use 'Price information unavailable'");

  const cafesPublicSrc = fs.readFileSync(path.resolve("src/pages/public/CafesPublic.tsx"), "utf8");
  assert.ok(cafesPublicSrc.includes("★ {c.googleRating.toFixed(1)} Google"), "CafesPublic must display Google rating badge");

  const savedCafesSrc = fs.readFileSync(path.resolve("src/pages/user/SavedCafes.tsx"), "utf8");
  assert.ok(savedCafesSrc.includes("★ ${c.googleRating.toFixed(1)} Google"), "SavedCafes must display Google rating");
});

test("mockDb listCafes & getCafe preserve exact ratings (4.8, 4.4, 5.0) across reload even when stale localStorage contains 0 / null / ratingVerified: false", () => {
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
    // Seed initial DB and inject stale cached cafe records simulating pre-update localStorage
    const initial = mockDb.listCafes();
    assert.equal(initial.length, 3);
    const dbKey = Array.from(store.keys()).find((k) => k.includes("datevra"));
    if (dbKey) {
      const parsed = JSON.parse(store.get(dbKey)!);
      parsed.cafes = parsed.cafes.map((c: Record<string, unknown>) => ({
        ...c,
        rating: 0,
        googleRating: null,
        googleReviewCount: null,
        ratingVerified: false,
        ratingStatusLabel: "Google rating unavailable",
      }));
      store.set(dbKey, JSON.stringify(parsed));
    }

    // Simulate reload: listCafes() and getCafe() must still return exact 4.8, 4.4, 5.0 with null review counts
    const reloadedList = mockDb.listCafes();
    const byId = Object.fromEntries(reloadedList.map((c) => [c.id, c]));
    assert.equal(byId["c-hot-stag-del"]?.googleRating, 4.8);
    assert.equal(byId["c-karmala-del"]?.googleRating, 4.4);
    assert.equal(byId["c-yumm-club-del"]?.googleRating, 5.0);

    assert.equal(mockDb.getCafe("c-hot-stag-del")?.googleRating?.toFixed(1), "4.8");
    assert.equal(mockDb.getCafe("c-karmala-del")?.googleRating?.toFixed(1), "4.4");
    assert.equal(mockDb.getCafe("c-yumm-club-del")?.googleRating?.toFixed(1), "5.0");
    assert.equal(mockDb.getCafe("c-hot-stag-del")?.googleReviewCount, null);
    assert.equal(mockDb.getCafe("c-karmala-del")?.googleReviewCount, null);
    assert.equal(mockDb.getCafe("c-yumm-club-del")?.googleReviewCount, null);
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = prevStorage;
    }
  }
});
