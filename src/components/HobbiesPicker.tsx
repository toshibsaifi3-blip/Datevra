import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ALL_HOBBY_OPTIONS,
  HOBBY_CATEGORIES,
  HOBBY_CUSTOM_MAX_LENGTH,
  HOBBY_MAX_SELECTION,
  HOBBY_MIN_SELECTION,
  isCatalogHobby,
  matchCanonicalHobby,
  normalizeHobbyValue,
  normalizeSavedHobbies,
  validateHobbySelection,
} from "../data/hobbies";
import { inputCls } from "./ui";

export interface HobbiesPickerProps {
  /** User's currently saved hobbies (displayed in exact selection order). */
  value: string[];
  /**
   * Called when user taps "Done" after passing min 3 / max 5 validation.
   * May be async to persist immediately to the backend.
   */
  onSave: (nextHobbies: string[]) => void | Promise<void>;
  /** Optional override for test/SSR rendering with modal initially open. */
  defaultOpen?: boolean;
}

const INITIAL_ALL_VISIBLE = 48;

/**
 * Tinder-inspired Hobbies selection experience styled with Datevra's exact
 * champagne, rose-gold, ivory, and burgundy glass design system.
 *
 * - Displays saved hobbies cleanly in exact selection order (no empty placeholder tags).
 * - Opens a dedicated uncluttered modal ("Your Hobbies") with live "X of 5 selected"
 *   counter, search across all 36 categories, category browsing filters, flat selectable
 *   rounded hobby chips, custom hobby addition ("Can't find your hobby? Add your own."),
 *   strict min 3 / max 5 validation on "Done", and safe cancel without overwriting.
 */
