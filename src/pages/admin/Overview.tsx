import { useEffect } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useAsync, useBackend } from "../../lib/data";
import type { ActivityLog } from "../../lib/types";
import { EmptyState, SectionHead, Skeleton, Stat } from "../../components/ui";
import { fmtDate, inr, rowCls, tdCls, thCls } from "./_util";

const EMPTY_SUMMARY = {
  membership: 0,
  experience: 0,
  cash: 0,
  refunded: 0,
  cafeCommissions: 0,
  total: 0,
  payments: 0,
  activeSubscriptions: 0,
  totalUsers: 0,
  totalMatches: 0,
  pendingApplications: 0,
};

export default function Overview() {
  const db = useBackend();
  const {
    data: s,
    loading: sLoading,
    error: sError,
    refresh: refreshSummary,
  } = useAsync((b) => b.revenueSummary(), [db], EMPTY_SUMMARY);
  const {
    data: activityRaw,
    loading: aLoading,
    refresh: refreshActivity,
  } = useAsync((b) => b.listActivity(), [db], [] as ActivityLog[]);

  useEffect(() => {
    const off1 = db.subscribe("payments", () => {
      refreshSummary();
      refreshActivity();
    });
    const off2 = db.subscribe("activity", refreshActivity);
    return () => {
      off1();
      off2();
    };
  }, [db, refreshSummary, refreshActivity]);

  const activity = activityRaw.slice(0, 8);

  const split = [
    { label: "Membership", value: s.membership, cls: "from-champagne/80 to-rosegold/80" },
    { label: "Experiences", value: s.experience, cls: "from-rosegold/80 to-burgundy-soft/80" },
    { label: "Cash", value: s.cash, cls: "from-mist/70 to-mist/40" },
  ];
  const max = Math.max(1, ...split.map((x) => x.value));

  const shortcuts = [
    { to: "/admin/applications", label: "Review applications", count: s.pendingApplications },
    { to: "/admin/payments", label: "Verify payments", count: s.payments },
    { to: "/admin/reports", label: "Moderate reports", count: null as number | null },
    { to: "/admin/verification", label: "Verify profiles", count: null as number | null },
  ];

  if (sLoading || aLoading) {
    return (
      <div className="px-5 pb-24 pt-10 md:pt-14">
        <div className="max-w-6xl mx-auto">
          <SectionHead
            kicker="Datevra Control Room"
            title="Platform Overview"
            sub="Loading live operational data…"
            align="left"
          />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Datevra Control Room"
          title="Platform Overview"
          sub="Live operational pulse — revenue, people, matches and items that need your attention."
          align="left"
        />
        {sError && (
          <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load summary: {sError}</p>
        )}

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
          <Stat label="Total revenue" value={inr(s.total)} sub="verified payments" />
          <Stat label="Membership revenue" value={inr(s.membership)} sub="Select · Signature · Privé" />
          <Stat label="Active subscriptions" value={s.activeSubscriptions} sub="paying members" />
          <Stat label="Members" value={s.totalUsers} sub="registered profiles" />
          <Stat label="Mutual matches" value={s.totalMatches} sub="both sides said yes" />
          <Stat label="Applications pending" value={s.pendingApplications} sub="curated experiences" />
          <Stat label="Payments recorded" value={s.payments} sub="all-time transactions" />
          <Stat label="Café commissions" value={inr(s.cafeCommissions)} sub="partner revenue share" />
        </div>

        <div className="grid lg:grid-cols-5 gap-6 mt-8">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass rounded-3xl p-6 lg:col-span-2"
          >
            <h3 className="font-display text-xl text-ivory">Revenue split</h3>
            <p className="text-xs text-mist mt-1">Verified payments by channel</p>
            <div className="mt-6 space-y-4">
              {split.map((x) => (
                <div key={x.label}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-ivory-dim">{x.label}</span>
                    <span className="text-champagne font-medium">{inr(x.value)}</span>
                  </div>
                  <div className="h-2.5 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, (x.value / max) * 100)}%` }}
                      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                      className={`h-full rounded-full bg-gradient-to-r ${x.cls}`}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-6 pt-4 border-t border-white/10">
              <div className="flex justify-between text-sm">
                <span className="text-ivory-dim">Refunded</span>
                <span className="text-ivory-dim">{inr(s.refunded)}</span>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="glass rounded-3xl p-6 lg:col-span-3"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl text-ivory">Pending actions</h3>
              <span className="text-xs text-mist">shortcuts</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3 mt-5">
              {shortcuts.map((q) => (
                <Link
                  key={q.to}
                  to={q.to}
                  className="glass rounded-2xl p-4 card-hover flex items-center justify-between group"
                >
                  <span className="text-ivory">{q.label}</span>
                  <span className="flex items-center gap-2">
                    {q.count !== null && (
                      <span className="text-xs font-medium rounded-full bg-rosegold/15 border border-rosegold/40 text-rosegold px-2.5 py-1">
                        {q.count}
                      </span>
                    )}
                    <span className="text-champagne group-hover:translate-x-1 transition-transform">→</span>
                  </span>
                </Link>
              ))}
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14 }}
          className="glass rounded-3xl mt-8 overflow-hidden"
        >
          <div className="flex items-center justify-between px-6 pt-6">
            <h3 className="font-display text-xl text-ivory">Recent activity</h3>
            <Link to="/admin/activity" className="text-sm text-champagne hover:text-rosegold">
              View all →
            </Link>
          </div>
          {activity.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nothing yet" body="Admin actions will appear here as they happen." />
            </div>
          ) : (
            <div className="overflow-x-auto mt-2">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    <th className={thCls}>Time</th>
                    <th className={thCls}>Action</th>
                    <th className={thCls}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {activity.map((a) => (
                    <tr key={a.id} className={rowCls}>
                      <td className={`${tdCls} whitespace-nowrap text-mist`}>{fmtDate(a.createdAt)}</td>
                      <td className={`${tdCls} whitespace-nowrap text-rosegold font-mono text-xs`}>{a.action}</td>
                      <td className={`${tdCls} text-ivory-dim`}>{a.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
