import { useEffect, useMemo, useState } from "react";
import {
  Search,
  Clock,
  RotateCcw,
  Eye,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ShieldAlert,
  ArrowUpDown,
  Copy,
  Check,
  User,
  MapPin,
} from "lucide-react";
import type { Report, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import {
  Avatar,
  Badge,
  EmptyState,
  Modal,
  SectionHead,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { fmtDate, rowCls, tdCls, thCls, timeAgo } from "./_util";

const STATUS_TONES: Record<Report["status"], "rose" | "gold" | "green" | "muted"> = {
  open: "rose",
  reviewing: "gold",
  resolved: "green",
  dismissed: "muted",
};

const ITEMS_PER_PAGE = 10;

type SortField = "createdAt" | "reason" | "status";
type SortOrder = "asc" | "desc";

interface ConfirmActionState {
  report: Report;
  targetStatus: Report["status"];
  title: string;
  description: string;
  confirmLabel: string;
  tone: "gold" | "rose" | "green";
}

export default function Reports() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  // Modal states
  const [inspectReport, setInspectReport] = useState<Report | null>(null);
  const [confirmModal, setConfirmModal] = useState<ConfirmActionState | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // In-flight tracking to prevent double-submissions
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());

  // Data fetching
  const {
    data: reportsRaw,
    loading: reportsLoading,
    error: reportsError,
    refresh: refreshReports,
  } = useAsync((b) => b.listReports(), [db], [] as Report[]);

  const {
    data: allUsersRaw,
    refresh: refreshUsers,
  } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => {
    const off1 = db.subscribe("reports", refreshReports);
    const off2 = db.subscribe("profiles", refreshUsers);
    return () => {
      off1();
      off2();
    };
  }, [db, refreshReports, refreshUsers]);

  const userMap = useMemo(() => new Map(allUsersRaw.map((u) => [u.id, u])), [allUsersRaw]);

  // Extract unique reason categories for filtering
  const availableReasons = useMemo(() => {
    const set = new Set<string>();
    for (const r of reportsRaw) {
      if (r.reason && r.reason.trim()) set.add(r.reason.trim());
    }
    return Array.from(set).sort();
  }, [reportsRaw]);

  // Tab counts for status pills
  const statusCounts = useMemo(() => {
    let open = 0;
    let reviewing = 0;
    let resolved = 0;
    let dismissed = 0;

    for (const r of reportsRaw) {
      if (r.status === "open") open++;
      else if (r.status === "reviewing") reviewing++;
      else if (r.status === "resolved") resolved++;
      else if (r.status === "dismissed") dismissed++;
    }

    return {
      all: reportsRaw.length,
      open,
      reviewing,
      resolved,
      dismissed,
    };
  }, [reportsRaw]);

  // Filter, search, and sort
  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return reportsRaw
      .filter((r) => {
        // Status filter
        if (statusFilter !== "all" && r.status !== statusFilter) return false;

        // Reason filter
        if (reasonFilter !== "all" && r.reason !== reasonFilter) return false;

        // Text search
        if (q) {
          const reporter = userMap.get(r.reporterId);
          const reported = userMap.get(r.reportedId);
          const reporterName = (reporter?.firstName || "").toLowerCase();
          const reportedName = (reported?.firstName || "").toLowerCase();
          const reasonMatch = (r.reason || "").toLowerCase().includes(q);
          const detailsMatch = (r.details || "").toLowerCase().includes(q);
          const idMatch = r.id.toLowerCase().includes(q);

          if (
            !reporterName.includes(q) &&
            !reportedName.includes(q) &&
            !reasonMatch &&
            !detailsMatch &&
            !idMatch
          ) {
            return false;
          }
        }

        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === "createdAt") {
          diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        } else if (sortField === "reason") {
          diff = a.reason.localeCompare(b.reason);
        } else if (sortField === "status") {
          diff = a.status.localeCompare(b.status);
        }
        return sortOrder === "asc" ? diff : -diff;
      });
  }, [reportsRaw, statusFilter, reasonFilter, searchQuery, sortField, sortOrder, userMap]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredReports.length / ITEMS_PER_PAGE));
  const paginatedReports = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredReports.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredReports, currentPage]);

  // Reset pagination on filter or search changes
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const handleStatusFilter = (st: string) => {
    setStatusFilter(st);
    setCurrentPage(1);
  };

  const handleReasonFilter = (rn: string) => {
    setReasonFilter(rn);
    setCurrentPage(1);
  };

  const handleSortToggle = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
    setCurrentPage(1);
  };

  // Status mutation with in-flight lock
  const executeStatusChange = async (reportId: string, newStatus: Report["status"]) => {
    if (submittingIds.has(reportId)) return;

    setSubmittingIds((prev) => new Set(prev).add(reportId));
    try {
      await db.setReportStatus(reportId, newStatus, actor);
      refreshReports();

      // If inspect modal is open on this report, keep its local status in sync
      if (inspectReport && inspectReport.id === reportId) {
        setInspectReport({ ...inspectReport, status: newStatus });
      }

      toast(`Report marked as ${newStatus}`, newStatus === "resolved" ? "gold" : "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update report status", "rose");
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(reportId);
        return next;
      });
      setConfirmModal(null);
    }
  };

  // Open confirmation modal for consequential transitions
  const requestResolve = (report: Report) => {
    const reported = userMap.get(report.reportedId);
    setConfirmModal({
      report,
      targetStatus: "resolved",
      title: "Resolve Community Report",
      description: `Mark this complaint regarding ${reported?.firstName ?? "the reported member"} as resolved? This records a formal resolution event in the administrative audit log.`,
      confirmLabel: "Mark as Resolved",
      tone: "green",
    });
  };

  const requestDismiss = (report: Report) => {
    const reported = userMap.get(report.reportedId);
    setConfirmModal({
      report,
      targetStatus: "dismissed",
      title: "Dismiss Community Report",
      description: `Dismiss this complaint regarding ${reported?.firstName ?? "the reported member"}? This closes the report as unsubstantiated or duplicate.`,
      confirmLabel: "Dismiss Report",
      tone: "rose",
    });
  };

  const requestReopen = (report: Report) => {
    setConfirmModal({
      report,
      targetStatus: "reviewing",
      title: "Reopen Investigation",
      description:
        "Reopen this report for active review? The complaint will return to the active investigation queue and the transition will be recorded in the audit log.",
      confirmLabel: "Reopen for Review",
      tone: "gold",
    });
  };

  // Quick clipboard helper
  const copyId = (id: string, label: string) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    toast(`${label} copied to clipboard`, "gold");
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div>
          <SectionHead
            kicker="Trust & safety"
            title="Reports & Complaints"
            sub="Member-filed complaints. Investigate, resolve, and audit community safety issues."
            align="left"
          />
          {reportsError && (
            <div className="mt-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Could not load reports: {reportsError}</span>
            </div>
          )}
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-2 border-b hairline pb-4">
          <button
            type="button"
            onClick={() => handleStatusFilter("all")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all ${
              statusFilter === "all"
                ? "bg-champagne/20 text-champagne border border-champagne/40"
                : "text-mist hover:text-ivory bg-white/5 border border-white/5"
            }`}
          >
            All Reports ({statusCounts.all})
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("open")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "open"
                ? "bg-rose-500/25 text-rose-300 border border-rose-500/40"
                : "text-mist hover:text-rose-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>Open ({statusCounts.open})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("reviewing")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "reviewing"
                ? "bg-amber-500/25 text-amber-300 border border-amber-500/40"
                : "text-mist hover:text-amber-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>Reviewing ({statusCounts.reviewing})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("resolved")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "resolved"
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
                : "text-mist hover:text-emerald-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Resolved ({statusCounts.resolved})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("dismissed")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "dismissed"
                ? "bg-white/20 text-ivory border border-white/30"
                : "text-mist hover:text-ivory bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-mist" />
            <span>Dismissed ({statusCounts.dismissed})</span>
          </button>
        </div>

        {/* Filter and Search Bar */}
        <div className="glass rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 min-w-[260px]">
            <Search className="w-4 h-4 text-mist absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by reporter, reported member, reason, details..."
              className={`${inputCls} pl-10 w-full`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mist hover:text-ivory"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Reason filter */}
            <select
              value={reasonFilter}
              onChange={(e) => handleReasonFilter(e.target.value)}
              className={`${inputCls} text-xs py-2`}
            >
              <option value="all">All Reasons</option>
              {availableReasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>

            {/* Sort field selector */}
            <div className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-xl px-2 py-1">
              <span className="text-[0.7rem] text-mist uppercase tracking-wider pl-1">Sort:</span>
              <button
                type="button"
                onClick={() => handleSortToggle("createdAt")}
                className={`px-2 py-1 rounded-lg text-xs transition-colors flex items-center gap-1 ${
                  sortField === "createdAt" ? "text-champagne font-medium" : "text-mist hover:text-ivory"
                }`}
              >
                <span>Date</span>
                {sortField === "createdAt" && (
                  <ArrowUpDown className="w-3 h-3 text-champagne" />
                )}
              </button>
              <button
                type="button"
                onClick={() => handleSortToggle("reason")}
                className={`px-2 py-1 rounded-lg text-xs transition-colors flex items-center gap-1 ${
                  sortField === "reason" ? "text-champagne font-medium" : "text-mist hover:text-ivory"
                }`}
              >
                <span>Reason</span>
                {sortField === "reason" && (
                  <ArrowUpDown className="w-3 h-3 text-champagne" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Results summary */}
        <div className="flex items-center justify-between text-xs text-mist px-1">
          <span>
            Showing {filteredReports.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}–
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredReports.length)} of {filteredReports.length}{" "}
            reports
          </span>
          {filteredReports.length !== reportsRaw.length && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setReasonFilter("all");
                setCurrentPage(1);
              }}
              className="text-champagne hover:underline"
            >
              Reset all filters
            </button>
          )}
        </div>

        {/* Reports Table */}
        <div className="glass rounded-3xl overflow-hidden">
          {reportsLoading && reportsRaw.length === 0 ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : filteredReports.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="No reports match your filters"
                body="Try adjusting your search criteria, clear status filters, or check back later."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[900px]">
                <thead>
                  <tr>
                    <th className={thCls}>Reporter</th>
                    <th className={thCls}>Reported Member</th>
                    <th className={thCls}>Reason</th>
                    <th className={thCls}>Details</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Filed</th>
                    <th className={`${thCls} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedReports.map((r) => {
                    const reporter = userMap.get(r.reporterId);
                    const reported = userMap.get(r.reportedId);
                    const isSubmitting = submittingIds.has(r.id);

                    return (
                      <tr key={r.id} className={rowCls}>
                        {/* Reporter */}
                        <td className={tdCls}>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={reporter?.firstName ?? "?"} size={32} />
                            <div>
                              <p className="text-ivory font-medium whitespace-nowrap">
                                {reporter?.firstName ?? "Unknown"}
                              </p>
                              <p className="text-[0.68rem] text-mist font-mono">
                                {r.reporterId.slice(0, 8)}…
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Reported Member */}
                        <td className={tdCls}>
                          <div className="flex items-center gap-2.5">
                            <Avatar name={reported?.firstName ?? "?"} size={32} />
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span className="text-ivory font-medium whitespace-nowrap">
                                  {reported?.firstName ?? "Unknown"}
                                </span>
                                {reported?.verified && (
                                  <span className="text-[0.62rem] text-champagne bg-champagne/10 border border-champagne/30 rounded px-1">
                                    Verified
                                  </span>
                                )}
                              </div>
                              <p className="text-[0.68rem] text-mist font-mono">
                                {r.reportedId.slice(0, 8)}…
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Reason */}
                        <td className={`${tdCls} text-champagne whitespace-nowrap font-medium`}>
                          <span className="inline-block px-2.5 py-0.5 rounded-full bg-champagne/10 border border-champagne/20 text-xs">
                            {r.reason}
                          </span>
                        </td>

                        {/* Details snippet */}
                        <td className={`${tdCls} text-ivory-dim max-w-[260px]`}>
                          <p className="line-clamp-2 text-xs leading-relaxed">{r.details || "—"}</p>
                        </td>

                        {/* Status */}
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONES[r.status]}>{r.status}</Badge>
                        </td>

                        {/* Filed Timestamp */}
                        <td className={`${tdCls} text-mist whitespace-nowrap text-xs`}>
                          <p>{fmtDate(r.createdAt)}</p>
                          <p className="text-[0.68rem] text-mist/70">{timeAgo(r.createdAt)}</p>
                        </td>

                        {/* Actions */}
                        <td className={`${tdCls} text-right`}>
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {/* Inspect Detail Button */}
                            <button
                              type="button"
                              onClick={() => setInspectReport(r)}
                              className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-mist hover:text-ivory flex items-center gap-1"
                              title="Inspect full report evidence"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Inspect</span>
                            </button>

                            {/* Open status transition: Start Review */}
                            {r.status === "open" && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => executeStatusChange(r.id, "reviewing")}
                                className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-champagne hover:text-rosegold whitespace-nowrap border-champagne/30 disabled:opacity-40"
                              >
                                {isSubmitting ? "Starting…" : "Start Review"}
                              </button>
                            )}

                            {/* Open or Reviewing actions: Resolve and Dismiss */}
                            {(r.status === "open" || r.status === "reviewing") && (
                              <>
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => requestResolve(r)}
                                  className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-emerald-300 hover:text-emerald-200 border-emerald-500/30 hover:bg-emerald-500/10 whitespace-nowrap disabled:opacity-40 flex items-center gap-1"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Resolve</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={isSubmitting}
                                  onClick={() => requestDismiss(r)}
                                  className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-mist hover:text-rose-300 border-white/10 hover:border-rose-500/30 hover:bg-rose-500/10 whitespace-nowrap disabled:opacity-40"
                                >
                                  <span>Dismiss</span>
                                </button>
                              </>
                            )}

                            {/* Resolved or Dismissed actions: Reopen */}
                            {(r.status === "resolved" || r.status === "dismissed") && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => requestReopen(r)}
                                className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-amber-300 hover:text-amber-200 border-amber-500/30 hover:bg-amber-500/10 whitespace-nowrap disabled:opacity-40 flex items-center gap-1"
                                title="Reopen this report for active investigation"
                              >
                                <RotateCcw className="w-3 h-3" />
                                <span>Reopen</span>
                              </button>
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

          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-6 py-4 border-t hairline">
              <span className="text-xs text-mist">
                Page {currentPage} of {totalPages}
              </span>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="btn-ghost px-3 py-1.5 rounded-xl text-xs disabled:opacity-30 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span>Previous</span>
                </button>

                <div className="flex items-center gap-1">
                  {Array.from({ length: totalPages }).map((_, i) => {
                    const page = i + 1;
                    if (
                      page === 1 ||
                      page === totalPages ||
                      (page >= currentPage - 1 && page <= currentPage + 1)
                    ) {
                      return (
                        <button
                          key={page}
                          type="button"
                          onClick={() => setCurrentPage(page)}
                          className={`w-7 h-7 rounded-lg text-xs font-mono transition-colors ${
                            currentPage === page
                              ? "bg-champagne/20 text-champagne border border-champagne/40 font-semibold"
                              : "text-mist hover:text-ivory bg-white/5"
                          }`}
                        >
                          {page}
                        </button>
                      );
                    }
                    if (page === currentPage - 2 || page === currentPage + 2) {
                      return (
                        <span key={page} className="text-mist px-1 text-xs">
                          …
                        </span>
                      );
                    }
                    return null;
                  })}
                </div>

                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="btn-ghost px-3 py-1.5 rounded-xl text-xs disabled:opacity-30 flex items-center gap-1"
                >
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirmation Modal */}
      {confirmModal && (
        <Modal
          open={Boolean(confirmModal)}
          onClose={() => setConfirmModal(null)}
          title={confirmModal.title}
        >
          <div className="space-y-5">
            <p className="text-sm text-ivory-dim leading-relaxed">{confirmModal.description}</p>

            {/* Quick Context Card */}
            <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-mist">Report Reason:</span>
                <span className="text-champagne font-medium">{confirmModal.report.reason}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-mist">Report ID:</span>
                <span className="text-ivory font-mono text-[0.7rem]">{confirmModal.report.id}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-mist">Current Status:</span>
                <Badge tone={STATUS_TONES[confirmModal.report.status]}>
                  {confirmModal.report.status}
                </Badge>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmModal(null)}
                className="btn-ghost px-4 py-2 rounded-xl text-xs text-mist hover:text-ivory"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingIds.has(confirmModal.report.id)}
                onClick={() =>
                  executeStatusChange(confirmModal.report.id, confirmModal.targetStatus)
                }
                className={`rounded-xl px-4 py-2 text-xs font-medium transition-all ${
                  confirmModal.tone === "green"
                    ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30"
                    : confirmModal.tone === "rose"
                    ? "bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30"
                    : "btn-gold"
                }`}
              >
                {submittingIds.has(confirmModal.report.id) ? "Updating…" : confirmModal.confirmLabel}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Report Inspection Modal (High Fidelity) */}
      {inspectReport && (
        <Modal
          open={Boolean(inspectReport)}
          onClose={() => setInspectReport(null)}
          title={`Report Investigation — #${inspectReport.id.slice(0, 8)}`}
          wide={true}
        >
          {(() => {
            const reporter = userMap.get(inspectReport.reporterId);
            const reported = userMap.get(inspectReport.reportedId);
            const isSubmitting = submittingIds.has(inspectReport.id);

            return (
              <div className="space-y-6">
                {/* Meta Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-mist">Status:</span>
                    <Badge tone={STATUS_TONES[inspectReport.status]}>
                      {inspectReport.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-mist">Reason:</span>
                    <span className="text-champagne font-medium bg-champagne/10 border border-champagne/20 rounded px-2 py-0.5">
                      {inspectReport.reason}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-mist" />
                    <span className="text-mist">Filed:</span>
                    <span className="text-ivory">{fmtDate(inspectReport.createdAt)}</span>
                  </div>
                </div>

                {/* Complaint Narrative Details */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[0.7rem] uppercase tracking-wider text-mist font-semibold">
                      Complaint Narrative & Details
                    </p>
                    <span className="text-[0.68rem] text-mist font-mono">
                      ID: {inspectReport.id}
                    </span>
                  </div>
                  <div className="p-4 rounded-2xl bg-black/40 border border-white/10 text-sm text-ivory leading-relaxed font-sans min-h-[90px] whitespace-pre-wrap">
                    {inspectReport.details || (
                      <span className="text-mist italic">
                        No additional text was supplied with this report.
                      </span>
                    )}
                  </div>
                </div>

                {/* Parties Involved Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Reporter Card */}
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[0.68rem] uppercase tracking-wider text-champagne font-semibold flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5" />
                        <span>Filing Reporter</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => copyId(inspectReport.reporterId, "Reporter ID")}
                        className="text-[0.68rem] text-mist hover:text-champagne flex items-center gap-1 font-mono"
                      >
                        {copiedId === inspectReport.reporterId ? (
                          <Check className="w-3 h-3 text-champagne" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{inspectReport.reporterId.slice(0, 8)}…</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <Avatar name={reporter?.firstName ?? "?"} size={44} />
                      <div>
                        <p className="text-ivory font-medium text-base">
                          {reporter?.firstName ?? "Unknown Member"}
                        </p>
                        <p className="text-xs text-mist">
                          {reporter?.age ? `${reporter.age} yrs` : "Age undisclosed"}
                          {reporter?.gender ? ` · ${reporter.gender}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-white/5 space-y-1.5 text-xs text-mist">
                      {reporter?.city && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3 h-3 text-champagne" />
                          <span>{reporter.city}</span>
                        </div>
                      )}
                      {reporter?.email && (
                        <div className="text-[0.72rem] text-mist/80 font-mono">
                          {reporter.email}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Reported Member Card */}
                  <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[0.68rem] uppercase tracking-wider text-rose-300 font-semibold flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" />
                        <span>Reported Member</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => copyId(inspectReport.reportedId, "Reported ID")}
                        className="text-[0.68rem] text-mist hover:text-rose-300 flex items-center gap-1 font-mono"
                      >
                        {copiedId === inspectReport.reportedId ? (
                          <Check className="w-3 h-3 text-champagne" />
                        ) : (
                          <Copy className="w-3 h-3" />
                        )}
                        <span>{inspectReport.reportedId.slice(0, 8)}…</span>
                      </button>
                    </div>

                    <div className="flex items-center gap-3">
                      <Avatar name={reported?.firstName ?? "?"} size={44} />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-ivory font-medium text-base">
                            {reported?.firstName ?? "Unknown Member"}
                          </p>
                          {reported?.verified && (
                            <span className="text-[0.62rem] text-champagne bg-champagne/10 border border-champagne/30 rounded px-1">
                              Verified
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-mist">
                          {reported?.age ? `${reported.age} yrs` : "Age undisclosed"}
                          {reported?.gender ? ` · ${reported.gender}` : ""}
                        </p>
                      </div>
                    </div>

                    <div className="pt-2 border-t border-white/5 space-y-1.5 text-xs text-mist">
                      {reported?.city && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="w-3 h-3 text-rosegold" />
                          <span>{reported.city}</span>
                        </div>
                      )}
                      {reported?.email && (
                        <div className="text-[0.72rem] text-mist/80 font-mono">
                          {reported.email}
                        </div>
                      )}
                    </div>

                    {/* Reported photos preview thumbnail row */}
                    {reported && Array.isArray(reported.photos) && reported.photos.length > 0 && (
                      <div className="pt-2 border-t border-white/5">
                        <p className="text-[0.65rem] text-mist uppercase tracking-wider mb-1.5">
                          Member Photos ({reported.photos.length})
                        </p>
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {reported.photos.slice(0, 4).map((p, idx) => (
                            <div
                              key={idx}
                              className="w-12 h-12 rounded-lg overflow-hidden bg-black/40 border border-white/10 shrink-0"
                            >
                              <img
                                src={p}
                                alt={`Portrait ${idx + 1}`}
                                className="w-full h-full object-cover"
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Evidence & Administrative Policy Notice */}
                <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs space-y-1 text-amber-200/90 leading-relaxed">
                  <div className="flex items-center gap-1.5 font-medium text-amber-300">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Evidence & Moderation Safety Policy</span>
                  </div>
                  <p>
                    • <strong>Evidence attachments:</strong> The Datevra report schema captures text
                    narratives. Media upload attachments are not supported by the public.reports schema.
                  </p>
                  <p>
                    • <strong>Platform sanctions:</strong> Administrative account suspensions require
                    the forthcoming Platform Sanctions RPC. Datevra safety guidelines strictly forbid
                    administrators from placing personal peer-to-peer blocks on member accounts.
                  </p>
                </div>

                {/* In-Modal Action Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t hairline">
                  <span className="text-xs text-mist">
                    Audit log actor: <span className="font-mono text-champagne">{actor}</span>
                  </span>

                  <div className="flex items-center gap-2">
                    {inspectReport.status === "open" && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => executeStatusChange(inspectReport.id, "reviewing")}
                        className="btn-ghost rounded-xl px-3.5 py-2 text-xs text-champagne hover:text-rosegold border-champagne/30 disabled:opacity-40"
                      >
                        {isSubmitting ? "Starting…" : "Start Review"}
                      </button>
                    )}

                    {(inspectReport.status === "open" || inspectReport.status === "reviewing") && (
                      <>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => requestResolve(inspectReport)}
                          className="btn-ghost rounded-xl px-3.5 py-2 text-xs text-emerald-300 hover:text-emerald-200 border-emerald-500/30 hover:bg-emerald-500/10 disabled:opacity-40 flex items-center gap-1"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Resolve Report</span>
                        </button>
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => requestDismiss(inspectReport)}
                          className="btn-ghost rounded-xl px-3.5 py-2 text-xs text-mist hover:text-rose-300 border-white/10 hover:border-rose-500/30 hover:bg-rose-500/10 disabled:opacity-40"
                        >
                          <span>Dismiss Report</span>
                        </button>
                      </>
                    )}

                    {(inspectReport.status === "resolved" || inspectReport.status === "dismissed") && (
                      <button
                        type="button"
                        disabled={isSubmitting}
                        onClick={() => requestReopen(inspectReport)}
                        className="btn-ghost rounded-xl px-3.5 py-2 text-xs text-amber-300 hover:text-amber-200 border-amber-500/30 hover:bg-amber-500/10 disabled:opacity-40 flex items-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Reopen Investigation</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
