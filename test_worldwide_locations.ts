import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

(globalThis as unknown as { React: typeof React }).React = React;

import About from "./src/pages/public/About";
import {
  IndiaCityMultiPicker,
  IndiaLocationPicker,
} from "./src/components/IndiaLocationPicker";
import {
  findWorldLocationByValue,
  formatWorldLocationSubtitle,
  getWorldCitiesByCountry,
  getWorldCountries,
  getWorldLocationStats,
  searchWorldLocations,
} from "./src/data/worldLocations";
import {
  getAllIndiaLocations,
  getDeduplicatedIndiaLocationCount,
  getIndiaStatesAndUTs,
} from "./src/data/indiaLocations";
import {
  formatProfileLocation,
  hasConfiguredLocation,
  isWorldwideProfile,
  normalizeLocationState,
  WORLDWIDE_SCOPE_TOKEN,
} from "./src/lib/locationScope";
import {
  BROAD_DEFAULT_PREFS,
  computeCompatibility,
  evaluatePairwiseCompatibility,
  matchesPreferences,
  MIN_COMPATIBILITY_SCORE,
  rankCandidates,
} from "./src/lib/compat";
import { mapProfile, profileCompleteness, unmapProfilePatch } from "./src/lib/supabase/mappers";
import * as mockDb from "./src/lib/mockDb";
import type { MatchPreferences, UserProfile } from "./src/lib/types";

function makeProfile(overrides: Partial<UserProfile>): UserProfile {
  return {
    id: overrides.id ?? "u-test",
    email: overrides.email ?? "test@datevra.test",
    passwordHash: "hash",
    role: "member",
    firstName: overrides.firstName ?? "Aarav",
    age: overrides.age ?? 28,
    gender: overrides.gender ?? "man",
    interestedIn: overrides.interestedIn ?? "women",
    city: overrides.city ?? "Mumbai",
    locationScope: overrides.locationScope ?? "city",
    bio: "Thoughtful builder who enjoys cinema and coffee.",
    occupation: "Product Designer",
    education: "B.Des",
    heightCm: 178,
    relationshipIntent: overrides.relationshipIntent ?? "Long-term relationship",
    prompts: [{ q: "Ideal Sunday?", a: "Slow coffee and a walk." }],
    interests: ["Coffee", "Cinema", "Travel", "Reading", "Art"],
    hobbies: ["Coffee brewing", "Film photography", "Chess"],
    lifestyle: ["Non-smoker", "Social drinker", "Active"],
    photos: ["https://example.com/photo.jpg"],
    verified: true,
    plan: "plus",
    profileComplete: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActive: "2026-11-27T00:00:00.000Z",
    ...overrides,
  };
}

/* ============================================================================
 * 1. CHANGE 1: HOMEPAGE / ABOUT CITIES STATISTIC (WORLDWIDE) & PARTNER CAFÉS (3)
 * ============================================================================ */

test("About page displays WORLDWIDE and worldwide copy, removes 5,262, and preserves Partner cafés = 3", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(About)),
  );

  assert.ok(html.includes("Cities"), "Expected Cities stat card label");
  assert.ok(html.includes("WORLDWIDE"), "Expected exact text WORLDWIDE in Cities stat");
  assert.ok(
    html.includes("Explore cities and towns around the world"),
    "Expected exact worldwide supporting text",
  );
  assert.equal(html.includes("5,262"), false, "Must not display 5,262 anywhere in Cities stat");
  assert.equal(
    html.includes("Across India&#x27;s cities and towns"),
    false,
    "Must replace India-specific supporting text",
  );

  // Partner Cafés remains 3 untouched
  assert.ok(html.includes("Partner cafés"), "Partner cafés card must remain");
  assert.ok(html.includes(">3<"), "Partner cafés count must remain 3");
  assert.ok(html.includes("Curated partner venues"), "Partner cafés subtitle must remain");
});

/* ============================================================================
 * 2. CHANGE 2: WORLDWIDE DATASET INTEGRITY & CONTINENTAL COVERAGE
 * ============================================================================ */

