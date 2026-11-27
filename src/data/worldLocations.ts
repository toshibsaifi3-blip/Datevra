/**
 * Worldwide Geographical Locations Module for Datevra.
 *
 * Combines:
 * 1. Official Government of India LGD dataset (`src/data/indiaLocations.ts`):
 *    ALL 28 States, ALL 8 Union Territories, ALL 790 districts, and ALL 5,262
 *    deduplicated (5,292 raw) verified Indian cities & towns — preserved intact.
 * 2. Official GeoNames global dataset (`src/data/worldLocationsData.ts`):
 *    243 non-India countries & territories, 2,728 admin1 regions/states, and
 *    30,359 deduplicated populated cities/towns (cities15000 + countryInfo +
 *    admin1CodesASCII, CC BY 4.0).
 *
 * Total verified coverage: 244 countries & territories, 35,621 deduplicated
 * city/town records across all populated continents.
 */

import {
  findIndiaLocationByCity,
  formatLocationSubtitle,
  getAllIndiaLocations,
  getDeduplicatedIndiaLocationCount,
  getIndiaStatesAndUTs,
  searchIndiaLocations,
  type IndiaLocation,
} from "./indiaLocations";
import {
  WORLD_CITIES_PACKED,
  WORLD_COUNTRIES_RAW,
  WORLD_LOCATION_DATASET_META,
  WORLD_REGIONS_RAW,
} from "./worldLocationsData";
import { isWorldwideToken } from "../lib/locationScope";

export { WORLD_LOCATION_DATASET_META };

export interface WorldCountry {
  readonly index: number;
  readonly code: string;
  readonly name: string;
  readonly continent: string;
  readonly aliases: readonly string[];
  readonly locationCount: number;
  readonly isIndia: boolean;
}

export interface WorldLocation {
  readonly id: string;
  readonly geonameId?: string;
  readonly name: string;
  readonly country: string;
  readonly countryCode: string;
  readonly region: string;
  readonly district?: string;
  readonly settlementType?: string;
  readonly localName?: string;
  readonly aliases: readonly string[];
  readonly tier: number;
  readonly isIndia: boolean;
  /** Original IndiaLocation record when `isIndia === true`. */
  readonly indiaLocation?: IndiaLocation;
}

export interface WorldLocationStats {
  readonly countryCount: number;
  readonly nonIndiaCountryCount: number;
  readonly indiaDeduplicatedCount: number;
  readonly indiaRawCount: number;
  readonly internationalCount: number;
  readonly totalDeduplicatedGlobalCount: number;
}

interface SearchableWorldCity extends WorldLocation {
  readonly _nameFold: string;
  readonly _countryFold: string;
  readonly _countryCodeLower: string;
  readonly _countryAliasesFold: readonly string[];
  readonly _regionFold: string;
  readonly _aliasesFold: readonly string[];
}

export const POPULAR_COUNTRY_CODES: readonly string[] = [
  "IN",
  "US",
  "GB",
  "CA",
  "AU",
  "AE",
  "SG",
  "FR",
  "DE",
  "JP",
] as const;

export const POPULAR_GLOBAL_CITIES: readonly string[] = [
  "Mumbai",
  "Delhi",
  "Bengaluru",
  "Hyderabad",
  "Pune",
  "New York City",
  "London",
  "Dubai",
  "Singapore",
  "Toronto",
  "Sydney",
  "Paris",
  "Berlin",
  "Tokyo",
] as const;

