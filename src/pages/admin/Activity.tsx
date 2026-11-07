import { useEffect, useMemo, useState } from "react";
import type { ActivityLog } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { Badge, EmptyState, Modal, SectionHead, Skeleton, inputCls } from "../../components/ui";
import { fmtDate, getIstToday, rowCls, tdCls, thCls, timeAgo, toIstDateString } from "./_util";
import {
  Calendar,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Filter,
  RotateCcw,
  Search,
  Shield,
  ShieldCheck,
  User,
  X,
} from "lucide-react";

export type ActivityCategory =
  | "all"
  | "passes"
  | "financial"
  | "matchmaking"
  | "users"
  | "cafes"
  | "safety"
  | "system";

export function classifyAction(action: string): {
  category: ActivityCategory;
  categoryLabel: string;
  tone: "gold" | "rose" | "green" | "muted";
} {
  if (action.startsWith("user.") || action.startsWith("verify.")) {
    return { category: "users", categoryLabel: "Verification", tone: "green" };
  }
  if (action.startsWith("membership_pass.") || action.startsWith("pass.")) {
    return { category: "passes", categoryLabel: "Passes & Memberships", tone: "gold" };
  }
  if (action.startsWith("payment.") || action.startsWith("investor.")) {
    return { category: "financial", categoryLabel: "Financial & Payouts", tone: "gold" };
  }
  if (action.startsWith("proposal.")) {
    return { category: "matchmaking", categoryLabel: "Matchmaking", tone: "rose" };
  }
  if (action.startsWith("cafe.") || action.startsWith("booking.") || action.startsWith("application.")) {
    return { category: "cafes", categoryLabel: "Cafés & Bookings", tone: "gold" };
  }
  if (action.startsWith("report.")) {
    return { category: "safety", categoryLabel: "Safety & Reports", tone: "rose" };
  }
  return { category: "system", categoryLabel: "System & Content", tone: "muted" };
}

export function formatActionName(action: string): string {
  const map: Record<string, string> = {
    "user.verify": "Member Verification",
    "membership_pass.create": "Membership Pass Created",
    "membership_pass.revoke": "Membership Pass Revoked",
    "pass.create": "Café Pass Created",
    "pass.revoke": "Café Pass Revoked",
    "proposal.create": "Match Proposal Created",
    "payment.verify": "Payment Verified",
    "payment.cash": "Cash Payment Recorded",
    "payment.refund": "Payment Refunded",
    "investor.upsert": "Investor Profile Saved",
    "investor.payout": "Investor Payout Recorded",
    "booking.create": "Date Booking Created",
    "booking.status": "Booking Status Updated",
    "cafe.create": "Café Partner Added",
    "cafe.update": "Café Partner Updated",
    "cafe.upsert": "Café Partner Saved",
    "application.status": "Application Decision",
    "report.status": "Report Status Updated",
    "report.block": "Safety Block Enforced",
    "notification.broadcast": "Broadcast Announcement",
    "cms.update": "CMS Content Updated",
    "settings.update": "Platform Settings Updated",
  };
  return map[action] ?? action;
}

const PAGE_SIZE = 20;