test("Worldwide dataset integrates GeoNames global cities + all 5,262 deduplicated India LGD locations across 244 countries & territories", () => {
  const stats = getWorldLocationStats();
  const countries = getWorldCountries();

  assert.equal(stats.countryCount, 244);
  assert.equal(countries.length, 244);
  assert.equal(stats.indiaDeduplicatedCount, 5262);
  assert.equal(stats.internationalCount, 30359);
  assert.equal(stats.totalDeduplicatedGlobalCount, 35621);

  // All 6 populated continents represented
  const continents = new Set(countries.map((c) => c.continent));
  for (const cont of ["Asia", "Europe", "North America", "South America", "Africa", "Oceania"]) {
    assert.ok(continents.has(cont), `Expected continent "${cont}" to be represented`);
  }

  // Zero duplicate country ISO codes
  const codeSet = new Set(countries.map((c) => c.code));
  assert.equal(codeSet.size, 244);

  // India retains all 28 States + 8 UTs = 36 administrative entities
  assert.equal(getIndiaStatesAndUTs().length, 36);
  assert.equal(getDeduplicatedIndiaLocationCount(), 5262);
  assert.equal(getAllIndiaLocations().length, 5292);
});

/* ============================================================================
 * 3. CHANGE 2: REQUIRED SAMPLE CITIES, INTERNATIONAL ALIASES & DISAMBIGUATION
 * ============================================================================ */