export function foldLocationText(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function indiaToWorldLocation(loc: IndiaLocation): WorldLocation {
  return {
    id: loc.id,
    name: loc.name,
    country: "India",
    countryCode: "IN",
    region: loc.state,
    district: loc.district,
    settlementType: loc.settlementType,
    localName: loc.localName,
    aliases: loc.aliases,
    tier: loc.isMajor ? 3 : 1,
    isIndia: true,
    indiaLocation: loc,
  };
}

let _cachedCountries: WorldCountry[] | null = null;
let _cachedNonIndiaCities: SearchableWorldCity[] | null = null;
let _cachedByCountry: Map<string, SearchableWorldCity[]> | null = null;
let _cachedByNameFold: Map<string, SearchableWorldCity[]> | null = null;

function ensureWorldHydrated(): {
  countries: WorldCountry[];
  nonIndiaCities: SearchableWorldCity[];
  byCountry: Map<string, SearchableWorldCity[]>;
  byNameFold: Map<string, SearchableWorldCity[]>;
} {
  if (_cachedCountries && _cachedNonIndiaCities && _cachedByCountry && _cachedByNameFold) {
    return {
      countries: _cachedCountries,
      nonIndiaCities: _cachedNonIndiaCities,
      byCountry: _cachedByCountry,
      byNameFold: _cachedByNameFold,
    };
  }

  const indiaDeduplicatedCount = getDeduplicatedIndiaLocationCount();
  const countryMeta = WORLD_COUNTRIES_RAW.map(([code, name, continent, pipeAliases], index) => {
    const aliases = pipeAliases ? pipeAliases.split("|").filter(Boolean) : [];
    return {
      index,
      code,
      name,
      continent,
      aliases,
      _nameFold: foldLocationText(name),
      _codeLower: code.toLowerCase(),
      _aliasesFold: aliases.map(foldLocationText),
    };
  });

  const countByCountryIdx = new Array<number>(countryMeta.length).fill(0);
  const byCountry = new Map<string, SearchableWorldCity[]>();
  const byNameFold = new Map<string, SearchableWorldCity[]>();
  const nonIndiaCities: SearchableWorldCity[] = [];

  const lines = WORLD_CITIES_PACKED.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split("\t");
    const geonameId = parts[0];
    const name = parts[1];
    const ci = Number(parts[2]);
    const riStr = parts[3];
    const tier = Number(parts[4]) || 0;
    const aliasesRaw = parts[5] || "";

    const country = countryMeta[ci];
    if (!country || !name) continue;

    const region = riStr !== "" ? (WORLD_REGIONS_RAW[Number(riStr)]?.[1] ?? "") : "";
    const aliases = aliasesRaw ? aliasesRaw.split("|").filter(Boolean) : [];
    countByCountryIdx[ci] = (countByCountryIdx[ci] ?? 0) + 1;

    const item: SearchableWorldCity = {
      id: `gn-${geonameId}`,
      geonameId,
      name,
      country: country.name,
      countryCode: country.code,
      region,
      aliases,
      tier,
      isIndia: false,
      _nameFold: foldLocationText(name),
      _countryFold: country._nameFold,
      _countryCodeLower: country._codeLower,
      _countryAliasesFold: country._aliasesFold,
      _regionFold: foldLocationText(region),
      _aliasesFold: aliases.map(foldLocationText),
    };

    nonIndiaCities.push(item);

    const arr = byCountry.get(country.code);
    if (arr) arr.push(item);
    else byCountry.set(country.code, [item]);

    const nameArr = byNameFold.get(item._nameFold);
    if (nameArr) nameArr.push(item);
    else byNameFold.set(item._nameFold, [item]);
  }

  const countries: WorldCountry[] = countryMeta.map((c) => ({
    index: c.index,
    code: c.code,
    name: c.name,
    continent: c.continent,
    aliases: c.aliases,
    locationCount: c.code === "IN" ? indiaDeduplicatedCount : (countByCountryIdx[c.index] ?? 0),
    isIndia: c.code === "IN",
  }));

  _cachedCountries = countries;
  _cachedNonIndiaCities = nonIndiaCities;
  _cachedByCountry = byCountry;
  _cachedByNameFold = byNameFold;

  return { countries, nonIndiaCities, byCountry, byNameFold };
}

export function getWorldCountries(): readonly WorldCountry[] {
  return ensureWorldHydrated().countries;
}

