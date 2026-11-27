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
  formatWorldLocationValue,
  getWorldCitiesByCountry,
  getWorldCountries,
  getWorldLocationStats,
  getWorldRegionsByCountry,
  isNonGeographicalLocation,
  sameSavedLocation,
  sanitizeRealLocation,
  searchWorldCountries,
  searchWorldLocations,
  searchWorldRegions,
} from "./src/data/worldLocations";
import {
  getAllIndiaLocations,
  getDeduplicatedIndiaLocationCount,
  getIndiaStatesAndUTs,
} from "./src/data/indiaLocations";
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
    role: "member",
    firstName: overrides.firstName ?? "Aarav",
    age: overrides.age ?? 28,
    gender: overrides.gender ?? "man",
    interestedIn: overrides.interestedIn ?? "women",
    city: overrides.city ?? "Mumbai",
    bio: "Thoughtful builder who enjoys cinema and coffee.",
    relationshipIntent: overrides.relationshipIntent ?? "Long-term relationship",
    interests: ["Coffee", "Cinema", "Travel", "Reading", "Art"],
    hobbies: ["Coffee brewing", "Film photography", "Chess"],
    lifestyle: ["Non-smoker", "Social drinker", "Active"],
    photos: ["https://example.com/photo.jpg"],
    verified: true,
    online: true,
    plan: "plus",
    planExpiresAt: null,
    profileComplete: 100,
    createdAt: "2026-01-01T00:00:00.000Z",
    lastActive: "2026-11-27T00:00:00.000Z",
    ...overrides,
  };
}

/* ============================================================================
 * 1. HOMEPAGE / ABOUT STATISTIC PRESERVED (WORLDWIDE + PARTNER CAFÉS = 3)
 * ============================================================================ */

test("About page keeps WORLDWIDE Cities stat and Partner cafés = 3", () => {
  const html = renderToStaticMarkup(
    React.createElement(MemoryRouter, null, React.createElement(About)),
  );

  assert.ok(html.includes("Cities"));
  assert.ok(html.includes("WORLDWIDE"));
  assert.ok(html.includes("Explore cities and towns around the world"));
  assert.equal(html.includes("5,262"), false);
  assert.ok(html.includes("Partner cafés"));
  assert.ok(html.includes(">3<"));
  assert.ok(html.includes("Curated partner venues"));
});

/* ============================================================================
 * 2. ZERO SPECIAL WORLDWIDE OPTION IN CITY PICKERS & ZERO FAKE STORAGE
 * ============================================================================ */

test("No special Worldwide option appears in city pickers and no fake Worldwide location can be stored", () => {
  // Single-location picker open by default (All Countries default)
  const pickerHtml = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "Mumbai",
      onChange: () => {},
      defaultOpen: true,
    }),
  );

  assert.equal(pickerHtml.includes("🌍"), false, "Must NOT render 🌍 Worldwide card");
  assert.equal(pickerHtml.includes("Worldwide"), false, "Must NOT display Worldwide as a selectable location");
  assert.equal(pickerHtml.includes("Open globally"), false, "Must NOT display Open globally");
  assert.equal(pickerHtml.includes("Open to matching"), false, "Must NOT display Worldwide scope description");

  // Default Country selector is All Countries (244)
  assert.ok(pickerHtml.includes("All Countries (244)"), "Country selector must default to All Countries (244)");
  assert.ok(pickerHtml.includes("Popular Countries"), "Country selector must include Popular Countries");
  assert.ok(
    pickerHtml.includes("All States / Provinces / Regions (select a country)"),
    "State/Province/Region cascading selector must be present",
  );

  // If a legacy value of "Worldwide" is passed in, it must NOT render as a selected location
  const legacyWorldwideHtml = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "Worldwide",
      onChange: () => {},
      defaultOpen: false,
    }),
  );
  assert.equal(legacyWorldwideHtml.includes("Worldwide"), false);
  assert.ok(legacyWorldwideHtml.includes("Select city or town"));

  // Multi-city Discover picker also has ZERO Worldwide selectable button
  const multiHtml = renderToStaticMarkup(
    React.createElement(IndiaCityMultiPicker, {
      selected: [],
      onChange: () => {},
    }),
  );
  assert.equal(multiHtml.includes("🌍"), false);
  assert.equal(multiHtml.includes("Worldwide"), false);
  assert.ok(multiHtml.includes("All Countries (244)"));

  // Non-geographical rejection guards
  assert.equal(isNonGeographicalLocation("Worldwide"), true);
  assert.equal(isNonGeographicalLocation("__WORLDWIDE__"), true);
  assert.equal(sanitizeRealLocation("Worldwide"), "");
  assert.equal(sanitizeRealLocation("__WORLDWIDE__"), "");
  assert.equal(findWorldLocationByValue("Worldwide"), null);
  assert.equal(findWorldLocationByValue("__WORLDWIDE__"), null);

  // Supabase mappers refuse to write "Worldwide" as a city
  const fakePatch = unmapProfilePatch({ city: "Worldwide" });
  assert.equal(fakePatch.city, undefined);
  const mappedLegacy = mapProfile({
    id: "u-legacy",
    email: "legacy@datevra.test",
    first_name: "Asha",
    age: 26,
    gender: "woman",
    interested_in: "men",
    city: "Worldwide",
    created_at: "2026-11-27T00:00:00.000Z",
  });
  assert.notEqual(mappedLegacy.city.toLowerCase(), "worldwide");
});

