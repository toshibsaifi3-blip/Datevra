/**
 * Worldwide Geographical Locations Module for Datevra.
 *
 * Combines:
 * 1. Official Government of India LGD dataset (`src/data/indiaLocations.ts`):
 *    ALL 28 States, ALL 8 Union Territories (36 total), ALL 790 districts, and
 *    ALL 5,262 deduplicated (5,292 raw) verified Indian cities & towns — preserved intact.
 * 2. Official GeoNames global dataset (`src/data/worldLocationsData.ts`):
 *    243 non-India countries & territories, 2,728 admin1 states/provinces/regions,
 *    and 30,359 deduplicated populated cities/towns (cities15000 + countryInfo +
 *    admin1CodesASCII, CC BY 4.0).
 *
 * Total verified coverage:
 * - 244 countries & territories
 * - 2,764 states, provinces & administrative regions (36 India + 2,728 international)
 * - 35,621 deduplicated global city/town records (5,262 India + 30,359 international)
 *
 * Strictly represents real geographical locations — never includes a fake
 * "Worldwide" city, state, or country record.
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

export { WORLD_LOCATION_DATASET_META };

export interface WorldCountry {
  readonly index: number;
  readonly code: string;
  readonly name: string;
  readonly continent: string;
  readonly aliases: readonly string[];
  readonly locationCount: number;
  readonly regionCount: number;
  readonly isIndia: boolean;
}

export interface WorldRegion {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly countryCode: string;
  readonly countryName: string;
  readonly kind: "State" | "Union Territory" | "Region";
  readonly locationCount: number;
}

export interface WorldLocation {
  readonly id: string;
  readonly geonameId?: string;
  readonly name: string;
  readonly country: string;
  readonly countryCode: string;
  readonly region: string;
  readonly regionCode: string;
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
  readonly indiaStateUtCount: number;
  readonly internationalRegionCount: number;
  readonly totalRegionCount: number;
  readonly indiaDeduplicatedCount: number;
  readonly indiaRawCount: number;
  readonly internationalCount: number;
  readonly totalDeduplicatedGlobalCount: number;
}

interface SearchableWorldCountry extends WorldCountry {
  readonly _nameFold: string;
  readonly _codeLower: string;
  readonly _aliasesFold: readonly string[];
}

interface SearchableWorldRegion extends WorldRegion {
  readonly _nameFold: string;
  readonly _countryFold: string;
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
  "New York City, United States",
  "London, United Kingdom",
  "Dubai, United Arab Emirates",
  "Singapore",
  "Toronto, Canada",
  "Sydney, Australia",
  "Paris, France",
  "Berlin, Germany",
  "Tokyo, Japan",
] as const;

/**
 * Rejects placeholder/non-geographical values such as "Worldwide" so they can
 * never be stored or displayed as a city, state, or country.
 */
export function isNonGeographicalLocation(raw: string | null | undefined): boolean {
  const clean = (raw ?? "").trim().toLowerCase();
  return clean === "worldwide" || clean === "__worldwide__";
}

/**
 * Cleans a city/location string, returning `""` if blank or non-geographical.
 */
export function sanitizeRealLocation(raw: string | null | undefined): string {
  const clean = (raw ?? "").trim();
  if (!clean || isNonGeographicalLocation(clean)) return "";
  return clean;
}

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
    regionCode: loc.stateCode,
    district: loc.district,
    settlementType: loc.settlementType,
    localName: loc.localName,
    aliases: loc.aliases,
    tier: loc.isMajor ? 3 : 1,
    isIndia: true,
    indiaLocation: loc,
  };
}

let _cachedCountries: SearchableWorldCountry[] | null = null;
let _cachedRegionsAll: SearchableWorldRegion[] | null = null;
let _cachedRegionsByCountry: Map<string, SearchableWorldRegion[]> | null = null;
let _cachedNonIndiaCities: SearchableWorldCity[] | null = null;
let _cachedByCountry: Map<string, SearchableWorldCity[]> | null = null;
let _cachedByCountryRegion: Map<string, SearchableWorldCity[]> | null = null;
let _cachedByNameFold: Map<string, SearchableWorldCity[]> | null = null;
let _cachedDuplicateNameInCountry: Set<string> | null = null;