export function getWorldLocationStats(): WorldLocationStats {
  const { countries, nonIndiaCities } = ensureWorldHydrated();
  const indiaDeduplicatedCount = getDeduplicatedIndiaLocationCount();
  const indiaRawCount = getAllIndiaLocations().length;
  return {
    countryCount: countries.length,
    nonIndiaCountryCount: countries.length - 1,
    indiaDeduplicatedCount,
    indiaRawCount,
    internationalCount: nonIndiaCities.length,
    totalDeduplicatedGlobalCount: indiaDeduplicatedCount + nonIndiaCities.length,
  };
}

export function getWorldCitiesByCountry(countryCode: string, limit?: number): WorldLocation[] {
  const cc = countryCode.trim().toUpperCase();
  if (cc === "IN") {
    return searchIndiaLocations("", { limit: limit ?? 60 }).map(indiaToWorldLocation);
  }
  const list = ensureWorldHydrated().byCountry.get(cc) ?? [];
  return typeof limit === "number" ? list.slice(0, limit) : list;
}

export interface SearchWorldLocationsOptions {
  /**
   * Country ISO-2 filter:
   * - `"IN"` -> India (uses official LGD dataset & optional `indiaStateCode`)
   * - `"US"`, `"GB"`, etc. -> specific country from GeoNames
   * - `""` or `"ALL"` or undefined -> search across all 244 countries & territories
   */
  countryCode?: string;
  /** Optional India State/UT code (only applied when `countryCode === "IN"`). */
  indiaStateCode?: string;
  limit?: number;
}

/**
 * Ranked global search across all 244 countries & territories (35,621 deduplicated
 * city/town records: 5,262 India LGD + 30,359 GeoNames cities15000).
 *
 * Supports:
 * - City & town names (including diacritic-folded ASCII search)
 * - International spellings & local-language aliases (e.g. München, Wien, Roma, 東京, دبي, Bangalore, NYC)
 * - Regions, states & districts (e.g. California, Maharashtra, Bavaria, England, Ontario)
 * - Country names & abbreviations (e.g. United States, USA, UK, UAE, Japan, France, Germany, India)
 */
