import { useEffect, useMemo, useState } from "react";
import type { Report, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Avatar, Badge, EmptyState, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDate, rowCls, tdCls, thCls } from "./_util";

const STATUS_TONES: Record<Report["status"], "rose" | "gold" | "green" | "muted"> = {
  open: "rose",
  reviewing: "gold",
  resolved: "green",
  dismissed: "muted",
};

export default function Reports() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [statusFilter, setStatusFilter] = useState("all");
  const actor = session?.userId ?? "admin-1";

  const { data: reportsRaw, loading, error, refresh: refreshReports } = useAsync(
    (b) => b.listReports(),
    [db],
    [] as Report[],
  );
  const { data: all, refresh: refreshUsers } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );

  useEffect(() => {
    const off1 = db.subscribe("reports", refreshReports);
    const off2 = db.subscribe("profiles", refreshUsers);
    return () => {
      off1();
      off2();
    };
  }, [db, refreshReports, refreshUsers]);

  const userMap = useMemo(() => new Map(all.map((u) => [u.id, u])), [all]);

  const reports = reportsRaw.filter(
    (r) => statusFilter === "all" || r.status === statusFilter,
  );

  const setStatus = async (id: string, status: Report["status"]) => {
    try {
      await db.setReportStatus(id, status);
      refreshReports();
      toast(`Report marked as ${status}`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update report", "rose");
    }
  };

  const quickBlock = async (reportedId: string, reportId: string) => {
    const reported = userMap.get(reportedId);
    if (!reported) return;
    if (!window.confirm(`Block ${reported.firstName} from the platform? This dissolves any match.`))
      return;
    try {
      await db.blockUser(actor, reportedId);
      await db.setReportStatus(reportId, "resolved");
      refreshReports();
      toast(`${reported.firstName} blocked`, "rose");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not block user", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Trust & safety"
          title="Reports & Complaints"
          sub="Member-filed complaints. Investigate, resolve, and escalate where safety is at stake."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load reports: {error}</p>}

        <div className="mt-8 glass rounded-2xl p-4 flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${inputCls} max-w-xs`}
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="reviewing">Reviewing</option>
            <option value="resolved">Resolved</option>
            <option value="dismissed">Dismissed</option>
          </select>
          <span className="text-sm text-mist">{reports.length} reports</span>
        </div>

        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : reports.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No reports here" body="Community complaints will appear in this queue." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr>
                    <th className={thCls}>Reporter</th>
                    <th className={thCls}>Reported</th>
                    <th className={thCls}>Reason</th>
                    <th className={thCls}>Details</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Filed</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const reporter = userMap.get(r.reporterId);
                    const reported = userMap.get(r.reportedId);
                    return (
                      <tr key={r.id} className={rowCls}>
                        <td className={tdCls}>
                          <div className="flex items-center gap-2">
                            <Avatar name={reporter?.firstName ?? "?"} size={32} />
                            <span className="text-ivory whitespace-nowrap">
                              {reporter?.firstName ?? "Unknown"}
                            </span>
                          </div>
                        </td>
                        <td className={tdCls}>
                          <div className="flex items-center gap-2">
                            <Avatar name={reported?.firstName ?? "?"} size={32} />
                            <span className="text-ivory whitespace-nowrap">
                              {reported?.firstName ?? "Unknown"}
                            </span>
                          </div>
                        </td>
                        <td className={`${tdCls} text-champagne whitespace-nowrap`}>{r.reason}</td>
                        <td className={`${tdCls} text-ivory-dim max-w-[220px]`}>
                          <p className="line-clamp-2">{r.details}</p>
                        </td>
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONES[r.status]}>{r.status}</Badge>
                        </td>
                        <td className={`${tdCls} text-mist whitespace-nowrap`}>{fmtDate(r.createdAt)}</td>
                        <td className={tdCls}>
                          <div className="flex gap-1.5 flex-wrap">
                            {r.status === "open" && (
                              <button
                                onClick={() => setStatus(r.id, "reviewing")}
                                className="text-xs text-champagne hover:text-rosegold whitespace-nowrap"
                              >
                                Start review
                              </button>
                            )}
                            {(r.status === "open" || r.status === "reviewing") && (
                              <>
                                <button
                                  onClick={() => setStatus(r.id, "resolved")}
                                  className="text-xs text-emerald-300 hover:text-emerald-200 whitespace-nowrap"
                                >
                                  Resolve
                                </button>
                                <button
                                  onClick={() => setStatus(r.id, "dismissed")}
                                  className="text-xs text-mist hover:text-ivory whitespace-nowrap"
                                >
                                  Dismiss
                                </button>
                                <button
                                  onClick={() => quickBlock(r.reportedId, r.id)}
                                  className="text-xs text-rosegold hover:text-champagne whitespace-nowrap"
                                >
                                  Block user
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