/* ============================================================================
 * 3. GLOBAL DATASET INTEGRITY: COUNTRIES, STATES/PROVINCES, CITIES & INDIA
 * ============================================================================ */

test("Global dataset contains 244 countries, 2,764 states/provinces/regions, and 35,621 deduplicated cities while preserving all 5,262 India locations", () => {
  const stats = getWorldLocationStats();
  const countries = getWorldCountries();

  assert.equal(stats.countryCount, 244);
  assert.equal(countries.length, 244);
  assert.equal(stats.indiaStateUtCount, 36);
  assert.equal(stats.internationalRegionCount, 2728);
  assert.equal(stats.totalRegionCount, 2764);
  assert.equal(stats.indiaDeduplicatedCount, 5262);
  assert.equal(stats.indiaRawCount, 5292);
  assert.equal(stats.internationalCount, 30359);
  assert.equal(stats.totalDeduplicatedGlobalCount, 35621);

  // All 6 populated continents represented
  const continents = new Set(countries.map((c) => c.continent));
  for (const cont of ["Asia", "Europe", "North America", "South America", "Africa", "Oceania"]) {
    assert.ok(continents.has(cont), `Expected continent ${cont}`);
  }

  // Zero duplicate ISO-2 country codes
  assert.equal(new Set(countries.map((c) => c.code)).size, 244);

  // India preservation: 28 States + 8 UTs = 36, 5,262 deduplicated / 5,292 raw
  assert.equal(getIndiaStatesAndUTs().length, 36);
  assert.equal(getDeduplicatedIndiaLocationCount(), 5262);
  assert.equal(getAllIndiaLocations().length, 5292);
});

/* ============================================================================
 * 4. CASCADING COUNTRY -> STATE/PROVINCE -> CITY BROWSING & GLOBAL SEARCH
 * ============================================================================ */