export function searchWorldLocations(
  query: string,
  options: SearchWorldLocationsOptions = {},
): WorldLocation[] {
  const limit = options.limit ?? 30;
  const rawCountry = (options.countryCode ?? "").trim().toUpperCase();
  const cc = rawCountry === "ALL" ? "" : rawCountry;
  const qFold = foldLocationText(query);

  // 1. India-scoped browsing/search: preserve 100% of existing LGD India experience
  if (cc === "IN") {
    return searchIndiaLocations(query, {
      stateCode: options.indiaStateCode || undefined,
      limit,
    }).map(indiaToWorldLocation);
  }

  const { nonIndiaCities, byCountry } = ensureWorldHydrated();

  // 2. Single non-India country browsing/search
  if (cc) {
    const pool = byCountry.get(cc) ?? [];
    if (!qFold) {
      return pool.slice(0, limit);
    }
    const scored: { loc: SearchableWorldCity; rank: number }[] = [];
    for (let i = 0; i < pool.length; i++) {
      const loc = pool[i];
      const rank = scoreNonIndiaCity(loc, qFold);
      if (rank < 999) scored.push({ loc, rank });
    }
    scored.sort(compareScoredCities);
    return scored.slice(0, limit).map((s) => s.loc);
  }

  // 3. Worldwide search (All 244 countries & territories including India)
  if (!qFold) {
    // Interleave major Indian metros + top global hubs when no query is entered
    const indiaTop = searchIndiaLocations("", { limit: Math.min(12, Math.ceil(limit / 3)) }).map(
      indiaToWorldLocation,
    );
    const intlTop = nonIndiaCities.slice(0, limit);
    const merged: WorldLocation[] = [];
    let iIdx = 0;
    let wIdx = 0;
    while (merged.length < limit && (iIdx < indiaTop.length || wIdx < intlTop.length)) {
      if (wIdx < intlTop.length) merged.push(intlTop[wIdx++]);
      if (merged.length < limit && wIdx < intlTop.length) merged.push(intlTop[wIdx++]);
      if (merged.length < limit && iIdx < indiaTop.length) merged.push(indiaTop[iIdx++]);
    }
    return merged;
  }

  // Check if query matches "india" / "bharat" / "hindustan"
  const isIndiaCountryQuery =
    qFold === "india" ||
    qFold === "bharat" ||
    qFold === "hindustan" ||
    "india".startsWith(qFold) && qFold.length >= 3;

  // Search India LGD pool
  const indiaMatches = isIndiaCountryQuery
    ? searchIndiaLocations("", { limit: Math.min(limit, 25) }).map(indiaToWorldLocation)
    : searchIndiaLocations(query, { limit: Math.min(limit, 25) }).map(indiaToWorldLocation);

  // Score both India & non-India matches on a unified relevance scale
  const scoredAll: { loc: WorldLocation; rank: number; tieOrder: number }[] = [];
  for (let i = 0; i < indiaMatches.length; i++) {
    const loc = indiaMatches[i];
    const nameFold = foldLocationText(loc.name);
    const regionFold = foldLocationText(loc.region);
    const aliasesFold = loc.aliases.map(foldLocationText);
    let rank = 24;
    if (nameFold === qFold) rank = loc.tier >= 3 ? 0 : 1;
    else if (aliasesFold.some((a) => a === qFold)) rank = loc.tier >= 3 ? 2 : 3;
    else if (nameFold.startsWith(qFold)) rank = loc.tier >= 3 ? 4 : 6;
    else if (aliasesFold.some((a) => a.startsWith(qFold))) rank = 7;
    else if (nameFold.includes(qFold)) rank = loc.tier >= 3 ? 11 : 14;
    else if (isIndiaCountryQuery) rank = loc.tier >= 3 ? 16 : 22;
    else if (regionFold.startsWith(qFold)) rank = 19;
    else rank = 24;
    scoredAll.push({ loc, rank, tieOrder: i });
  }

  for (let i = 0; i < nonIndiaCities.length; i++) {
    const loc = nonIndiaCities[i];
    const rank = scoreNonIndiaCity(loc, qFold);
    if (rank < 999) {
      scoredAll.push({ loc, rank, tieOrder: i });
    }
  }

  scoredAll.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.loc.tier - a.loc.tier ||
      a.tieOrder - b.tieOrder ||
      a.loc.name.length - b.loc.name.length ||
      a.loc.name.localeCompare(b.loc.name),
  );

  return scoredAll.slice(0, limit).map((s) => s.loc);
}

function scoreNonIndiaCity(loc: SearchableWorldCity, qFold: string): number {
  if (loc._nameFold === qFold) {
    return loc.tier >= 3 ? 0 : loc.tier >= 2 ? 1 : 2;
  }
  if (loc._aliasesFold.some((a) => a === qFold)) {
    return loc.tier >= 3 ? 1 : 3;
  }
  if (loc._nameFold.startsWith(qFold)) {
    return loc.tier >= 3 ? 4 : loc.tier >= 2 ? 5 : 7;
  }
  if (loc._aliasesFold.some((a) => a.startsWith(qFold))) {
    return loc.tier >= 3 ? 6 : 8;
  }
  if (
    loc._countryFold === qFold ||
    loc._countryCodeLower === qFold ||
    loc._countryAliasesFold.some((a) => a === qFold)
  ) {
    return loc.tier >= 3 ? 9 : loc.tier >= 2 ? 12 : 16;
  }
  if (loc._nameFold.includes(qFold)) {
    return loc.tier >= 3 ? 10 : loc.tier >= 2 ? 13 : 15;
  }
  if (loc._aliasesFold.some((a) => a.includes(qFold))) {
    return 14;
  }
  if (loc._regionFold && loc._regionFold === qFold) {
    return loc.tier >= 3 ? 11 : 17;
  }
  if (
    qFold.length >= 3 &&
    (loc._countryFold.startsWith(qFold) ||
      loc._countryAliasesFold.some((a) => a.startsWith(qFold)))
  ) {
    return loc.tier >= 3 ? 15 : loc.tier >= 2 ? 18 : 22;
  }
  if (loc._regionFold && loc._regionFold.startsWith(qFold)) {
    return loc.tier >= 3 ? 18 : 21;
  }
  if (loc._regionFold && qFold.length >= 3 && loc._regionFold.includes(qFold)) {
    return 24;
  }
  if (qFold.length >= 3 && loc._countryFold.includes(qFold)) {
    return loc.tier >= 3 ? 20 : 26;
  }
  return 999;
}

