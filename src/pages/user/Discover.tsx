import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import {
  activeFilterLabels,
  BROAD_DEFAULT_PREFS,
  computeCompatibility,
  rankCandidates,
} from "../../lib/compat";
import { CITIES, RELATIONSHIP_INTENTS } from "../../data/seed";
import {
  Avatar,
  Badge,
  EmptyState,
  Field,
  Modal,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import MatchOverlay, { type MatchCelebration } from "../../components/MatchOverlay";
import { LimitReachedModal, DailyLimitCounters } from "../../components/LimitModal";
import { excludedIdsFor, useDbRefresh } from "./shared";
import type { DailyUsage, MatchPreferences, UserProfile } from "../../lib/types";

const REPORT_REASONS = [
  "Inappropriate behaviour",
  "Fake or misleading profile",
  "Harassment",
  "Spam or solicitation",
  "Underage concern",
  "Other",
];

function CompatBar({ score, factors }: { score: number; factors: string[] }) {
  const reducedMotion = useReducedMotion();
  return (
    <div>
      <div className="flex justify-between text-xs text-mist mb-1.5">
        <span className="uppercase tracking-[0.18em]">Compatibility</span>
        <span className="text-champagne font-semibold">{score}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-rosegold via-champagne to-rosegold"
          initial={reducedMotion ? { width: `${score}%` } : { width: 0 }}
          animate={{ width: `${score}%` }}
          transition={
            reducedMotion
              ? { duration: 0.01 }
              : { duration: 0.9, ease: [0.22, 1, 0.36, 1] }
          }
        />
      </div>
      <ul className="mt-2.5 space-y-1">
        {factors.slice(0, 3).map((f) => (
          <li key={f} className="text-xs text-ivory-dim/90 flex gap-1.5">
            <span className="text-rosegold">✦</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type Ranked = ReturnType<typeof rankCandidates>[number];

const cardVariants = {
  enter: (d: number) => ({ x: d * 90, opacity: 0, rotate: d * 2.5, scale: 0.96 }),
  center: { x: 0, opacity: 1, rotate: 0, scale: 1 },
  exit: (d: number) => ({
    x: d * 480,
    opacity: 0,
    rotate: d * 14,
    scale: 0.92,
    transition: { duration: 0.32, ease: [0.32, 0, 0.67, 0] as const },
  }),
};

const reducedCardVariants = {
  enter: () => ({ opacity: 0 }),
  center: { opacity: 1 },
  exit: () => ({ opacity: 0, transition: { duration: 0.08 } }),
};

function ProfileCard({
  entry,
  onView,
  onSwipe,
  busy,
}: {
  entry: Ranked;
  onView: () => void;
  /** direction: 1 = liked (swiped right), -1 = passed (swiped left) */
  onSwipe: (dir: 1 | -1) => void;
  busy?: boolean;
}) {
  const p = entry.profile;
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const likeOpacity = useTransform(x, [40, 130], [0, 1]);
  const passOpacity = useTransform(x, [-40, -130], [0, 1]);
  const rotate = useTransform(x, [-260, 260], [-10, 10]);

  const photos = useMemo(() => (p.photos && p.photos.length > 0 ? p.photos : []), [p.photos]);
  const [photoIdx, setPhotoIdx] = useState(0);
  const [imgFailed, setImgFailed] = useState(false);
  const [imgLoading, setImgLoading] = useState(false);
  const draggingRef = useRef(false);

  const currentPhoto = photos[photoIdx];

  const handlePrevPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (draggingRef.current) return;
    if (photoIdx > 0) {
      setPhotoIdx((i) => i - 1);
      setImgFailed(false);
      setImgLoading(true);
    }
  };

  const handleNextPhoto = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (draggingRef.current) return;
    if (photoIdx < photos.length - 1) {
      setPhotoIdx((i) => i + 1);
      setImgFailed(false);
      setImgLoading(true);
    }
  };

  return (
    <motion.div
      drag={busy ? false : "x"}
      style={reducedMotion ? undefined : { x, rotate }}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.55}
      onDragStart={() => {
        draggingRef.current = true;
      }}
      onDragEnd={(_, info) => {
        setTimeout(() => {
          draggingRef.current = false;
        }, 80);
        if (busy) return;
        if (info.offset.x > 110) onSwipe(1);
        else if (info.offset.x < -110) onSwipe(-1);
      }}
      className="glass-strong glow-border rounded-[2rem] overflow-hidden relative cursor-grab active:cursor-grabbing touch-pan-y select-none shadow-[0_24px_60px_-18px_rgba(16,9,31,0.85)]"
    >
      {/* Drag stamps */}
      <motion.div
        style={{ opacity: likeOpacity }}
        className="absolute top-16 left-6 z-30 rotate-[-14deg] rounded-xl border-4 border-rosegold bg-rosegold/15 backdrop-blur px-4 py-1.5 font-display text-2xl tracking-[0.2em] text-rosegold pointer-events-none"
      >
        LIKE
      </motion.div>
      <motion.div
        style={{ opacity: passOpacity }}
        className="absolute top-16 right-6 z-30 rotate-[14deg] rounded-xl border-4 border-mist bg-midnight/40 backdrop-blur px-4 py-1.5 font-display text-2xl tracking-[0.2em] text-mist pointer-events-none"
      >
        NOPE
      </motion.div>

      {/* Classic Tinder-style full-card photograph with multi-photo tap navigation */}
      <div className="relative h-[440px] sm:h-[530px] overflow-hidden">
        {/* Segmented photo indicators at top */}
        {photos.length > 1 && (
          <div
            aria-hidden="true"
            className="absolute top-3 inset-x-4 z-30 flex items-center gap-1.5 pointer-events-none"
          >
            {photos.map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full ${
                  reducedMotion ? "" : "transition-all duration-300"
                } ${
                  i === photoIdx
                    ? "bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                    : i < photoIdx
                      ? "bg-white/60"
                      : "bg-white/25"
                }`}
              />
            ))}
          </div>
        )}

        {/* Tap zones for previous / next photo */}
        {photos.length > 1 && (
          <>
            <button
              type="button"
              aria-label={`Previous photo of ${p.firstName}`}
              onClick={handlePrevPhoto}
              disabled={photoIdx === 0}
              className="absolute inset-y-0 left-0 w-[40%] z-20 cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-champagne"
            />
            <button
              type="button"
              aria-label={`Next photo of ${p.firstName}`}
              onClick={handleNextPhoto}
              disabled={photoIdx === photos.length - 1}
              className="absolute inset-y-0 right-0 w-[60%] z-20 cursor-pointer disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-champagne"
            />
          </>
        )}

        {currentPhoto && !imgFailed ? (
          <>
            {imgLoading && (
              <div
                aria-hidden="true"
                className="absolute inset-0 bg-gradient-to-br from-coal via-burgundy-deep/60 to-midnight animate-pulse"
              />
            )}
            <img
              key={currentPhoto}
              src={currentPhoto}
              alt={`${p.firstName}'s photo ${photoIdx + 1} of ${photos.length}`}
              className={`absolute inset-0 h-full w-full object-cover pointer-events-none ${
                reducedMotion ? "" : "transition-opacity duration-300"
              } ${imgLoading ? "opacity-0" : "opacity-100"}`}
              draggable={false}
              onLoad={() => setImgLoading(false)}
              onError={() => {
                setImgFailed(true);
                setImgLoading(false);
              }}
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-coal via-burgundy-deep to-midnight flex items-center justify-center">
            <span className="font-display text-7xl text-champagne/60">
              {p.firstName.charAt(0)}
            </span>
          </div>
        )}

        {/* Subtle top scrim for progress bar & Full Profile button readability */}
        <div className="absolute top-0 inset-x-0 h-28 bg-gradient-to-b from-midnight/70 via-midnight/25 to-transparent pointer-events-none" />
        {/* Bottom gradient scrim for readable name & age overlay */}
        <div className="absolute bottom-0 inset-x-0 h-1/2 bg-gradient-to-t from-midnight via-midnight/65 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-tr from-burgundy/25 via-transparent to-rosegold/15 pointer-events-none" />

        {/* Upper-right Full Profile button (isolated from card drag/swipe & photo taps) */}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            if (draggingRef.current) return;
            onView();
          }}
          aria-label={`Full Profile of ${p.firstName}`}
          className="absolute top-6 right-4 z-30 rounded-full bg-midnight/75 backdrop-blur-md border border-champagne/40 px-4 min-h-[44px] text-xs font-medium tracking-wide text-ivory hover:border-rosegold/70 hover:bg-midnight/90 transition-colors shadow-[0_6px_24px_rgba(16,9,31,0.65)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
        >
          Full Profile
        </button>

        {/* Minimal Name & Age overlay near bottom of photograph */}
        <div className="absolute bottom-0 inset-x-0 p-6 z-20 pointer-events-none">
          <h2 className="font-display text-3xl sm:text-4xl font-semibold text-ivory tracking-wide leading-tight drop-shadow-[0_2px_16px_rgba(0,0,0,0.9)]">
            {p.firstName}, {p.age}
          </h2>
        </div>
      </div>
    </motion.div>
  );
}

interface DeckData {
  deck: ReturnType<typeof rankCandidates>;
  savedIds: string[];
  prefs: MatchPreferences;
  likedIds: string[];
}

export default function Discover() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const db = useBackend();
  const reducedMotion = useReducedMotion();
  const tick = useDbRefresh("likes", "matches", "blocks", "profiles");

  const [dir, setDir] = useState<1 | -1>(1);
  const [celebration, setCelebration] = useState<MatchCelebration | null>(null);
  const [viewing, setViewing] = useState<UserProfile | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [prefsDraft, setPrefsDraft] = useState<MatchPreferences | null>(null);
  const [reportFor, setReportFor] = useState<UserProfile | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState("");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [actedState, setActedState] = useState<{ userId: string; ids: Set<string> }>({
    userId: "",
    ids: new Set(),
  });
  const [passedState, setPassedState] = useState<{ userId: string; ids: Set<string> }>({
    userId: "",
    ids: new Set(),
  });
  const [limitKind, setLimitKind] = useState<"likes" | "interests" | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [liveStatus, setLiveStatus] = useState("");
  const busyActionRef = useRef(false);

  const actedLocal = useMemo(
    () => (actedState.userId === (user?.id ?? "") ? actedState.ids : new Set<string>()),
    [actedState, user?.id],
  );
  const passedLocal = useMemo(
    () => (passedState.userId === (user?.id ?? "") ? passedState.ids : new Set<string>()),
    [passedState, user?.id],
  );

  // Free-tier daily caps (20 likes / 20 interests per IST day; paid = exempt).
  const { data: usage, refresh: refreshUsage } = useAsync(
    (b) => (user ? b.getDailyUsage(user.id) : Promise.resolve(null)),
    [db, user?.id],
    null as DailyUsage | null,
  );

  const {
    data,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<DeckData | null> => {
      if (!user) return null;
      const [profiles, prefs, savedIds, sent] = await Promise.all([
        b.listProfiles(),
        b.getPrefs(user.id),
        b.savedProfiles(user.id),
        b.likesSent(user.id),
      ]);
      const excluded = await excludedIdsFor(b, user.id, profiles);
      return {
        deck: rankCandidates(user, profiles, prefs, excluded),
        savedIds,
        prefs,
        likedIds: sent.map((l) => l.toUserId),
      };
    },
    [user?.id, tick],
    null as DeckData | null,
  );

  const deck = useMemo(() => data?.deck ?? [], [data?.deck]);
  const visibleDeck = useMemo(
    () => deck.filter((d) => !actedLocal.has(d.profile.id)),
    [deck, actedLocal],
  );
  const current = visibleDeck[0] ?? null;
  const next = visibleDeck[1] ?? null;
  const saved = useMemo(() => new Set(data?.savedIds ?? []), [data?.savedIds]);
  const likedIds = useMemo(() => new Set(data?.likedIds ?? []), [data?.likedIds]);
  const prefs = data?.prefs ?? null;
  const filterTags = useMemo(() => activeFilterLabels(prefs), [prefs]);

  const markActed = useCallback(
    (id: string) => {
      const uid = user?.id ?? "";
      setActedState((prev) => {
        const base = prev.userId === uid ? prev.ids : new Set<string>();
        const nextSet = new Set(base);
        nextSet.add(id);
        return { userId: uid, ids: nextSet };
      });
    },
    [user?.id],
  );

  const markPassed = useCallback(
    (id: string) => {
      const uid = user?.id ?? "";
      setPassedState((prev) => {
        const base = prev.userId === uid ? prev.ids : new Set<string>();
        const nextSet = new Set(base);
        nextSet.add(id);
        return { userId: uid, ids: nextSet };
      });
    },
    [user?.id],
  );

  /** Opening a full profile counts as "showing interest" (20/day for free users). */
  const openProfile = useCallback(
    async (profile: UserProfile) => {
      if (!user) return;
      const me = user;
      try {
        await db.recordProfileInterest(me.id, profile.id);
        void refreshUsage();
        setViewing(profile);
      } catch (e) {
        if (e instanceof Error && e.message.includes("DAILY_INTEREST_LIMIT_REACHED")) {
          setLimitKind("interests");
          void refreshUsage();
        } else {
          toast(e instanceof Error ? e.message : "Couldn't open the profile.", "rose");
        }
      }
    },
    [db, user, refreshUsage, toast],
  );

  const doPass = useCallback(
    async (id: string, name?: string) => {
      if (!user || busyActionRef.current) return;
      const me = user;
      busyActionRef.current = true;
      setBusyAction(true);
      try {
        await db.sendPass(me.id, id);
        markPassed(id);
        markActed(id);
        setLiveStatus(name ? `Passed on ${name}` : "Passed");
        refresh();
      } catch (e) {
        toast(
          e instanceof Error ? e.message : "Couldn't pass right now.",
          "rose",
        );
      } finally {
        busyActionRef.current = false;
        setBusyAction(false);
      }
    },
    [db, user, markPassed, markActed, refresh, toast],
  );

  const doLike = useCallback(
    async (id: string, name?: string) => {
      if (!user || busyActionRef.current) return;
      const me = user;
      busyActionRef.current = true;
      setBusyAction(true);
      try {
        const { match } = await db.sendLike(me.id, id);
        markActed(id);
        refresh();
        void refreshUsage();
        if (match) {
          // Honest mutual-match check: confirm the returned match really exists
          // in this user's mutual matches before celebrating anything.
          const mutuals = await db.matchesFor(me.id);
          const real = mutuals.find((m) => m.id === match.id);
          if (real) {
            const convs = await db.conversationsFor(me.id);
            const conv = convs.find((c) => c.matchId === real.id);
            const otherId = real.userA === me.id ? real.userB : real.userA;
            const other = await db.getUser(otherId);
            setLiveStatus(`It's a match with ${other?.firstName ?? "your match"}!`);
            setCelebration({
              name: other?.firstName ?? "your match",
              matchPhoto: other?.photos[0],
              mePhoto: me.photos?.[0],
              convId: conv ? conv.id : null,
            });
          } else {
            toast("Liked ♥ — fingers crossed it's mutual.");
          }
        } else {
          setLiveStatus(name ? `Liked ${name}` : "Liked");
          toast("Liked ♥ — fingers crossed it's mutual.");
        }
      } catch (e) {
        if (e instanceof Error && e.message.includes("DAILY_LIKE_LIMIT_REACHED")) {
          setLimitKind("likes");
          void refreshUsage();
        } else {
          toast(
            e instanceof Error ? e.message : "Couldn't send the like.",
            "rose",
          );
        }
      } finally {
        busyActionRef.current = false;
        setBusyAction(false);
      }
    },
    [db, user, markActed, refresh, refreshUsage, toast],
  );

  const swipe = useCallback(
    (d: 1 | -1, id: string, name?: string) => {
      if (busyActionRef.current) return;
      setDir(d);
      if (d === 1) void doLike(id, name);
      else void doPass(id, name);
    },
    [doLike, doPass],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement | null;
      const isFormOrDialogControl =
        activeEl &&
        (activeEl.tagName === "INPUT" ||
          activeEl.tagName === "TEXTAREA" ||
          activeEl.tagName === "SELECT" ||
          activeEl.isContentEditable ||
          Boolean(activeEl.closest('[role="dialog"]')));
      if (isFormOrDialogControl) return;
      if (viewing || filtersOpen || reportFor || limitKind || celebration) return;
      if (!current || busyActionRef.current) return;

      if (e.key === "ArrowLeft") {
        e.preventDefault();
        swipe(-1, current.profile.id, current.profile.firstName);
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        swipe(1, current.profile.id, current.profile.firstName);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        void openProfile(current.profile);
      } else if (e.key === " ") {
        // Only trigger openProfile on Space if not focused on an interactive button/link
        const tag = activeEl?.tagName;
        if (tag === "BUTTON" || tag === "A" || activeEl?.getAttribute("role") === "button") {
          return;
        }
        e.preventDefault();
        void openProfile(current.profile);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [current, viewing, filtersOpen, reportFor, limitKind, celebration, swipe, openProfile]);

  if (!user) return null;
  const me = user;

  const toggleSave = async (id: string) => {
    try {
      if (saved.has(id)) {
        await db.unsaveProfile(me.id, id);
        toast("Removed from saved.");
      } else {
        await db.saveProfile(me.id, id);
        toast("Saved to your list.");
      }
      refresh();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't update saved list.",
        "rose",
      );
    }
  };

  const openFilters = () => {
    setPrefsDraft({ ...(data?.prefs ?? BROAD_DEFAULT_PREFS) });
    setFiltersOpen(true);
  };

  const applyFilters = async () => {
    if (prefsDraft) {
      try {
        const sanitized: MatchPreferences = {
          ...prefsDraft,
          ageMin: Math.max(18, Math.min(99, prefsDraft.ageMin)),
          ageMax: Math.max(
            Math.max(18, Math.min(99, prefsDraft.ageMin)),
            Math.min(99, prefsDraft.ageMax),
          ),
          minSharedInterests: Math.max(0, Math.min(10, prefsDraft.minSharedInterests)),
        };
        await db.savePrefs(me.id, sanitized);
        refresh();
        toast("Discovery preferences updated.");
      } catch (e) {
        toast(
          e instanceof Error ? e.message : "Couldn't save preferences.",
          "rose",
        );
      }
    }
    setFiltersOpen(false);
  };

  const resetFilters = async () => {
    try {
      await db.savePrefs(me.id, BROAD_DEFAULT_PREFS);
      setPrefsDraft(BROAD_DEFAULT_PREFS);
      setFiltersOpen(false);
      refresh();
      toast("Filters reset — showing everyone eligible.");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't reset filters.",
        "rose",
      );
    }
  };

  const submitReport = async () => {
    if (!reportFor) return;
    try {
      await db.fileReport({
        reporterId: me.id,
        reportedId: reportFor.id,
        reason: reportReason,
        details: reportDetails.trim(),
      });
      toast("Report submitted. Our team will review it.", "gold");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't submit the report.",
        "rose",
      );
    }
    setReportFor(null);
    setReportDetails("");
    setReportReason(REPORT_REASONS[0]);
  };

  const doBlock = async (p: UserProfile) => {
    if (busyActionRef.current) return;
    busyActionRef.current = true;
    setBusyAction(true);
    try {
      await db.blockUser(me.id, p.id);
      markActed(p.id);
      setViewing(null);
      setConfirmBlock(false);
      toast(`${p.firstName} has been blocked.`, "rose");
      refresh();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't block right now.",
        "rose",
      );
    } finally {
      busyActionRef.current = false;
      setBusyAction(false);
    }
  };

  const draftCompatPreview =
    prefsDraft && current
      ? computeCompatibility(me, current.profile, prefsDraft)
      : null;

  const viewingCompat = viewing
    ? computeCompatibility(me, viewing, prefs)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-5 py-10 overflow-x-hidden">
      <div className="sr-only" aria-live="polite">
        {liveStatus || (current ? `Showing ${current.profile.firstName}, ${current.profile.age}` : "")}
      </div>

      <div className="flex items-center justify-between gap-3 mb-5">
        <div className="min-w-0">
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">
            Discover
          </p>
          <h1 className="font-display text-3xl text-ivory mt-1">
            Meet someone <span className="text-gradient-dream">new</span>
          </h1>
        </div>
        <button
          type="button"
          onClick={openFilters}
          className="btn-ghost rounded-full px-5 min-h-[44px] text-sm shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
        >
          ⚙ Filters{filterTags.length > 0 ? ` (${filterTags.length})` : ""}
        </button>
      </div>

      {filterTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-5">
          {filterTags.map((tag) => (
            <span
              key={tag}
              className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-ivory-dim"
            >
              {tag}
            </span>
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="text-xs text-rosegold hover:text-champagne underline underline-offset-4 px-2 py-1"
          >
            Reset filters
          </button>
        </div>
      )}

      {usage && (
        <DailyLimitCounters
          likesUsed={usage.likesUsed}
          interestsUsed={usage.interestsUsed}
          likeLimit={usage.likeLimit}
          interestLimit={usage.interestLimit}
          isPaid={usage.isPaid}
        />
      )}

      {loading ? (
        <div className="max-w-md mx-auto">
          <Skeleton className="h-[560px] rounded-[2rem]" />
        </div>
      ) : error ? (
        <EmptyState
          title="Couldn't load discovery"
          body={error}
          action={
            <button
              type="button"
              onClick={refresh}
              className="btn-gold rounded-full px-6 min-h-[44px] text-sm"
            >
              Try again
            </button>
          }
        />
      ) : visibleDeck.length === 0 ? (
        <EmptyState
          title="You've seen everyone"
          body="No more profiles fit your current preferences. Widen your filters or check back later — new members join every day."
          action={
            <div className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                onClick={openFilters}
                className="btn-gold rounded-full px-6 min-h-[44px] text-sm"
              >
                Adjust preferences
              </button>
              {filterTags.length > 0 && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="btn-ghost rounded-full px-6 min-h-[44px] text-sm"
                >
                  Reset filters
                </button>
              )}
            </div>
          }
        />
      ) : current ? (
        <div className="max-w-md mx-auto pb-4">
          <div className="relative">
            {/* Peeking next card */}
            {next && next.profile.id !== current.profile.id && (
              <div className="absolute inset-0 translate-y-3 scale-[0.94] opacity-40 pointer-events-none rounded-[2rem] overflow-hidden glass">
                <div className="h-full bg-gradient-to-br from-coal via-burgundy-deep to-midnight" />
              </div>
            )}
            <AnimatePresence initial={false} custom={dir} mode="wait">
              <motion.div
                key={current.profile.id}
                custom={dir}
                variants={reducedMotion ? reducedCardVariants : cardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={
                  reducedMotion
                    ? { duration: 0.08 }
                    : { type: "spring", damping: 28, stiffness: 260 }
                }
                className="relative"
              >
                <ProfileCard
                  key={current.profile.id}
                  entry={current}
                  onView={() => void openProfile(current.profile)}
                  onSwipe={(d) => swipe(d, current.profile.id, current.profile.firstName)}
                  busy={busyAction}
                />
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Stationary Pass / Save / Like controls below the card */}
          <div className="flex items-center justify-center gap-6 mt-6">
            <motion.button
              type="button"
              whileTap={reducedMotion ? undefined : { scale: 0.85 }}
              onClick={() => swipe(-1, current.profile.id, current.profile.firstName)}
              disabled={busyAction}
              aria-label={`Pass on ${current.profile.firstName}`}
              className="h-16 w-16 rounded-full glass-strong border border-white/15 flex items-center justify-center text-2xl text-mist hover:text-ivory hover:border-white/40 transition-colors shadow-[0_0_24px_rgba(154,143,184,0.25)] disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
            >
              ✕
            </motion.button>
            <motion.button
              type="button"
              whileTap={reducedMotion ? undefined : { scale: 0.85 }}
              onClick={() => toggleSave(current.profile.id)}
              disabled={busyAction}
              aria-label={
                saved.has(current.profile.id)
                  ? `Remove ${current.profile.firstName} from saved`
                  : `Save ${current.profile.firstName}'s profile`
              }
              className={`h-12 w-12 rounded-full glass-strong border flex items-center justify-center text-lg transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne ${
                saved.has(current.profile.id)
                  ? "border-champagne/60 text-champagne shadow-[0_0_20px_rgba(197,164,255,0.35)]"
                  : "border-white/15 text-mist hover:text-ivory"
              }`}
            >
              {saved.has(current.profile.id) ? "★" : "☆"}
            </motion.button>
            <motion.button
              type="button"
              whileTap={reducedMotion ? undefined : { scale: 0.82 }}
              onClick={() => swipe(1, current.profile.id, current.profile.firstName)}
              disabled={busyAction}
              aria-label={`Like ${current.profile.firstName}`}
              className="h-20 w-20 rounded-full bg-gradient-to-br from-rosegold via-burgundy to-burgundy-deep border border-champagne/50 flex items-center justify-center text-3xl shadow-[0_0_44px_rgba(255,61,154,0.45)] hover:shadow-[0_0_64px_rgba(255,61,154,0.65)] transition-shadow disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
            >
              <motion.span
                key={current.profile.id}
                initial={reducedMotion ? false : { scale: 0.6 }}
                animate={reducedMotion ? undefined : { scale: [0.6, 1.15, 1] }}
                transition={{ type: "spring", damping: 10, stiffness: 300 }}
                className={`text-ivory ${reducedMotion ? "" : "animate-heartbeat"}`}
              >
                ♥
              </motion.span>
            </motion.button>
          </div>
          <p className="text-center text-xs text-mist/70 mt-4">
            {visibleDeck.length} {visibleDeck.length === 1 ? "profile" : "profiles"} remaining
          </p>
        </div>
      ) : null}

      {/* Real mutual-match celebration */}
      <MatchOverlay
        celebration={celebration}
        onClose={() => setCelebration(null)}
        onChat={(convId) => {
          setCelebration(null);
          navigate(convId ? `/chat?c=${convId}` : "/chat");
        }}
      />

      {/* Full profile */}
      <Modal
        open={!!viewing}
        onClose={() => {
          setViewing(null);
          setConfirmBlock(false);
        }}
        title={viewing ? `${viewing.firstName}, ${viewing.age}` : ""}
        wide
      >
        {viewing && (
          <div className="space-y-5">
            <div className="relative -mx-6 -mt-6 h-52 overflow-hidden rounded-t-[1.4rem]">
              {viewing.photos[0] ? (
                <img
                  src={viewing.photos[0]}
                  alt={`${viewing.firstName}'s photo`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-coal via-burgundy-deep to-midnight" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-midnight via-midnight/30 to-transparent" />
              <div className="absolute bottom-3 left-6 flex items-center gap-3">
                <Avatar name={viewing.firstName} photo={viewing.photos[0]} size={64} ring />
                <div>
                  <p className="text-ivory font-display text-xl">
                    {viewing.firstName}, {viewing.age}
                  </p>
                  <p className="text-mist text-sm">{viewing.city}</p>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {viewing.verified && <Badge tone="green">✓ Verified</Badge>}
              {viewing.relationshipIntent && (
                <Badge tone="gold">{viewing.relationshipIntent}</Badge>
              )}
            </div>
            {viewing.bio && <p className="text-ivory-dim leading-relaxed">{viewing.bio}</p>}
            {viewing.photos.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Photos
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {viewing.photos.map((url, i) => (
                    <div
                      key={url}
                      className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                    >
                      <img
                        src={url}
                        alt={`${viewing.firstName}'s photo ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {viewing.interests.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Interests
                </p>
                <div className="flex flex-wrap gap-2">
                  {viewing.interests.map((i) => (
                    <span
                      key={i}
                      className="rounded-full border border-champagne/40 bg-champagne/10 px-3 py-1 text-xs text-champagne"
                    >
                      {i}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {viewing.hobbies.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Hobbies
                </p>
                <div className="flex flex-wrap gap-2">
                  {viewing.hobbies.map((i) => (
                    <span
                      key={i}
                      className="rounded-full border border-rosegold/40 bg-rosegold/10 px-3 py-1 text-xs text-rosegold"
                    >
                      {i}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {viewing.lifestyle.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Lifestyle
                </p>
                <div className="flex flex-wrap gap-2">
                  {viewing.lifestyle.map((i) => (
                    <span
                      key={i}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-ivory-dim"
                    >
                      {i}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {viewingCompat && (
              <CompatBar score={viewingCompat.score} factors={viewingCompat.factors} />
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              {!likedIds.has(viewing.id) && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => {
                    const target = viewing;
                    setViewing(null);
                    void doLike(target.id, target.firstName);
                  }}
                  className="btn-gold rounded-full px-6 min-h-[44px] text-sm disabled:opacity-50"
                >
                  ♥ Like
                </button>
              )}
              <button
                type="button"
                disabled={busyAction}
                onClick={() => toggleSave(viewing.id)}
                className="btn-ghost rounded-full px-6 min-h-[44px] text-sm disabled:opacity-50"
              >
                {saved.has(viewing.id) ? "★ Saved" : "☆ Save"}
              </button>
              {!passedLocal.has(viewing.id) && (
                <button
                  type="button"
                  disabled={busyAction}
                  onClick={() => {
                    const target = viewing;
                    setViewing(null);
                    void doPass(target.id, target.firstName);
                  }}
                  className="btn-ghost rounded-full px-6 min-h-[44px] text-sm disabled:opacity-50"
                >
                  ✕ Pass
                </button>
              )}
            </div>
            <div className="hairline pt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setReportFor(viewing)}
                className="text-xs text-mist hover:text-ivory underline underline-offset-4 py-1"
              >
                Report profile
              </button>
              {confirmBlock ? (
                <span className="flex gap-2 items-center">
                  <span className="text-xs text-rosegold">Block {viewing.firstName}?</span>
                  <button
                    type="button"
                    disabled={busyAction}
                    onClick={() => doBlock(viewing)}
                    className="text-xs text-ivory bg-burgundy rounded-full px-3 py-1.5 disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmBlock(false)}
                    className="text-xs text-mist py-1"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmBlock(true)}
                  className="text-xs text-mist hover:text-ivory underline underline-offset-4 py-1"
                >
                  Block
                </button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Report */}
      <Modal open={!!reportFor} onClose={() => setReportFor(null)} title="Report profile">
        <p className="text-sm text-mist mb-4">
          Reports are reviewed by our safety team. The person won't be told who reported them.
        </p>
        <Field label="Reason">
          <select
            className={inputCls}
            value={reportReason}
            onChange={(e) => setReportReason(e.target.value)}
          >
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Field>
        <div className="mt-4">
          <Field label="Details (optional)">
            <textarea
              className={`${inputCls} min-h-[90px]`}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="What happened?"
            />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={() => setReportFor(null)}
            className="btn-ghost rounded-full px-5 min-h-[44px] text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submitReport}
            className="btn-gold rounded-full px-5 min-h-[44px] text-sm"
          >
            Submit report
          </button>
        </div>
      </Modal>

      {/* Filters */}
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Discovery preferences"
        wide
      >
        {prefsDraft && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 -mt-1 mb-1">
              <span className="text-rosegold text-lg animate-twinkle">✦</span>
              <p className="text-sm text-mist">
                Tune who appears in your deck. Changes apply immediately.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Min age">
                <input
                  type="number"
                  className={inputCls}
                  min={18}
                  max={99}
                  value={prefsDraft.ageMin}
                  onChange={(e) => {
                    const nextMin = Math.max(18, Math.min(99, Number(e.target.value) || 18));
                    setPrefsDraft({
                      ...prefsDraft,
                      ageMin: nextMin,
                      ageMax: Math.max(nextMin, prefsDraft.ageMax),
                    });
                  }}
                />
              </Field>
              <Field label="Max age">
                <input
                  type="number"
                  className={inputCls}
                  min={18}
                  max={99}
                  value={prefsDraft.ageMax}
                  onChange={(e) => {
                    const nextMax = Math.max(prefsDraft.ageMin, Math.min(99, Number(e.target.value) || 99));
                    setPrefsDraft({ ...prefsDraft, ageMax: nextMax });
                  }}
                />
              </Field>
            </div>
            <Field label="Interested in">
              <select
                className={inputCls}
                value={prefsDraft.interestedIn}
                onChange={(e) =>
                  setPrefsDraft({
                    ...prefsDraft,
                    interestedIn: e.target.value as MatchPreferences["interestedIn"],
                  })
                }
              >
                <option value="women">Women</option>
                <option value="men">Men</option>
                <option value="everyone">Everyone</option>
              </select>
            </Field>
            <Field label="Cities">
              <div className="flex flex-wrap gap-2">
                {CITIES.map((c) => {
                  const on = prefsDraft.cities.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      onClick={() =>
                        setPrefsDraft({
                          ...prefsDraft,
                          cities: on
                            ? prefsDraft.cities.filter((x) => x !== c)
                            : [...prefsDraft.cities, c],
                        })
                      }
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
            </Field>
            <Field label="Relationship intentions">
              <div className="flex flex-wrap gap-2">
                {RELATIONSHIP_INTENTS.map((r) => {
                  const on = prefsDraft.relationshipIntents.includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() =>
                        setPrefsDraft({
                          ...prefsDraft,
                          relationshipIntents: on
                            ? prefsDraft.relationshipIntents.filter((x) => x !== r)
                            : [...prefsDraft.relationshipIntents, r],
                        })
                      }
                      className={`rounded-full border px-3.5 py-1.5 min-h-[38px] text-sm transition-colors ${
                        on
                          ? "border-rosegold/60 bg-rosegold/10 text-rosegold shadow-[0_0_14px_rgba(255,61,154,0.25)]"
                          : "border-white/15 text-mist hover:text-ivory"
                      }`}
                    >
                      {r}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label="Minimum shared interests">
              <input
                type="number"
                className={inputCls}
                min={0}
                max={10}
                value={prefsDraft.minSharedInterests}
                onChange={(e) =>
                  setPrefsDraft({
                    ...prefsDraft,
                    minSharedInterests: Math.max(0, Math.min(10, Number(e.target.value) || 0)),
                  })
                }
              />
            </Field>
            {draftCompatPreview && (
              <p className="text-xs text-mist">
                Preview: your current top profile would score {draftCompatPreview.score}% with these filters.
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-rosegold hover:text-champagne underline underline-offset-4 py-2"
              >
                Reset all filters
              </button>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setFiltersOpen(false)}
                  className="btn-ghost rounded-full px-5 min-h-[44px] text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyFilters}
                  className="btn-gold rounded-full px-6 min-h-[44px] text-sm font-medium"
                >
                  Apply filters
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
      {limitKind && (
        <LimitReachedModal
          open={true}
          kind={limitKind}
          onClose={() => setLimitKind(null)}
        />
      )}
    </div>
  );
}
