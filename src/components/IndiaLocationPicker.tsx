import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatLocationSubtitle,
  getIndiaStatesAndUTs,
  type IndiaLocation,
} from "../data/indiaLocations";
import {
  findWorldLocationByValue,
  formatSelectedLocationBadge,
  formatWorldLocationSubtitle,
  getWorldCountries,
  POPULAR_COUNTRY_CODES,
  POPULAR_GLOBAL_CITIES,
  searchWorldLocations,
  type WorldLocation,
} from "../data/worldLocations";
import {
  isWorldwideProfile,
  WORLDWIDE_DISPLAY_LABEL,
  WORLDWIDE_SCOPE_TOKEN,
  type LocationScope,
} from "../lib/locationScope";
import { inputCls } from "./ui";

export interface IndiaLocationPickerProps {
  value: string;
  onChange: (city: string, location?: IndiaLocation | WorldLocation) => void;
  /** Explicit location scope ("city" | "worldwide"). */
  locationScope?: LocationScope;
  /** Called when the member chooses Worldwide or switches back to a specific city/town. */
  onScopeChange?: (scope: LocationScope, city: string, location?: WorldLocation) => void;
  /** Whether to show the prominent 🌍 Worldwide option at the top (default: true). */
  allowWorldwide?: boolean;
  /** Optional override for SSR/unit tests to render with dropdown initially open. */
  defaultOpen?: boolean;
  placeholder?: string;
  id?: string;
}

/**
 * Shared Worldwide & India searchable location selector.
 *
 * Preserves the exact Datevra selector design and all 5,262 deduplicated
 * Government of India LGD records (28 States & 8 Union Territories) while
 * expanding to 244 countries & territories (35,621 deduplicated global city/town
 * records from GeoNames + India LGD) and an explicit `🌍 Worldwide` global scope.
 */
