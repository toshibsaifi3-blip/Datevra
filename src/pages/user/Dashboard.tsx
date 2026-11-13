import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { rankCandidates } from "../../lib/compat";
import { PLANS } from "../../data/seed";
import {
  Avatar,
  Badge,
  EmptyState,
  PlanBadge,
  Skeleton,
  Stat,
  useToast,
  Reveal,
} from "../../components/ui";
import { LimitReachedModal } from "../../components/LimitModal";
import {
  APP_STATUS_META,
  excludedIdsFor,
  fmtExpiry,
  greeting,
  inr,
  timeAgo,
  useDbRefresh,
} from "./shared";
import type {
  DateApplication,
  DateBooking,
  DateExperience,
  Like,
  Match,
  Subscription,
  UserProfile,
} from "../../lib/types";

interface AppRow {
  app: DateApplication;
  exp: DateExperience | undefined;
}

interface BookingRow {
  booking: DateBooking;
  exp: DateExperience | undefined;
}

interface LikeRow {
  like: Like;
  profile: UserProfile | undefined;
}

interface DashboardData {
  me: UserProfile;
  matches: Match[];
  likes: Like[];
  unreadMessages: number;
  sub: Subscription | undefined;
  plan: { id: string; name: string; tagline: string } | undefined;
  recommended: ReturnType<typeof rankCandidates>;
  recentLikes: LikeRow[];
  unreadNotifs: { id: string; title: string; body: string; createdAt: string; link?: string }[];
  apps: AppRow[];
  upcoming: BookingRow[];
}