export default function Activity() {
  const db = useBackend();
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ActivityCategory>("all");
  const [roleFilter, setRoleFilter] = useState<"all" | "admin" | "system">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "7d" | "30d">("all");
  const [sortOrder, setSortOrder] = useState<"desc" | "asc">("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [inspectLog, setInspectLog] = useState<ActivityLog | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const { data: logsRaw, loading, error, refresh } = useAsync(
    (b) => b.listActivity(),
    [db],
    [] as ActivityLog[],
  );

  useEffect(() => db.subscribe("activity", refresh), [db, refresh]);

  // Reset pagination when search or filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, categoryFilter, roleFilter, dateFilter, sortOrder]);

  // High-level audit metrics
  const stats = useMemo(() => {
    const total = logsRaw.length;
    let adminCount = 0;
    let systemCount = 0;
    let todayCount = 0;
    const todayIst = getIstToday();

    for (const l of logsRaw) {
      if (l.actorRole === "admin") adminCount++;
      else systemCount++;
      if (toIstDateString(l.createdAt) === todayIst) todayCount++;
    }
    return { total, adminCount, systemCount, todayCount };
  }, [logsRaw]);

  // Filtered & sorted logs
  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = Date.now();
    const oneDay = 86400000;

    return logsRaw
      .filter((a) => {
        // Role filter
        if (roleFilter !== "all" && a.actorRole !== roleFilter) return false;

        // Category filter
        if (categoryFilter !== "all") {
          const { category } = classifyAction(a.action);
          if (category !== categoryFilter) return false;
        }

        // Date filter
        if (dateFilter !== "all") {
          const logTime = new Date(a.createdAt).getTime();
          const age = now - logTime;
          if (dateFilter === "today") {
            const todayIst = getIstToday();
            if (toIstDateString(a.createdAt) !== todayIst) return false;
          } else if (dateFilter === "7d") {
            if (age > 7 * oneDay) return false;
          } else if (dateFilter === "30d") {
            if (age > 30 * oneDay) return false;
          }
        }

        // Search query
        if (q) {
          const classification = classifyAction(a.action);
          const formattedName = formatActionName(a.action).toLowerCase();
          const searchString = `${a.id} ${a.action} ${formattedName} ${classification.categoryLabel} ${a.detail} ${a.actorId} ${a.actorRole}`.toLowerCase();
          if (!searchString.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        return sortOrder === "desc" ? diff : -diff;
      });
  }, [logsRaw, searchQuery, categoryFilter, roleFilter, dateFilter, sortOrder]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredLogs.length / PAGE_SIZE));
  const paginatedLogs = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredLogs.slice(start, start + PAGE_SIZE);
  }, [filteredLogs, currentPage]);

  const hasActiveFilters =
    Boolean(searchQuery) ||
    categoryFilter !== "all" ||
    roleFilter !== "all" ||
    dateFilter !== "all" ||
    sortOrder !== "desc";

  const resetFilters = () => {
    setSearchQuery("");
    setCategoryFilter("all");
    setRoleFilter("all");
    setDateFilter("all");
    setSortOrder("desc");
  };

  const copyId = (id: string) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Page Header */}
        <SectionHead
          kicker="Audit ledger"
          title="Activity History"
          sub="Chronological, immutable audit ledger of all administrative decisions, transactions, and platform events. Records cannot be altered or removed."
          align="left"
        />

        {error && (
          <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center justify-between">
            <span>Failed to load activity history: {error}</span>
            <button
              onClick={refresh}
              className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 transition-colors"
            >
              Retry
            </button>
          </div>
        )}

        {/* Audit Metrics Stat Tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="glass rounded-2xl p-4 space-y-1">
            <p className="text-xs uppercase tracking-wider text-mist">Total Records</p>
            <p className="font-display text-2xl text-ivory">{stats.total}</p>
            <p className="text-[0.7rem] text-mist/80">Historical log entries</p>
          </div>
          <div className="glass rounded-2xl p-4 space-y-1">
            <p className="text-xs uppercase tracking-wider text-champagne/90">Admin Actions</p>
            <p className="font-display text-2xl text-gradient-gold">{stats.adminCount}</p>
            <p className="text-[0.7rem] text-mist/80">Manual decisions</p>
          </div>
          <div className="glass rounded-2xl p-4 space-y-1">
            <p className="text-xs uppercase tracking-wider text-mist">System Events</p>
            <p className="font-display text-2xl text-ivory-dim">{stats.systemCount}</p>
            <p className="text-[0.7rem] text-mist/80">Automated ledger items</p>
          </div>
          <div className="glass rounded-2xl p-4 space-y-1">
            <p className="text-xs uppercase tracking-wider text-mist">Today (IST)</p>
            <p className="font-display text-2xl text-ivory">{stats.todayCount}</p>
            <p className="text-[0.7rem] text-mist/80">Today's recorded activities</p>
          </div>
        </div>

        {/* Search & Comprehensive Filters Panel */}
        <div className="glass rounded-3xl p-5 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-mist absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search action, details, actor ID, entity code…"
                className={`${inputCls} pl-10 pr-9 w-full`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-ivory transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Quick Sort Dropdown */}
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs uppercase tracking-wider text-mist whitespace-nowrap">Sort:</span>
              <select
                value={sortOrder}
                onChange={(e) => setSortOrder(e.target.value as "desc" | "asc")}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ivory focus:outline-none focus:border-champagne/40"
              >
                <option value="desc" className="bg-midnight text-ivory">Newest First</option>
                <option value="asc" className="bg-midnight text-ivory">Oldest First</option>
              </select>
            </div>
          </div>

          {/* Granular Filter Selectors */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-white/5">
            {/* Category Filter */}
            <div>
              <label className="text-[0.7rem] uppercase tracking-wider text-mist block mb-1.5 flex items-center gap-1.5">
                <Filter className="w-3 h-3 text-champagne/80" />
                <span>Action Category</span>
              </label>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as ActivityCategory)}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ivory focus:outline-none focus:border-champagne/40"
              >
                <option value="all" className="bg-midnight text-ivory">All Categories</option>
                <option value="passes" className="bg-midnight text-ivory">Passes & Memberships</option>
                <option value="financial" className="bg-midnight text-ivory">Financial & Payouts</option>
                <option value="matchmaking" className="bg-midnight text-ivory">Curated Matchmaking</option>
                <option value="users" className="bg-midnight text-ivory">User Verification</option>
                <option value="cafes" className="bg-midnight text-ivory">Cafés & Bookings</option>
                <option value="safety" className="bg-midnight text-ivory">Safety & Reports</option>
                <option value="system" className="bg-midnight text-ivory">System & Content</option>
              </select>
            </div>

            {/* Role Filter */}
            <div>
              <label className="text-[0.7rem] uppercase tracking-wider text-mist block mb-1.5 flex items-center gap-1.5">
                <User className="w-3 h-3 text-champagne/80" />
                <span>Actor Role</span>
              </label>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as "all" | "admin" | "system")}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ivory focus:outline-none focus:border-champagne/40"
              >
                <option value="all" className="bg-midnight text-ivory">All Roles</option>
                <option value="admin" className="bg-midnight text-ivory">Admin Actions</option>
                <option value="system" className="bg-midnight text-ivory">System Actions</option>
              </select>
            </div>

            {/* Date Range Filter */}
            <div>
              <label className="text-[0.7rem] uppercase tracking-wider text-mist block mb-1.5 flex items-center gap-1.5">
                <Calendar className="w-3 h-3 text-champagne/80" />
                <span>Time Period</span>
              </label>
              <select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value as "all" | "today" | "7d" | "30d")}
                className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ivory focus:outline-none focus:border-champagne/40"
              >
                <option value="all" className="bg-midnight text-ivory">All Time</option>
                <option value="today" className="bg-midnight text-ivory">Today</option>
                <option value="7d" className="bg-midnight text-ivory">Past 7 Days</option>
                <option value="30d" className="bg-midnight text-ivory">Past 30 Days</option>
              </select>
            </div>
          </div>

          {/* Active Filter Pills Bar */}
          {hasActiveFilters && (
            <div className="flex items-center justify-between pt-2 text-xs text-mist border-t border-white/5 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[0.7rem] uppercase tracking-wider text-champagne/80">Filters applied:</span>
                {searchQuery && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    Query: “{searchQuery}”
                    <button type="button" onClick={() => setSearchQuery("")}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {categoryFilter !== "all" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    Category: {categoryFilter}
                    <button type="button" onClick={() => setCategoryFilter("all")}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {roleFilter !== "all" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    Role: {roleFilter}
                    <button type="button" onClick={() => setRoleFilter("all")}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {dateFilter !== "all" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    Period: {dateFilter}
                    <button type="button" onClick={() => setDateFilter("all")}><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={resetFilters}
                className="text-xs text-rosegold hover:underline flex items-center gap-1 ml-auto"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset all filters</span>
              </button>
            </div>
          )}
        </div>

        {/* Results Counter & Table */}
        <div className="glass rounded-3xl overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between flex-wrap gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ivory">
              Recorded Entries ({filteredLogs.length})
            </span>
            <span className="text-xs text-mist">
              Showing page {currentPage} of {totalPages}
            </span>
          </div>

          {loading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-xl" />
              ))}
            </div>
          ) : filteredLogs.length === 0 ? (
            <div className="p-12 text-center">
              <EmptyState
                title="No activity records found"
                body={
                  hasActiveFilters
                    ? "No audit records match your active search or filter criteria. Try adjusting or clearing your filters."
                    : "No platform activity records are currently in the audit ledger."
                }
              />
              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="btn-gold mt-4 text-xs px-4 py-2"
                >
                  Clear all filters
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[880px]">
                <thead>
                  <tr>
                    <th className={thCls}>Timestamp</th>
                    <th className={thCls}>Action</th>
                    <th className={thCls}>Actor</th>
                    <th className={thCls}>Audit Detail</th>
                    <th className={`${thCls} text-right`}>Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {paginatedLogs.map((log) => {
                    const { categoryLabel, tone } = classifyAction(log.action);
                    const formattedName = formatActionName(log.action);
                    return (
                      <tr
                        key={log.id}
                        className={`${rowCls} cursor-pointer`}
                        onClick={() => setInspectLog(log)}
                      >
                        {/* Timestamp */}
                        <td className={`${tdCls} whitespace-nowrap`}>
                          <div className="space-y-0.5">
                            <p className="text-xs font-medium text-ivory">{fmtDate(log.createdAt)}</p>
                            <p className="text-[0.7rem] text-mist flex items-center gap-1">
                              <Clock className="w-3 h-3 inline text-champagne/70" />
                              <span>{timeAgo(log.createdAt)}</span>
                            </p>
                          </div>
                        </td>

                        {/* Action & Category */}
                        <td className={`${tdCls} whitespace-nowrap`}>
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <Badge tone={tone}>{categoryLabel}</Badge>
                            </div>
                            <p className="font-mono text-xs text-champagne">{formattedName}</p>
                            <p className="font-mono text-[0.65rem] text-mist/60">{log.action}</p>
                          </div>
                        </td>

                        {/* Actor */}
                        <td className={`${tdCls} whitespace-nowrap`}>
                          <div className="space-y-1">
                            <Badge tone={log.actorRole === "admin" ? "gold" : "muted"}>
                              {log.actorRole}
                            </Badge>
                            <p className="font-mono text-xs text-mist">
                              {log.actorId ? log.actorId.slice(0, 16) : "system"}
                            </p>
                          </div>
                        </td>

                        {/* Detail */}
                        <td className={`${tdCls} text-ivory-dim max-w-[420px]`}>
                          <p className="line-clamp-2 text-xs leading-relaxed">
                            {log.detail || "No additional detail provided."}
                          </p>
                        </td>

                        {/* Inspect action */}
                        <td className={`${tdCls} text-right whitespace-nowrap`}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setInspectLog(log);
                            }}
                            className="text-xs text-champagne/90 hover:text-champagne hover:bg-white/5 border border-white/10 px-2.5 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1"
                          >
                            <span>Inspect</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Bounded Pagination Controls */}
          {totalPages > 1 && (
            <div className="px-6 py-4 border-t border-white/5 flex items-center justify-between flex-wrap gap-3">
              <span className="text-xs text-mist">
                Showing {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, filteredLogs.length)} of {filteredLogs.length} entries
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={currentPage <= 1}
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 text-xs rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed text-ivory transition-colors"
                >
                  Previous
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, totalPages) }).map((_, i) => {
                    let pageNum = i + 1;
                    if (totalPages > 5 && currentPage > 3) {
                      pageNum = Math.min(totalPages - 4, currentPage - 2) + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        type="button"
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-8 h-8 rounded-xl text-xs font-mono transition-colors ${
                          currentPage === pageNum
                            ? "bg-champagne text-ink font-semibold"
                            : "hover:bg-white/5 text-mist hover:text-ivory"
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  disabled={currentPage >= totalPages}
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 text-xs rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed text-ivory transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Activity Detail Inspection Modal */}
        <Modal
          open={Boolean(inspectLog)}
          onClose={() => setInspectLog(null)}
          title="Audit Record Inspection"
        >
          {inspectLog && (
            <div className="space-y-5 text-sm">
              {/* Record Summary Banner */}
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-champagne" />
                    <span className="font-semibold text-ivory text-base">
                      {formatActionName(inspectLog.action)}
                    </span>
                  </div>
                  <Badge tone={classifyAction(inspectLog.action).tone}>
                    {classifyAction(inspectLog.action).categoryLabel}
                  </Badge>
                </div>
                <p className="font-mono text-xs text-champagne/80">{inspectLog.action}</p>
              </div>

              {/* Key Audit Attributes */}
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                  <p className="uppercase tracking-wider text-mist">Actor Role</p>
                  <p className="font-semibold text-ivory capitalize">{inspectLog.actorRole}</p>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                  <p className="uppercase tracking-wider text-mist">Actor ID</p>
                  <p className="font-mono text-ivory-dim truncate">
                    {inspectLog.actorId || "system"}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                  <p className="uppercase tracking-wider text-mist">Logged At</p>
                  <p className="font-medium text-ivory">{fmtDate(inspectLog.createdAt)}</p>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 space-y-1">
                  <p className="uppercase tracking-wider text-mist">Relative</p>
                  <p className="font-medium text-champagne">{timeAgo(inspectLog.createdAt)}</p>
                </div>
              </div>

              {/* Complete Event Detail */}
              <div className="space-y-1.5">
                <label className="text-xs uppercase tracking-wider text-mist font-medium block">
                  Unaltered Event Description
                </label>
                <div className="p-4 rounded-2xl bg-midnight/90 border border-white/10 font-mono text-xs text-ivory leading-relaxed break-words whitespace-pre-wrap">
                  {inspectLog.detail || "No additional detail provided with this record."}
                </div>
              </div>

              {/* Log Record ID & Copy */}
              <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 flex items-center justify-between text-xs">
                <div className="space-y-0.5 overflow-hidden mr-2">
                  <p className="text-[0.65rem] uppercase tracking-wider text-mist">Audit Record ID</p>
                  <p className="font-mono text-mist truncate">{inspectLog.id}</p>
                </div>
                <button
                  type="button"
                  onClick={() => copyId(inspectLog.id)}
                  className="px-2.5 py-1.5 rounded-lg border border-white/10 hover:bg-white/5 text-ivory text-xs flex items-center gap-1 shrink-0 transition-colors"
                >
                  {copiedId ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-300">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-mist" />
                      <span>Copy ID</span>
                    </>
                  )}
                </button>
              </div>

              {/* Ledger Security & Redaction Assurance Notice */}
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-emerald-300">
                  <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Immutable Audit Ledger</span>
                </div>
                <p className="text-emerald-200/80 leading-relaxed">
                  This audit record is permanently preserved in the platform activity ledger. Historical records are strictly read-only and cannot be altered, modified, or deleted by any administrative account.
                </p>
              </div>

              <div className="flex items-center justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setInspectLog(null)}
                  className="btn-gold px-5 py-2 text-xs"
                >
                  Close Inspection
                </button>
              </div>
            </div>
          )}
        </Modal>
      </div>
    </div>
  );
}