export function IndiaLocationPicker({
  value,
  onChange,
  locationScope,
  onScopeChange,
  allowWorldwide = true,
  defaultOpen = false,
  placeholder = "Search city, town, region or country…",
  id,
}: IndiaLocationPickerProps) {
  const isWorldwide =
    allowWorldwide &&
    isWorldwideProfile({
      locationScope,
      city: value,
    });

  const matchedCurrent = useMemo(
    () => (isWorldwide ? null : findWorldLocationByValue(value)),
    [isWorldwide, value],
  );

  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  /**
   * Country scope filter:
   * - `"ALL"` -> All Worldwide (all 244 countries & territories)
   * - `"IN"`  -> All India (28 States & 8 UTs, with State/UT sub-filter)
   * - `"US"`, `"GB"`, etc. -> Specific country
   */
  const [countryScope, setCountryScope] = useState<string>(() => {
    if (isWorldwide) return "ALL";
    if (matchedCurrent) return matchedCurrent.countryCode;
    return "IN";
  });
  const [indiaStateCode, setIndiaStateCode] = useState("");
  const [limit, setLimit] = useState(30);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const countries = useMemo(() => getWorldCountries(), []);
  const popularCountries = useMemo(
    () =>
      POPULAR_COUNTRY_CODES.map((code) => countries.find((c) => c.code === code)).filter(
        (c): c is NonNullable<typeof c> => Boolean(c),
      ),
    [countries],
  );
  const statesAndUTs = useMemo(() => getIndiaStatesAndUTs(), []);
  const statesOnly = useMemo(
    () => statesAndUTs.filter((s) => s.kind === "State"),
    [statesAndUTs],
  );
  const utsOnly = useMemo(
    () => statesAndUTs.filter((s) => s.kind === "Union Territory"),
    [statesAndUTs],
  );

  const results = useMemo(
    () =>
      open
        ? searchWorldLocations(query, {
            // When user types a query while still on default All India without a state filter,
            // check if they're browsing a specific country or All Worldwide.
            // If countryScope === "IN" and indiaStateCode is empty, search India first; if
            // zero India hits, fall back to global search so typing "London" or "Tokyo" works immediately!
            countryCode: countryScope === "ALL" ? "" : countryScope,
            indiaStateCode: countryScope === "IN" ? indiaStateCode || undefined : undefined,
            limit: limit + 1,
          })
        : [],
    [open, query, countryScope, indiaStateCode, limit],
  );

  // If user is on the default India scope (no specific State/UT selected) and searches for
  // an international city/country (e.g. "London", "New York", "Japan") that yields 0 Indian hits,
  // seamlessly surface global GeoNames matches without forcing an extra dropdown click!
  const effectiveResults = useMemo(() => {
    if (!open) return [];
    if (results.length > 0 || !query.trim() || countryScope !== "IN" || indiaStateCode) {
      return results;
    }
    return searchWorldLocations(query, { countryCode: "", limit: limit + 1 });
  }, [open, results, query, countryScope, indiaStateCode, limit]);

  const hasMore = effectiveResults.length > limit;
  const visibleResults = hasMore ? effectiveResults.slice(0, limit) : effectiveResults;

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

  const selectWorldwide = () => {
    if (onScopeChange) {
      onScopeChange("worldwide", "");
    } else {
      onChange(WORLDWIDE_SCOPE_TOKEN);
    }
    setOpen(false);
    setQuery("");
  };

  const selectLocation = (loc: WorldLocation) => {
    if (onScopeChange) {
      onScopeChange("city", loc.name, loc);
    } else {
      onChange(loc.name, loc.indiaLocation ?? loc);
    }
    setCountryScope(loc.countryCode);
    setOpen(false);
    setQuery("");
  };

  const showWorldwideOption =
    allowWorldwide &&
    (!query.trim() ||
      "worldwide".includes(query.trim().toLowerCase()) ||
      "global".includes(query.trim().toLowerCase()) ||
      "anywhere".includes(query.trim().toLowerCase()));

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
          {isWorldwide ? (
            <>
              <span className="text-ivory">🌍 {WORLDWIDE_DISPLAY_LABEL}</span>
              <span className="text-mist/80 text-xs ml-1.5">· Open globally</span>
            </>
          ) : value ? (
            <>
              <span className="text-ivory">{value}</span>
              {matchedCurrent && (
                <span className="text-mist/80 text-xs ml-1.5">
                  · {formatSelectedLocationBadge(matchedCurrent)}
                </span>
              )}
            </>
          ) : (
            <span className="text-mist/60">Select location</span>
          )}
        </span>
        <span className="text-xs text-mist shrink-0" aria-hidden>
          {open ? "▲" : "▼"}
        </span>
      </button>

      {open && (
        <div className="mt-2 glass-strong border border-white/15 rounded-2xl p-3 space-y-2.5 shadow-2xl z-30">
          {/* Prominent first selectable option: 🌍 Worldwide */}
          {showWorldwideOption && (
            <button
              type="button"
              role="option"
              aria-selected={isWorldwide}
              onClick={selectWorldwide}
              className={`w-full text-left px-3 py-2.5 min-h-[44px] rounded-xl border flex items-center justify-between gap-2 transition-colors ${
                isWorldwide
                  ? "border-champagne/60 bg-champagne/15 text-champagne"
                  : "border-white/15 bg-white/[0.04] text-ivory hover:border-champagne/40 hover:bg-white/[0.07]"
              }`}
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">🌍 Worldwide</p>
                <p className="text-[11px] text-mist truncate">
                  Open to matching across cities and countries worldwide
                </p>
              </div>
              {isWorldwide && <span className="text-xs text-champagne shrink-0">✓</span>}
            </button>
          )}

          {/* City / Country / Region / Alias search */}
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
            aria-label="Search worldwide cities, towns, regions, or countries"
          />

          {/* Scope & Country selector (All Worldwide, All India, Popular Countries, All 244 Countries) */}
          <select
            className={inputCls}
            value={countryScope}
            onChange={(e) => {
              setCountryScope(e.target.value);
              setIndiaStateCode("");
              setLimit(30);
            }}
            aria-label="Browse by Worldwide, All India, or Country"
          >
            <option value="ALL">Worldwide ({countries.length} countries &amp; territories)</option>
            <option value="IN">All India (28 States &amp; 8 Union Territories)</option>
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

          {/* Preserved India State / Union Territory filter when browsing India */}
          {countryScope === "IN" && (
            <select
              className={inputCls}
              value={indiaStateCode}
              onChange={(e) => {
                setIndiaStateCode(e.target.value);
                setLimit(30);
              }}
              aria-label="Filter by Indian State or Union Territory"
            >
              <option value="">All India States &amp; Union Territories (36)</option>
              <optgroup label="States (28)">
                {statesOnly.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.locationCount})
                  </option>
                ))}
              </optgroup>
              <optgroup label="Union Territories (8)">
                {utsOnly.map((u) => (
                  <option key={u.code} value={u.code}>
                    {u.name} ({u.locationCount})
                  </option>
                ))}
              </optgroup>
            </select>
          )}

          {/* Preserve legacy/existing saved value if not in dataset */}
          {!isWorldwide && value && !matchedCurrent && (
            <div className="text-[11px] text-champagne/90 px-2 py-1 rounded-lg bg-champagne/10 border border-champagne/25">
              Current saved city: <strong className="text-ivory">{value}</strong> (preserved unless you pick a new location)
            </div>
          )}

          {/* Results list */}
          <div
            role="listbox"
            className="max-h-60 overflow-y-auto divide-y divide-white/5 rounded-xl border border-white/10 bg-midnight/60"
          >
            {visibleResults.length === 0 ? (
              <p className="p-3 text-xs text-mist text-center">
                No city or town matched &ldquo;{query.trim()}&rdquo;. Try searching by country, region, or alternate spelling.
              </p>
            ) : (
              visibleResults.map((loc) => {
                const isSelected =
                  !isWorldwide && value.trim().toLowerCase() === loc.name.toLowerCase();
                return (
                  <button
                    key={loc.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => selectLocation(loc)}
                    className={`w-full text-left px-3 py-2.5 min-h-[44px] flex items-center justify-between gap-2 transition-colors ${
                      isSelected
                        ? "bg-champagne/15 text-champagne"
                        : "text-ivory hover:bg-white/[0.06]"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">
                        {loc.name}
                        {loc.localName && (
                          <span className="text-xs text-mist/80 ml-1.5 font-normal">
                            ({loc.localName})
                          </span>
                        )}
                      </p>
                      <p className="text-[11px] text-mist truncate">
                        {loc.isIndia && loc.indiaLocation
                          ? `${formatLocationSubtitle(loc.indiaLocation)} · India · ${loc.indiaLocation.settlementType}`
                          : formatWorldLocationSubtitle(loc)}
                      </p>
                    </div>
                    {isSelected && (
                      <span className="text-xs text-champagne shrink-0">✓</span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + 40)}
              className="w-full text-center text-xs text-champagne hover:text-rosegold py-1.5"
            >
              Load more locations…
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface IndiaCityMultiPickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
}

/**
 * Multi-location selector for Discovery preferences filter modal.
 * Supports explicit 🌍 Worldwide (open to all locations — clears city filter)
 * as well as searching and selecting cities across all 244 countries & India's 36 States/UTs.
 */
export function IndiaCityMultiPicker({ selected, onChange }: IndiaCityMultiPickerProps) {
  const [query, setQuery] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [indiaStateCode, setIndiaStateCode] = useState("");

  const countries = useMemo(() => getWorldCountries(), []);
  const statesAndUTs = useMemo(() => getIndiaStatesAndUTs(), []);

  const searchResults = useMemo(() => {
    if (!query.trim() && !countryCode && !indiaStateCode) return [];
    return searchWorldLocations(query, {
      countryCode: countryCode || undefined,
      indiaStateCode: countryCode === "IN" ? indiaStateCode || undefined : undefined,
      limit: 24,
    });
  }, [query, countryCode, indiaStateCode]);

  const toggleCity = (city: string) => {
    const lower = city.trim().toLowerCase();
    const exists = selected.some((c) => c.trim().toLowerCase() === lower);
    if (exists) {
      onChange(selected.filter((c) => c.trim().toLowerCase() !== lower));
    } else {
      onChange([...selected, city]);
    }
  };

  const isWorldwideFilter = selected.length === 0;

  return (
    <div className="space-y-3">
      {/* Prominent Worldwide toggle (open to all locations) + currently selected cities */}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onChange([])}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 min-h-[36px] text-xs font-medium transition-colors ${
            isWorldwideFilter
              ? "border-champagne/70 bg-champagne/15 text-champagne"
              : "border-white/15 text-mist hover:text-ivory"
          }`}
        >
          <span>🌍 Worldwide (All locations)</span>
          {isWorldwideFilter && <span>✓</span>}
        </button>

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
      </div>

      {/* Search any city, region or country worldwide */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any city, region or country…"
        />
        <select
          className={inputCls}
          value={countryCode}
          onChange={(e) => {
            setCountryCode(e.target.value);
            setIndiaStateCode("");
          }}
          aria-label="Filter cities by Country"
        >
          <option value="">All Countries ({countries.length})</option>
          <option value="IN">India (28 States &amp; 8 UTs)</option>
          {countries
            .filter((c) => c.code !== "IN")
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
        </select>
      </div>

      {countryCode === "IN" && (
        <select
          className={inputCls}
          value={indiaStateCode}
          onChange={(e) => setIndiaStateCode(e.target.value)}
          aria-label="Filter Indian cities by State or Union Territory"
        >
          <option value="">All Indian States &amp; UTs (36)</option>
          {statesAndUTs.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {/* Matching search results or global quick picks */}
      {searchResults.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto pr-1">
          {searchResults.map((loc) => {
            const on = selected.some(
              (c) => c.trim().toLowerCase() === loc.name.toLowerCase(),
            );
            return (
              <button
                key={loc.id}
                type="button"
                onClick={() => toggleCity(loc.name)}
                className={`rounded-full border px-3 py-1.5 min-h-[36px] text-xs transition-colors ${
                  on
                    ? "border-champagne/60 bg-champagne/10 text-champagne"
                    : "border-white/15 text-mist hover:text-ivory"
                }`}
              >
                {on ? "✓ " : "+ "}
                {loc.name}
                <span className="opacity-70 ml-1">
                  ({loc.isIndia ? loc.region : loc.country})
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