test("Cascading Country -> State/Province/Region -> City/Town filters and direct search work across all required examples", () => {
  // 1. Country search
  assert.ok(searchWorldCountries("United States").some((c) => c.code === "US"));
  assert.ok(searchWorldCountries("USA").some((c) => c.code === "US"));
  assert.ok(searchWorldCountries("United Kingdom").some((c) => c.code === "GB"));
  assert.ok(searchWorldCountries("Canada").some((c) => c.code === "CA"));
  assert.ok(searchWorldCountries("Australia").some((c) => c.code === "AU"));
  assert.ok(searchWorldCountries("UAE").some((c) => c.code === "AE"));
  assert.ok(searchWorldCountries("Deutschland").some((c) => c.code === "DE"));
  assert.ok(searchWorldCountries("Japan").some((c) => c.code === "JP"));
  assert.ok(searchWorldCountries("India").some((c) => c.code === "IN"));

  // 2. State / Province / Region browsing per country
  const expectedRegions: Array<{ countryCode: string; regionNames: string[] }> = [
    { countryCode: "IN", regionNames: ["Maharashtra", "Delhi", "Karnataka", "Telangana", "Tamil Nadu", "West Bengal", "Bihar"] },
    { countryCode: "US", regionNames: ["New York", "California", "Texas", "Florida"] },
    { countryCode: "GB", regionNames: ["England", "Scotland", "Wales"] },
    { countryCode: "CA", regionNames: ["Ontario", "Quebec", "British Columbia"] },
    { countryCode: "AU", regionNames: ["New South Wales", "Victoria", "Queensland"] },
    { countryCode: "AE", regionNames: ["Dubai", "Abu Dhabi", "Sharjah"] },
    { countryCode: "DE", regionNames: ["Bavaria", "Hamburg", "State of Berlin"] },
    { countryCode: "JP", regionNames: ["Tokyo", "Osaka", "Kyoto"] },
  ];

  for (const { countryCode, regionNames } of expectedRegions) {
    const regions = getWorldRegionsByCountry(countryCode);
    assert.ok(regions.length > 0, `Expected regions for ${countryCode}`);
    for (const rName of regionNames) {
      const reg = regions.find((r) => r.name === rName);
      assert.ok(reg, `Expected region "${rName}" in ${countryCode}`);
      const citiesInRegion = getWorldCitiesByCountry(countryCode, { regionCode: reg!.code, limit: 10 });
      assert.ok(citiesInRegion.length > 0, `Expected cities in ${rName}, ${countryCode}`);
    }
  }

  // 3. Cascading UI renders states/provinces when a country is chosen
  const usPickerHtml = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "",
      onChange: () => {},
      defaultOpen: true,
      defaultCountryCode: "US",
    }),
  );
  assert.ok(usPickerHtml.includes("California"));
  assert.ok(usPickerHtml.includes("Texas"));
  assert.ok(usPickerHtml.includes("Florida"));
  assert.ok(usPickerHtml.includes("New York"));

  const inPickerHtml = renderToStaticMarkup(
    React.createElement(IndiaLocationPicker, {
      value: "Mumbai",
      onChange: () => {},
      defaultOpen: true,
      defaultCountryCode: "IN",
    }),
  );
  assert.ok(inPickerHtml.includes("All States &amp; Union Territories (36)"));
  assert.ok(inPickerHtml.includes("States (28)"));
  assert.ok(inPickerHtml.includes("Union Territories (8)"));
  assert.ok(inPickerHtml.includes("Maharashtra"));

  // 4. Direct region search
  assert.ok(searchWorldRegions("California").some((r) => r.countryCode === "US"));
  assert.ok(searchWorldRegions("Ontario").some((r) => r.countryCode === "CA"));
  assert.ok(searchWorldRegions("New South Wales").some((r) => r.countryCode === "AU"));
  assert.ok(searchWorldRegions("Scotland").some((r) => r.countryCode === "GB"));

  // 5. Direct global city search (without manually opening any country)
  const requiredCities: Array<{ query: string; countryCode: string; expectedNameContains: string }> = [
    // India
    { query: "Delhi", countryCode: "IN", expectedNameContains: "Delhi" },
    { query: "Mumbai", countryCode: "IN", expectedNameContains: "Mumbai" },
    { query: "Bengaluru", countryCode: "IN", expectedNameContains: "Bengaluru" },
    { query: "Hyderabad", countryCode: "IN", expectedNameContains: "Hyderabad" },
    { query: "Pune", countryCode: "IN", expectedNameContains: "Pune" },
    { query: "Kolkata", countryCode: "IN", expectedNameContains: "Kolkata" },
    { query: "Chennai", countryCode: "IN", expectedNameContains: "Chennai" },
    { query: "Patna", countryCode: "IN", expectedNameContains: "Patna" },
    // US
    { query: "New York", countryCode: "US", expectedNameContains: "New York" },
    { query: "Los Angeles", countryCode: "US", expectedNameContains: "Los Angeles" },
    { query: "Chicago", countryCode: "US", expectedNameContains: "Chicago" },
    { query: "Miami", countryCode: "US", expectedNameContains: "Miami" },
    // UK
    { query: "London", countryCode: "GB", expectedNameContains: "London" },
    { query: "Manchester", countryCode: "GB", expectedNameContains: "Manchester" },
    { query: "Birmingham", countryCode: "GB", expectedNameContains: "Birmingham" },
    // Canada
    { query: "Toronto", countryCode: "CA", expectedNameContains: "Toronto" },
    { query: "Vancouver", countryCode: "CA", expectedNameContains: "Vancouver" },
    { query: "Montreal", countryCode: "CA", expectedNameContains: "Montr" },
    // Australia
    { query: "Sydney", countryCode: "AU", expectedNameContains: "Sydney" },
    { query: "Melbourne", countryCode: "AU", expectedNameContains: "Melbourne" },
    { query: "Brisbane", countryCode: "AU", expectedNameContains: "Brisbane" },
    // UAE
    { query: "Dubai", countryCode: "AE", expectedNameContains: "Dubai" },
    { query: "Abu Dhabi", countryCode: "AE", expectedNameContains: "Abu Dhabi" },
    { query: "Sharjah", countryCode: "AE", expectedNameContains: "Sharjah" },
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
    // Other continents
    { query: "Cairo", countryCode: "EG", expectedNameContains: "Cairo" },
    { query: "Nairobi", countryCode: "KE", expectedNameContains: "Nairobi" },
    { query: "Sao Paulo", countryCode: "BR", expectedNameContains: "Paulo" },
    { query: "Buenos Aires", countryCode: "AR", expectedNameContains: "Buenos Aires" },
  ];

  for (const s of requiredCities) {
    const hits = searchWorldLocations(s.query, { limit: 25 });
    const found = hits.find(
      (i) => i.countryCode === s.countryCode && i.name.includes(s.expectedNameContains),
    );
    assert.ok(found, `Expected direct search "${s.query}" to find ${s.expectedNameContains} in ${s.countryCode}`);
  }

  // Local-language & India alias searches
  assert.ok(searchWorldLocations("München", { limit: 10 }).some((i) => i.name === "Munich" && i.countryCode === "DE"));
  assert.ok(searchWorldLocations("東京", { limit: 10 }).some((i) => i.name === "Tokyo" && i.countryCode === "JP"));
  assert.ok(searchWorldLocations("دبي", { limit: 10 }).some((i) => i.name === "Dubai" && i.countryCode === "AE"));
  assert.ok(searchWorldLocations("Bangalore", { countryCode: "IN", limit: 10 }).some((i) => i.name === "Bengaluru"));
  assert.ok(searchWorldLocations("Kavaratti", { countryCode: "IN", limit: 10 }).some((i) => i.region === "Lakshadweep"));
  assert.ok(searchWorldLocations("Leh", { countryCode: "IN", limit: 10 }).some((i) => i.region === "Ladakh"));

  // Disambiguation of identical city names via country & region labels AND saved values
  const parisHits = searchWorldLocations("Paris", { limit: 25 }).filter((i) => i.name === "Paris");
  const parisFr = parisHits.find((i) => i.countryCode === "FR")!;
  const parisTx = parisHits.find((i) => i.countryCode === "US" && i.region === "Texas")!;
  assert.ok(parisFr && parisTx);
  assert.notEqual(formatWorldLocationSubtitle(parisFr), formatWorldLocationSubtitle(parisTx));
  assert.equal(formatWorldLocationValue(parisFr), "Paris, France");
  assert.equal(formatWorldLocationValue(parisTx), "Paris, United States");
  assert.equal(findWorldLocationByValue("Paris, France")?.id, parisFr.id);
  assert.equal(findWorldLocationByValue("Paris, United States")?.id, parisTx.id);
  assert.equal(findWorldLocationByValue("Paris, Texas, United States")?.id, parisTx.id);

  // Within-country state disambiguation (e.g. Springfield in multiple US states)
  const springfields = searchWorldLocations("Springfield", { countryCode: "US", limit: 15 }).filter(
    (i) => i.name === "Springfield",
  );
  const spIl = springfields.find((i) => i.region === "Illinois")!;
  const spMo = springfields.find((i) => i.region === "Missouri")!;
  assert.ok(spIl && spMo, "Expected Springfield in both Illinois and Missouri");
  assert.equal(formatWorldLocationValue(spIl), "Springfield, Illinois, United States");
  assert.equal(formatWorldLocationValue(spMo), "Springfield, Missouri, United States");
  assert.equal(findWorldLocationByValue("Springfield, Illinois, United States")?.id, spIl.id);
  assert.equal(findWorldLocationByValue("Springfield, Missouri, United States")?.id, spMo.id);

  const londonHits = searchWorldLocations("London", { limit: 25 }).filter((i) => i.name === "London");
  const londonUk = londonHits.find((i) => i.countryCode === "GB")!;
  const londonCa = londonHits.find((i) => i.countryCode === "CA")!;
  assert.ok(londonUk && londonCa);
  assert.equal(formatWorldLocationValue(londonUk), "London, United Kingdom");
  assert.equal(formatWorldLocationValue(londonCa), "London, Canada");
  assert.equal(findWorldLocationByValue("London, United Kingdom")?.id, londonUk.id);
  assert.equal(findWorldLocationByValue("London, Canada")?.id, londonCa.id);

  // India preserves canonical plain city name (backwards compatible)
  const mumbai = searchWorldLocations("Mumbai", { countryCode: "IN", limit: 5 })[0]!;
  assert.equal(formatWorldLocationValue(mumbai), "Mumbai");
});