function ensureWorldHydrated() {
  if (
    _cachedCountries &&
    _cachedRegionsAll &&
    _cachedRegionsByCountry &&
    _cachedNonIndiaCities &&
    _cachedByCountry &&
    _cachedByCountryRegion &&
    _cachedByNameFold &&
    _cachedDuplicateNameInCountry
  ) {
    return {
      countries: _cachedCountries,
      regionsAll: _cachedRegionsAll,
      regionsByCountry: _cachedRegionsByCountry,
      nonIndiaCities: _cachedNonIndiaCities,
      byCountry: _cachedByCountry,
      byCountryRegion: _cachedByCountryRegion,
      byNameFold: _cachedByNameFold,
      duplicateNameInCountry: _cachedDuplicateNameInCountry,
    };
  }

  const indiaDeduplicatedCount = getDeduplicatedIndiaLocationCount();
  const indiaStates = getIndiaStatesAndUTs();

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
  const countByRegionIdx = new Array<number>(WORLD_REGIONS_RAW.length).fill(0);
  const byCountry = new Map<string, SearchableWorldCity[]>();
  const byCountryRegion = new Map<string, SearchableWorldCity[]>();
  const byNameFold = new Map<string, SearchableWorldCity[]>();
  const nameCountInCountry = new Map<string, number>();
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

    const hasRegion = riStr !== "";
    const regionIdx = hasRegion ? Number(riStr) : -1;
    const region = hasRegion ? (WORLD_REGIONS_RAW[regionIdx]?.[1] ?? "") : "";
    const regionCode = hasRegion ? `r${regionIdx}` : "";
    const aliases = aliasesRaw ? aliasesRaw.split("|").filter(Boolean) : [];

    countByCountryIdx[ci] = (countByCountryIdx[ci] ?? 0) + 1;
    if (hasRegion && regionIdx >= 0) {
      countByRegionIdx[regionIdx] = (countByRegionIdx[regionIdx] ?? 0) + 1;
    }

    const nameFold = foldLocationText(name);
    const countryNameKey = `${country.code}|${nameFold}`;
    nameCountInCountry.set(countryNameKey, (nameCountInCountry.get(countryNameKey) ?? 0) + 1);

    const item: SearchableWorldCity = {
      id: `gn-${geonameId}`,
      geonameId,
      name,
      country: country.name,
      countryCode: country.code,
      region,
      regionCode,
      aliases,
      tier,
      isIndia: false,
      _nameFold: nameFold,
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

    if (regionCode) {
      const crKey = `${country.code}|${regionCode}`;
      const rArr = byCountryRegion.get(crKey);
      if (rArr) rArr.push(item);
      else byCountryRegion.set(crKey, [item]);
    }

    const nameArr = byNameFold.get(item._nameFold);
    if (nameArr) nameArr.push(item);
    else byNameFold.set(item._nameFold, [item]);
  }

  const duplicateNameInCountry = new Set<string>();
  for (const [k, cnt] of nameCountInCountry.entries()) {
    if (cnt > 1) duplicateNameInCountry.add(k);
  }

  // Build unified states / provinces / regions index across ALL 244 countries (India LGD + GeoNames)
  const regionsByCountry = new Map<string, SearchableWorldRegion[]>();
  const regionsAll: SearchableWorldRegion[] = [];

  // 1. India's 28 States + 8 Union Territories (preserved intact)
  const indiaRegions: SearchableWorldRegion[] = indiaStates.map((st) => ({
    id: `IN:${st.code}`,
    code: st.code,
    name: st.name,
    countryCode: "IN",
    countryName: "India",
    kind: st.kind,
    locationCount: st.locationCount,
    _nameFold: foldLocationText(st.name),
    _countryFold: "india",
  }));
  regionsByCountry.set("IN", indiaRegions);
  regionsAll.push(...indiaRegions);

  // 2. All 2,728 GeoNames admin1 regions across non-India countries
  for (let ri = 0; ri < WORLD_REGIONS_RAW.length; ri++) {
    const [ci, regionName] = WORLD_REGIONS_RAW[ri];
    const country = countryMeta[ci];
    if (!country || !regionName) continue;
    const reg: SearchableWorldRegion = {
      id: `${country.code}:r${ri}`,
      code: `r${ri}`,
      name: regionName,
      countryCode: country.code,
      countryName: country.name,
      kind: "Region",
      locationCount: countByRegionIdx[ri] ?? 0,
      _nameFold: foldLocationText(regionName),
      _countryFold: country._nameFold,
    };
    const arr = regionsByCountry.get(country.code);
    if (arr) arr.push(reg);
    else regionsByCountry.set(country.code, [reg]);
    regionsAll.push(reg);
  }

  // Sort each non-India country's regions alphabetically for clean dropdown browsing
  for (const [cc, list] of regionsByCountry.entries()) {
    if (cc !== "IN") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
  }

  const countries: SearchableWorldCountry[] = countryMeta.map((c) => ({
    index: c.index,
    code: c.code,
    name: c.name,
    continent: c.continent,
    aliases: c.aliases,
    locationCount: c.code === "IN" ? indiaDeduplicatedCount : (countByCountryIdx[c.index] ?? 0),
    regionCount: regionsByCountry.get(c.code)?.length ?? 0,
    isIndia: c.code === "IN",
    _nameFold: c._nameFold,
    _codeLower: c._codeLower,
    _aliasesFold: c._aliasesFold,
  }));

  _cachedCountries = countries;
  _cachedRegionsAll = regionsAll;
  _cachedRegionsByCountry = regionsByCountry;
  _cachedNonIndiaCities = nonIndiaCities;
  _cachedByCountry = byCountry;
  _cachedByCountryRegion = byCountryRegion;
  _cachedByNameFold = byNameFold;
  _cachedDuplicateNameInCountry = duplicateNameInCountry;

  return {
    countries,
    regionsAll,
    regionsByCountry,
    nonIndiaCities,
    byCountry,
    byCountryRegion,
    byNameFold,
    duplicateNameInCountry,
  };
}

