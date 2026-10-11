import { useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import type { Subscription, UserProfile } from "../../lib/types";
import { PLANS } from "../../data/seed";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Badge, EmptyState, PlanBadge, SectionHead, Skeleton, Stat } from "../../components/ui";
import { fmtDay, inr } from "./_util";

interface SubRow {
  user: UserProfile;
  sub: Subscription | undefined;
}

export default function Memberships() {
  const { session } = useAuth();
  const db = useBackend();

  const { data: plans, loading: pLoading } = useAsync((b) => b.listPlans(), [db], PLANS);
  const { data: all, loading: uLoading, error, refresh } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );

  useEffect(() => db.subscribe("profiles", refresh), [db, refresh]);

  const users = useMemo(
    () => all.filter((u) => u.id !== session?.userId),
    [all, session],
  );

  const { data: rowsRaw, loading: sLoading, refresh: refreshSubs } = useAsync(
    (b) =>
      Promise.all(
        users.map(async (u) => ({ user: u, sub: await b.activeSubscription(u.id) })),
      ),
    [db, users],
    [] as SubRow[],
  );

  useEffect(() => {
    const off1 = db.subscribe("subscriptions", refreshSubs);
    const off2 = db.subscribe("payments", refreshSubs);
    return () => {
      off1();
      off2();
    };
  }, [db, refreshSubs]);

  const subs = useMemo(
    () =>
      rowsRaw
        .filter((x): x is { user: UserProfile; sub: Subscription } => !!x.sub)
        .sort((a, b) => (a.sub.expiresAt ?? "").localeCompare(b.sub.expiresAt ?? "")),
    [rowsRaw],
  );

  const loading = pLoading || uLoading || sLoading;

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Plans & subscriptions"
          title="Memberships"
          sub="Select ₹499 · Signature ₹799 · Privé ₹1,199. Membership never guarantees a match, date or romantic outcome."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load members: {error}</p>}

        {loading ? (
          <div className="grid grid-cols-3 gap-4 mt-10">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mt-10">
              {plans.map((p) => {
                const count = users.filter((u) => u.plan === p.id).length;
                return (
                  <motion.div
                    key={p.id}
                    initial={{ opacity: 0, y: 24 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    className="glass rounded-3xl p-6 card-hover"
                  >
                    <PlanBadge plan={p.id} />
                    <p className="font-display text-4xl mt-3 text-gradient-gold">{inr(p.price)}</p>
                    <p className="text-xs text-mist mt-1">per month</p>
                    <p className="text-sm text-ivory-dim mt-3">{p.tagline}</p>
                    <ul className="mt-4 space-y-2 text-sm text-ivory-dim">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-2">
                          <span className="text-champagne">✦</span> {f}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-5 text-sm text-ivory">
                      <span className="font-display text-2xl text-ivory">{count}</span>{" "}
                      <span className="text-mist">members</span>
                    </p>
                  </motion.div>
                );
              })}
            </div>

            <div className="glass rounded-2xl p-5 mt-6 flex gap-4 items-start">
              <span className="text-2xl">🛠</span>
              <div className="text-sm text-ivory-dim leading-relaxed">
                <p className="text-ivory font-medium">Editing plans</p>
                <p>
                  Plans are configured in the production <code className="text-champagne">membership_plans</code>{" "}
                  table in Supabase (prices, features, priority weights). Changes there take effect
                  everywhere — pricing cards, checkout and this dashboard. This view renders the
                  live plan records.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
              <Stat label="Active subscriptions" value={subs.length} sub="paying members" />
              <Stat
                label="MRR"
                value={inr(subs.reduce((s, x) => s + (plans.find((p) => p.id === x.sub.planId)?.price ?? 0), 0))}
                sub="monthly recurring revenue"
              />
              <Stat
                label="Expiring soon"
                value={subs.filter((x) => x.sub.expiresAt != null && new Date(x.sub.expiresAt).getTime() - Date.now() < 7 * 864e5).length}
                sub="within 7 days"
              />
              <Stat label="Free members" value={users.filter((u) => !u.plan).length} sub="not subscribed" />
            </div>

            <div className="glass rounded-3xl mt-8 overflow-hidden">
              <h3 className="font-display text-xl text-ivory px-6 pt-6">Active subscriptions</h3>
              {subs.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No active subscriptions" body="Verified membership payments activate subscriptions automatically." />
                </div>
              ) : (
                <div className="overflow-x-auto mt-2">
                  <table className="w-full text-sm min-w-[640px]">
                    <tbody>
                      {subs.map(({ user, sub }) => (
                        <tr key={sub.id} className="border-t border-white/5">
                          <td className="px-6 py-4">
                            <p className="text-ivory font-medium">{user.firstName}</p>
                            <p className="text-xs text-mist">{user.email}</p>
                          </td>
                          <td className="px-6 py-4">
                            <PlanBadge plan={sub.planId} />
                          </td>
                          <td className="px-6 py-4 text-ivory-dim">
                            {sub.autoRenew ? <Badge tone="green">auto-renew</Badge> : <Badge tone="muted">manual</Badge>}
                          </td>
                          <td className="px-6 py-4 text-mist whitespace-nowrap">
                            renews {fmtDay(sub.expiresAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
