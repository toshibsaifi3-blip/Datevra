import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Avatar, Badge, EmptyState, Reveal, Skeleton, useToast } from "../../components/ui";
import MatchOverlay, { type MatchCelebration } from "../../components/MatchOverlay";
import { LimitReachedModal } from "../../components/LimitModal";
import { timeAgo, useDbRefresh } from "./shared";
import type { Like, UserProfile } from "../../lib/types";

type Tab = "received" | "sent";

interface LikeRow {
  like: Like;
  profile: UserProfile;
}

interface LikesData {
  received: LikeRow[];
  sent: LikeRow[];
}

export default function Likes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const db = useBackend();
  const tick = useDbRefresh("likes", "matches", "blocks");
  const [tab, setTab] = useState<Tab>("received");
  const [celebration, setCelebration] = useState<MatchCelebration | null>(null);
  const [limitKind, setLimitKind] = useState<"likes" | "interests" | null>(null);

  const {
    data,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<LikesData> => {
      if (!user) return { received: [], sent: [] };
      const [rec, sen] = await Promise.all([
        b.likesReceived(user.id),
        b.likesSent(user.id),
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
      return { received: toRows(rec, recP), sent: toRows(sen, senP) };
    },
    [user?.id, tick],
    { received: [], sent: [] } as LikesData,
  );

  if (!user) return null;
  const me = user;
  const { received, sent } = data;

  const likeBack = async (profileId: string) => {
    try {
      const { match } = await db.sendLike(me.id, profileId);
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
    }
  };

  const pass = async (profileId: string) => {
    try {
      await db.sendPass(me.id, profileId);
      refresh();
      toast("Passed.", "rose");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't pass right now.",
        "rose",
      );
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-5 py-10">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Likes</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-6">
          Who&apos;s feeling the <span className="text-gradient-dream">spark</span>
        </h1>
      </Reveal>

      <div className="flex gap-2 mb-8">
        {(["received", "sent"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-6 py-2.5 text-sm font-medium transition-all ${
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
        <p className="text-sm text-rosegold">Couldn't load likes: {error}</p>
      ) : tab === "received" ? (
        received.length === 0 ? (
          <EmptyState
            title="No likes yet"
            body="When someone likes your profile, they'll appear here. A complete profile with a warm bio gets noticed more."
            action={
              <Link to="/discover" className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block">
                Discover people
              </Link>
            }
          />
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {received.map(({ like, profile }) => (
              <Reveal key={like.id}>
                <motion.div
                  whileHover={{ y: -4 }}
                  className="glass glow-border rounded-[1.5rem] p-5 card-hover relative overflow-hidden"
                >
                  <div className="absolute -top-12 -right-12 h-36 w-36 rounded-full bg-rosegold/25 blur-[70px] pointer-events-none" />
                  <div className="absolute top-4 right-4 z-10">
                    <span className="text-rosegold text-xl animate-heartbeat">♥</span>
                  </div>
                  <div className="flex items-center gap-4 relative">
                    <Avatar name={profile.firstName} photo={profile.photos[0]} size={64} ring />
                    <div className="min-w-0">
                      <p className="text-ivory font-medium text-lg truncate">
                        {profile.firstName}, {profile.age}
                      </p>
                      <p className="text-sm text-mist">{profile.city}</p>
                      <p className="text-xs text-mist/70">{timeAgo(like.createdAt)}</p>
                    </div>
                  </div>
                  {profile.bio && (
                    <p className="text-xs text-ivory-dim/90 mt-3 line-clamp-2 relative">{profile.bio}</p>
                  )}
                  {profile.verified && (
                    <div className="mt-2.5 relative">
                      <Badge tone="green">✓ Verified</Badge>
                    </div>
                  )}
                  <div className="flex gap-2 mt-4 relative">
                    <button onClick={() => likeBack(profile.id)} className="btn-gold rounded-full px-4 py-2.5 text-xs font-semibold flex-1">
                      ♥ Like back
                    </button>
                    <button onClick={() => pass(profile.id)} className="btn-ghost rounded-full px-4 py-2.5 text-xs flex-1">
                      ✕ Pass
                    </button>
                  </div>
                </motion.div>
              </Reveal>
            ))}
          </div>
        )
      ) : sent.length === 0 ? (
        <EmptyState
          title="Nothing sent yet"
          body="Profiles you like will show up here until they respond."
          action={
            <Link to="/discover" className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block">
              Discover people
            </Link>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sent.map(({ like, profile }) => (
            <Reveal key={like.id}>
              <motion.div
                whileHover={{ y: -4 }}
                className="glass glow-border rounded-[1.5rem] p-5 card-hover relative overflow-hidden"
              >
                <div className="absolute -top-12 -right-12 h-36 w-36 rounded-full bg-burgundy/40 blur-[70px] pointer-events-none" />
                <div className="flex items-center gap-4 relative">
                  <Avatar name={profile.firstName} photo={profile.photos[0]} size={64} />
                  <div className="min-w-0">
                    <p className="text-ivory font-medium text-lg truncate">
                      {profile.firstName}, {profile.age}
                    </p>
                    <p className="text-sm text-mist">{profile.city}</p>
                    <p className="text-xs text-mist/70">Liked {timeAgo(like.createdAt)}</p>
                  </div>
                </div>
                <p className="text-xs text-mist mt-4 relative">
                  Waiting for them to like you back — a match appears only when it&apos;s mutual.
                </p>
              </motion.div>
            </Reveal>
          ))}
        </div>
      )}

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