export function getWorldCountries(): readonly WorldCountry[] {
  return ensureWorldHydrated().countries;
}

export function getWorldRegionsByCountry(countryCode: string): readonly WorldRegion[] {
  const cc = countryCode.trim().toUpperCase();
  if (!cc) return [];
  return ensureWorldHydrated().regionsByCountry.get(cc) ?? [];
}

export function getWorldLocationStats(): WorldLocationStats {
  const { countries, nonIndiaCities } = ensureWorldHydrated();
  const indiaDeduplicatedCount = getDeduplicatedIndiaLocationCount();
  const indiaRawCount = getAllIndiaLocations().length;
  const indiaStateUtCount = getIndiaStatesAndUTs().length;
  const internationalRegionCount = WORLD_REGIONS_RAW.length;
  return {
    countryCount: countries.length,
    nonIndiaCountryCount: countries.length - 1,
    indiaStateUtCount,
    internationalRegionCount,
    totalRegionCount: indiaStateUtCount + internationalRegionCount,
    indiaDeduplicatedCount,
    indiaRawCount,
    internationalCount: nonIndiaCities.length,
    totalDeduplicatedGlobalCount: indiaDeduplicatedCount + nonIndiaCities.length,
  };
}

export function getWorldCitiesByCountry(
  countryCode: string,
  options: { regionCode?: string; limit?: number } = {},
): WorldLocation[] {
  const cc = countryCode.trim().toUpperCase();
  if (cc === "IN") {
    return searchIndiaLocations("", {
      stateCode: options.regionCode || undefined,
      limit: options.limit ?? 60,
    }).map(indiaToWorldLocation);
  }
  const { byCountry, byCountryRegion } = ensureWorldHydrated();
  const list = options.regionCode
    ? (byCountryRegion.get(`${cc}|${options.regionCode}`) ?? [])
    : (byCountry.get(cc) ?? []);
  return typeof options.limit === "number" ? list.slice(0, options.limit) : list;
}

/**
 * Searches all 244 countries & territories by name, ISO-2 code, or local/common alias.
 */
export function searchWorldCountries(query: string, limit = 8): WorldCountry[] {
  const qFold = foldLocationText(query);
  if (!qFold) return [];
  const { countries } = ensureWorldHydrated();
  const scored: { country: WorldCountry; rank: number }[] = [];
  for (let i = 0; i < countries.length; i++) {
    const c = countries[i];
    let rank = 999;
    if (c._nameFold === qFold || c._codeLower === qFold) rank = 0;
    else if (c._aliasesFold.includes(qFold)) rank = 1;
    else if (c._nameFold.startsWith(qFold)) rank = 2;
    else if (c._aliasesFold.some((a) => a.startsWith(qFold))) rank = 3;
    else if (qFold.length >= 3 && c._nameFold.includes(qFold)) rank = 4;
    if (rank < 999) scored.push({ country: c, rank });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.country.locationCount - a.country.locationCount ||
      a.country.name.localeCompare(b.country.name),
  );
  return scored.slice(0, limit).map((s) => s.country);
}

/**
 * Searches states, provinces, and administrative regions (all 36 India States/UTs +
 * 2,728 GeoNames admin1 divisions), optionally scoped to a single country.
 */
