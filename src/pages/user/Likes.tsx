import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Avatar, Badge, EmptyState, Modal, Reveal, Skeleton, useToast } from "../../components/ui";
import MatchOverlay, { type MatchCelebration } from "../../components/MatchOverlay";
import { LimitReachedModal } from "../../components/LimitModal";
import { partnerOf, timeAgo, useDbRefresh } from "./shared";
import { computeCompatibility } from "../../lib/compat";
import type { Like, MatchPreferences, UserProfile } from "../../lib/types";

type Tab = "received" | "sent";

interface LikeRow {
  like: Like;
  profile: UserProfile;
}

interface LikesData {
  received: LikeRow[];
  sent: LikeRow[];
  matchedPartnerIds: string[];
  prefs: MatchPreferences | null;
}

interface ViewingLikeProfile {
  profile: UserProfile;
  source: Tab;
}

export default function Likes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const db = useBackend();
  const reducedMotion = useReducedMotion();
  const tick = useDbRefresh("likes", "matches", "blocks", "profiles");

  const [tab, setTab] = useState<Tab>("received");
  const [celebration, setCelebration] = useState<MatchCelebration | null>(null);
  const [limitKind, setLimitKind] = useState<"likes" | "interests" | null>(null);
  const [viewing, setViewing] = useState<ViewingLikeProfile | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actedIds, setActedIds] = useState<Set<string>>(new Set());
  const busyRef = useRef<string | null>(null);

  const {
    data,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<LikesData> => {
      if (!user) return { received: [], sent: [], matchedPartnerIds: [], prefs: null };
      const [rec, sen, matches, prefs] = await Promise.all([
        b.likesReceived(user.id),
        b.likesSent(user.id),
        b.matchesFor(user.id),
        b.getPrefs(user.id),
      ]);
      const [recP, senP] = await Promise.all([
        Promise.all(rec.map((l) => b.getUser(l.fromUserId))),
        Promise.all(sen.map((l) => b.getUser(l.toUserId))),
      ]);
      const toRows = (ls: Like[], ps: (UserProfile | undefined)[]): LikeRow[] => {
        const out: LikeRow[] = [];
        ls.forEach((like, i) => {
          const profile = ps[i];
          if (profile) out.push({ like, profile });
        });
        return out;
      };
      return {
        received: toRows(rec, recP),
        sent: toRows(sen, senP),
        matchedPartnerIds: matches.map((m) => partnerOf(m, user.id)),
        prefs,
      };
    },
    [user?.id, tick],
    { received: [], sent: [], matchedPartnerIds: [], prefs: null } as LikesData,
  );

  const matchedSet = useMemo(() => new Set(data.matchedPartnerIds), [data.matchedPartnerIds]);
  const received = useMemo(
    () => data.received.filter((r) => !actedIds.has(r.profile.id)),
    [data.received, actedIds],
  );
  const sent = data.sent;

  if (!user) return null;
  const me = user;

  const markActed = (profileId: string) => {
    setActedIds((prev) => {
      if (prev.has(profileId)) return prev;
      const next = new Set(prev);
      next.add(profileId);
      return next;
    });
  };

  const likeBack = async (profileId: string) => {
    if (busyRef.current) return;
    busyRef.current = profileId;
    setBusyId(profileId);
    try {
      const { match } = await db.sendLike(me.id, profileId);
      markActed(profileId);
      if (viewing?.profile.id === profileId) setViewing(null);
      refresh();
      if (match) {
        // Honest mutual-match check: only celebrate if the returned match
        // really exists in this user's mutual matches.
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
        } else {
          toast("Liked back.");
        }
      } else {
        toast("Liked back.");
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("DAILY_LIKE_LIMIT_REACHED")) {
        setLimitKind("likes");
      } else {
        toast(
          e instanceof Error ? e.message : "Couldn't send the like.",
          "rose",
        );
      }
    } finally {
      busyRef.current = null;
      setBusyId(null);
    }
  };

  const pass = async (profileId: string) => {
    if (busyRef.current) return;
    busyRef.current = profileId;
    setBusyId(profileId);
    try {
      await db.sendPass(me.id, profileId);
      markActed(profileId);
      if (viewing?.profile.id === profileId) setViewing(null);
      refresh();
      toast("Passed.", "rose");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't pass right now.",
        "rose",
      );
    } finally {
      busyRef.current = null;
      setBusyId(null);
    }
  };

  const viewingCompat = viewing
    ? computeCompatibility(me, viewing.profile, data.prefs)
    : null;
  const viewingMatched = viewing ? matchedSet.has(viewing.profile.id) : false;

  return (
    <div className="max-w-5xl mx-auto px-0 sm:px-4 py-2 sm:py-6 overflow-x-hidden">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Likes</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-6">
          Who&apos;s feeling the <span className="text-gradient-dream">spark</span>
        </h1>
      </Reveal>

      <div className="flex flex-wrap gap-2 mb-8">
        {(["received", "sent"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`rounded-full px-6 min-h-[44px] text-sm font-medium transition-all ${
              tab === t
                ? "bg-gradient-to-r from-rosegold via-burgundy to-burgundy-deep text-ivory border border-champagne/50 shadow-[0_0_24px_rgba(255,61,154,0.35)]"
                : "btn-ghost"
            }`}
          >
            {t === "received" ? `Received (${received.length})` : `Sent (${sent.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-44 rounded-[1.5rem]" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Couldn't load likes"
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
      ) : tab === "received" ? (
        received.length === 0 ? (
          <EmptyState
            title="No likes yet"
            body="When someone likes your profile, they'll appear here. A complete profile with a warm bio gets noticed more."
            action={
              <Link to="/discover" className="btn-gold rounded-full px-6 py-2.5 min-h-[44px] text-sm inline-flex items-center">
                Discover people
              </Link>
            }
          />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {received.map(({ like, profile }) => {
              const isBusy = busyId === profile.id;
              const isMatched = matchedSet.has(profile.id);
              const compat = computeCompatibility(me, profile, data.prefs);
              return (
                <Reveal key={like.id}>
                  <motion.div
                    whileHover={reducedMotion ? undefined : { y: -4 }}
                    className="glass glow-border rounded-[1.5rem] p-5 card-hover relative overflow-hidden"
                  >
                    <div className="absolute -top-12 -right-12 h-36 w-36 rounded-full bg-rosegold/25 blur-[70px] pointer-events-none" />
                    <div className="absolute top-4 right-4 z-10 flex items-center gap-1.5">
                      <span className="text-[0.7rem] text-champagne font-semibold">
                        ✦ {compat.score}%
                      </span>
                      <span className="text-rosegold text-lg">♥</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewing({ profile, source: "received" })}
                      className="flex items-center gap-4 relative w-full text-left pr-14 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
                    >
                      <Avatar name={profile.firstName} photo={profile.photos[0]} size={64} ring />
                      <div className="min-w-0">
                        <p className="text-ivory font-medium text-lg truncate">
                          {profile.firstName}, {profile.age}
                        </p>
                        <p className="text-sm text-mist truncate">{profile.city}</p>
                        <p className="text-xs text-mist/70">{timeAgo(like.createdAt)}</p>
                      </div>
                    </button>
                    {profile.bio && (
                      <p className="text-xs text-ivory-dim/90 mt-3 line-clamp-2 relative">
                        {profile.bio}
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 relative">
                      {profile.verified && <Badge tone="green">✓ Verified</Badge>}
                      {profile.relationshipIntent && (
                        <Badge tone="gold">{profile.relationshipIntent}</Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2 mt-4 relative">
                      {isMatched ? (
                        <Link
                          to="/matches"
                          className="btn-gold rounded-full px-4 min-h-[44px] text-xs font-semibold flex-1 inline-flex items-center justify-center"
                        >
                          ✦ Matched · View
                        </Link>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void likeBack(profile.id)}
                            className="btn-gold rounded-full px-4 min-h-[44px] text-xs font-semibold flex-1 disabled:opacity-50"
                          >
                            {isBusy ? "Sending…" : "♥ Like back"}
                          </button>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void pass(profile.id)}
                            className="btn-ghost rounded-full px-4 min-h-[44px] text-xs flex-1 disabled:opacity-50"
                          >
                            ✕ Pass
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => setViewing({ profile, source: "received" })}
                        className="btn-ghost rounded-full px-3.5 min-h-[44px] text-xs"
                      >
                        Full profile
                      </button>
                    </div>
                  </motion.div>
                </Reveal>
              );
            })}
          </div>
        )
      ) : sent.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          body="Profiles you like will show up here until they respond."
          action={
            <Link to="/discover" className="btn-gold rounded-full px-6 py-2.5 min-h-[44px] text-sm inline-flex items-center">
              Discover people
            </Link>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sent.map(({ like, profile }) => {
            const compat = computeCompatibility(me, profile, data.prefs);
            const isMatched = matchedSet.has(profile.id);
            return (
              <Reveal key={like.id}>
                <motion.div
                  whileHover={reducedMotion ? undefined : { y: -4 }}
                  className="glass glow-border rounded-[1.5rem] p-5 card-hover relative overflow-hidden"
                >
                  <div className="absolute -top-12 -right-12 h-36 w-36 rounded-full bg-burgundy/40 blur-[70px] pointer-events-none" />
                  <div className="absolute top-4 right-4 z-10 text-[0.7rem] text-champagne font-semibold">
                    ✦ {compat.score}%
                  </div>
                  <button
                    type="button"
                    onClick={() => setViewing({ profile, source: "sent" })}
                    className="flex items-center gap-4 relative w-full text-left pr-12 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
                  >
                    <Avatar name={profile.firstName} photo={profile.photos[0]} size={64} />
                    <div className="min-w-0">
                      <p className="text-ivory font-medium text-lg truncate">
                        {profile.firstName}, {profile.age}
                      </p>
                      <p className="text-sm text-mist truncate">{profile.city}</p>
                      <p className="text-xs text-mist/70">Liked {timeAgo(like.createdAt)}</p>
                    </div>
                  </button>
                  <p className="text-xs text-mist mt-4 relative">
                    {isMatched
                      ? "It's mutual! Open Matches or Chat to message."
                      : "Waiting for them to like you back — a match appears only when it's mutual."}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 relative">
                    <button
                      type="button"
                      onClick={() => setViewing({ profile, source: "sent" })}
                      className="btn-ghost rounded-full px-4 min-h-[44px] text-xs"
                    >
                      Full profile
                    </button>
                    {isMatched && (
                      <Link
                        to="/chat"
                        className="btn-gold rounded-full px-4 min-h-[44px] text-xs font-semibold inline-flex items-center"
                      >
                        💬 Chat
                      </Link>
                    )}
                  </div>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
      )}

      {/* Full profile modal */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.profile.firstName}, ${viewing.profile.age}` : ""}
        wide
      >
        {viewing && (
          <div className="space-y-5">
            <div className="relative -mx-5 -mt-5 sm:-mx-6 sm:-mt-6 md:-mx-8 md:-mt-8 h-52 overflow-hidden rounded-t-[1.4rem]">
              {viewing.profile.photos[0] ? (
                <img
                  src={viewing.profile.photos[0]}
                  alt={`${viewing.profile.firstName}'s photo`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-coal via-burgundy-deep to-midnight" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-midnight via-midnight/30 to-transparent" />
              <div className="absolute bottom-3 left-5 sm:left-6 flex items-center gap-3">
                <Avatar
                  name={viewing.profile.firstName}
                  photo={viewing.profile.photos[0]}
                  size={64}
                  ring
                />
                <div>
                  <p className="text-ivory font-display text-xl">
                    {viewing.profile.firstName}, {viewing.profile.age}
                  </p>
                  <p className="text-mist text-sm">{viewing.profile.city}</p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {viewing.profile.verified && <Badge tone="green">✓ Verified</Badge>}
              {viewing.profile.relationshipIntent && (
                <Badge tone="gold">{viewing.profile.relationshipIntent}</Badge>
              )}
              {viewingCompat && (
                <Badge tone="rose">✦ {viewingCompat.score}% compatible</Badge>
              )}
            </div>

            {viewing.profile.bio && (
              <p className="text-ivory-dim leading-relaxed">{viewing.profile.bio}</p>
            )}

            {viewing.profile.photos.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Photos
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {viewing.profile.photos.map((url, i) => (
                    <div
                      key={url}
                      className="aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/5"
                    >
                      <img
                        src={url}
                        alt={`${viewing.profile.firstName}'s photo ${i + 1}`}
                        className="h-full w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {viewing.profile.interests.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Interests
                </p>
                <div className="flex flex-wrap gap-2">
                  {viewing.profile.interests.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-champagne/40 bg-champagne/10 px-3 py-1 text-xs text-champagne"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {viewing.profile.hobbies.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Hobbies
                </p>
                <div className="flex flex-wrap gap-2">
                  {viewing.profile.hobbies.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-rosegold/40 bg-rosegold/10 px-3 py-1 text-xs text-rosegold"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {viewing.profile.lifestyle.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Lifestyle
                </p>
                <div className="flex flex-wrap gap-2">
                  {viewing.profile.lifestyle.map((item) => (
                    <span
                      key={item}
                      className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-ivory-dim"
                    >
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {viewingCompat && viewingCompat.factors.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Why you connect
                </p>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-2.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rosegold via-champagne to-rosegold"
                    style={{ width: `${viewingCompat.score}%` }}
                  />
                </div>
                <ul className="space-y-1">
                  {viewingCompat.factors.slice(0, 4).map((f) => (
                    <li key={f} className="text-xs text-ivory-dim/90 flex gap-1.5">
                      <span className="text-rosegold">✦</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-3 pt-2">
              {viewing.source === "received" && !viewingMatched && (
                <>
                  <button
                    type="button"
                    disabled={busyId === viewing.profile.id}
                    onClick={() => void likeBack(viewing.profile.id)}
                    className="btn-gold rounded-full px-6 min-h-[44px] text-sm font-semibold flex-1 disabled:opacity-50"
                  >
                    {busyId === viewing.profile.id ? "Sending…" : "♥ Like back"}
                  </button>
                  <button
                    type="button"
                    disabled={busyId === viewing.profile.id}
                    onClick={() => void pass(viewing.profile.id)}
                    className="btn-ghost rounded-full px-6 min-h-[44px] text-sm disabled:opacity-50"
                  >
                    ✕ Pass
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setViewing(null)}
                className="btn-ghost rounded-full px-6 min-h-[44px] text-sm"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Real mutual-match celebration */}
      <MatchOverlay
        celebration={celebration}
        onClose={() => setCelebration(null)}
        onChat={(convId) => {
          setCelebration(null);
          navigate(convId ? `/chat?c=${convId}` : "/chat");
        }}
      />
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
