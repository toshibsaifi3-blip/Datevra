import { useMemo, useState } from "react";
import type { CatalogCategory } from "../data/lifestyle";
import { addCustomTagItem } from "../lib/profileFields";
import { inputCls } from "./ui";

interface CatalogTagPickerProps {
  categories: readonly CatalogCategory[];
  selected: string[];
  onChange: (next: string[]) => void;
  tone?: "gold" | "rose";
  searchPlaceholder?: string;
  customPlaceholder?: string;
  emptySelectedText?: string;
  allowCustom?: boolean;
  maxCustomLength?: number;
  initialVisibleCount?: number;
}

const DEFAULT_VISIBLE = 24;

export function CatalogTagPicker({
  categories,
  selected,
  onChange,
  tone = "gold",
  searchPlaceholder = "Search options or categories…",
  customPlaceholder = "Add your own…",
  emptySelectedText = "None selected yet — optional, pick any that fit you.",
  allowCustom = true,
  maxCustomLength = 48,
  initialVisibleCount = DEFAULT_VISIBLE,
}: CatalogTagPickerProps) {
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [visibleLimit, setVisibleLimit] = useState<number>(initialVisibleCount);
  const [customInput, setCustomInput] = useState("");

  const selectedLowerSet = useMemo(
    () => new Set(selected.map((item) => item.trim().toLowerCase())),
    [selected],
  );

  const selectedCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of categories) {
      let c = 0;
      for (const item of cat.items) {
        if (selectedLowerSet.has(item.toLowerCase())) c++;
      }
      if (c > 0) counts.set(cat.id, c);
    }
    return counts;
  }, [categories, selectedLowerSet]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out: { item: string; categoryLabel: string }[] = [];

    for (const cat of categories) {
      if (activeCategory !== "all" && cat.id !== activeCategory) continue;
      const catMatches = q !== "" && cat.label.toLowerCase().includes(q);
      for (const item of cat.items) {
        if (!q || catMatches || item.toLowerCase().includes(q)) {
          out.push({ item, categoryLabel: cat.label });
        }
      }
    }
    return out;
  }, [categories, activeCategory, query]);

  const visibleItems = filteredItems.slice(0, visibleLimit);
  const remainingCount = Math.max(0, filteredItems.length - visibleItems.length);

  const toggleItem = (item: string) => {
    const key = item.trim().toLowerCase();
    if (selectedLowerSet.has(key)) {
      onChange(selected.filter((x) => x.trim().toLowerCase() !== key));
    } else {
      onChange([...selected, item]);
    }
  };

  const removeItem = (item: string) => {
    const key = item.trim().toLowerCase();
    onChange(selected.filter((x) => x.trim().toLowerCase() !== key));
  };

  const handleAddCustom = () => {
    const next = addCustomTagItem(selected, customInput, maxCustomLength);
    if (next !== selected) {
      onChange(next);
    }
    setCustomInput("");
  };

  const activeChipCls =
    tone === "rose"
      ? "border-rosegold/50 bg-rosegold/10 text-rosegold"
      : "border-champagne/50 bg-champagne/10 text-champagne";

  const activeCategoryCls =
    tone === "rose"
      ? "border-rosegold/60 bg-rosegold/15 text-rosegold"
      : "border-champagne/60 bg-champagne/15 text-champagne";

  return (
    <div className="space-y-3">
      {/* Selected items (order preserved, including legacy saved values) */}
      <div>
        {selected.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {selected.map((item) => (
              <span
                key={item}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs ${activeChipCls}`}
              >
                <span className="break-words">{item}</span>
                <button
                  type="button"
                  onClick={() => removeItem(item)}
                  aria-label={`Remove ${item}`}
                  className="hover:text-ivory leading-none pl-0.5 min-w-[20px] min-h-[20px] inline-flex items-center justify-center"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-mist/80">{emptySelectedText}</p>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          className={inputCls}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setVisibleLimit(initialVisibleCount);
          }}
          placeholder={searchPlaceholder}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setVisibleLimit(initialVisibleCount);
            }}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mist hover:text-ivory px-2 py-1"
          >
            Clear
          </button>
        )}
      </div>

      {/* Scrollable category filter bar */}
      <div
        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1"
        role="tablist"
        aria-label="Categories"
      >
        <button
          type="button"
          role="tab"
          aria-selected={activeCategory === "all"}
          onClick={() => {
            setActiveCategory("all");
            setVisibleLimit(initialVisibleCount);
          }}
          className={`shrink-0 rounded-full border px-3 py-1.5 min-h-[34px] text-xs transition-colors whitespace-nowrap ${
            activeCategory === "all"
              ? activeCategoryCls
              : "border-white/15 text-mist hover:text-ivory"
          }`}
        >
          All ({categories.length})
        </button>
        {categories.map((cat) => {
          const isActive = activeCategory === cat.id;
          const selCount = selectedCountByCategory.get(cat.id) ?? 0;
          return (
            <button
              key={cat.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => {
                setActiveCategory(cat.id);
                setVisibleLimit(60);
              }}
              className={`shrink-0 rounded-full border px-3 py-1.5 min-h-[34px] text-xs transition-colors whitespace-nowrap ${
                isActive
                  ? activeCategoryCls
                  : "border-white/15 text-mist hover:text-ivory"
              }`}
            >
              {cat.label}
              {selCount > 0 ? ` · ${selCount}` : ""}
            </button>
          );
        })}
      </div>

      {/* Options list */}
      {filteredItems.length === 0 ? (
        <p className="text-xs text-mist/80 py-2">
          No matching options found. Try another keyword or add a custom tag below.
        </p>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-1">
            {visibleItems.map(({ item }) => {
              const isSelected = selectedLowerSet.has(item.toLowerCase());
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => toggleItem(item)}
                  aria-pressed={isSelected}
                  className={`rounded-full border px-3 py-1.5 min-h-[34px] text-xs transition-colors text-left ${
                    isSelected
                      ? activeChipCls
                      : "border-white/15 text-ivory-dim hover:border-white/35 hover:text-ivory"
                  }`}
                >
                  {isSelected ? `✓ ${item}` : `+ ${item}`}
                </button>
              );
            })}
          </div>
          {remainingCount > 0 && (
            <div className="flex items-center justify-between gap-2 pt-1">
              <span className="text-[11px] text-mist/80">
                Showing {visibleItems.length} of {filteredItems.length} options
              </span>
              <button
                type="button"
                onClick={() => setVisibleLimit((n) => n + 40)}
                className="text-xs text-champagne hover:text-rosegold underline underline-offset-4 py-1"
              >
                Show more ({Math.min(40, remainingCount)} more)
              </button>
            </div>
          )}
        </div>
      )}

      {/* Optional custom tag entry */}
      {allowCustom && (
        <div className="flex flex-col min-[420px]:flex-row gap-2 pt-1">
          <input
            type="text"
            className={inputCls}
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleAddCustom();
              }
            }}
            placeholder={customPlaceholder}
            maxLength={maxCustomLength}
          />
          <button
            type="button"
            onClick={handleAddCustom}
            className="btn-ghost rounded-xl px-4 py-2 min-h-[44px] text-xs shrink-0"
          >
            + Add
          </button>
        </div>
      )}
    </div>
  );
}
