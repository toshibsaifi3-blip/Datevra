import { useEffect } from "react";
import type { Cafe } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { EmptyState, SectionHead, Skeleton, Stat, inputCls, useToast } from "../../components/ui";
import { inr, rowCls, tdCls, thCls } from "./_util";
import { isDemoCafe } from "../../lib/cafeFilter";

export default function Partnerships() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  const { data: cafes, loading, error, refresh } = useAsync(
    (b) => b.listCafes(),
    [db],
    [] as Cafe[],
  );

  useEffect(() => db.subscribe("cafes", refresh), [db, refresh]);

  const partners = cafes.filter((c) => c.partner && !isDemoCafe(c));
  const totalDue = partners.reduce((s, c) => s + Math.round((c.revenue * c.commissionPct) / 100), 0);

  const saveField = async (cafe: Cafe, patch: Partial<Cafe>) => {
    try {
      await db.upsertCafe({ ...cafe, ...patch }, actor);
      refresh();
      toast(`${cafe.name} partnership updated`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update partnership", "rose");
    }
  };

  const downloadReport = () => {
    const header = "Café,City,Agreement,Commission %,Total bookings,Revenue (₹),Commission due (₹)\n";
    const rows = partners
      .map((c) =>
        [
          `"${c.name.replace(/"/g, '""')}"`,
          c.city,
          c.agreementRef ?? "",
          c.commissionPct,
          c.totalBookings,
          c.revenue,
          Math.round((c.revenue * c.commissionPct) / 100),
        ].join(","),
      )
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `datevra-partnerships-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("Partnership report downloaded", "gold");
  };

  return (
    <div className="px-0 sm:px-5 pb-16 sm:pb-24 pt-4 sm:pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Venue network"
          title="Café Partnerships"
          sub="Signed agreements, commission terms and per-partner performance. Export for the finance team."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load partnerships: {error}</p>}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 sm:mt-10">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8 sm:mt-10">
              <Stat label="Active partners" value={partners.length} sub="signed agreements" />
              <Stat label="Partner revenue" value={inr(partners.reduce((s, c) => s + c.revenue, 0))} sub="via Datevra bookings" />
              <Stat label="Commission due" value={inr(totalDue)} sub="unsettled estimate" />
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={downloadReport}
                disabled={partners.length === 0}
                className="btn-ghost rounded-xl px-5 py-3 text-sm w-full sm:w-auto min-h-[44px] disabled:opacity-40"
              >
                ⬇ Generate report (CSV)
              </button>
            </div>

            <div className="glass rounded-3xl mt-4 overflow-hidden">
              {partners.length === 0 ? (
                <div className="p-6">
                  <EmptyState title="No partners" body="Promote a café to partner status in Café Management." />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[920px]">
                    <thead>
                      <tr>
                        <th className={thCls}>Café</th>
                        <th className={thCls}>Agreement ref</th>
                        <th className={thCls}>Commission %</th>
                        <th className={thCls}>Bookings</th>
                        <th className={thCls}>Revenue</th>
                        <th className={thCls}>Due</th>
                        <th className={thCls}>Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {partners.map((c) => {
                        const due = Math.round((c.revenue * c.commissionPct) / 100);
                        return (
                          <tr key={c.id} className={rowCls}>
                            <td className={tdCls}>
                              <p className="text-ivory font-medium">{c.name}</p>
                              <p className="text-xs text-mist">{c.city}</p>
                            </td>
                            <td className={tdCls}>
                              <input
                                key={`ref-${c.id}-${c.agreementRef}`}
                                defaultValue={c.agreementRef ?? ""}
                                placeholder="CAFE-2026-…"
                                className={`${inputCls} !py-1.5 text-xs font-mono min-w-[140px]`}
                                onBlur={(e) => {
                                  if (e.target.value.trim() !== (c.agreementRef ?? ""))
                                    saveField(c, { agreementRef: e.target.value.trim() || null });
                                }}
                              />
                            </td>
                            <td className={tdCls}>
                              <span className="text-ivory-dim font-medium text-xs">
                                {c.commissionPct != null ? `${c.commissionPct}%` : "Fixed"}
                              </span>
                            </td>
                            <td className={`${tdCls} text-ivory-dim`}>{c.totalBookings}</td>
                            <td className={`${tdCls} text-ivory-dim whitespace-nowrap`}>{inr(c.revenue)}</td>
                            <td className={`${tdCls} text-rosegold font-medium whitespace-nowrap`}>{inr(due)}</td>
                            <td className={`${tdCls} text-mist whitespace-nowrap max-w-[200px]`}>
                              <p className="line-clamp-1">{c.openingHours || "—"}</p>
                            </td>
                          </tr>
                        );
                      })}
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
