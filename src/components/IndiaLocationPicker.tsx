import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatLocationSubtitle,
  type IndiaLocation,
} from "../data/indiaLocations";
import {
  findWorldLocationByValue,
  formatSelectedLocationBadge,
  formatWorldLocationSubtitle,
  formatWorldLocationValue,
  getWorldCountries,
  getWorldRegionsByCountry,
  POPULAR_COUNTRY_CODES,
  POPULAR_GLOBAL_CITIES,
  sanitizeRealLocation,
  searchWorldCountries,
  searchWorldLocations,
  searchWorldRegions,
  type WorldCountry,
  type WorldLocation,
  type WorldRegion,
} from "../data/worldLocations";
import { inputCls } from "./ui";

export interface IndiaLocationPickerProps {
  value: string;
  onChange: (city: string, location?: IndiaLocation | WorldLocation) => void;
  /** Optional override for SSR/unit tests to render with dropdown initially open. */
  defaultOpen?: boolean;
  /** Optional initial country ISO-2 filter for tests or scoped browsing (default: "" = All Countries). */
  defaultCountryCode?: string;
  /** Optional initial state/province/region code filter (paired with defaultCountryCode). */
  defaultRegionCode?: string;
  placeholder?: string;
  id?: string;
}

/**
 * Shared Global & India searchable cascading location selector.
 *
 * Preserves Datevra's exact selector design and all 5,262 deduplicated
 * Government of India LGD records (28 States & 8 Union Territories) while
 * providing real geographical browsing & search across 244 countries & territories,
 * 2,764 states/provinces/regions, and 35,621 deduplicated global cities & towns.
 *
 * Strictly selects real geographical locations (Country -> State/Province/Region -> City/Town).
 */
