/**
 * India-Wide Verified Locations Module
 *
 * Sourced from official Government of India Local Government Directory (LGD)
 * daily snapshot (observed 2026-11-26, retrieved 2026-11-26).
 * Covers ALL 28 States, ALL 8 Union Territories, ALL 790 Districts,
 * ALL 5,050 official Urban Local Bodies (ULBs), plus LGD subdistrict settlements
 * for UTs/districts with few or zero statutory ULBs (e.g. Lakshadweep).
 */

import {
  INDIA_DISTRICTS_RAW,
  INDIA_LOCATION_DATASET_META,
  INDIA_LOCATIONS_RAW,
  INDIA_SETTLEMENT_TYPES,
  INDIA_STATES_RAW,
} from "./indiaLocationsData";

export { INDIA_LOCATION_DATASET_META };

export interface IndiaStateUT {
  readonly index: number;
  readonly code: string;
  readonly name: string;
  readonly lgdName: string;
  readonly kind: "State" | "Union Territory";
  readonly districtCount: number;
  readonly locationCount: number;
}

export interface IndiaDistrict {
  readonly index: number;
  readonly code: string;
  readonly name: string;
  readonly stateIndex: number;
  readonly stateName: string;
  readonly stateCode: string;
}

export interface IndiaLocation {
  readonly id: string;
  readonly name: string;
  readonly state: string;
  readonly stateCode: string;
  readonly stateIndex: number;
  readonly stateKind: "State" | "Union Territory";
  readonly district: string;
  readonly districtCode: string;
  readonly lgdCode: string;
  readonly settlementType: string;
  readonly isMajor: boolean;
  readonly officialBodyName?: string;
  readonly localName?: string;
  readonly aliases: readonly string[];
}

interface SearchableLocation extends IndiaLocation {
  readonly _nameLower: string;
  readonly _districtLower: string;
  readonly _stateLower: string;
  readonly _localLower: string;
  readonly _aliasesLower: readonly string[];
  readonly _officialLower: string;
}

let _cachedStates: IndiaStateUT[] | null = null;
let _cachedDistricts: IndiaDistrict[] | null = null;
let _cachedLocations: SearchableLocation[] | null = null;
let _cachedByState: Map<number, SearchableLocation[]> | null = null;
let _cachedByNameLower: Map<string, SearchableLocation[]> | null = null;

function ensureHydrated(): {
  states: IndiaStateUT[];
  districts: IndiaDistrict[];
  locations: SearchableLocation[];
  byState: Map<number, SearchableLocation[]>;
  byNameLower: Map<string, SearchableLocation[]>;
} {
  if (_cachedStates && _cachedDistricts && _cachedLocations && _cachedByState && _cachedByNameLower) {
    return {
      states: _cachedStates,
      districts: _cachedDistricts,
      locations: _cachedLocations,
      byState: _cachedByState,
      byNameLower: _cachedByNameLower,
    };
  }

  const districtCountByState = new Array<number>(INDIA_STATES_RAW.length).fill(0);
  const locationCountByState = new Array<number>(INDIA_STATES_RAW.length).fill(0);

  const districts: IndiaDistrict[] = INDIA_DISTRICTS_RAW.map(([code, name, stateIndex], index) => {
    districtCountByState[stateIndex] = (districtCountByState[stateIndex] ?? 0) + 1;
    const st = INDIA_STATES_RAW[stateIndex];
    return {
      index,
      code,
      name,
      stateIndex,
      stateName: st[1],
      stateCode: st[0],
    };
  });

  const byState = new Map<number, SearchableLocation[]>();
  const byNameLower = new Map<string, SearchableLocation[]>();

  const locations: SearchableLocation[] = INDIA_LOCATIONS_RAW.map((tuple, idx) => {
    const [name, stateIndex, districtIndex, lgdCode, typeIdx, majorFlag, officialBodyName, localName, pipeAliases] = tuple;
    const st = INDIA_STATES_RAW[stateIndex];
    const dist = districts[districtIndex];
    const aliases = pipeAliases ? pipeAliases.split("|").filter(Boolean) : [];
    locationCountByState[stateIndex] = (locationCountByState[stateIndex] ?? 0) + 1;

    const item: SearchableLocation = {
      id: `in-${st[0]}-${lgdCode}-${idx}`,
      name,
      state: st[1],
      stateCode: st[0],
      stateIndex,
      stateKind: st[3] === "U" ? "Union Territory" : "State",
      district: dist ? dist.name : "",
      districtCode: dist ? dist.code : "",
      lgdCode,
      settlementType: INDIA_SETTLEMENT_TYPES[typeIdx] ?? "Municipality",
      isMajor: majorFlag === 1,
      officialBodyName: officialBodyName || undefined,
      localName: localName || undefined,
      aliases,
      _nameLower: name.toLowerCase(),
      _districtLower: (dist ? dist.name : "").toLowerCase(),
      _stateLower: st[1].toLowerCase(),
      _localLower: (localName || "").toLowerCase(),
      _aliasesLower: aliases.map((a) => a.toLowerCase()),
      _officialLower: (officialBodyName || "").toLowerCase(),
    };

    const stArr = byState.get(stateIndex);
    if (stArr) stArr.push(item);
    else byState.set(stateIndex, [item]);

    const nameArr = byNameLower.get(item._nameLower);
    if (nameArr) nameArr.push(item);
    else byNameLower.set(item._nameLower, [item]);

    return item;
  });

  const states: IndiaStateUT[] = INDIA_STATES_RAW.map(([code, name, lgdName, kind], index) => ({
    index,
    code,
    name,
    lgdName,
    kind: kind === "U" ? "Union Territory" : "State",
    districtCount: districtCountByState[index] ?? 0,
    locationCount: locationCountByState[index] ?? 0,
  }));

  _cachedStates = states;
  _cachedDistricts = districts;
  _cachedLocations = locations;
  _cachedByState = byState;
  _cachedByNameLower = byNameLower;

  return { states, districts, locations, byState, byNameLower };
}