export default function Dashboard() {
  const { user } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [limitHit, setLimitHit] = useState(false);
  const tick = useDbRefresh(
    "likes",
    "matches",
    "conversations",
    "notifications",
    "profiles",
    "payments",
  );

  const {
    data,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<DashboardData | null> => {
      if (!user) return null;
      const me = user;
      const [convs, sub, likesRec, matches, profiles, prefs, notifs, apps, bookings] =
        await Promise.all([
          b.conversationsFor(me.id),
          b.activeSubscription(me.id),
          b.likesReceived(me.id),
          b.matchesFor(me.id),
          b.listProfiles(),
          b.getPrefs(me.id),
          b.notificationsFor(me.id),
          b.applicationsFor(me.id),
          b.bookingsFor(me.id),
        ]);
      const unreadMessages = convs.reduce((n, c) => n + (c.unread[me.id] ?? 0), 0);
      const excluded = await excludedIdsFor(b, me.id, profiles);
      const plan = sub ? PLANS.find((p) => p.id === sub.planId) : undefined;
      const recommended = rankCandidates(me, profiles, prefs, excluded).slice(0, 3);
      const recentSlice = likesRec.slice(0, 4);
      const recentProfs = await Promise.all(
        recentSlice.map((l) => b.getUser(l.fromUserId)),
      );
      const recentLikes: LikeRow[] = recentSlice.map((like, i) => ({
        like,
        profile: recentProfs[i],
      }));
      const unreadNotifs = notifs
        .filter((n) => !n.read)
        .slice(0, 4)
        .map((n) => ({ id: n.id, title: n.title, body: n.body, createdAt: n.createdAt, link: n.link }));
      const appSlice = apps.slice(0, 3);
      const appExps = await Promise.all(
        appSlice.map((a) => b.getExperience(a.experienceId)),
      );
      const appRows: AppRow[] = appSlice.map((app, i) => ({ app, exp: appExps[i] }));
      const upcomingBookings = bookings.filter((bk) => bk.status === "upcoming").slice(0, 3);
      const bkExps = await Promise.all(
        upcomingBookings.map((x) => b.getExperience(x.experienceId)),
      );
      const upcoming: BookingRow[] = upcomingBookings.map((booking, i) => ({
        booking,
        exp: bkExps[i],
      }));
      return {
        me,
        matches,
        likes: likesRec,
        unreadMessages,
        sub,
        plan,
        recommended,
        recentLikes,
        unreadNotifs,
        apps: appRows,
        upcoming,
      };
    },
    [user?.id, tick],
    null as DashboardData | null,
  );

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-0 sm:px-4 py-2 sm:py-6 space-y-6">
        <Skeleton className="h-44 rounded-3xl" />
        <div className="grid grid-cols-1 min-[340px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-3xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-0 sm:px-4 py-2 sm:py-6">
        <p className="text-sm text-rosegold">Couldn't load your dashboard: {error}</p>
        <button onClick={refresh} className="btn-ghost rounded-full px-5 min-h-[44px] text-sm mt-4">
          Try again
        </button>
      </div>
    );
  }

  if (!data) return null;
  const { me } = data;

  const likeBack = async (profileId: string) => {
    try {
      const { match } = await db.sendLike(me.id, profileId);
      refresh();
      toast(
        match ? "It's a mutual match! Open Chat to say hello." : "Liked back.",
        "gold",
      );
    } catch (e) {
      if (e instanceof Error && e.message.includes("DAILY_LIKE_LIMIT_REACHED")) {
        setLimitHit(true);
      } else {
        toast(
          e instanceof Error ? e.message : "Couldn't send the like.",
          "rose",
        );
      }
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-0 sm:px-4 py-2 sm:py-6 space-y-8 sm:space-y-10 overflow-x-clip">
      {/* Welcome */}
      <Reveal>
        <div className="glass rounded-3xl p-5 sm:p-6 md:p-8 relative overflow-hidden">
          <div className="absolute -top-24 -right-24 h-64 w-64 rounded-full bg-burgundy/40 blur-[100px]" />
          <div className="relative flex flex-wrap items-center gap-4 sm:gap-5">
            <Avatar name={me.firstName} photo={me.photos[0]} size={72} ring />
            <div className="flex-1 min-w-0 sm:min-w-[220px]">
              <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">
                {greeting()}
              </p>
              <h1 className="font-display text-3xl md:text-4xl text-ivory mt-1 truncate">
                {me.firstName}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-2 sm:gap-3">
                <PlanBadge plan={me.plan} />
                {me.verified && (
                  <Badge tone="green">✓ Verified</Badge>
                )}
              </div>
            </div>
            <div className="w-full md:w-64">
              <div className="flex justify-between text-xs text-mist mb-1.5">
                <span className="uppercase tracking-[0.18em]">Profile</span>
                <span className="text-champagne">{me.profileComplete}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rosegold to-champagne transition-all"
                  style={{ width: `${me.profileComplete}%` }}
                />
              </div>
              {me.profileComplete < 100 && (
                <Link
                  to="/profile"
                  className="text-xs text-rosegold hover:text-champagne mt-2 inline-block"
                >
                  Complete your profile →
                </Link>
              )}
            </div>
          </div>
        </div>
      </Reveal>

      {/* Stats */}
      <div className="grid grid-cols-1 min-[340px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <Reveal delay={0.05}>
          <Stat
            label="Mutual matches"
            value={data.matches.length}
            sub="People who liked you back"
          />
        </Reveal>
        <Reveal delay={0.1}>
          <Stat
            label="Likes received"
            value={data.likes.length}
            sub="Waiting for your response"
          />
        </Reveal>
        <Reveal delay={0.15}>
          <Stat
            label="Unread messages"
            value={data.unreadMessages}
            sub="Across your conversations"
          />
        </Reveal>
        <Reveal delay={0.2}>
          <Stat
            label="Membership"
            value={data.plan ? data.plan.name : "Free"}
            sub={
              data.sub
                ? `Renews ${data.sub.expiresAt ? new Date(data.sub.expiresAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "never — lifetime"}`
                : "Upgrade for priority matching"
            }
          />
        </Reveal>
      </div>

      {/* Recommended */}
      <Reveal>
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="font-display text-2xl text-ivory">Recommended for you</h2>
          <Link to="/discover" className="text-sm text-rosegold hover:text-champagne shrink-0">
            Discover more →
          </Link>
        </div>
        {data.recommended.length === 0 ? (
          <EmptyState
            title="No recommendations right now"
            body="You've seen everyone who fits your current preferences. Try widening your discovery filters."
            action={
              <Link to="/discover" className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block">
                Open Discover
              </Link>
            }
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {data.recommended.map(({ profile, score, factors }) => (
              <Link
                key={profile.id}
                to="/discover"
                className="glass rounded-2xl p-4 sm:p-5 card-hover block min-w-0"
              >
                <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                  <Avatar name={profile.firstName} photo={profile.photos[0]} size={60} ring />
                  <div className="min-w-0 flex-1">
                    <p className="text-ivory font-medium text-lg truncate">
                      {profile.firstName}, {profile.age}
                    </p>
                    <p className="text-sm text-mist truncate">{profile.city}</p>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-mist mb-1">
                    <span>Compatibility</span>
                    <span className="text-champagne">{score}%</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-rosegold to-champagne"
                      style={{ width: `${score}%` }}
                    />
                  </div>
                  {factors[0] && (
                    <p className="text-xs text-ivory-dim mt-2 truncate">{factors[0]}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Reveal>

      {/* Two-column panels */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent likes */}
        <Reveal>
          <div className="glass rounded-3xl p-4 sm:p-6 h-full min-w-0">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="font-display text-xl text-ivory">New likes</h2>
              <Link to="/likes" className="text-sm text-rosegold hover:text-champagne shrink-0">
                View all →
              </Link>
            </div>
            {data.recentLikes.length === 0 ? (
              <p className="text-sm text-mist">
                No new likes yet. Keep your profile fresh — great photos and a thoughtful bio help.
              </p>
            ) : (
              <div className="space-y-3">
                {data.recentLikes.map(({ like, profile }) =>
                  profile ? (
                    <div key={like.id} className="flex items-center gap-3">
                      <Avatar name={profile.firstName} photo={profile.photos[0]} size={46} />
                      <div className="flex-1 min-w-0">
                        <p className="text-ivory text-sm font-medium truncate">
                          {profile.firstName}, {profile.age} · {profile.city}
                        </p>
                        <p className="text-xs text-mist">{timeAgo(like.createdAt)}</p>
                      </div>
                      <button
                        onClick={() => likeBack(profile.id)}
                        className="btn-ghost rounded-full px-4 min-h-[40px] text-xs shrink-0"
                      >
                        Like back
                      </button>
                    </div>
                  ) : null,
                )}
              </div>
            )}
          </div>
        </Reveal>

        {/* Notifications */}
        <Reveal delay={0.08}>
          <div className="glass rounded-3xl p-4 sm:p-6 h-full min-w-0">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="font-display text-xl text-ivory">Notifications</h2>
              <Link to="/notifications" className="text-sm text-rosegold hover:text-champagne shrink-0">
                View all →
              </Link>
            </div>
            {data.unreadNotifs.length === 0 ? (
              <p className="text-sm text-mist">You're all caught up.</p>
            ) : (
              <div className="space-y-3">
                {data.unreadNotifs.map((n) => (
                  <Link key={n.id} to={n.link ?? "/notifications"} className="block">
                    <div className="flex gap-3 items-start">
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-rosegold shrink-0" />
                      <div className="min-w-0">
                        <p className="text-ivory text-sm font-medium">{n.title}</p>
                        <p className="text-xs text-mist truncate">{n.body}</p>
                        <p className="text-[0.7rem] text-mist/70 mt-0.5">{timeAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </Reveal>

        {/* Membership */}
        <Reveal>
          <div className="glass rounded-3xl p-4 sm:p-6 h-full min-w-0 relative overflow-hidden">
            <div className="absolute -bottom-20 -left-20 h-52 w-52 rounded-full bg-rosegold/10 blur-[90px]" />
            <div className="relative">
              <div className="flex items-center justify-between gap-2 mb-4">
                <h2 className="font-display text-xl text-ivory">Membership</h2>
                <Link to="/membership" className="text-sm text-rosegold hover:text-champagne shrink-0">
                  Manage →
                </Link>
              </div>
              {data.plan && data.sub ? (
                <div>
                  <div className="flex items-center gap-3 flex-wrap">
                    <PlanBadge plan={data.plan.id as "connect" | "plus" | "elite"} />
                    <span className="text-sm text-ivory-dim">{data.plan.tagline}</span>
                  </div>
                  <p className="text-sm text-mist mt-3">
                    Active {data.sub.expiresAt ? "until " : ""}
                    <span className="text-ivory">
                      {fmtExpiry(data.sub.expiresAt)}
                    </span>
                    {data.sub.autoRenew ? " · auto-renews" : " · auto-renew off"}
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-ivory-dim">
                    You're on the <span className="text-ivory">Free</span> plan. Upgrade for
                    priority matchmaking, enhanced visibility and exclusive experiences.
                  </p>
                  <div className="flex flex-wrap gap-2.5 sm:gap-3 mt-4 text-sm">
                    {PLANS.map((p) => (
                      <Link
                        key={p.id}
                        to="/membership"
                        className="btn-ghost rounded-full px-4 py-2 min-h-[40px] inline-flex items-center"
                      >
                        {p.name} · {inr(p.price)}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Reveal>

        {/* Applications + bookings */}
        <Reveal delay={0.08}>
          <div className="glass rounded-3xl p-4 sm:p-6 h-full min-w-0">
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 className="font-display text-xl text-ivory">Date experiences</h2>
              <Link to="/experiences" className="text-sm text-rosegold hover:text-champagne shrink-0">
                View all →
              </Link>
            </div>
            {data.apps.length === 0 && data.upcoming.length === 0 ? (
              <p className="text-sm text-mist">
                No applications or bookings yet.{" "}
                <Link to="/experiences" className="text-rosegold hover:text-champagne">
                  Explore curated experiences →
                </Link>
              </p>
            ) : (
              <div className="space-y-3">
                {data.apps.map(({ app: a, exp }) => {
                  const meta = APP_STATUS_META[a.status];
                  return (
                    <div key={a.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-ivory text-sm font-medium truncate">
                          {exp?.title ?? "Experience"}
                        </p>
                        <p className="text-xs text-mist">
                          {a.slotDate} · {a.slotTime}
                        </p>
                      </div>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                    </div>
                  );
                })}
                {data.upcoming.map(({ booking: b, exp }) => {
                  return (
                    <div key={b.id} className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-ivory text-sm font-medium truncate">
                          ✦ {exp?.title ?? "Booked date"} — {b.venue}
                        </p>
                        <p className="text-xs text-mist">
                          {b.date} · {b.time}
                        </p>
                      </div>
                      <Badge tone="gold">Upcoming</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </Reveal>
      </div>
      {limitHit && (
        <LimitReachedModal open={true} kind="likes" onClose={() => setLimitHit(false)} />
      )}
    </div>
  );
}
