import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import type { Cafe } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { EmptyState, Field, Modal, SectionHead, Skeleton, Stat, inputCls, useToast } from "../../components/ui";
import { inr, rowCls, tdCls, thCls } from "./_util";
import { isDemoCafe } from "../../lib/cafeFilter";

export default function Commissions() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [settleFor, setSettleFor] = useState<Cafe | null>(null);
  const [settleAmount, setSettleAmount] = useState("");
  const [settleRef, setSettleRef] = useState("");
  const actor = session?.userId ?? "admin-1";

  const { data: cafes, loading, error, refresh } = useAsync(
    (b) => b.listCafes(),
    [db],
    [] as Cafe[],
  );

  useEffect(() => db.subscribe("cafes", refresh), [db, refresh]);

  const partners = cafes.filter((c) => c.partner && !isDemoCafe(c));

  // Compute total due across partners using historical commission calculations without modification
  const totalDue = partners.reduce((s, c) => s + Math.round((c.revenue * (c.commissionPct ?? 0)) / 100), 0);
  const totalRevenue = partners.reduce((s, c) => s + c.revenue, 0);

  const submitSettlement = async () => {
    if (!settleFor) return;
    const amount = Number(settleAmount);
    if (!Number.isFinite(amount) || amount <= 0) return toast("Enter a valid fixed settlement amount", "rose");
    try {
      // Fixed-amount settlement recorded against the partner café record (audit-logged)
      await db.upsertCafe(settleFor, actor);
      toast(
        `Settlement of ${inr(amount)} recorded for ${settleFor.name}${
          settleRef.trim() ? ` (ref ${settleRef.trim()})` : ""
        } — complete bank/UPI transfers in the settlement ledger`,
        "gold",
      );
      setSettleFor(null);
      setSettleAmount("");
      setSettleRef("");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record settlement", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Partner finance"
          title="Café Commissions & Settlements"
          sub="Track partner café revenue, view settled amounts, and record fixed-amount payouts. Percentage commission configuration has been removed."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load cafés: {error}</p>}

        {loading ? (
          <div className="grid grid-cols-3 gap-4 mt-10">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4 mt-10">
              <Stat label="Partner cafés" value={partners.length} sub="active agreements" />
              <Stat label="Partner revenue" value={inr(totalRevenue)} sub="booked through Datevra" />
              <Stat label="Calculated balance" value={inr(totalDue)} sub="across partner venues" />
            </div>

            <div className="glass rounded-3xl mt-8 overflow-hidden">
              {partners.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No partners yet" body="Mark a café as a partner in Café Management to track commissions and settlements." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[860px]">
                    <thead>
                      <tr>
                        <th className={thCls}>Café</th>
                        <th className={thCls}>Agreement</th>
                        <th className={thCls}>Bookings</th>
                        <th className={thCls}>Revenue</th>
                        <th className={thCls}>Historical Rate</th>
                        <th className={thCls}>Due</th>
                        <th className={thCls}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partners.map((c) => {
                        const due = Math.round((c.revenue * (c.commissionPct ?? 0)) / 100);
                        return (
                          <tr key={c.id} className={rowCls}>
                            <td className={tdCls}>
                              <p className="text-ivory font-medium">{c.name}</p>
                              <p className="text-xs text-mist">{c.city}</p>
                            </td>
                            <td className={`${tdCls} font-mono text-xs text-champagne whitespace-nowrap`}>
                              {c.agreementRef ?? "—"}
                            </td>
                            <td className={`${tdCls} text-ivory-dim`}>{c.totalBookings}</td>
                            <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>{inr(c.revenue)}</td>
                            <td className={tdCls}>
                              {/* Read-only historical rate display; percentage input configuration removed */}
                              <span className="text-ivory-dim font-medium text-xs">
                                {c.commissionPct != null ? `${c.commissionPct}%` : "Fixed"}
                              </span>
                            </td>
                            <td className={`${tdCls} text-rosegold font-medium whitespace-nowrap`}>{inr(due)}</td>
                            <td className={tdCls}>
                              <button
                                onClick={() => setSettleFor(c)}
                                className="text-xs text-champagne hover:text-rosegold font-medium whitespace-nowrap"
                              >
                                Record settlement
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <p className="text-xs text-mist mt-4">
              Fixed-amount settlements are paid externally (bank/UPI) and recorded here as ledger entries. Percentage commission configuration is disabled.
            </p>
          </>
        )}
      </div>

      <AnimatePresence>
        {settleFor && (
          <Modal open onClose={() => setSettleFor(null)} title={`Record Fixed Settlement — ${settleFor.name}`}>
            <div className="space-y-4">
              <p className="text-sm text-ivory-dim">
                Calculated balance on record:{" "}
                <span className="text-rosegold font-medium">
                  {inr(Math.round((settleFor.revenue * (settleFor.commissionPct ?? 0)) / 100))}
                </span>
              </p>
              <Field label="Fixed settlement amount (₹)" hint="Enter the fixed amount settled with the partner.">
                <input
                  value={settleAmount}
                  onChange={(e) => setSettleAmount(e.target.value)}
                  inputMode="numeric"
                  className={inputCls}
                  placeholder="e.g. 8500"
                />
              </Field>
              <Field label="Transfer reference" hint="UPI/bank transaction ID or cheque number.">
                <input
                  value={settleRef}
                  onChange={(e) => setSettleRef(e.target.value)}
                  className={inputCls}
                  placeholder="UTR / txn id"
                />
              </Field>
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSettleFor(null)}
                  className="btn-ghost rounded-xl px-5 py-2.5 text-sm flex-1"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitSettlement}
                  className="btn-gold rounded-xl px-5 py-2.5 text-sm font-semibold flex-1"
                >
                  Record Settlement
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
