import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Avatar, Badge, EmptyState, Modal, Reveal, Skeleton, useToast } from "../../components/ui";
import { partnerOf, timeAgo, useDbRefresh } from "./shared";
import type { Match, MatchProposal, UserProfile } from "../../lib/types";

interface MatchRow {
  match: Match;
  profile: UserProfile;
}

export default function Matches() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const db = useBackend();
  const tick = useDbRefresh("matches", "conversations", "blocks");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<MatchRow | null>(null);

  const {
    data: matches,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<MatchRow[]> => {
      if (!user) return [];
      const ms = await b.matchesFor(user.id);
      const profs = await Promise.all(
        ms.map((m) => b.getUser(partnerOf(m, user.id))),
      );
      const rows: MatchRow[] = [];
      ms.forEach((match, i) => {
        const profile = profs[i];
        if (profile) rows.push({ match, profile });
      });
      return rows;
    },
    [user?.id, tick],
    [] as MatchRow[],
  );

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
    if (!user) return;
    try {
      const updated = await db.respondToMatchProposal(p.id, user.id, accept);
      if (updated.status === "accepted") {
        toast("It's a match! You can now chat.", "gold");
      } else if (!accept) {
        toast("Proposal declined.");
      } else {
        toast("Accepted! Waiting for the other person.", "gold");
      }
      refreshProposals();
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not respond", "rose");
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
    if (!confirmId) return;
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
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-5 py-10">
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
          <div className="grid gap-3">
            {proposals.map((p) => {
              const otherName = p.userAId === me.id ? p.userBName : p.userAName;
              const myResponse = p.userAId === me.id ? p.userAResponse : p.userBResponse;
              return (
                <div key={p.id} className="rounded-2xl border border-champagne/30 p-5 bg-gradient-to-br from-champagne/10 to-transparent">
                  <p className="font-semibold">Datevra curators suggest: {otherName}</p>
                  {p.message && <p className="text-sm text-white/70 mt-2 italic">“{p.message}”</p>}
                  {myResponse === true ? (
                    <p className="text-sm text-champagne mt-3">You accepted — waiting for {otherName}.</p>
                  ) : (
                    <div className="flex gap-2 mt-4">
                      <button onClick={() => respond(p, true)} className="btn-gold flex-1">Accept</button>
                      <button onClick={() => respond(p, false)} className="px-4 py-2 rounded-full bg-white/5 text-white/60 text-sm">Decline</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-56 rounded-[1.5rem]" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-rosegold">Couldn't load matches: {error}</p>
      ) : matches.length === 0 ? (
        <EmptyState
          title="No matches yet"
          body="Like profiles in Discover — when someone likes you back, you'll both appear here and can start chatting."
          action={
            <Link to="/discover" className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block">
              Discover people
            </Link>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {matches.map(({ match, profile }) => {
            const photo = profile.photos[0];
            return (
              <Reveal key={match.id}>
                <motion.div
                  whileHover={{ y: -4 }}
                  className="glass glow-border rounded-[1.5rem] overflow-hidden card-hover relative"
                >
                  {/* Photo banner with dreamy lighting */}
                  <button
                    onClick={() => setViewing({ match, profile })}
                    className="block w-full text-left"
                    aria-label={`View ${profile.firstName}'s profile`}
                  >
                    <div className="relative h-40">
                      {photo ? (
                        <img
                          src={photo}
                          alt={`${profile.firstName}'s photo`}
                          className="absolute inset-0 h-full w-full object-cover"
                          loading="lazy"
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
                      <div className="absolute bottom-3 left-4 flex items-center gap-3">
                        <Avatar name={profile.firstName} photo={photo} size={56} ring />
                        <div>
                          <p className="text-ivory font-medium text-lg leading-tight">
                            {profile.firstName}, {profile.age}
                          </p>
                          <p className="text-xs text-ivory-dim">{profile.city}</p>
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
                    <div className="flex gap-2 mt-5">
                      <button
                        onClick={() => openChat(match.id)}
                        className="btn-gold rounded-full px-4 py-2.5 text-xs font-semibold flex-1"
                      >
                        💬 Message
                      </button>
                      <button
                        onClick={() => setViewing({ match, profile })}
                        className="btn-ghost rounded-full px-4 py-2.5 text-xs"
                      >
                        Profile
                      </button>
                      <button
                        onClick={() => setConfirmId(match.id)}
                        aria-label={`Unmatch ${profile.firstName}`}
                        className="btn-ghost rounded-full px-3.5 py-2.5 text-xs text-mist hover:text-rosegold"
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
            <div className="relative -mx-6 -mt-6 h-52 overflow-hidden rounded-t-[1.4rem]">
              {viewing.profile.photos[0] ? (
                <img
                  src={viewing.profile.photos[0]}
                  alt={`${viewing.profile.firstName}'s photo`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-coal via-burgundy-deep to-midnight" />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-midnight via-midnight/30 to-transparent" />
              <div className="absolute bottom-3 left-6 flex items-center gap-3">
                <Avatar name={viewing.profile.firstName} photo={viewing.profile.photos[0]} size={64} ring />
                <div>
                  <p className="text-ivory font-display text-xl">
                    {viewing.profile.firstName}, {viewing.profile.age}
                  </p>
                  <p className="text-mist text-sm">{viewing.profile.city}</p>
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
            {viewing.profile.interests.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {viewing.profile.interests.map((t) => (
                  <span key={t} className="rounded-full border border-champagne/40 bg-champagne/10 px-3 py-1 text-xs text-champagne">{t}</span>
                ))}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => { const m = viewing.match.id; setViewing(null); void openChat(m); }}
                className="btn-gold rounded-full px-6 py-2.5 text-sm font-medium flex-1"
              >
                💬 Message
              </button>
              <button onClick={() => setViewing(null)} className="btn-ghost rounded-full px-6 py-2.5 text-sm">
                Close
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!confirmId} onClose={() => setConfirmId(null)} title="End this match?">
        <p className="text-sm text-ivory-dim">
          This will permanently close the conversation and remove the match for both of you.
          This can't be undone.
        </p>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setConfirmId(null)} className="btn-ghost rounded-full px-5 py-2 text-sm">
            Keep match
          </button>
          <button onClick={doUnmatch} className="rounded-full px-5 py-2 text-sm bg-burgundy text-ivory hover:bg-burgundy-soft transition-colors">
            Yes, unmatch
          </button>
        </div>
      </Modal>
    </div>
  );
}