test("Worldwide search resolves all sample cities across continents, country names, aliases, and disambiguates identical names", () => {
  // Sample cities from specification + Africa/South America coverage
  const requiredSamples: Array<{ query: string; countryCode: string; expectedNameContains: string }> = [
    // India
    { query: "Mumbai", countryCode: "IN", expectedNameContains: "Mumbai" },
    { query: "Delhi", countryCode: "IN", expectedNameContains: "Delhi" },
    { query: "Bengaluru", countryCode: "IN", expectedNameContains: "Bengaluru" },
    { query: "Hyderabad", countryCode: "IN", expectedNameContains: "Hyderabad" },
    { query: "Pune", countryCode: "IN", expectedNameContains: "Pune" },
    { query: "Kolkata", countryCode: "IN", expectedNameContains: "Kolkata" },
    { query: "Chennai", countryCode: "IN", expectedNameContains: "Chennai" },
    { query: "Patna", countryCode: "IN", expectedNameContains: "Patna" },
    // United States
    { query: "New York", countryCode: "US", expectedNameContains: "New York" },
    { query: "Los Angeles", countryCode: "US", expectedNameContains: "Los Angeles" },
    { query: "Chicago", countryCode: "US", expectedNameContains: "Chicago" },
    { query: "San Francisco", countryCode: "US", expectedNameContains: "San Francisco" },
    { query: "Miami", countryCode: "US", expectedNameContains: "Miami" },
    // United Kingdom
    { query: "London", countryCode: "GB", expectedNameContains: "London" },
    { query: "Manchester", countryCode: "GB", expectedNameContains: "Manchester" },
    { query: "Birmingham", countryCode: "GB", expectedNameContains: "Birmingham" },
    { query: "Edinburgh", countryCode: "GB", expectedNameContains: "Edinburgh" },
    // Canada
    { query: "Toronto", countryCode: "CA", expectedNameContains: "Toronto" },
    { query: "Vancouver", countryCode: "CA", expectedNameContains: "Vancouver" },
    { query: "Montreal", countryCode: "CA", expectedNameContains: "Montr" },
    // Australia
    { query: "Sydney", countryCode: "AU", expectedNameContains: "Sydney" },
    { query: "Melbourne", countryCode: "AU", expectedNameContains: "Melbourne" },
    { query: "Brisbane", countryCode: "AU", expectedNameContains: "Brisbane" },
    { query: "Perth", countryCode: "AU", expectedNameContains: "Perth" },
    // UAE
    { query: "Dubai", countryCode: "AE", expectedNameContains: "Dubai" },
    { query: "Abu Dhabi", countryCode: "AE", expectedNameContains: "Abu Dhabi" },
    { query: "Sharjah", countryCode: "AE", expectedNameContains: "Sharjah" },
    // Singapore
    { query: "Singapore", countryCode: "SG", expectedNameContains: "Singapore" },
    // France
    { query: "Paris", countryCode: "FR", expectedNameContains: "Paris" },
    { query: "Lyon", countryCode: "FR", expectedNameContains: "Lyon" },
    { query: "Marseille", countryCode: "FR", expectedNameContains: "Marseille" },
    // Germany
    { query: "Berlin", countryCode: "DE", expectedNameContains: "Berlin" },
    { query: "Munich", countryCode: "DE", expectedNameContains: "Munich" },
    { query: "Hamburg", countryCode: "DE", expectedNameContains: "Hamburg" },
    // Japan
    { query: "Tokyo", countryCode: "JP", expectedNameContains: "Tokyo" },
    { query: "Osaka", countryCode: "JP", expectedNameContains: "Osaka" },
    { query: "Kyoto", countryCode: "JP", expectedNameContains: "Kyoto" },
    // Africa & South America
    { query: "Cairo", countryCode: "EG", expectedNameContains: "Cairo" },
    { query: "Lagos", countryCode: "NG", expectedNameContains: "Lagos" },
    { query: "Nairobi", countryCode: "KE", expectedNameContains: "Nairobi" },
    { query: "Sao Paulo", countryCode: "BR", expectedNameContains: "Paulo" },
    { query: "Buenos Aires", countryCode: "AR", expectedNameContains: "Buenos Aires" },
    { query: "Bogota", countryCode: "CO", expectedNameContains: "Bogot" },
  ];

  for (const s of requiredSamples) {
    const items = searchWorldLocations(s.query, { countryCode: "ALL", limit: 25 });
    const found = items.find(
      (i) => i.countryCode === s.countryCode && i.name.includes(s.expectedNameContains),
    );
    assert.ok(
      found,
      `Expected query "${s.query}" to return a city in ${s.countryCode} containing "${s.expectedNameContains}"`,
    );
  }

  // Country name / abbreviation search
  assert.ok(searchWorldLocations("USA", { countryCode: "ALL", limit: 20 }).some((i) => i.countryCode === "US"));
  assert.ok(searchWorldLocations("United Kingdom", { countryCode: "ALL", limit: 20 }).some((i) => i.countryCode === "GB"));
  assert.ok(searchWorldLocations("UAE", { countryCode: "ALL", limit: 20 }).some((i) => i.countryCode === "AE"));
  assert.ok(searchWorldLocations("Japan", { countryCode: "ALL", limit: 20 }).some((i) => i.countryCode === "JP"));
  assert.ok(searchWorldLocations("Deutschland", { countryCode: "ALL", limit: 20 }).some((i) => i.countryCode === "DE"));

  // Region/state search
  assert.ok(searchWorldLocations("California", { countryCode: "US", limit: 20 }).some((i) => i.name === "Los Angeles"));
  assert.ok(searchWorldLocations("Bavaria", { countryCode: "DE", limit: 20 }).some((i) => i.name === "Munich"));
  assert.ok(searchWorldLocations("Maharashtra", { countryCode: "IN", limit: 20 }).some((i) => i.name === "Mumbai"));

  // International & local-language aliases
  assert.ok(searchWorldLocations("München", { countryCode: "ALL", limit: 10 }).some((i) => i.name === "Munich" && i.countryCode === "DE"));
  assert.ok(searchWorldLocations("Wien", { countryCode: "ALL", limit: 10 }).some((i) => i.name === "Vienna" && i.countryCode === "AT"));
  assert.ok(searchWorldLocations("Roma", { countryCode: "ALL", limit: 10 }).some((i) => i.name === "Rome" && i.countryCode === "IT"));
  assert.ok(searchWorldLocations("東京", { countryCode: "ALL", limit: 10 }).some((i) => i.name === "Tokyo" && i.countryCode === "JP"));
  assert.ok(searchWorldLocations("دبي", { countryCode: "ALL", limit: 10 }).some((i) => i.name === "Dubai" && i.countryCode === "AE"));
  assert.ok(searchWorldLocations("Bangalore", { countryCode: "IN", limit: 10 }).some((i) => i.name === "Bengaluru" && i.countryCode === "IN"));
  assert.ok(searchWorldLocations("Bombay", { countryCode: "IN", limit: 10 }).some((i) => i.name === "Mumbai" && i.countryCode === "IN"));

  // India remote / UT locations preserved
  assert.ok(searchWorldLocations("Kavaratti", { countryCode: "IN", limit: 10 }).some((i) => i.region === "Lakshadweep"));
  assert.ok(searchWorldLocations("Leh", { countryCode: "IN", limit: 10 }).some((i) => i.region === "Ladakh"));

  // Disambiguation of identical city names with region + country
  const parisMatches = searchWorldLocations("Paris", { countryCode: "ALL", limit: 25 }).filter(
    (i) => i.name === "Paris",
  );
  const parisFr = parisMatches.find((i) => i.countryCode === "FR");
  const parisUs = parisMatches.find((i) => i.countryCode === "US");
  assert.ok(parisFr, "Expected Paris, France");
  assert.ok(parisUs, "Expected Paris, United States");
  assert.ok(formatWorldLocationSubtitle(parisFr!).includes("France"));
  assert.ok(formatWorldLocationSubtitle(parisUs!).includes("United States"));
  assert.notEqual(
    formatWorldLocationSubtitle(parisFr!),
    formatWorldLocationSubtitle(parisUs!),
    "Identical city names must have distinct region + country subtitles",
  );

  // Country browsing & value lookup helpers
  assert.ok(getWorldCitiesByCountry("GB").length > 200);
  assert.equal(findWorldLocationByValue("London")?.countryCode, "GB");
  assert.equal(findWorldLocationByValue("London, Canada")?.countryCode, "CA");
  assert.equal(findWorldLocationByValue("Mumbai")?.countryCode, "IN");
  assert.equal(findWorldLocationByValue(WORLDWIDE_SCOPE_TOKEN), null);
});