export function searchWorldRegions(
  query: string,
  options: { countryCode?: string; limit?: number } = {},
): WorldRegion[] {
  const qFold = foldLocationText(query);
  if (!qFold) return [];
  const limit = options.limit ?? 8;
  const cc = (options.countryCode ?? "").trim().toUpperCase();
  const { regionsAll, regionsByCountry } = ensureWorldHydrated();
  const pool = cc && cc !== "ALL" ? (regionsByCountry.get(cc) ?? []) : regionsAll;
  const scored: { region: WorldRegion; rank: number }[] = [];
  for (let i = 0; i < pool.length; i++) {
    const r = pool[i];
    let rank = 999;
    if (r._nameFold === qFold) rank = 0;
    else if (r._nameFold.startsWith(qFold)) rank = 1;
    else if (qFold.length >= 3 && r._nameFold.includes(qFold)) rank = 2;
    if (rank < 999) scored.push({ region: r, rank });
  }
  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      b.region.locationCount - a.region.locationCount ||
      a.region.name.localeCompare(b.region.name),
  );
  return scored.slice(0, limit).map((s) => s.region);
}

export interface SearchWorldLocationsOptions {
  /**
   * Country ISO-2 filter:
   * - `""` or `"ALL"` or undefined -> search across all 244 countries & territories
   * - `"IN"` -> India (uses official LGD dataset & optional `regionCode`)
   * - `"US"`, `"GB"`, `"CA"`, `"AU"`, etc. -> specific country from GeoNames
   */
  countryCode?: string;
  /**
   * State / Province / Region code from `getWorldRegionsByCountry(countryCode)`:
   * - When `countryCode === "IN"`: Indian State/UT code (e.g. `"MH"`, `"DL"`, `"KA"`).
   * - When non-India country: GeoNames region code (e.g. `"r70"` for California).
   */
  regionCode?: string;
  /** Backwards-compatible alias for `regionCode` when `countryCode === "IN"`. */
  indiaStateCode?: string;
  limit?: number;
}

/**
 * Ranked global search across all 244 countries & territories (35,621 deduplicated
 * city/town records: 5,262 India LGD + 30,359 GeoNames cities15000).
 *
 * Supports:
 * - Cascading Country -> State/Province/Region -> City/Town filtering
 * - Direct global search across cities, towns, states/provinces, countries & aliases
 * - Diacritic-folded & local-language search (München, Wien, Roma, 東京, دبي, Bangalore, NYC)
 */
export function searchWorldLocations(
  query: string,
  options: SearchWorldLocationsOptions = {},
): WorldLocation[] {
  const limit = options.limit ?? 30;
  const rawCountry = (options.countryCode ?? "").trim().toUpperCase();
  const cc = rawCountry === "ALL" ? "" : rawCountry;
  const regionCode = (options.regionCode ?? options.indiaStateCode ?? "").trim();
  const qFold = foldLocationText(query);

  // 1. India-scoped browsing/search: preserve 100% of existing LGD India experience
  if (cc === "IN") {
    return searchIndiaLocations(query, {
      stateCode: regionCode || undefined,
      limit,
    }).map(indiaToWorldLocation);
  }

  const { nonIndiaCities, byCountry, byCountryRegion } = ensureWorldHydrated();

  // 2. Single non-India country (and optional state/province/region) browsing/search
  if (cc) {
    const pool = regionCode
      ? (byCountryRegion.get(`${cc}|${regionCode}`) ?? [])
      : (byCountry.get(cc) ?? []);
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

  // 3. All Countries search (all 244 countries & territories including India)
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
      if (iIdx < indiaTop.length) merged.push(indiaTop[iIdx++]);
      if (merged.length < limit && wIdx < intlTop.length) merged.push(intlTop[wIdx++]);
      if (merged.length < limit && wIdx < intlTop.length) merged.push(intlTop[wIdx++]);
    }
    return merged;
  }

  const isIndiaCountryQuery =
    qFold === "india" ||
    qFold === "bharat" ||
    qFold === "hindustan" ||
    ("india".startsWith(qFold) && qFold.length >= 3);

  const indiaMatches = isIndiaCountryQuery
    ? searchIndiaLocations("", { limit: Math.min(limit, 25) }).map(indiaToWorldLocation)
    : searchIndiaLocations(query, { limit: Math.min(limit, 25) }).map(indiaToWorldLocation);

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
    else if (regionFold === qFold) rank = 11;
    else if (regionFold.startsWith(qFold)) rank = 18;
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
 * Formats the canonical saved value for a selected geographical location:
 * - India: canonical city/town name (e.g. "Mumbai", "Delhi", "Bengaluru") to preserve
 *   100% compatibility with existing Indian users, partner cafés, and matches.
 * - International:
 *   - City-states where city === country -> "Singapore"
 *   - Cities whose name repeats across multiple regions within the same country
 *     -> "City, Region, Country" (e.g. "Paris, Texas, United States")
 *   - Other international cities -> "City, Country" (e.g. "London, United Kingdom",
 *     "London, Canada", "Paris, France", "Tokyo, Japan")
 */