export function IndiaLocationPicker({
  value,
  onChange,
  defaultOpen = false,
  defaultCountryCode = "",
  defaultRegionCode = "",
  placeholder = "Search country, state/province, city or town…",
  id,
}: IndiaLocationPickerProps) {
  const cleanValue = sanitizeRealLocation(value);

  const matchedCurrent = useMemo(
    () => findWorldLocationByValue(cleanValue),
    [cleanValue],
  );

  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  /** Country ISO-2 filter: `""` = All Countries by default. */
  const [countryCode, setCountryCode] = useState<string>(defaultCountryCode);
  /** State / Province / Region code filtered by `countryCode`. */
  const [regionCode, setRegionCode] = useState<string>(defaultRegionCode);
  const [limit, setLimit] = useState(30);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const countries = useMemo(() => getWorldCountries(), []);
  const popularCountries = useMemo(
    () =>
      POPULAR_COUNTRY_CODES.map((code) => countries.find((c) => c.code === code)).filter(
        (c): c is WorldCountry => Boolean(c),
      ),
    [countries],
  );

  const regionsForCountry = useMemo(
    () => (countryCode ? getWorldRegionsByCountry(countryCode) : []),
    [countryCode],
  );
  const indiaStatesOnly = useMemo(
    () => (countryCode === "IN" ? regionsForCountry.filter((r) => r.kind === "State") : []),
    [countryCode, regionsForCountry],
  );
  const indiaUtsOnly = useMemo(
    () =>
      countryCode === "IN"
        ? regionsForCountry.filter((r) => r.kind === "Union Territory")
        : [],
    [countryCode, regionsForCountry],
  );

  // Quick cascading filter suggestions when user types a country or state/province name
  const matchingCountries = useMemo(
    () => (open && query.trim().length >= 2 && !countryCode ? searchWorldCountries(query, 4) : []),
    [open, query, countryCode],
  );
  const matchingRegions = useMemo(
    () =>
      open && query.trim().length >= 2 && !regionCode
        ? searchWorldRegions(query, { countryCode: countryCode || undefined, limit: 4 })
        : [],
    [open, query, countryCode, regionCode],
  );

  const results = useMemo(
    () =>
      open
        ? searchWorldLocations(query, {
            countryCode: countryCode || undefined,
            regionCode: regionCode || undefined,
            limit: limit + 1,
          })
        : [],
    [open, query, countryCode, regionCode, limit],
  );

  const hasMore = results.length > limit;
  const visibleResults = hasMore ? results.slice(0, limit) : results;

  useEffect(() => {
    if (!open) return;
    const handleOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const selectLocation = (loc: WorldLocation) => {
    const savedValue = formatWorldLocationValue(loc);
    onChange(savedValue, loc.indiaLocation ?? loc);
    setOpen(false);
    setQuery("");
  };

  const applyCountryQuickFilter = (c: WorldCountry) => {
    setCountryCode(c.code);
    setRegionCode("");
    setQuery("");
    setLimit(30);
  };

  const applyRegionQuickFilter = (r: WorldRegion) => {
    setCountryCode(r.countryCode);
    setRegionCode(r.code);
    setQuery("");
    setLimit(30);
  };

  const triggerPrimaryLabel = matchedCurrent ? matchedCurrent.name : cleanValue;

  return (
    <div ref={containerRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => {
          setOpen((prev) => {
            const next = !prev;
            if (next) {
              setLimit(30);
              setTimeout(() => searchInputRef.current?.focus(), 0);
            }
            return next;
          });
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`${inputCls} flex items-center justify-between gap-2 text-left cursor-pointer`}
      >
        <span className="min-w-0 truncate">
          {triggerPrimaryLabel ? (
            <>
              <span className="text-ivory">{triggerPrimaryLabel}</span>
              {matchedCurrent && (
                <span className="text-mist/80 text-xs ml-1.5">
                  · {formatSelectedLocationBadge(matchedCurrent)}
                </span>
              )}
            </>
          ) : (
            <span className="text-mist/60">Select city or town</span>
          )}
        </span>
        <span className="text-xs text-mist shrink-0" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-2 glass-strong border border-white/15 rounded-2xl p-3 space-y-2.5 shadow-2xl z-30">
          {/* Direct global search: country, state/province, city, town, or local alias */}
          <input
            ref={searchInputRef}
            type="text"
            className={inputCls}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setLimit(30);
            }}
            placeholder={placeholder}
            aria-label="Search country, state, province, city, or town"
          />

          {/* Cascading Filter 1: Country selector (All Countries by default) */}
          <select
            className={inputCls}
            value={countryCode}
            onChange={(e) => {
              setCountryCode(e.target.value);
              setRegionCode("");
              setLimit(30);
            }}
            aria-label="Filter by Country"
          >
            <option value="">All Countries ({countries.length})</option>
            <optgroup label="Popular Countries">
              {popularCountries.map((c) => (
                <option key={`pop-${c.code}`} value={c.code}>
                  {c.name} ({c.locationCount.toLocaleString("en-IN")})
                </option>
              ))}
            </optgroup>
            <optgroup label={`All Countries & Territories (${countries.length})`}>
              {countries.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.locationCount.toLocaleString("en-IN")})
                </option>
              ))}
            </optgroup>
          </select>

          {/* Cascading Filter 2: State / Province / Region selector (filtered by selected country) */}
          {countryCode === "IN" ? (
            <select
              className={inputCls}
              value={regionCode}
              onChange={(e) => {
                setRegionCode(e.target.value);
                setLimit(30);
              }}
              aria-label="Filter by Indian State or Union Territory"
            >
              <option value="">All States &amp; Union Territories (36)</option>
              <optgroup label="States (28)">
                {indiaStatesOnly.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.locationCount})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Union Territories (8)">
                {indiaUtsOnly.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name} ({u.locationCount})
                  </option>
                ))}
              </optgroup>
            </select>
          ) : countryCode && regionsForCountry.length > 0 ? (
            <select
              className={inputCls}
              value={regionCode}
              onChange={(e) => {
                setRegionCode(e.target.value);
                setLimit(30);
              }}
              aria-label="Filter by State, Province, or Region"
            >
              <option value="">
                All States / Provinces / Regions ({regionsForCountry.length})
              </option>
              {regionsForCountry.map((r) => (
                <option key={r.id} value={r.code}>
                  {r.name} ({r.locationCount})
                </option>
              ))}
            </select>
          ) : (
            <select
              className={`${inputCls} opacity-65`}
              value=""
              disabled
              aria-label="Filter by State, Province, or Region"
            >
              <option value="">
                {countryCode
                  ? "No separate states or regions for this country"
                  : "All States / Provinces / Regions (select a country)"}
              </option>
            </select>
          )}

          {/* Quick-drill pills when searching countries or states/provinces */}
          {(matchingCountries.length > 0 || matchingRegions.length > 0) && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {matchingCountries.map((c) => (
                <button
                  key={`qc-${c.code}`}
                  type="button"
                  onClick={() => applyCountryQuickFilter(c)}
                  className="rounded-full border border-champagne/40 bg-champagne/10 px-2.5 py-1 text-[11px] text-champagne hover:bg-champagne/20 transition-colors"
                >
                  Browse {c.name} ({c.locationCount.toLocaleString("en-IN")})
                </button>
              ))}
              {matchingRegions.map((r) => (
                <button
                  key={`qr-${r.id}`}
                  type="button"
                  onClick={() => applyRegionQuickFilter(r)}
                  className="rounded-full border border-white/15 bg-white/[0.04] px-2.5 py-1 text-[11px] text-ivory-dim hover:border-champagne/40 hover:text-ivory transition-colors"
                >
                  {r.name}, {r.countryName} ({r.locationCount})
                </button>
              ))}
            </div>
          )}

          {/* Preserve legacy/existing saved value if not in dataset */}
          {cleanValue && !matchedCurrent && (
            <div className="text-[11px] text-champagne/90 px-2 py-1 rounded-lg bg-champagne/10 border border-champagne/25">
              Current saved city: <strong className="text-ivory">{cleanValue}</strong> (preserved unless you pick a new location)
            </div>
          )}

          {/* Cascading Filter 3: City / Town results */}
          <div
            role="listbox"
            aria-label="Global cities and towns"
            className="max-h-60 overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/10 bg-black/25"
          >
            {visibleResults.length === 0 ? (
              <p className="text-xs text-mist px-3 py-4 text-center">
                No matching locations found. Try another city, town, state/province, or switch Country to All Countries.
              </p>
            ) : (
              visibleResults.map((loc) => {
                const locValue = formatWorldLocationValue(loc);
                const selected =
                  Boolean(matchedCurrent && matchedCurrent.id === loc.id) ||
                  cleanValue.toLowerCase() === locValue.toLowerCase();
                const subtitle = formatWorldLocationSubtitle(loc);
                return (
                  <button
                    key={loc.id}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => selectLocation(loc)}
                    className={`w-full text-left px-3 py-2.5 min-h-[44px] flex items-center justify-between gap-2 transition-colors ${
                      selected
                        ? "bg-champagne/15 text-champagne"
                        : "hover:bg-white/[0.05] text-ivory"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {loc.name}
                        {loc.isIndia && loc.settlementType && loc.settlementType !== "Municipal Corporation" && (
                          <span className="text-[11px] font-normal text-mist/75 ml-1.5">
                            · {loc.settlementType}
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-mist truncate">
                        {subtitle}
                        {loc.aliases.length > 0 && query.trim().length > 0 && (
                          <span className="text-mist/70"> · aka {loc.aliases.slice(0, 2).join(", ")}</span>
                        )}
                      </p>
                    </div>
                    {selected && <span className="text-xs text-champagne shrink-0">✓</span>}
                  </button>
                );
              })
            )}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + 40)}
              className="w-full text-center text-xs text-champagne hover:text-ivory py-1.5 rounded-lg border border-white/10 hover:border-champagne/40 transition-colors"
            >
              Load more locations…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export interface IndiaCityMultiPickerProps {
  selected: string[];
  onChange: (cities: string[]) => void;
}

/**
 * Multi-location selector for Discovery preferences filter modal.
 * Uses cascading Country (All Countries by default) -> State/Province/Region -> City/Town
 * filters across all 244 countries & India's 36 States/UTs.
 */
export function IndiaCityMultiPicker({ selected, onChange }: IndiaCityMultiPickerProps) {
  const [query, setQuery] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [regionCode, setRegionCode] = useState("");

  const countries = useMemo(() => getWorldCountries(), []);
  const popularCountries = useMemo(
    () =>
      POPULAR_COUNTRY_CODES.map((code) => countries.find((c) => c.code === code)).filter(
        (c): c is WorldCountry => Boolean(c),
      ),
    [countries],
  );
  const regionsForCountry = useMemo(
    () => (countryCode ? getWorldRegionsByCountry(countryCode) : []),
    [countryCode],
  );

  const searchResults = useMemo(() => {
    if (!query.trim() && !countryCode && !regionCode) return [];
    return searchWorldLocations(query, {
      countryCode: countryCode || undefined,
      regionCode: regionCode || undefined,
      limit: 24,
    });
  }, [query, countryCode, regionCode]);

  const toggleCity = (city: string) => {
    const clean = sanitizeRealLocation(city);
    if (!clean) return;
    const lower = clean.toLowerCase();
    const exists = selected.some((c) => c.trim().toLowerCase() === lower);
    if (exists) {
      onChange(selected.filter((c) => c.trim().toLowerCase() !== lower));
    } else {
      onChange([...selected, clean]);
    }
  };

  return (
    <div className="space-y-3">
      {/* Currently selected filter cities */}
      {selected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((city) => (
            <span
              key={city}
              className="inline-flex items-center gap-1.5 rounded-full border border-champagne/60 bg-champagne/10 px-3 py-1 text-xs text-champagne"
            >
              <span>{city}</span>
              <button
                type="button"
                onClick={() => toggleCity(city)}
                aria-label={`Remove ${city}`}
                className="hover:text-ivory leading-none"
              >
                ×
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-mist hover:text-ivory underline underline-offset-2 px-1.5 py-1"
          >
            Clear all
          </button>
        </div>
      ) : (
        <p className="text-xs text-mist">
          No city filter active — select one or more cities below to narrow Discover results.
        </p>
      )}

      {/* Search + Country selector (All Countries by default) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search country, state/province, or city…"
        />
        <select
          className={inputCls}
          value={countryCode}
          onChange={(e) => {
            setCountryCode(e.target.value);
            setRegionCode("");
          }}
          aria-label="Filter cities by Country"
        >
          <option value="">All Countries ({countries.length})</option>
          <optgroup label="Popular Countries">
            {popularCountries.map((c) => (
              <option key={`mpop-${c.code}`} value={c.code}>
                {c.name}
              </option>
            ))}
          </optgroup>
          <optgroup label={`All Countries & Territories (${countries.length})`}>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </optgroup>
        </select>
      </div>

      {/* Cascading State / Province / Region selector for selected country */}
      {countryCode && regionsForCountry.length > 0 && (
        <select
          className={inputCls}
          value={regionCode}
          onChange={(e) => setRegionCode(e.target.value)}
          aria-label="Filter cities by State, Province, or Region"
        >
          <option value="">
            {countryCode === "IN"
              ? "All Indian States & Union Territories (36)"
              : `All States / Provinces / Regions (${regionsForCountry.length})`}
          </option>
          {regionsForCountry.map((r) => (
            <option key={r.id} value={r.code}>
              {r.name} ({r.locationCount})
            </option>
          ))}
        </select>
      )}

      {/* Matching search results or global quick picks */}
      {searchResults.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
          {searchResults.map((loc) => {
            const locVal = formatWorldLocationValue(loc);
            const on = selected.some(
              (c) =>
                c.trim().toLowerCase() === locVal.toLowerCase() ||
                c.trim().toLowerCase() === loc.name.toLowerCase(),
            );
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => toggleCity(locVal)}
                className={`rounded-full border px-3 py-1.5 min-h-[36px] text-xs transition-colors ${
                  on
                    ? "border-champagne/60 bg-champagne/10 text-champagne"
                    : "border-white/15 text-mist hover:text-ivory"
                }`}
              >
                {on ? "✓ " : "+ "}
                {loc.name}
                <span className="opacity-70 ml-1">
                  ({formatWorldLocationSubtitle(loc)})
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {POPULAR_GLOBAL_CITIES.map((c) => {
            const on = selected.some(
              (x) => x.trim().toLowerCase() === c.toLowerCase(),
            );
            return (
              <button
                key={c}
                type="button"
                onClick={() => toggleCity(c)}
                className={`rounded-full border px-3.5 py-1.5 min-h-[38px] text-sm transition-colors ${
                  on
                    ? "border-champagne/60 bg-champagne/10 text-champagne shadow-[0_0_14px_rgba(197,164,255,0.25)]"
                    : "border-white/15 text-mist hover:text-ivory"
                }`}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { formatLocationSubtitle };