/* ============================================================================
 * 4. CHANGE 2: EXISTING CITY SELECTOR UI RENDERS WORLDWIDE FIRST + ALL INDIA
 * ============================================================================ */

test("IndiaLocationPicker renders 🌍 Worldwide first, preserves All India selector, and handles Worldwide selection", () => {
  // Open dropdown with an existing India city selected
  const openMumbaiHtml = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "Mumbai",
      locationScope: "city",
      onChange: () => {},
      defaultOpen: true,
    }),
  );

  assert.ok(openMumbaiHtml.includes("Mumbai"), "Trigger must show selected city Mumbai");
  assert.ok(openMumbaiHtml.includes("Maharashtra"), "Trigger must preserve India state subtitle");
  assert.ok(openMumbaiHtml.includes("🌍"), "Must show globe icon for Worldwide option");
  assert.ok(openMumbaiHtml.includes("Worldwide"), "Must include Worldwide option");
  assert.ok(
    openMumbaiHtml.includes("Open to matching across cities and countries worldwide"),
    "Worldwide option must explain global scope",
  );
  assert.ok(
    openMumbaiHtml.includes("Worldwide (244 countries &amp; territories)"),
    "Scope selector must include Worldwide (244 countries & territories)",
  );
  assert.ok(
    openMumbaiHtml.includes("All India (28 States &amp; 8 Union Territories)"),
    "Scope selector must preserve All India (28 States & 8 Union Territories)",
  );
  assert.ok(
    openMumbaiHtml.includes("All India States &amp; Union Territories (36)"),
    "Must preserve India State/UT filter",
  );
  assert.ok(openMumbaiHtml.includes("Popular Countries"), "Must include Popular Countries optgroup");

  // Worldwide appears BEFORE city results in the listbox
  const idxWorldwideOpt = openMumbaiHtml.indexOf("Open to matching across cities and countries worldwide");
  const idxDelhiOpt = openMumbaiHtml.indexOf("National Capital Territory");
  assert.ok(
    idxWorldwideOpt > -1 && (idxDelhiOpt === -1 || idxWorldwideOpt < idxDelhiOpt),
    "Worldwide must be the first selectable option in the dropdown",
  );

  // Selected Worldwide state
  const worldwideSelectedHtml = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "",
      locationScope: "worldwide",
      onChange: () => {},
      defaultOpen: false,
    }),
  );
  assert.ok(worldwideSelectedHtml.includes("🌍 Worldwide"));
  assert.ok(worldwideSelectedHtml.includes("Open globally"));

  // Discover Multi-City Picker includes Worldwide (All locations) toggle + 244 countries
  const multiHtml = renderToStaticMarkup(
    React.createElement(IndiaCityMultiPicker, {
      selected: [],
      onChange: () => {},
    }),
  );
  assert.ok(multiHtml.includes("🌍 Worldwide (All locations)"));
  assert.ok(multiHtml.includes("All Countries (244)"));
  assert.ok(multiHtml.includes("India (28 States &amp; 8 UTs)"));
});

/* ============================================================================
 * 5. CHANGE 3: LOCATION PERSISTENCE (MOCKDB + SUPABASE MAPPERS)
 * ============================================================================ */

