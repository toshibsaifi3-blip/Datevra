import { useEffect } from "react";
import { motion } from "framer-motion";
import { useAsync, useBackend } from "../../lib/data";
import { SectionHead, Skeleton, Stat } from "../../components/ui";
import { inr } from "./_util";

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

export default function Analytics() {
  const db = useBackend();
  const { data: s, loading, error, refresh } = useAsync(
    (b) => b.revenueSummary(),
    [db],
    EMPTY_SUMMARY,
  );

  useEffect(() => db.subscribe("payments", refresh), [db, refresh]);

  const bars = [
    { label: "Membership", value: s.membership, cls: "from-champagne/90 to-rosegold/80", note: "Connect · Plus · Elite" },
    { label: "Experiences", value: s.experience, cls: "from-rosegold/90 to-burgundy-soft/80", note: "curated date bookings" },
    { label: "Cash", value: s.cash, cls: "from-mist/80 to-mist/40", note: "admin-recorded counter payments" },
  ];
  const max = Math.max(1, ...bars.map((b) => b.value));

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Financial intelligence"
          title="Revenue Analytics"
          sub="All-time figures from verified payments and partner records. Demo data — wire to live tables before launch."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load analytics: {error}</p>}

        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
              <Stat label="Total revenue" value={inr(s.total)} sub="verified payments" />
              <Stat label="Membership" value={inr(s.membership)} sub="recurring base" />
              <Stat label="Experiences" value={inr(s.experience)} sub="date-experience fees" />
              <Stat label="Cash (counter)" value={inr(s.cash)} sub="admin-recorded" />
              <Stat label="Refunded" value={inr(s.refunded)} sub="kept in history" />
              <Stat label="Café commissions" value={inr(s.cafeCommissions)} sub="partner revenue share" />
              <Stat label="Net after refunds" value={inr(s.total - s.refunded)} sub="verified minus refunds" />
              <Stat label="Payments" value={s.payments} sub="total transactions" />
            </div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="glass rounded-3xl p-6 md:p-8 mt-8"
            >
              <h3 className="font-display text-xl text-ivory">Revenue by channel</h3>
              <p className="text-xs text-mist mt-1">All-time verified payments</p>
              <div className="mt-8 space-y-6">
                {bars.map((b) => (
                  <div key={b.label}>
                    <div className="flex justify-between items-baseline mb-2">
                      <div>
                        <p className="text-ivory">{b.label}</p>
                        <p className="text-xs text-mist">{b.note}</p>
                      </div>
                      <p className="font-display text-2xl text-gradient-gold">{inr(b.value)}</p>
                    </div>
                    <div className="h-3 rounded-full bg-white/5 overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        whileInView={{ width: `${Math.max(3, (b.value / max) * 100)}%` }}
                        viewport={{ once: true }}
                        transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
                        className={`h-full rounded-full bg-gradient-to-r ${b.cls}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>

            <div className="grid lg:grid-cols-2 gap-6 mt-8">
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="glass rounded-3xl p-6"
              >
                <h3 className="font-display text-xl text-ivory">Platform health</h3>
                <dl className="mt-5 space-y-3 text-sm">
                  {[
                    ["Registered members", String(s.totalUsers)],
                    ["Active subscriptions", String(s.activeSubscriptions)],
                    ["Mutual matches", String(s.totalMatches)],
                    ["Applications awaiting review", String(s.pendingApplications)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-t border-white/5 pt-3">
                      <dt className="text-ivory-dim">{k}</dt>
                      <dd className="text-champagne font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                className="glass rounded-3xl p-6"
              >
                <h3 className="font-display text-xl text-ivory">Money-out overview</h3>
                <dl className="mt-5 space-y-3 text-sm">
                  {[
                    ["Refunds issued", inr(s.refunded)],
                    ["Café commissions due", inr(s.cafeCommissions)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between border-t border-white/5 pt-3">
                      <dt className="text-ivory-dim">{k}</dt>
                      <dd className="text-rosegold font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-xs text-mist mt-5 leading-relaxed">
                  Commissions are computed from partner café revenue × agreed percentage and settled
                  from the Partnerships page. Investor payouts live under Investors.
                </p>
              </motion.div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
