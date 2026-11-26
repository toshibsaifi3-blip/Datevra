import { useEffect, useMemo, useRef, useState } from "react";
import {
  findIndiaLocationByCity,
  formatLocationSubtitle,
  getIndiaStatesAndUTs,
  POPULAR_INDIA_CITIES,
  searchIndiaLocations,
  type IndiaLocation,
} from "../data/indiaLocations";
import { inputCls } from "./ui";

interface IndiaLocationPickerProps {
  value: string;
  onChange: (city: string, location?: IndiaLocation) => void;
  placeholder?: string;
  id?: string;
}

/**
 * Shared India-wide searchable city/town selector covering ALL 28 States &
 * ALL 8 Union Territories (5,292 verified LGD locations across 790 districts).
 * Supports both City-first search (name, district, state, aliases like Bangalore/Bombay)
 * and State/UT-first browsing while preserving any legacy saved city value.
 */
export function IndiaLocationPicker({
  value,
  onChange,
  placeholder = "Search city, town, district or state…",
  id,
}: IndiaLocationPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [stateCode, setStateCode] = useState("");
  const [limit, setLimit] = useState(30);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const statesAndUTs = useMemo(() => getIndiaStatesAndUTs(), []);
  const statesOnly = useMemo(
    () => statesAndUTs.filter((s) => s.kind === "State"),
    [statesAndUTs],
  );
  const utsOnly = useMemo(
    () => statesAndUTs.filter((s) => s.kind === "Union Territory"),
    [statesAndUTs],
  );

  const matchedCurrent = useMemo(() => findIndiaLocationByCity(value), [value]);

  const results = useMemo(
    () =>
      open
        ? searchIndiaLocations(query, {
            stateCode: stateCode || undefined,
            limit: limit + 1,
          })
        : [],
    [open, query, stateCode, limit],
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

  const selectLocation = (loc: IndiaLocation) => {
    onChange(loc.name, loc);
    setOpen(false);
    setQuery("");
  };

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
          {value ? (
            <>
              <span className="text-ivory">{value}</span>
              {matchedCurrent && (
                <span className="text-mist/80 text-xs ml-1.5">
                  · {matchedCurrent.state}
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
          {/* City-first search */}
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
            aria-label="Search Indian cities, towns, districts, or states"
          />

          {/* State / Union Territory filter (all 28 States + 8 UTs) */}
          <select
            className={inputCls}
            value={stateCode}
            onChange={(e) => {
              setStateCode(e.target.value);
              setLimit(30);
            }}
            aria-label="Filter by State or Union Territory"
          >
            <option value="">All India (28 States &amp; 8 Union Territories)</option>
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

          {/* Preserve legacy/existing saved value if not in visible results */}
          {value && !matchedCurrent && (
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
                No verified Indian city or town matched &ldquo;{query.trim()}&rdquo;. Try searching by district, state, or alternate spelling.
              </p>
            ) : (
              visibleResults.map((loc) => {
                const isSelected =
                  value.trim().toLowerCase() === loc.name.toLowerCase();
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
                        {formatLocationSubtitle(loc)} · {loc.settlementType}
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
 * Multi-city selector for Discovery preferences filter modal.
 * Preserves quick-pick metro chips while enabling search across all 5,292 verified Indian locations.
 */
export function IndiaCityMultiPicker({ selected, onChange }: IndiaCityMultiPickerProps) {
  const [query, setQuery] = useState("");
  const [stateCode, setStateCode] = useState("");

  const statesAndUTs = useMemo(() => getIndiaStatesAndUTs(), []);

  const searchResults = useMemo(() => {
    if (!query.trim() && !stateCode) return [];
    return searchIndiaLocations(query, {
      stateCode: stateCode || undefined,
      limit: 20,
    });
  }, [query, stateCode]);

  const toggleCity = (city: string) => {
    const lower = city.trim().toLowerCase();
    const exists = selected.some((c) => c.trim().toLowerCase() === lower);
    if (exists) {
      onChange(selected.filter((c) => c.trim().toLowerCase() !== lower));
    } else {
      onChange([...selected, city]);
    }
  };

  const quickCities = POPULAR_INDIA_CITIES.slice(0, 12);

  return (
    <div className="space-y-3">
      {/* Currently selected cities */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
      )}

      {/* Search any city or state across India */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <input
          type="text"
          className={inputCls}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search any Indian city, town or district…"
        />
        <select
          className={inputCls}
          value={stateCode}
          onChange={(e) => setStateCode(e.target.value)}
          aria-label="Filter cities by State or Union Territory"
        >
          <option value="">Filter by State / UT (36)</option>
          {statesAndUTs.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Matching search results */}
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
                <span className="opacity-70 ml-1">({loc.state})</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {quickCities.map((c) => {
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