function compareScoredCities(
  a: { loc: SearchableWorldCity; rank: number },
  b: { loc: SearchableWorldCity; rank: number },
): number {
  return (
    a.rank - b.rank ||
    b.loc.tier - a.loc.tier ||
    a.loc.name.length - b.loc.name.length ||
    a.loc.name.localeCompare(b.loc.name)
  );
}

/**
 * Resolves a saved city string (either Indian or international, canonical or alias)
 * to its verified WorldLocation record. Returns `null` for empty or Worldwide scope.
 */
export function findWorldLocationByValue(city: string | null | undefined): WorldLocation | null {
  const raw = (city ?? "").trim();
  if (!raw || isWorldwideToken(raw)) return null;

  // 1. Check India LGD first (preserves 100% compatibility with existing Indian members)
  const indiaMatch = findIndiaLocationByCity(raw);
  if (indiaMatch) return indiaToWorldLocation(indiaMatch);

  // 2. Check GeoNames international cities by exact folded name
  const { nonIndiaCities, byNameFold } = ensureWorldHydrated();
  const fold = foldLocationText(raw);
  const exact = byNameFold.get(fold);
  if (exact && exact.length > 0) {
    return exact[0]; // already sorted by tier & population desc
  }

  // 3. Check "City, Country" or "City, Region, Country" strings
  if (raw.includes(",")) {
    const parts = raw.split(",").map(foldLocationText).filter(Boolean);
    if (parts.length >= 2) {
      const cityPart = parts[0];
      const tailPart = parts[parts.length - 1];
      const candidates = byNameFold.get(cityPart) ?? [];
      const matched = candidates.find(
        (c) =>
          c._countryFold === tailPart ||
          c._countryCodeLower === tailPart ||
          c._regionFold === tailPart ||
          c._countryAliasesFold.includes(tailPart),
      );
      if (matched) return matched;
    }
  }

  // 4. Check exact alias match (e.g. "New York" -> "New York City", "München" -> "Munich")
  const byAlias = nonIndiaCities.find((c) => c._aliasesFold.includes(fold));
  return byAlias ?? null;
}

/**
 * Formats a concise disambiguating subtitle showing region and country.
 * - India: e.g. "Mumbai Suburban · Maharashtra, India" or "Maharashtra, India"
 * - International: e.g. "New York, United States", "England, United Kingdom",
 *   "Île-de-France, France", or "Singapore" when country & city match.
 */
export function formatWorldLocationSubtitle(loc: WorldLocation): string {
  if (loc.isIndia && loc.indiaLocation) {
    return `${formatLocationSubtitle(loc.indiaLocation)} · India`;
  }
  const region = loc.region.trim();
  const country = loc.country.trim();
  if (
    region &&
    region.toLowerCase() !== country.toLowerCase() &&
    region.toLowerCase() !== loc.name.toLowerCase()
  ) {
    return `${region}, ${country}`;
  }
  return country;
}

/**
 * Compact badge text displayed beside the selected city inside the selector button.
 * - India: preserves exact "Maharashtra" format shown in the screenshot
 * - International: shows "Region, Country" (or "Country") to disambiguate identical city names
 */
export function formatSelectedLocationBadge(loc: WorldLocation): string {
  if (loc.isIndia) return loc.region;
  return formatWorldLocationSubtitle(loc);
}

export { getIndiaStatesAndUTs };