test("Worldwide scope persists as explicit global scope (not city='Worldwide') across reload & logout/login", () => {
  // Normalization contract: Worldwide is NEVER stored as an ordinary city named "Worldwide"
  assert.deepEqual(normalizeLocationState("Worldwide"), {
    locationScope: "worldwide",
    city: "",
  });
  assert.deepEqual(normalizeLocationState(WORLDWIDE_SCOPE_TOKEN), {
    locationScope: "worldwide",
    city: "",
  });
  assert.deepEqual(normalizeLocationState("Mumbai", "worldwide"), {
    locationScope: "worldwide",
    city: "",
  });
  assert.deepEqual(normalizeLocationState("London", "city"), {
    locationScope: "city",
    city: "London",
  });

  // Supabase mapper round-trip: native location_scope column
  const wwPatch = unmapProfilePatch({ locationScope: "worldwide", city: "" });
  assert.equal(wwPatch.location_scope, "worldwide");
  assert.equal(wwPatch.city, "");

  const mappedNative = mapProfile({
    id: "u-ww-1",
    email: "ww1@datevra.test",
    first_name: "Meera",
    age: 27,
    gender: "woman",
    interested_in: "men",
    city: "",
    location_scope: "worldwide",
    created_at: "2026-11-27T00:00:00.000Z",
  });
  assert.equal(mappedNative.locationScope, "worldwide");
  assert.equal(mappedNative.city, "");
  assert.equal(isWorldwideProfile(mappedNative), true);
  assert.equal(hasConfiguredLocation(mappedNative), true);
  assert.equal(formatProfileLocation(mappedNative), "Worldwide");

  // Supabase mapper fallback: legacy schema using sentinel token in city column
  const mappedFallback = mapProfile({
    id: "u-ww-2",
    email: "ww2@datevra.test",
    first_name: "Rohan",
    age: 29,
    gender: "man",
    interested_in: "women",
    city: WORLDWIDE_SCOPE_TOKEN,
    created_at: "2026-11-27T00:00:00.000Z",
  });
  assert.equal(mappedFallback.locationScope, "worldwide");
  assert.equal(mappedFallback.city, "");
  assert.equal(formatProfileLocation(mappedFallback), "Worldwide");

  // Profile completeness counts Worldwide identically to a configured specific city (+10 over unset)
  const baseCompleteness = {
    bio: "Hello there, enjoying life and good coffee.",
    relationshipIntent: "Long-term relationship",
    interests: ["Art", "Coffee", "Travel", "Cinema", "Reading"],
    photos: ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
  };
  assert.equal(
    profileCompleteness({ ...baseCompleteness, city: "", locationScope: "worldwide" }),
    100,
  );
  assert.equal(
    profileCompleteness({ ...baseCompleteness, city: "Mumbai", locationScope: "city" }),
    100,
  );
  assert.equal(
    profileCompleteness({ ...baseCompleteness, city: "", locationScope: "city" }),
    90,
  );

  // mockDb persistence across reload + logout/login + switch back to specific city
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
      email: "global.member@datevra.test",
      password: "Password123!",
      firstName: "Tara",
      age: 26,
      gender: "woman",
      interestedIn: "men",
      city: "Mumbai",
    });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    const uid = reg.session.userId;
    assert.equal(mockDb.getUser(uid)?.locationScope, "city");
    assert.equal(mockDb.getUser(uid)?.city, "Mumbai");

    // Switch to Worldwide
    const savedWw = mockDb.updateUser(uid, { locationScope: "worldwide", city: "" });
    assert.equal(savedWw?.locationScope, "worldwide");
    assert.equal(savedWw?.city, "");

    // Reload read
    const reloaded = mockDb.getUser(uid);
    assert.equal(reloaded?.locationScope, "worldwide");
    assert.equal(reloaded?.city, "");

    // Logout & login
    mockDb.logout();
    const relogin = mockDb.login("global.member@datevra.test", "Password123!");
    assert.equal(relogin.ok, true);
    if (!relogin.ok) return;
    const afterLogin = mockDb.getUser(relogin.session.userId);
    assert.equal(afterLogin?.locationScope, "worldwide");
    assert.equal(afterLogin?.city, "");

    // Switch from Worldwide to international city (London)
    const savedLondon = mockDb.updateUser(uid, { locationScope: "city", city: "London" });
    assert.equal(savedLondon?.locationScope, "city");
    assert.equal(savedLondon?.city, "London");
    assert.equal(mockDb.getUser(uid)?.city, "London");
    assert.equal(mockDb.getUser(uid)?.locationScope, "city");
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = prevStorage;
    }
  }
});