export function getIndiaStatesAndUTs(): readonly IndiaStateUT[] {
  return ensureHydrated().states;
}

export function getIndiaDistricts(): readonly IndiaDistrict[] {
  return ensureHydrated().districts;
}

export function getAllIndiaLocations(): readonly IndiaLocation[] {
  return ensureHydrated().locations;
}

/**
 * Derives the exact deduplicated count of supported Indian cities & towns
 * from the active India locations dataset across all 28 States & 8 UTs.
 * Deduplicates by (stateCode, normalized canonical name) so aliases and
 * repeated source records are never double-counted.
 */
export function getDeduplicatedIndiaLocationCount(): number {
  const seen = new Set<string>();
  for (const loc of ensureHydrated().locations) {
    const normName = loc.name.trim().toLowerCase().replace(/\s+/g, " ");
    if (!normName) continue;
    seen.add(`${loc.stateCode}|${normName}`);
  }
  return seen.size;
}

export function getDistrictsByStateCode(stateCode: string): readonly IndiaDistrict[] {
  return ensureHydrated().districts.filter((d) => d.stateCode === stateCode);
}

export function getLocationsByStateCode(stateCode: string): readonly IndiaLocation[] {
  const { states, byState } = ensureHydrated();
  const st = states.find((s) => s.code === stateCode);
  if (!st) return [];
  return byState.get(st.index) ?? [];
}

/**
 * Curated list of India's top metro & state-capital cities for instant quick-picks
 * (all backed by verified records in the LGD dataset).
 */
export const POPULAR_INDIA_CITIES: readonly string[] = [
  "Delhi",
  "New Delhi",
  "Mumbai",
  "Bengaluru",
  "Hyderabad",
  "Chennai",
  "Kolkata",
  "Pune",
  "Jaipur",
  "Ahmedabad",
  "Gurugram",
  "Noida",
  "Chandigarh",
  "Kochi",
  "Lucknow",
  "Indore",
  "Surat",
  "Nagpur",
  "Bhopal",
  "Patna",
  "Bhubaneswar",
  "Guwahati",
  "Thiruvananthapuram",
  "Coimbatore",
  "Visakhapatnam",
  "Vadodara",
  "Dehradun",
  "Shimla",
  "Panaji",
  "Srinagar",
  "Ranchi",
  "Raipur",
  "Amritsar",
  "Udaipur",
  "Varanasi",
  "Prayagraj",
  "Puducherry",
  "Shillong",
  "Gangtok",
  "Leh",
  "Sri Vijaya Puram",
  "Kavaratti",
] as const;