export function formatWorldLocationValue(loc: WorldLocation): string {
  if (loc.isIndia) return loc.name;
  const name = loc.name.trim();
  const region = loc.region.trim();
  const country = loc.country.trim();
  if (!country || name.toLowerCase() === country.toLowerCase()) {
    return name;
  }
  const { duplicateNameInCountry } = ensureWorldHydrated();
  const dupKey = `${loc.countryCode}|${foldLocationText(name)}`;
  if (
    duplicateNameInCountry.has(dupKey) &&
    region &&
    region.toLowerCase() !== name.toLowerCase() &&
    region.toLowerCase() !== country.toLowerCase()
  ) {
    return `${name}, ${region}, ${country}`;
  }
  return `${name}, ${country}`;
}

/**
 * Resolves a saved city string (Indian or international, plain or disambiguated
 * `"City, Country"` / `"City, Region, Country"`) to its verified WorldLocation.
 * Returns `null` for empty or non-geographical values (such as `"Worldwide"`).
 */
export function findWorldLocationByValue(city: string | null | undefined): WorldLocation | null {
  const raw = sanitizeRealLocation(city);
  if (!raw) return null;

  // 1. Check "City, Region, Country" or "City, Country" first so disambiguated values
  //    (e.g. "Paris, Texas, United States" or "London, Canada") always resolve accurately.
  const { nonIndiaCities, byNameFold } = ensureWorldHydrated();
  if (raw.includes(",")) {
    const parts = raw.split(",").map(foldLocationText).filter(Boolean);
    if (parts.length >= 2) {
      const cityPart = parts[0];
      const lastPart = parts[parts.length - 1];
      const midPart = parts.length >= 3 ? parts[1] : "";

      if (lastPart === "india" || lastPart === "in") {
        const indiaHit = findIndiaLocationByCity(parts[0]);
        if (indiaHit) return indiaToWorldLocation(indiaHit);
      }

      const candidates = byNameFold.get(cityPart) ?? [];
      if (midPart) {
        const exactWithRegion = candidates.find(
          (c) =>
            (c._countryFold === lastPart ||
              c._countryCodeLower === lastPart ||
              c._countryAliasesFold.includes(lastPart)) &&
            c._regionFold === midPart,
        );
        if (exactWithRegion) return exactWithRegion;
      }
      const matched = candidates.find(
        (c) =>
          c._countryFold === lastPart ||
          c._countryCodeLower === lastPart ||
          c._regionFold === lastPart ||
          c._countryAliasesFold.includes(lastPart),
      );
      if (matched) return matched;
    }
  }

  // 2. Check India LGD (preserves 100% compatibility with existing Indian members)
  const indiaMatch = findIndiaLocationByCity(raw);
  if (indiaMatch) return indiaToWorldLocation(indiaMatch);

  // 3. Check GeoNames international cities by exact folded name
  const fold = foldLocationText(raw);
  const exact = byNameFold.get(fold);
  if (exact && exact.length > 0) {
    return exact[0];
  }

  // 4. Check exact alias match (e.g. "New York" -> "New York City", "München" -> "Munich")
  const byAlias = nonIndiaCities.find((c) => c._aliasesFold.includes(fold));
  return byAlias ?? null;
}

/**
 * Formats a concise disambiguating subtitle showing region and country.
 * - India: e.g. "Mumbai Suburban · Maharashtra, India" or "Maharashtra, India"
 * - International: e.g. "New York, United States", "England, United Kingdom",
 *   "Île-de-France, France", or "Singapore".
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
 */
export function formatSelectedLocationBadge(loc: WorldLocation): string {
  if (loc.isIndia) return `${loc.region}, India`;
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
 * Compares two saved city strings for Discovery & matching consistency.
 * Handles exact case-insensitive matches (e.g. "Mumbai" === "Mumbai",
 * "London, United Kingdom" === "London, United Kingdom") and canonical
 * resolution when one side stored a plain city name ("London") and the
 * other stored the disambiguated form ("London, United Kingdom").
 */
export function sameSavedLocation(a: string | null | undefined, b: string | null | undefined): boolean {
  const cleanA = sanitizeRealLocation(a);
  const cleanB = sanitizeRealLocation(b);
  if (!cleanA || !cleanB) return false;
  if (cleanA.toLowerCase() === cleanB.toLowerCase()) return true;
  const locA = findWorldLocationByValue(cleanA);
  const locB = findWorldLocationByValue(cleanB);
  return Boolean(locA && locB && locA.id === locB.id);
}

export { getIndiaStatesAndUTs };
