import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Avatar, Badge, EmptyState, Modal, Reveal, Skeleton, useToast } from "../../components/ui";
import { computeCompatibility } from "../../lib/compat";
import { partnerOf, timeAgo, useDbRefresh } from "./shared";
import type { Match, MatchPreferences, MatchProposal, UserProfile } from "../../lib/types";

interface MatchRow {
  match: Match;
  profile: UserProfile;
}

interface MatchesData {
  rows: MatchRow[];
  prefs: MatchPreferences | null;
}

export default function Matches() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const db = useBackend();
  const reducedMotion = useReducedMotion();
  const tick = useDbRefresh("matches", "conversations", "blocks", "profiles");

  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<MatchRow | null>(null);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [unmatching, setUnmatching] = useState(false);
  const busyProposalRef = useRef<string | null>(null);
  const unmatchingRef = useRef(false);

  const {
    data,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<MatchesData> => {
      if (!user) return { rows: [], prefs: null };
      const [ms, prefs] = await Promise.all([
        b.matchesFor(user.id),
        b.getPrefs(user.id),
      ]);
      const profs = await Promise.all(
        ms.map((m) => b.getUser(partnerOf(m, user.id))),
      );
      const rows: MatchRow[] = [];
      ms.forEach((match, i) => {
        const profile = profs[i];
        if (profile) rows.push({ match, profile });
      });
      return { rows, prefs };
    },
    [user?.id, tick],
    { rows: [], prefs: null } as MatchesData,
  );

  const matches = data.rows;

  const {
    data: proposals,
    refresh: refreshProposals,
  } = useAsync(
    async (b): Promise<MatchProposal[]> => {
      if (!user) return [];
      return (await b.myMatchProposals(user.id)).filter((p) => p.status === "pending");
    },
    [user?.id, tick],
    [] as MatchProposal[],
  );

  const respond = async (p: MatchProposal, accept: boolean) => {
    if (!user || busyProposalRef.current) return;
    busyProposalRef.current = p.id;
    setBusyProposalId(p.id);
    try {
      const updated = await db.respondToMatchProposal(p.id, user.id, accept);
      if (updated.status === "accepted") {
        toast("It's a match! You can now chat.", "gold");
      } else if (updated.status === "declined") {
        toast(accept ? "This proposal is no longer available." : "Proposal declined.");
      } else {
        toast("Accepted! Waiting for the other person.", "gold");
      }
      refreshProposals();
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not respond", "rose");
    } finally {
      busyProposalRef.current = null;
      setBusyProposalId(null);
    }
  };

  if (!user) return null;
  const me = user;

  const openChat = async (matchId: string) => {
    try {
      const convs = await db.conversationsFor(me.id);
      const conv = convs.find((c) => c.matchId === matchId);
      navigate(conv ? `/chat?c=${conv.id}` : "/chat");
    } catch {
      navigate("/chat");
    }
  };

  const doUnmatch = async () => {
    if (!confirmId || unmatchingRef.current) return;
    unmatchingRef.current = true;
    setUnmatching(true);
    try {
      await db.unmatch(confirmId, me.id);
      setConfirmId(null);
      refresh();
      toast("Match ended.", "rose");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't end the match.",
        "rose",
      );
    } finally {
      unmatchingRef.current = false;
      setUnmatching(false);
    }
  };

  const viewingFactors = viewing
    ? viewing.match.factors.length > 0
      ? viewing.match.factors
      : computeCompatibility(me, viewing.profile, data.prefs).factors
    : [];

  return (
    <div className="max-w-5xl mx-auto px-0 sm:px-4 py-2 sm:py-6 overflow-x-clip">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Matches</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-2">
          Mutual <span className="text-gradient-dream">connections</span>
        </h1>
        <p className="text-sm text-mist mb-8">
          A match exists only when both of you liked each other. Nothing here was ever forced.
        </p>
      </Reveal>

      {proposals.length > 0 && (
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-3">💌 Curated proposals for you</h2>
          <div className="grid grid-cols-1 gap-3">
            {proposals.map((p) => {
              const otherName = p.userAId === me.id ? p.userBName : p.userAName;
              const myResponse = p.userAId === me.id ? p.userAResponse : p.userBResponse;
              const isBusy = busyProposalId === p.id;
              return (
                <div key={p.id} className="rounded-2xl border border-champagne/30 p-5 bg-gradient-to-br from-champagne/10 to-transparent">
                  <p className="font-semibold">Datevra curators suggest: {otherName}</p>
                  {p.message && <p className="text-sm text-white/70 mt-2 italic">“{p.message}”</p>}
                  {myResponse === true ? (
                    <p className="text-sm text-champagne mt-3">You accepted — waiting for {otherName}.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2 mt-4">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void respond(p, true)}
                        className="btn-gold rounded-full min-h-[44px] px-5 text-sm flex-1 disabled:opacity-50"
                      >
                        {isBusy ? "Sending…" : "Accept"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void respond(p, false)}
                        className="px-4 min-h-[44px] rounded-full bg-white/5 text-white/70 hover:text-ivory text-sm disabled:opacity-50"
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-[1.5rem]" />
          ))}
        </div>
      ) : error ? (
        <EmptyState
          title="Couldn't load matches"
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
      ) : matches.length === 0 ? (
        <EmptyState
          title="No matches yet"
          body="Like profiles in Discover — when someone likes you back, you'll both appear here and can start chatting."
          action={
            <Link to="/discover" className="btn-gold rounded-full px-6 py-2.5 min-h-[44px] text-sm inline-flex items-center">
              Discover people
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {matches.map(({ match, profile }) => {
            const photo = profile.photos[0];
            return (
              <Reveal key={match.id}>
                <motion.div
                  whileHover={reducedMotion ? undefined : { y: -4 }}
                  className="glass glow-border rounded-[1.5rem] w-full min-w-0 overflow-hidden card-hover relative"
                >
                  {/* Photo banner with dreamy lighting */}
                  <button
                    type="button"
                    onClick={() => setViewing({ match, profile })}
                    className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne"
                    aria-label={`View ${profile.firstName}'s profile`}
                  >
                    <div className="relative h-40">
                      {photo ? (
                        <img
                          src={photo}
                          alt={`${profile.firstName}'s photo`}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="absolute inset-0 bg-gradient-to-br from-coal via-burgundy-deep to-midnight flex items-center justify-center">
                          <span className="font-display text-5xl text-champagne/60">
                            {profile.firstName.charAt(0)}
                          </span>
                        </div>
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-midnight via-midnight/40 to-transparent" />
                      <div className="absolute inset-0 bg-gradient-to-tr from-burgundy/25 via-transparent to-rosegold/15" />
                      <div className="absolute bottom-3 inset-x-4 flex items-center gap-3 pr-16">
                        <Avatar name={profile.firstName} photo={photo} size={56} ring />
                        <div className="min-w-0">
                          <p className="text-ivory font-medium text-lg leading-tight truncate">
                            {profile.firstName}, {profile.age}
                          </p>
                          <p className="text-xs text-ivory-dim truncate">{profile.city}</p>
                        </div>
                      </div>
                      <span className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-midnight/60 backdrop-blur px-2.5 py-1 border border-champagne/30">
                        <span className="text-champagne text-xs">✦</span>
                        <span className="text-champagne text-xs font-semibold">{match.compatibility}%</span>
                      </span>
                    </div>
                  </button>
                  <div className="p-5 pt-4 relative">
                    <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-burgundy/40 blur-[70px] pointer-events-none" />
                    <p className="text-xs text-mist/80">Matched {timeAgo(match.createdAt)}</p>
                    {match.factors[0] && (
                      <p className="text-xs text-ivory-dim mt-1.5 truncate">✦ {match.factors[0]}</p>
                    )}
                    <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mt-3">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-rosegold to-champagne"
                        style={{ width: `${match.compatibility}%` }}
                      />
                    </div>
                    <div className="flex flex-wrap gap-2 mt-5">
                      <button
                        type="button"
                        onClick={() => void openChat(match.id)}
                        className="btn-gold rounded-full px-4 min-h-[44px] text-xs font-semibold flex-1"
                      >
                        💬 Message
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewing({ match, profile })}
                        className="btn-ghost rounded-full px-4 min-h-[44px] text-xs"
                      >
                        Profile
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmId(match.id)}
                        aria-label={`Unmatch ${profile.firstName}`}
                        className="btn-ghost rounded-full px-3.5 min-h-[44px] min-w-[44px] text-xs text-mist hover:text-rosegold"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
      )}

      {/* View profile */}
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
              <div className="absolute bottom-3 inset-x-5 sm:inset-x-6 flex items-center gap-3">
                <Avatar name={viewing.profile.firstName} photo={viewing.profile.photos[0]} size={64} ring />
                <div className="min-w-0 flex-1">
                  <p className="text-ivory font-display text-xl truncate">
                    {viewing.profile.firstName}, {viewing.profile.age}
                  </p>
                  <p className="text-mist text-sm truncate">{viewing.profile.city}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {viewing.profile.verified && <Badge tone="green">✓ Verified</Badge>}
              {viewing.profile.relationshipIntent && (
                <Badge tone="gold">{viewing.profile.relationshipIntent}</Badge>
              )}
              <Badge tone="rose">✦ {viewing.match.compatibility}% compatible</Badge>
            </div>
            {viewing.profile.bio && (
              <p className="text-ivory-dim leading-relaxed">{viewing.profile.bio}</p>
            )}
            {viewing.profile.photos.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Photos</p>
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
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Interests</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.profile.interests.map((t) => (
                    <span key={t} className="rounded-full border border-champagne/40 bg-champagne/10 px-3 py-1 text-xs text-champagne">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {viewing.profile.hobbies.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Hobbies</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.profile.hobbies.map((t) => (
                    <span key={t} className="rounded-full border border-rosegold/40 bg-rosegold/10 px-3 py-1 text-xs text-rosegold">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {viewing.profile.lifestyle.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">Lifestyle</p>
                <div className="flex flex-wrap gap-2">
                  {viewing.profile.lifestyle.map((t) => (
                    <span key={t} className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-ivory-dim">{t}</span>
                  ))}
                </div>
              </div>
            )}
            {viewingFactors.length > 0 && (
              <div>
                <p className="text-[0.72rem] uppercase tracking-[0.2em] text-mist mb-2">
                  Compatibility factors
                </p>
                <div className="h-2 rounded-full bg-white/10 overflow-hidden mb-2.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-rosegold via-champagne to-rosegold"
                    style={{ width: `${viewing.match.compatibility}%` }}
                  />
                </div>
                <ul className="space-y-1">
                  {viewingFactors.slice(0, 4).map((f) => (
                    <li key={f} className="text-xs text-ivory-dim/90 flex gap-1.5">
                      <span className="text-rosegold">✦</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  const m = viewing.match.id;
                  setViewing(null);
                  void openChat(m);
                }}
                className="btn-gold rounded-full px-6 min-h-[44px] text-sm font-medium flex-1"
              >
                💬 Message
              </button>
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

      <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title="End this match?">
        <p className="text-sm text-ivory-dim">
          This will permanently close the conversation and remove the match for both of you.
          This can&apos;t be undone.
        </p>
        <div className="flex flex-wrap justify-end gap-3 mt-6">
          <button
            type="button"
            disabled={unmatching}
            onClick={() => setConfirmId(null)}
            className="btn-ghost rounded-full px-5 min-h-[44px] text-sm disabled:opacity-50"
          >
            Keep match
          </button>
          <button
            type="button"
            disabled={unmatching}
            onClick={() => void doUnmatch()}
            className="rounded-full px-5 min-h-[44px] text-sm bg-burgundy text-ivory hover:bg-burgundy-soft transition-colors disabled:opacity-50"
          >
            {unmatching ? "Ending…" : "Yes, unmatch"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