export interface SearchIndiaLocationsOptions {
  stateCode?: string;
  limit?: number;
}

/**
 * Fast, ranked search across all 5,200+ verified Indian cities, towns, ULBs,
 * districts, states/UTs, aliases (e.g. Bangalore -> Bengaluru, Bombay -> Mumbai,
 * Allahabad -> Prayagraj, Gurgaon -> Gurugram, Port Blair -> Sri Vijaya Puram),
 * and local-language script names.
 */
export function searchIndiaLocations(
  query: string,
  options: SearchIndiaLocationsOptions = {},
): IndiaLocation[] {
  const { states, locations, byState } = ensureHydrated();
  const limit = options.limit ?? 40;
  const q = query.trim().toLowerCase();

  let pool: readonly SearchableLocation[] = locations;
  if (options.stateCode) {
    const st = states.find((s) => s.code === options.stateCode);
    pool = st ? byState.get(st.index) ?? [] : [];
  }

  if (!q) {
    if (options.stateCode) {
      return pool.slice(0, limit);
    }
    // When no query & no state filter, return major metros & capitals first
    const majors: IndiaLocation[] = [];
    for (const loc of pool) {
      if (loc.isMajor) {
        majors.push(loc);
        if (majors.length >= limit) break;
      }
    }
    return majors;
  }

  const scored: { loc: SearchableLocation; rank: number }[] = [];

  for (let i = 0; i < pool.length; i++) {
    const loc = pool[i];
    let rank = 999;

    if (loc._nameLower === q) {
      rank = loc.isMajor ? 0 : 1;
    } else if (loc._aliasesLower.some((a) => a === q)) {
      rank = loc.isMajor ? 2 : 3;
    } else if (loc._nameLower.startsWith(q)) {
      rank = loc.isMajor ? 4 : 6;
    } else if (loc._aliasesLower.some((a) => a.startsWith(q))) {
      rank = loc.isMajor ? 5 : 7;
    } else if (loc._localLower && loc._localLower.includes(q)) {
      rank = 8;
    } else if (loc._districtLower === q) {
      rank = 9;
    } else if (loc._nameLower.includes(q)) {
      rank = loc.isMajor ? 10 : 12;
    } else if (loc._aliasesLower.some((a) => a.includes(q))) {
      rank = 13;
    } else if (loc._officialLower && loc._officialLower.includes(q)) {
      rank = 14;
    } else if (loc._districtLower.startsWith(q)) {
      rank = 15;
    } else if (loc._districtLower.includes(q)) {
      rank = 18;
    } else if (loc._stateLower.startsWith(q)) {
      rank = loc.isMajor ? 20 : 25;
    } else if (loc._stateLower.includes(q)) {
      rank = loc.isMajor ? 22 : 28;
    }

    if (rank < 999) {
      scored.push({ loc, rank });
    }
  }

  scored.sort(
    (a, b) =>
      a.rank - b.rank ||
      Number(b.loc.isMajor) - Number(a.loc.isMajor) ||
      a.loc.name.length - b.loc.name.length ||
      a.loc.name.localeCompare(b.loc.name),
  );

  return scored.slice(0, limit).map((s) => s.loc);
}

/**
 * Finds the best matching verified IndiaLocation for a saved city string
 * (supports canonical names and aliases like "Bangalore" or "Bombay").
 */
export function findIndiaLocationByCity(city: string | null | undefined): IndiaLocation | null {
  const clean = (city ?? "").trim().toLowerCase();
  if (!clean) return null;
  const { byNameLower, locations } = ensureHydrated();
  const exact = byNameLower.get(clean);
  if (exact && exact.length > 0) {
    return exact.find((l) => l.isMajor) ?? exact[0];
  }
  const byAlias = locations.find((l) => l._aliasesLower.includes(clean));
  return byAlias ?? null;
}

/**
 * Formats a concise secondary subtitle for a location (e.g. "Mumbai Suburban, Maharashtra"
 * or "Kavaratti · Lakshadweep").
 */
export function formatLocationSubtitle(loc: IndiaLocation): string {
  if (loc.district && loc.district.toLowerCase() !== loc.name.toLowerCase() && loc.district.toLowerCase() !== loc.state.toLowerCase()) {
    return `${loc.district} · ${loc.state}`;
  }
  return loc.state;
}
