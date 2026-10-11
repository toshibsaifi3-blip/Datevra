import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion, useMotionValue, useTransform } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { computeCompatibility, rankCandidates } from "../../lib/compat";
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
  return (
    <div>
      <div className="flex justify-between text-xs text-mist mb-1.5">
        <span className="uppercase tracking-[0.18em]">Compatibility</span>
        <span className="text-champagne font-semibold">{score}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-rosegold via-champagne to-rosegold"
          initial={{ width: 0 }}
          animate={{ width: `${score}%` }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
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

function ProfileCard({
  entry,
  saved,
  onLike,
  onPass,
  onSave,
  onView,
  onSwipe,
}: {
  entry: Ranked;
  saved: boolean;
  onLike: () => void;
  onPass: () => void;
  onSave: () => void;
  onView: () => void;
  /** direction: 1 = liked (swiped right), -1 = passed (swiped left) */
  onSwipe: (dir: 1 | -1) => void;
}) {
  const p = entry.profile;
  const x = useMotionValue(0);
  const likeOpacity = useTransform(x, [40, 130], [0, 1]);
  const passOpacity = useTransform(x, [-40, -130], [0, 1]);
  const rotate = useTransform(x, [-260, 260], [-10, 10]);
  const photo = p.photos[0];

  return (
    <motion.div
      drag="x"
      style={{ x, rotate }}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.55}
      onDragEnd={(_, info) => {
        if (info.offset.x > 110) onSwipe(1);
        else if (info.offset.x < -110) onSwipe(-1);
      }}
      className="glass-strong glow-border rounded-[2rem] overflow-hidden relative cursor-grab active:cursor-grabbing touch-pan-y select-none"
    >
      {/* Drag stamps */}
      <motion.div
        style={{ opacity: likeOpacity }}
        className="absolute top-6 left-6 z-20 rotate-[-14deg] rounded-xl border-4 border-rosegold bg-rosegold/15 backdrop-blur px-4 py-1.5 font-display text-2xl tracking-[0.2em] text-rosegold pointer-events-none"
      >
        LIKE
      </motion.div>
      <motion.div
        style={{ opacity: passOpacity }}
        className="absolute top-6 right-6 z-20 rotate-[14deg] rounded-xl border-4 border-mist bg-midnight/40 backdrop-blur px-4 py-1.5 font-display text-2xl tracking-[0.2em] text-mist pointer-events-none"
      >
        NOPE
      </motion.div>

      {/* Photo with dreamy lighting */}
      <div className="relative h-[380px] sm:h-[430px]">
        {photo ? (
          <img
            src={photo}
            alt={`${p.firstName}'s photo`}
            className="absolute inset-0 h-full w-full object-cover pointer-events-none"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-coal via-burgundy-deep to-midnight flex items-center justify-center">
            <span className="font-display text-7xl text-champagne/60">
              {p.firstName.charAt(0)}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-midnight via-midnight/35 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-tr from-burgundy/30 via-transparent to-rosegold/20 pointer-events-none" />
        <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5 rounded-full bg-midnight/60 backdrop-blur px-3 py-1.5 border border-champagne/30">
          <span className="text-champagne text-sm">✦</span>
          <span className="text-champagne text-sm font-semibold">{entry.score}%</span>
        </div>

        {/* Name block overlaid */}
        <div className="absolute bottom-0 inset-x-0 p-6 z-10">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="font-display text-3xl sm:text-4xl text-ivory drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)]">
                  {p.firstName}, {p.age}
                </h2>
                {p.verified && <Badge tone="green">✓ Verified</Badge>}
              </div>
              <p className="text-ivory-dim mt-1 flex items-center gap-1.5 text-sm">
                <span className="text-rosegold">✧</span> {p.city}
              </p>
              {p.relationshipIntent && (
                <p className="text-sm text-champagne/90 mt-1.5 italic">
                  “{p.relationshipIntent}”
                </p>
              )}
            </div>
            <button
              onClick={onView}
              className="shrink-0 rounded-full btn-ghost px-4 py-2 text-xs backdrop-blur"
            >
              Full profile
            </button>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="p-6 pt-5 relative">
        <div className="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-burgundy/40 blur-[90px] pointer-events-none" />
        {p.bio && (
          <p className="text-ivory-dim leading-relaxed text-[0.95rem]">{p.bio}</p>
        )}
        <div className="flex flex-wrap gap-2 mt-4">
          {[...p.interests, ...p.hobbies].slice(0, 8).map((t) => (
            <span
              key={t}
              className="rounded-full border border-champagne/30 bg-champagne/10 px-3 py-1 text-xs text-champagne"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="mt-5 hairline pt-5">
          <CompatBar score={entry.score} factors={entry.factors} />
        </div>

        {/* Controls */}
        <div className="flex items-center justify-center gap-5 mt-6">
          <motion.button
            whileTap={{ scale: 0.85 }}
            onClick={onPass}
            aria-label="Pass"
            className="h-16 w-16 rounded-full glass-strong border border-white/15 flex items-center justify-center text-2xl text-mist hover:text-ivory hover:border-white/40 transition-colors shadow-[0_0_24px_rgba(154,143,184,0.25)]"
          >
            ✕
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.85 }}
            onClick={onSave}
            aria-label="Save profile"
            className={`h-12 w-12 rounded-full glass-strong border flex items-center justify-center text-lg transition-colors ${
              saved
                ? "border-champagne/60 text-champagne shadow-[0_0_20px_rgba(197,164,255,0.35)]"
                : "border-white/15 text-mist hover:text-ivory"
            }`}
          >
            {saved ? "★" : "☆"}
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.82 }}
            onClick={onLike}
            aria-label="Like"
            className="h-20 w-20 rounded-full bg-gradient-to-br from-rosegold via-burgundy to-burgundy-deep border border-champagne/50 flex items-center justify-center text-3xl shadow-[0_0_44px_rgba(255,61,154,0.45)] hover:shadow-[0_0_64px_rgba(255,61,154,0.65)] transition-shadow"
          >
            <motion.span
              key={p.id}
              initial={{ scale: 0.6 }}
              animate={{ scale: [0.6, 1.15, 1] }}
              transition={{ type: "spring", damping: 10, stiffness: 300 }}
              className="text-ivory animate-heartbeat"
            >
              ♥
            </motion.span>
          </motion.button>
        </div>
        <p className="text-center text-xs text-mist/70 mt-4">
          Drag the card, or tap ♥ / ✕
        </p>
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
  const tick = useDbRefresh("likes", "matches", "blocks", "profiles");

  const [idx, setIdx] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [celebration, setCelebration] = useState<MatchCelebration | null>(null);
  const [viewing, setViewing] = useState<UserProfile | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [prefsDraft, setPrefsDraft] = useState<MatchPreferences | null>(null);
  const [reportFor, setReportFor] = useState<UserProfile | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetails, setReportDetails] = useState("");
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [passedLocal, setPassedLocal] = useState<Set<string>>(new Set());
  const [limitKind, setLimitKind] = useState<"likes" | "interests" | null>(null);

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
      const [profiles, prefs, savedIds, excluded, sent] = await Promise.all([
        b.listProfiles(),
        b.getPrefs(user.id),
        b.savedProfiles(user.id),
        excludedIdsFor(b, user.id),
        b.likesSent(user.id),
      ]);
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

  const deck = data?.deck ?? [];

  useEffect(() => {
    setIdx((i) => Math.min(i, Math.max(0, deck.length - 1)));
  }, [deck.length]);

  if (!user) return null;
  const me = user;
  const current = deck[Math.min(idx, Math.max(0, deck.length - 1))] ?? null;
  const next = deck[Math.min(idx + 1, deck.length - 1)] ?? null;
  const saved = new Set(data?.savedIds ?? []);
  const likedIds = new Set(data?.likedIds ?? []);
  const prefs = data?.prefs ?? null;

  const advance = () => setIdx((i) => i + 1);

  const doPass = async (id: string) => {
    try {
      await db.sendPass(me.id, id);
      setPassedLocal((s) => new Set(s).add(id));
      refresh();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't pass right now.",
        "rose",
      );
    }
    advance();
  };

  const doLike = async (id: string) => {
    try {
      const { match } = await db.sendLike(me.id, id);
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
          setCelebration({
            name: other?.firstName ?? "your match",
            matchPhoto: other?.photos[0],
            mePhoto: me.photos?.[0],
            convId: conv ? conv.id : null,
          });
        }
      } else {
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
    }
    advance();
  };

  /** Opening a full profile counts as "showing interest" (20/day for free users). */
  const openProfile = async (profile: UserProfile) => {
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
  };

  const swipe = (d: 1 | -1, id: string) => {
    setDir(d);
    if (d === 1) void doLike(id);
    else void doPass(id);
  };

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
    if (data?.prefs) setPrefsDraft({ ...data.prefs });
    setFiltersOpen(true);
  };

  const applyFilters = async () => {
    if (prefsDraft) {
      try {
        await db.savePrefs(me.id, prefsDraft);
        setIdx(0);
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
    try {
      await db.blockUser(me.id, p.id);
      setViewing(null);
      setConfirmBlock(false);
      toast(`${p.firstName} has been blocked.`, "rose");
      refresh();
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't block right now.",
        "rose",
      );
    }
    advance();
  };

  const draftCompatPreview = prefsDraft && current
    ? computeCompatibility(me, current.profile, prefsDraft)
    : null;

  const viewingCompat = viewing
    ? computeCompatibility(me, viewing, prefs)
    : null;

  return (
    <div className="max-w-3xl mx-auto px-5 py-10 overflow-x-hidden">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Discover</p>
          <h1 className="font-display text-3xl text-ivory mt-1">
            Meet someone <span className="text-gradient-dream">new</span>
          </h1>
        </div>
        <button onClick={openFilters} className="btn-ghost rounded-full px-5 py-2.5 text-sm">
          ⚙ Filters
        </button>
      </div>
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
        <p className="text-sm text-rosegold">Couldn't load discovery: {error}</p>
      ) : deck.length === 0 ? (
        <EmptyState
          title="You've seen everyone"
          body="No more profiles fit your current preferences. Widen your filters or check back later — new members join every day."
          action={
            <button onClick={openFilters} className="btn-gold rounded-full px-6 py-2.5 text-sm">
              Adjust preferences
            </button>
          }
        />
      ) : current ? (
        <div className="max-w-md mx-auto">
          <div className="relative">
            {/* Peeking next card */}
            {next && next.profile.id !== current.profile.id && (
              <div className="absolute inset-0 translate-y-4 scale-[0.94] opacity-40 pointer-events-none rounded-[2rem] overflow-hidden glass">
                <div className="h-[380px] sm:h-[430px] bg-gradient-to-br from-coal via-burgundy-deep to-midnight" />
              </div>
            )}
            <AnimatePresence initial={false} custom={dir} mode="wait">
              <motion.div
                key={current.profile.id}
                custom={dir}
                variants={cardVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ type: "spring", damping: 28, stiffness: 260 }}
                className="relative"
              >
                <ProfileCard
                  entry={current}
                  saved={saved.has(current.profile.id)}
                  onLike={() => swipe(1, current.profile.id)}
                  onPass={() => swipe(-1, current.profile.id)}
                  onSave={() => toggleSave(current.profile.id)}
                  onView={() => void openProfile(current.profile)}
                  onSwipe={(d) => swipe(d, current.profile.id)}
                />
              </motion.div>
            </AnimatePresence>
          </div>
          <p className="text-center text-xs text-mist/70 mt-5">
            {deck.length - idx} of {deck.length} remaining
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
      <Modal open={!!viewing} onClose={() => { setViewing(null); setConfirmBlock(false); }} title={viewing ? `${viewing.firstName}, ${viewing.age}` : ""} wide>
        {viewing && (
          <div className="space-y-5">
            <div className="relative -mx-6 -mt-6 h-52 overflow-hidden rounded-t-[1.4rem]">
              {viewing.photos[0] ? (
                <img src={viewing.photos[0]} alt={`${viewing.firstName}'s photo`} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-coal via-burgundy-deep to-midnight" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-midnight via-midnight/30 to-transparent" />
              <div className="absolute bottom-3 left-6 flex items-center gap-3">
                <Avatar name={viewing.firstName} photo={viewing.photos[0]} size={64} ring />
                <div>
                  <p className="text-ivory font-display text-xl">{viewing.firstName}, {viewing.age}</p>
                  <p className="text-mist text-sm">{viewing.city}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              {viewing.verified && <Badge tone="green">✓ Verified</Badge>}
              {viewing.relationshipIntent && <Badge tone="gold">{viewing.relationshipIntent}</Badge>}
            </div>
            {viewing.bio && <p className="text-ivory-dim leading-relaxed">{viewing.bio}</p>}
            {viewing.photos.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Photos</p>
                <div className="grid grid-cols-3 gap-2">
                  {viewing.photos.map((url, i) => (
                    <div key={url} className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5">
                      <img src={url} alt={`${viewing.firstName}'s photo ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {viewing.interests.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Interests</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.interests.map((i) => (
                    <span key={i} className="rounded-full border border-champagne/40 bg-champagne/10 px-3 py-1 text-xs text-champagne">{i}</span>
                  ))}
                </div>
              </div>
            )}
            {viewing.hobbies.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Hobbies</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.hobbies.map((i) => (
                    <span key={i} className="rounded-full border border-rosegold/40 bg-rosegold/10 px-3 py-1 text-xs text-rosegold">{i}</span>
                  ))}
                </div>
              </div>
            )}
            {viewing.lifestyle.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Lifestyle</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.lifestyle.map((i) => (
                    <span key={i} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-ivory-dim">{i}</span>
                  ))}
                </div>
              </div>
            )}
            {viewingCompat && (
              <CompatBar score={viewingCompat.score} factors={viewingCompat.factors} />
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              {!likedIds.has(viewing.id) && (
                <button onClick={() => { setViewing(null); void doLike(viewing.id); }} className="btn-gold rounded-full px-6 py-2.5 text-sm">
                  ♥ Like
                </button>
              )}
              <button onClick={() => toggleSave(viewing.id)} className="btn-ghost rounded-full px-6 py-2.5 text-sm">
                {saved.has(viewing.id) ? "★ Saved" : "☆ Save"}
              </button>
              {!passedLocal.has(viewing.id) && (
                <button onClick={() => { setViewing(null); void doPass(viewing.id); }} className="btn-ghost rounded-full px-6 py-2.5 text-sm">
                  ✕ Pass
                </button>
              )}
            </div>
            <div className="hairline pt-4 flex flex-wrap gap-3">
              <button onClick={() => setReportFor(viewing)} className="text-xs text-mist hover:text-ivory underline underline-offset-4">
                Report profile
              </button>
              {confirmBlock ? (
                <span className="flex gap-2 items-center">
                  <span className="text-xs text-rosegold">Block {viewing.firstName}?</span>
                  <button onClick={() => doBlock(viewing)} className="text-xs text-ivory bg-burgundy rounded-full px-3 py-1">Confirm</button>
                  <button onClick={() => setConfirmBlock(false)} className="text-xs text-mist">Cancel</button>
                </span>
              ) : (
                <button onClick={() => setConfirmBlock(true)} className="text-xs text-mist hover:text-ivory underline underline-offset-4">
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
          <select className={inputCls} value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
            {REPORT_REASONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </Field>
        <div className="mt-4">
          <Field label="Details (optional)">
            <textarea className={`${inputCls} min-h-[90px]`} value={reportDetails} onChange={(e) => setReportDetails(e.target.value)} placeholder="What happened?" />
          </Field>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setReportFor(null)} className="btn-ghost rounded-full px-5 py-2 text-sm">Cancel</button>
          <button onClick={submitReport} className="btn-gold rounded-full px-5 py-2 text-sm">Submit report</button>
        </div>
      </Modal>

      {/* Filters */}
      <Modal open={filtersOpen} onClose={() => setFiltersOpen(false)} title="Discovery preferences" wide>
        {prefsDraft && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 -mt-1 mb-1">
              <span className="text-rosegold text-lg animate-twinkle">✦</span>
              <p className="text-sm text-mist">Tune who appears in your deck. Changes apply instantly.</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Min age">
                <input type="number" className={inputCls} min={18} max={99}
                  value={prefsDraft.ageMin}
                  onChange={(e) => setPrefsDraft({ ...prefsDraft, ageMin: Math.max(18, Number(e.target.value)) })} />
              </Field>
              <Field label="Max age">
                <input type="number" className={inputCls} min={18} max={99}
                  value={prefsDraft.ageMax}
                  onChange={(e) => setPrefsDraft({ ...prefsDraft, ageMax: Math.max(prefsDraft.ageMin, Number(e.target.value)) })} />
              </Field>
            </div>
            <Field label="Interested in">
              <select className={inputCls} value={prefsDraft.interestedIn}
                onChange={(e) => setPrefsDraft({ ...prefsDraft, interestedIn: e.target.value as MatchPreferences["interestedIn"] })}>
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
                          cities: on ? prefsDraft.cities.filter((x) => x !== c) : [...prefsDraft.cities, c],
                        })
                      }
                      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
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
                      className={`rounded-full border px-3.5 py-1.5 text-sm transition-colors ${
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
              <input type="number" className={inputCls} min={0} max={10}
                value={prefsDraft.minSharedInterests}
                onChange={(e) => setPrefsDraft({ ...prefsDraft, minSharedInterests: Math.max(0, Number(e.target.value)) })} />
            </Field>
            {draftCompatPreview && (
              <p className="text-xs text-mist">
                Preview: your current top profile would score {draftCompatPreview.score}% with these filters.
              </p>
            )}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => setFiltersOpen(false)} className="btn-ghost rounded-full px-5 py-2 text-sm">Cancel</button>
              <button onClick={applyFilters} className="btn-gold rounded-full px-6 py-2 text-sm font-medium">Apply filters</button>
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