/* ============================================================================
 * 5. PROFILE & ONBOARDING PERSISTENCE OF GLOBAL LOCATIONS
 * ============================================================================ */

test("Real global locations persist across reload and logout/login while rejecting fake Worldwide", () => {
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
      email: "intl.member@datevra.test",
      password: "Password123!",
      firstName: "Aanya",
      age: 27,
      gender: "woman",
      interestedIn: "men",
      city: "Mumbai",
    });
    assert.equal(reg.ok, true);
    if (!reg.ok) return;
    const uid = reg.session.userId;
    assert.equal(mockDb.getUser(uid)?.city, "Mumbai");

    // Save international city (London, United Kingdom)
    mockDb.updateUser(uid, { city: "London, United Kingdom" });
    assert.equal(mockDb.getUser(uid)?.city, "London, United Kingdom");

    // Reload & logout/login persistence
    mockDb.logout();
    const relogin = mockDb.login("intl.member@datevra.test", "Password123!");
    assert.equal(relogin.ok, true);
    if (!relogin.ok) return;
    assert.equal(mockDb.getUser(relogin.session.userId)?.city, "London, United Kingdom");

    // Reject attempt to overwrite with fake "Worldwide"
    mockDb.updateUser(uid, { city: "Worldwide" });
    assert.equal(mockDb.getUser(uid)?.city, "London, United Kingdom");

    // Switch to Tokyo, Japan and back to Bengaluru
    mockDb.updateUser(uid, { city: "Tokyo, Japan" });
    assert.equal(mockDb.getUser(uid)?.city, "Tokyo, Japan");
    mockDb.updateUser(uid, { city: "Bengaluru" });
    assert.equal(mockDb.getUser(uid)?.city, "Bengaluru");
  } finally {
    if (prevStorage === undefined) {
      delete (globalThis as { localStorage?: Storage }).localStorage;
    } else {
      (globalThis as { localStorage?: Storage }).localStorage = prevStorage;
    }
  }

  // Supabase mapper round-trip for international location
  const intlPatch = unmapProfilePatch({ city: "Toronto, Canada" });
  assert.equal(intlPatch.city, "Toronto, Canada");
  const mappedIntl = mapProfile({
    id: "u-ca",
    email: "ca@datevra.test",
    first_name: "Maya",
    age: 28,
    gender: "woman",
    interested_in: "men",
    city: "Toronto, Canada",
    created_at: "2026-11-27T00:00:00.000Z",
  });
  assert.equal(mappedIntl.city, "Toronto, Canada");

  // Completeness counts real international location
  assert.equal(
    profileCompleteness({
      bio: "Hello there, enjoying life and good coffee.",
      relationshipIntent: "Long-term relationship",
      city: "Toronto, Canada",
      interests: ["Art", "Coffee", "Travel", "Cinema", "Reading"],
      photos: ["https://example.com/p1.jpg", "https://example.com/p2.jpg"],
    }),
    100,
  );
});