/* ============================================================================
 * 6. CHANGE 3: DISCOVER & COMPATIBILITY (75% THRESHOLD + WEIGHTS PRESERVED)
 * ============================================================================ */

test("Discover interprets Worldwide as open across locations while preserving 75% threshold and exact city weights", () => {
  assert.equal(MIN_COMPATIBILITY_SCORE, 75, "75% compatibility threshold must remain unchanged");

  const mumbaiPrefs: MatchPreferences = {
    ...BROAD_DEFAULT_PREFS,
    ageMin: 24,
    ageMax: 34,
    interestedIn: "women",
    cities: ["Mumbai"],
  };

  const worldwidePrefs: MatchPreferences = {
    ...BROAD_DEFAULT_PREFS,
    ageMin: 24,
    ageMax: 34,
    interestedIn: "women",
    cities: [],
  };

  const viewerMumbai = makeProfile({
    id: "viewer-mumbai",
    gender: "man",
    interestedIn: "women",
    city: "Mumbai",
    locationScope: "city",
  });

  const viewerWorldwide = makeProfile({
    id: "viewer-worldwide",
    gender: "man",
    interestedIn: "women",
    city: "",
    locationScope: "worldwide",
  });

  const candidateMumbai = makeProfile({
    id: "cand-mumbai",
    firstName: "Diya",
    gender: "woman",
    interestedIn: "men",
    city: "Mumbai",
    locationScope: "city",
  });

  const candidateLondon = makeProfile({
    id: "cand-london",
    firstName: "Clara",
    gender: "woman",
    interestedIn: "men",
    city: "London",
    locationScope: "city",
  });

  const candidateWorldwide = makeProfile({
    id: "cand-worldwide",
    firstName: "Nisha",
    gender: "woman",
    interestedIn: "men",
    city: "",
    locationScope: "worldwide",
  });

  // Specific city filter matches Mumbai and Worldwide candidate, excludes London
  assert.equal(matchesPreferences(viewerMumbai, candidateMumbai, mumbaiPrefs), true);
  assert.equal(matchesPreferences(viewerMumbai, candidateWorldwide, mumbaiPrefs), true);
  assert.equal(matchesPreferences(viewerMumbai, candidateLondon, mumbaiPrefs), false);

  // Worldwide viewer with empty prefs.cities matches candidates across Mumbai, London, and Worldwide
  assert.equal(matchesPreferences(viewerWorldwide, candidateMumbai, worldwidePrefs), true);
  assert.equal(matchesPreferences(viewerWorldwide, candidateLondon, worldwidePrefs), true);
  assert.equal(matchesPreferences(viewerWorldwide, candidateWorldwide, worldwidePrefs), true);

  // Compatibility weights preserved: same specific city (+10) still scores 4 pts higher than Worldwide (+6)
  const sameCityScore = computeCompatibility(viewerMumbai, candidateMumbai, mumbaiPrefs);
  const wwScore = computeCompatibility(viewerWorldwide, candidateLondon, worldwidePrefs);
  assert.ok(sameCityScore.factors.some((f) => f.includes("Both in Mumbai")));
  assert.equal(
    wwScore.factors.some((f) => f.includes("Both in Worldwide")),
    false,
    "Must never pretend two profiles share a city called 'Worldwide'",
  );
  assert.ok(wwScore.factors.some((f) => f.includes("Open to matching worldwide")));
  assert.equal(sameCityScore.score - wwScore.score, 4, "Same city (+10) vs Worldwide (+6) delta must be 4 pts");

  // Pairwise concern check: Worldwide profile does not trigger 'Different locations' concern
  const evalWw = evaluatePairwiseCompatibility(viewerWorldwide, candidateLondon);
  assert.equal(evalWw.concerns.includes("Different locations"), false);
  assert.ok(evalWw.score >= MIN_COMPATIBILITY_SCORE);

  // rankCandidates surfaces London, Mumbai, and Worldwide candidates for a Worldwide viewer
  const ranked = rankCandidates(
    viewerWorldwide,
    [candidateMumbai, candidateLondon, candidateWorldwide],
    worldwidePrefs,
    new Set(),
  );
  assert.equal(ranked.length, 3);
  assert.ok(ranked.every((r) => r.score >= MIN_COMPATIBILITY_SCORE));
});