export function HobbiesPicker({ value, onSave, defaultOpen = false }: HobbiesPickerProps) {
  const normalizedSaved = useMemo(() => normalizeSavedHobbies(value), [value]);

  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<string[]>(normalizedSaved);
  const [customPool, setCustomPool] = useState<string[]>(() =>
    normalizedSaved.filter((item) => !isCatalogHobby(item)),
  );
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [visibleLimit, setVisibleLimit] = useState<number>(INITIAL_ALL_VISIBLE);
  const [showCustomForm, setShowCustomForm] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();

  const openModal = () => {
    const fresh = normalizeSavedHobbies(value);
    setDraft(fresh);
    setCustomPool((prev) => {
      const merged = [...prev];
      const seen = new Set(merged.map((x) => x.toLowerCase()));
      for (const item of fresh) {
        if (!isCatalogHobby(item) && !seen.has(item.toLowerCase())) {
          merged.push(item);
          seen.add(item.toLowerCase());
        }
      }
      return merged;
    });
    setQuery("");
    setActiveCategory("all");
    setVisibleLimit(INITIAL_ALL_VISIBLE);
    setShowCustomForm(false);
    setCustomInput("");
    setFeedback(null);
    setOpen(true);
  };

  const closeWithoutSaving = () => {
    if (saving) return;
    setOpen(false);
    setFeedback(null);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeWithoutSaving();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saving]);

  const draftLowerSet = useMemo(
    () => new Set(draft.map((item) => item.toLowerCase())),
    [draft],
  );

  const validation = useMemo(() => validateHobbySelection(draft), [draft]);

  const selectedCountByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cat of HOBBY_CATEGORIES) {
      let c = 0;
      for (const item of cat.items) {
        if (draftLowerSet.has(item.toLowerCase())) c++;
      }
      if (c > 0) counts.set(cat.id, c);
    }
    return counts;
  }, [draftLowerSet]);

  const toggleHobby = (hobby: string) => {
    setFeedback(null);
    const key = hobby.toLowerCase();
    if (draftLowerSet.has(key)) {
      setDraft((prev) => prev.filter((item) => item.toLowerCase() !== key));
      return;
    }
    if (draft.length >= HOBBY_MAX_SELECTION) {
      setFeedback(
        `Maximum ${HOBBY_MAX_SELECTION} hobbies selected. Deselect one to pick "${hobby}".`,
      );
      return;
    }
    setDraft((prev) => [...prev, hobby]);
  };

  const handleAddCustom = () => {
    setFeedback(null);
    const cleaned = normalizeHobbyValue(customInput);
    if (!cleaned) {
      setFeedback("Enter a hobby name before adding.");
      return;
    }
    if (cleaned.length < 2) {
      setFeedback("Hobby name must be at least 2 characters.");
      return;
    }
    if (cleaned.length > HOBBY_CUSTOM_MAX_LENGTH) {
      setFeedback(`Hobby name must be ${HOBBY_CUSTOM_MAX_LENGTH} characters or fewer.`);
      return;
    }

    const canonical = matchCanonicalHobby(cleaned);
    const lower = canonical.toLowerCase();

    // Ensure it exists in available pool if custom
    if (!isCatalogHobby(canonical)) {
      setCustomPool((prev) =>
        prev.some((x) => x.toLowerCase() === lower) ? prev : [...prev, canonical],
      );
    }

    if (draftLowerSet.has(lower)) {
      setFeedback(`"${canonical}" is already selected.`);
      setCustomInput("");
      return;
    }

    if (draft.length >= HOBBY_MAX_SELECTION) {
      setFeedback(
        `Added "${canonical}" to your custom hobbies. Deselect one hobby first to select it (max ${HOBBY_MAX_SELECTION}).`,
      );
      setCustomInput("");
      return;
    }

    setDraft((prev) => [...prev, canonical]);
    setCustomInput("");
  };

  const handleDone = async () => {
    const check = validateHobbySelection(draft);
    if (!check.valid) {
      setFeedback(check.reason ?? "Please select between 3 and 5 hobbies.");
      return;
    }
    setFeedback(null);
    setSaving(true);
    try {
      await onSave([...draft]);
      setOpen(false);
    } catch (err) {
      setFeedback(
        err instanceof Error ? err.message : "Could not save your hobbies. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  // Build visible sections respecting search query and category filter
  const { visibleSections, totalMatchedCount, remainingCount } = useMemo(() => {
    const q = normalizeHobbyValue(query).toLowerCase();
    const sections: { id: string; label: string; items: string[] }[] = [];

    // Custom / preserved hobbies section (shown first when matching)
    const matchingCustom = customPool.filter(
      (item) => !q || item.toLowerCase().includes(q) || "custom".includes(q),
    );
    if (matchingCustom.length > 0 && (activeCategory === "all" || activeCategory === "custom")) {
      sections.push({
        id: "custom",
        label: "Your Custom Hobbies",
        items: matchingCustom,
      });
    }

    for (const cat of HOBBY_CATEGORIES) {
      if (activeCategory !== "all" && cat.id !== activeCategory) continue;
      const catMatches = q.length > 0 && cat.label.toLowerCase().includes(q);
      const matched = cat.items.filter(
        (item) => !q || catMatches || item.toLowerCase().includes(q),
      );
      if (matched.length > 0) {
        sections.push({ id: cat.id, label: cat.label, items: matched });
      }
    }

    const total = sections.reduce((acc, s) => acc + s.items.length, 0);

    // When viewing "all" without an active search query, paginate smoothly so users
    // never face an overwhelming unfiltered wall of 350+ buttons at once.
    if (activeCategory === "all" && !q) {
      let budget = visibleLimit;
      const limited: { id: string; label: string; items: string[] }[] = [];
      for (const sec of sections) {
        if (budget <= 0) break;
        const slice = sec.items.slice(0, budget);
        if (slice.length > 0) {
          limited.push({ ...sec, items: slice });
          budget -= slice.length;
        }
      }
      const shown = limited.reduce((acc, s) => acc + s.items.length, 0);
      return {
        visibleSections: limited,
        totalMatchedCount: total,
        remainingCount: Math.max(0, total - shown),
      };
    }

    return {
      visibleSections: sections,
      totalMatchedCount: total,
      remainingCount: 0,
    };
  }, [query, activeCategory, customPool, visibleLimit]);

  const atLimit = draft.length >= HOBBY_MAX_SELECTION;

  return (
    <div className="space-y-3">
      {/* Saved hobbies summary in Profile / Onboarding (exact selection order, no empty placeholder chips) */}
      {normalizedSaved.length > 0 ? (
        <div className="flex flex-wrap gap-2" aria-label="Selected hobbies">
          {normalizedSaved.map((hobby) => (
            <span
              key={hobby}
              className="inline-flex items-center rounded-full border border-rosegold/50 bg-rosegold/10 px-3.5 py-1.5 text-sm text-rosegold"
            >
              {hobby}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-sm text-mist">
          Choose {HOBBY_MIN_SELECTION} to {HOBBY_MAX_SELECTION} hobbies so matches know what you love doing.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={openModal}
          className={`${
            normalizedSaved.length > 0 ? "btn-ghost" : "btn-gold"
          } rounded-full px-5 py-2.5 min-h-[44px] text-sm font-medium inline-flex items-center gap-2 touch-manipulation`}
        >
          <span>{normalizedSaved.length > 0 ? "Edit hobbies" : "Choose hobbies"}</span>
          <span className="text-xs opacity-80">
            ({normalizedSaved.length} of {HOBBY_MAX_SELECTION})
          </span>
        </button>
        <span className="text-xs text-mist/80">
          {ALL_HOBBY_OPTIONS.length}+ curated hobbies across {HOBBY_CATEGORIES.length} categories
        </span>
      </div>

      {/* Dedicated Tinder-style Hobbies Selection Modal */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[95] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/75 backdrop-blur-sm"
            onClick={closeWithoutSaving}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.97 }}
              animate={reducedMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 20, scale: 0.97 }}
              transition={reducedMotion ? { duration: 0.1 } : { type: "spring", damping: 28, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="glass-strong border border-white/15 rounded-t-[2rem] sm:rounded-[2rem] w-full max-w-2xl max-h-[92dvh] flex flex-col overflow-hidden focus:outline-none shadow-2xl"
            >
              {/* Step 1: Header + Intro + Live Counter */}
              <div className="px-5 sm:px-7 pt-5 sm:pt-6 pb-4 border-b hairline shrink-0 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 id={titleId} className="font-display text-2xl sm:text-3xl text-ivory">
                      Your Hobbies
                    </h2>
                    <p className="text-sm text-mist mt-1">
                      Choose the hobbies you enjoy. Show people what you love doing.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeWithoutSaving}
                    disabled={saving}
                    aria-label="Close hobbies selector without saving"
                    className="min-h-[44px] min-w-[44px] shrink-0 -mr-2 -mt-1 flex items-center justify-center rounded-xl text-mist hover:text-ivory active:bg-white/10 transition-colors text-2xl leading-none touch-manipulation"
                  >
                    ×
                  </button>
                </div>

                {/* Live Selection Counter (Step 3) */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-2.5">
                  <span
                    className={`text-sm font-semibold ${
                      validation.valid ? "text-champagne" : "text-rosegold"
                    }`}
                  >
                    {draft.length} of {HOBBY_MAX_SELECTION} selected
                  </span>
                  <span className="text-xs text-mist">
                    {draft.length < HOBBY_MIN_SELECTION
                      ? `Select ${HOBBY_MIN_SELECTION - draft.length} more (minimum ${HOBBY_MIN_SELECTION})`
                      : draft.length > HOBBY_MAX_SELECTION
                        ? `Deselect ${draft.length - HOBBY_MAX_SELECTION} to stay within ${HOBBY_MAX_SELECTION}`
                        : draft.length === HOBBY_MAX_SELECTION
                          ? "Maximum reached — tap any selected hobby to swap"
                          : `You can add ${HOBBY_MAX_SELECTION - draft.length} more`}
                  </span>
                </div>

                {/* Currently selected hobbies strip (preserves exact selection order) */}
                {draft.length > 0 && (
                  <div className="flex flex-wrap gap-1.5" aria-label="Selected hobbies in order">
                    {draft.map((item, idx) => (
                      <button
                        key={item}
                        type="button"
                        onClick={() => toggleHobby(item)}
                        aria-label={`Remove ${item}`}
                        className="inline-flex items-center gap-1.5 rounded-full border border-champagne/60 bg-gradient-to-r from-rosegold/25 to-champagne/20 px-3 py-1 text-xs font-medium text-champagne hover:brightness-110 transition-all"
                      >
                        <span className="text-[10px] opacity-75">{idx + 1}.</span>
                        <span>{item}</span>
                        <span aria-hidden>×</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Search bar (Step D) */}
                <div className="relative">
                  <input
                    type="text"
                    className={inputCls}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setVisibleLimit(INITIAL_ALL_VISIBLE);
                    }}
                    placeholder="Search hobbies..."
                    aria-label="Search hobbies"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setVisibleLimit(INITIAL_ALL_VISIBLE);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mist hover:text-ivory px-2 py-1"
                    >
                      Clear
                    </button>
                  )}
                </div>

                {/* Category browsing filter bar (Categories are filters/headings ONLY — not selectable hobbies) */}
                <div
                  className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
                  role="tablist"
                  aria-label="Browse hobby categories"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeCategory === "all"}
                    onClick={() => {
                      setActiveCategory("all");
                      setVisibleLimit(INITIAL_ALL_VISIBLE);
                    }}
                    className={`shrink-0 rounded-full border px-3 py-1.5 min-h-[34px] text-xs transition-colors whitespace-nowrap ${
                      activeCategory === "all"
                        ? "border-champagne/60 bg-champagne/15 text-champagne"
                        : "border-white/15 text-mist hover:text-ivory"
                    }`}
                  >
                    All ({HOBBY_CATEGORIES.length})
                  </button>
                  {customPool.length > 0 && (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeCategory === "custom"}
                      onClick={() => setActiveCategory("custom")}
                      className={`shrink-0 rounded-full border px-3 py-1.5 min-h-[34px] text-xs transition-colors whitespace-nowrap ${
                        activeCategory === "custom"
                          ? "border-rosegold/60 bg-rosegold/15 text-rosegold"
                          : "border-white/15 text-mist hover:text-ivory"
                      }`}
                    >
                      Custom ({customPool.length})
                    </button>
                  )}
                  {HOBBY_CATEGORIES.map((cat) => {
                    const isActive = activeCategory === cat.id;
                    const countInCat = selectedCountByCategory.get(cat.id) ?? 0;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        onClick={() => setActiveCategory(cat.id)}
                        className={`shrink-0 rounded-full border px-3 py-1.5 min-h-[34px] text-xs transition-colors whitespace-nowrap ${
                          isActive
                            ? "border-champagne/60 bg-champagne/15 text-champagne"
                            : "border-white/15 text-mist hover:text-ivory"
                        }`}
                      >
                        {cat.label}
                        {countInCat > 0 ? ` · ${countInCat}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Step 2: Scrollable flat selectable hobby tags grouped under non-selectable category headings */}
              <div className="flex-1 overflow-y-auto px-5 sm:px-7 py-4 space-y-5">
                {totalMatchedCount === 0 ? (
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-center space-y-2">
                    <p className="text-sm text-ivory">
                      No hobbies matched &ldquo;{query.trim()}&rdquo;.
                    </p>
                    <p className="text-xs text-mist">
                      Try another keyword, browse another category, or add your own hobby below.
                    </p>
                  </div>
                ) : (
                  <>
                    {visibleSections.map((section) => (
                      <div key={section.id} className="space-y-2.5">
                        <p className="text-[0.68rem] uppercase tracking-[0.24em] text-mist/85 font-medium">
                          {section.label}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {section.items.map((hobby) => {
                            const selected = draftLowerSet.has(hobby.toLowerCase());
                            const dimmed = !selected && atLimit;
                            return (
                              <button
                                key={hobby}
                                type="button"
                                onClick={() => toggleHobby(hobby)}
                                aria-pressed={selected}
                                className={`rounded-full border px-3.5 py-2 min-h-[38px] text-xs sm:text-sm transition-all touch-manipulation ${
                                  selected
                                    ? "border-rosegold bg-gradient-to-r from-rosegold/25 to-champagne/20 text-champagne font-medium shadow-[0_0_16px_rgba(255,61,154,0.28)]"
                                    : dimmed
                                      ? "border-white/10 bg-white/[0.02] text-mist/50 opacity-55 hover:opacity-80"
                                      : "border-white/20 bg-white/[0.03] text-ivory-dim hover:border-champagne/60 hover:text-ivory active:scale-[0.97]"
                                }`}
                              >
                                {selected ? `✓ ${hobby}` : hobby}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}

                    {remainingCount > 0 && (
                      <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-2 border-t hairline">
                        <span className="text-xs text-mist">
                          Showing {totalMatchedCount - remainingCount} of {totalMatchedCount} hobbies
                        </span>
                        <button
                          type="button"
                          onClick={() => setVisibleLimit((n) => n + 72)}
                          className="btn-ghost rounded-full px-4 py-2 min-h-[40px] text-xs text-champagne"
                        >
                          Show more hobbies ({Math.min(72, remainingCount)} more)
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* Step E: Custom hobbies ("Can't find your hobby? Add your own.") */}
                <div className="pt-4 border-t hairline space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setShowCustomForm((prev) => !prev)}
                    aria-expanded={showCustomForm}
                    className="text-xs sm:text-sm text-champagne hover:text-rosegold transition-colors inline-flex items-center gap-1.5"
                  >
                    <span>Can&apos;t find your hobby? Add your own.</span>
                    <span aria-hidden>{showCustomForm ? "▲" : "▼"}</span>
                  </button>

                  {showCustomForm && (
                    <div className="flex flex-col min-[420px]:flex-row gap-2 pt-1">
                      <input
                        type="text"
                        className={`${inputCls} min-w-0 flex-1`}
                        value={customInput}
                        onChange={(e) => setCustomInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddCustom();
                          }
                        }}
                        placeholder="Enter a custom hobby…"
                        maxLength={HOBBY_CUSTOM_MAX_LENGTH}
                        aria-label="Custom hobby name"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustom}
                        className="btn-ghost rounded-xl px-5 min-h-[44px] text-sm shrink-0"
                      >
                        Add hobby
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Step 4: Sticky footer with validation feedback + Done button */}
              <div className="px-5 sm:px-7 py-4 border-t hairline shrink-0 space-y-3 bg-midnight/60">
                {feedback && (
                  <p
                    role="alert"
                    className="text-xs text-rosegold bg-burgundy/25 border border-rosegold/30 rounded-xl px-3.5 py-2.5"
                  >
                    {feedback}
                  </p>
                )}
                <div className="flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={closeWithoutSaving}
                    disabled={saving}
                    className="btn-ghost rounded-full px-5 min-h-[44px] text-sm disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDone()}
                    disabled={saving}
                    aria-disabled={!validation.valid || saving}
                    className={`rounded-full px-8 min-h-[44px] text-sm font-semibold transition-all ${
                      validation.valid
                        ? "btn-gold"
                        : "border border-white/15 bg-white/5 text-mist hover:border-rosegold/40"
                    } disabled:opacity-60`}
                  >
                    {saving ? "Saving…" : "Done"}
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