/* ============================================================================
 * 6. DISCOVER INTERNATIONAL LOCATION FILTERING & 75% COMPATIBILITY PRESERVED
 * ============================================================================ */

test("Discover filters real international locations while preserving 75% compatibility threshold and exact weights", () => {
  assert.equal(MIN_COMPATIBILITY_SCORE, 75);
  assert.equal(sameSavedLocation("London", "London, United Kingdom"), true);
  assert.equal(sameSavedLocation("London, United Kingdom", "London, Canada"), false);
  assert.equal(sameSavedLocation("Paris, France", "Paris, Texas, United States"), false);

  const viewerLondon = makeProfile({
    id: "v-lon",
    gender: "man",
    interestedIn: "women",
    city: "London, United Kingdom",
  });

  const candLondonUk = makeProfile({
    id: "c-lon-uk",
    firstName: "Clara",
    gender: "woman",
    interestedIn: "men",
    city: "London, United Kingdom",
  });

  const candLondonCa = makeProfile({
    id: "c-lon-ca",
    firstName: "Sophie",
    gender: "woman",
    interestedIn: "men",
    city: "London, Canada",
  });

  const candTokyo = makeProfile({
    id: "c-tyo",
    firstName: "Yuki",
    gender: "woman",
    interestedIn: "men",
    city: "Tokyo, Japan",
  });

  const candMumbai = makeProfile({
    id: "c-bom",
    firstName: "Diya",
    gender: "woman",
    interestedIn: "men",
    city: "Mumbai",
  });

  const ukAndJapanPrefs: MatchPreferences = {
    ...BROAD_DEFAULT_PREFS,
    ageMin: 24,
    ageMax: 34,
    interestedIn: "women",
    cities: ["London, United Kingdom", "Tokyo, Japan"],
  };

  // Discover international filter matches London UK & Tokyo Japan, excludes London Canada & Mumbai
  assert.equal(matchesPreferences(viewerLondon, candLondonUk, ukAndJapanPrefs), true);
  assert.equal(matchesPreferences(viewerLondon, candTokyo, ukAndJapanPrefs), true);
  assert.equal(matchesPreferences(viewerLondon, candLondonCa, ukAndJapanPrefs), false);
  assert.equal(matchesPreferences(viewerLondon, candMumbai, ukAndJapanPrefs), false);

  // Exact matching weights preserved: same city (+10) vs chosen preferred city (+6) -> exact 4pt delta
  const sameCityScore = computeCompatibility(viewerLondon, candLondonUk, ukAndJapanPrefs);
  const chosenCityScore = computeCompatibility(viewerLondon, candTokyo, ukAndJapanPrefs);
  assert.ok(sameCityScore.factors.some((f) => f.includes("Both in London, United Kingdom")));
  assert.ok(chosenCityScore.factors.some((f) => f.includes("In Tokyo, Japan, one of your chosen cities")));
  assert.equal(sameCityScore.score - chosenCityScore.score, 4);

  // rankCandidates surfaces exactly the two filtered international matches above 75%
  const ranked = rankCandidates(
    viewerLondon,
    [candLondonUk, candLondonCa, candTokyo, candMumbai],
    ukAndJapanPrefs,
    new Set(),
  );
  assert.deepEqual(
    ranked.map((r) => r.profile.id),
    ["c-lon-uk", "c-tyo"],
  );
  assert.ok(ranked.every((r) => r.score >= MIN_COMPATIBILITY_SCORE));

  // Pairwise assessment detects distinct countries for disambiguated cities
  const pairDiff = evaluatePairwiseCompatibility(viewerLondon, candLondonCa);
  assert.ok(pairDiff.concerns.some((c) => c.includes("Different locations")));
});
