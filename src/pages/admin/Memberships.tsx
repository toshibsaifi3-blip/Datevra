import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  Sparkles,
  Ban,
} from "lucide-react";
import type { Subscription, SubscriptionStatus, UserProfile, PlanId } from "../../lib/types";
import { PLANS } from "../../data/seed";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import {
  Badge,
  EmptyState,
  Field,
  Modal,
  PlanBadge,
  SectionHead,
  Skeleton,
  Stat,
  inputCls,
  useToast,
} from "../../components/ui";
import { fmtDay, fmtDate, inr, thCls, tdCls, rowCls } from "./_util";

const ITEMS_PER_PAGE = 10;

type SortField = "startedAt" | "expiresAt" | "memberName";

export default function Memberships() {
  const { session } = useAuth();
  const db = useBackend();
  const { toast } = useToast();
  const actor = session?.userId || "admin-system";

  // Data fetching
  const { data: plans, loading: pLoading } = useAsync((b) => b.listPlans(), [db], PLANS);
  const {
    data: allUsers,
    loading: uLoading,
    refresh: refreshUsers,
  } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  // BATCHED QUERY: Replaces previous N+1 Promise.all(users.map(...)) loop
  const {
    data: subsRaw,
    loading: sLoading,
    error,
    refresh: refreshSubs,
  } = useAsync((b) => b.allSubscriptions(), [db], [] as Subscription[]);

  // Realtime subscriptions
  useEffect(() => {
    const off1 = db.subscribe("subscriptions", refreshSubs);
    const off2 = db.subscribe("profiles", () => {
      refreshSubs();
      refreshUsers();
    });
    const off3 = db.subscribe("payments", refreshSubs);
    return () => {
      off1();
      off2();
      off3();
    };
  }, [db, refreshSubs, refreshUsers]);

  // Lookup map for O(1) user profile retrieval
  const userMap = useMemo(
    () => new Map(allUsers.map((u) => [u.id, u])),
    [allUsers],
  );

  // Filter & Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | SubscriptionStatus>("all");
  const [tierFilter, setTierFilter] = useState<"all" | PlanId>("all");
  const [sortField, setSortField] = useState<SortField>("startedAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [currentPage, setCurrentPage] = useState(1);

  // In-flight mutation locking
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());

  // Administrative action modals
  const [cancelTarget, setCancelTarget] = useState<Subscription | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [extendTarget, setExtendTarget] = useState<Subscription | null>(null);
  const [extendDays, setExtendDays] = useState<number>(30);
  const [customDays, setCustomDays] = useState<string>("");
  const [extendReason, setExtendReason] = useState("");

  // Clipboard copy feedback
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    toast("Copied to clipboard", "gold");
    setTimeout(() => setCopiedId(null), 1800);
  };

  // Metrics calculation
  const metrics = useMemo(() => {
    const active = subsRaw.filter((s) => s.status === "active");
    const expired = subsRaw.filter((s) => s.status === "expired");
    const cancelled = subsRaw.filter((s) => s.status === "cancelled");
    const pending = subsRaw.filter((s) => s.status === "pending");

    const now = Date.now();
    const expiringSoon = active.filter(
      (s) =>
        s.expiresAt != null &&
        new Date(s.expiresAt).getTime() - now < 7 * 864e5 &&
        new Date(s.expiresAt).getTime() > now,
    );

    const mrr = active.reduce((sum, s) => {
      const plan = plans.find((p) => p.id === s.planId);
      return sum + (plan?.price ?? 0);
    }, 0);

    const payingUserIds = new Set(active.map((s) => s.userId));
    const nonAdminUsers = allUsers.filter((u) => u.id !== session?.userId);
    const freeUsers = nonAdminUsers.filter((u) => !payingUserIds.has(u.id));

    return {
      total: subsRaw.length,
      activeCount: active.length,
      expiredCount: expired.length,
      cancelledCount: cancelled.length,
      pendingCount: pending.length,
      expiringSoonCount: expiringSoon.length,
      mrr,
      freeMembersCount: freeUsers.length,
    };
  }, [subsRaw, allUsers, plans, session]);

  // Filter & Search handler
  const filteredSubs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return subsRaw
      .filter((s) => {
        // Status filter
        if (statusFilter !== "all" && s.status !== statusFilter) return false;

        // Tier filter
        if (tierFilter !== "all" && s.planId !== tierFilter) return false;

        // Search query
        if (q) {
          const user = userMap.get(s.userId);
          const name = (user?.firstName ?? "").toLowerCase();
          const email = (user?.email ?? "").toLowerCase();
          const subId = s.id.toLowerCase();
          const payId = (s.paymentId ?? "").toLowerCase();

          return (
            name.includes(q) ||
            email.includes(q) ||
            subId.includes(q) ||
            payId.includes(q)
          );
        }

        return true;
      })
      .sort((a, b) => {
        let diff = 0;
        if (sortField === "startedAt") {
          diff = (a.startedAt ?? "").localeCompare(b.startedAt ?? "");
        } else if (sortField === "expiresAt") {
          // Treat lifetime (null) as far future
          const expA = a.expiresAt ?? "9999-12-31";
          const expB = b.expiresAt ?? "9999-12-31";
          diff = expA.localeCompare(expB);
        } else if (sortField === "memberName") {
          const nameA = userMap.get(a.userId)?.firstName ?? "";
          const nameB = userMap.get(b.userId)?.firstName ?? "";
          diff = nameA.localeCompare(nameB);
        }

        return sortOrder === "asc" ? diff : -diff;
      });
  }, [subsRaw, statusFilter, tierFilter, searchQuery, sortField, sortOrder, userMap]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredSubs.length / ITEMS_PER_PAGE));
  const paginatedSubs = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredSubs.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredSubs, currentPage]);

  // Filter / Search change handlers (with pagination auto-reset)
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const handleStatusFilter = (st: "all" | SubscriptionStatus) => {
    setStatusFilter(st);
    setCurrentPage(1);
  };

  const handleTierFilter = (t: "all" | PlanId) => {
    setTierFilter(t);
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

  // Administrative Cancel Subscription execution
  const handleExecuteCancel = async () => {
    if (!cancelTarget || submittingIds.has(cancelTarget.id)) return;

    const sub = cancelTarget;
    setSubmittingIds((prev) => new Set(prev).add(sub.id));

    try {
      await db.cancelSubscription(sub.id, actor, cancelReason.trim());
      refreshSubs();
      refreshUsers();
      toast(
        `Subscription ${sub.id} cancelled. User profile entitlements reconciled.`,
        "gold",
      );
      setCancelTarget(null);
      setCancelReason("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Cancellation failed", "rose");
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(sub.id);
        return next;
      });
    }
  };

  // Administrative Extend Subscription execution
  const handleExecuteExtend = async () => {
    if (!extendTarget || submittingIds.has(extendTarget.id)) return;

    const days = customDays ? parseInt(customDays, 10) : extendDays;
    if (!days || days <= 0 || isNaN(days)) {
      toast("Please specify a valid positive number of days", "rose");
      return;
    }

    const sub = extendTarget;
    setSubmittingIds((prev) => new Set(prev).add(sub.id));

    try {
      const updated = await db.extendSubscription(
        sub.id,
        days,
        actor,
        extendReason.trim(),
      );
      refreshSubs();
      refreshUsers();
      toast(
        `Subscription ${sub.id} extended by ${days} days (valid until ${fmtDay(updated.expiresAt)}).`,
        "gold",
      );
      setExtendTarget(null);
      setExtendDays(30);
      setCustomDays("");
      setExtendReason("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Extension failed", "rose");
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(sub.id);
        return next;
      });
    }
  };

  // Helper badge renderer for subscription lifecycle statuses
  const renderStatusBadge = (status: SubscriptionStatus) => {
    switch (status) {
      case "active":
        return <Badge tone="green">Active</Badge>;
      case "expired":
        return <Badge tone="muted">Expired</Badge>;
      case "cancelled":
        return <Badge tone="rose">Cancelled</Badge>;
      case "pending":
        return <Badge tone="gold">Pending</Badge>;
      default:
        return <Badge tone="muted">{status}</Badge>;
    }
  };

  const loading = pLoading || uLoading || sLoading;

  return (
    <div className="px-0 sm:px-5 pb-16 sm:pb-24 pt-4 sm:pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Section Header with AUTHORITATIVE PRICING COPY (Privé ₹1,199) */}
        <SectionHead
          kicker="Plans & subscriptions"
          title="Memberships"
          sub="Select ₹499 · Signature ₹799 · Privé ₹1,199. Membership never guarantees a match, date or romantic outcome."
          align="left"
        />

        {error && (
          <p className="mt-4 text-sm text-rosegold">
            Couldn&apos;t load subscriptions: {error}
          </p>
        )}

        {/* Pricing Plan Cards with Live Membership Distribution */}
        {loading && plans.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {plans.map((p) => {
              const count = allUsers.filter((u) => u.plan === p.id).length;
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="glass rounded-3xl p-6 card-hover flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <PlanBadge plan={p.id} />
                      <span className="text-xs text-mist font-mono uppercase tracking-widest">
                        Tier {p.priority ?? 1}
                      </span>
                    </div>

                    <p className="font-display text-4xl mt-3 text-gradient-gold">
                      {inr(p.price)}
                    </p>
                    <p className="text-xs text-mist mt-1">per month</p>
                    <p className="text-sm text-ivory-dim mt-3">{p.tagline}</p>

                    <ul className="mt-4 space-y-2 text-sm text-ivory-dim">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-2 text-xs">
                          <span className="text-champagne">✦</span> {f}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="mt-6 pt-4 border-t hairline flex items-baseline justify-between">
                    <span className="text-xs text-mist uppercase tracking-wider">
                      Active Members
                    </span>
                    <span className="font-display text-2xl text-ivory">{count}</span>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}

        {/* Informational Guidance Notice */}
        <div className="glass rounded-2xl p-4 flex gap-3.5 items-start">
          <Sparkles className="w-5 h-5 text-champagne shrink-0 mt-0.5" />
          <div className="text-xs text-ivory-dim leading-relaxed">
            <p className="text-ivory font-medium">Enterprise Entitlement & Ledger Parity</p>
            <p className="mt-0.5">
              All subscription changes directly synchronize with member profiles and audit logs.
              Subscriptions can be extended or cancelled administratively; cancellations immediately
              reconcile member matchmaking entitlements.
            </p>
          </div>
        </div>

        {/* High-Level Financial & Subscription Metric Cards */}
        <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          <Stat
            label="Active subscriptions"
            value={metrics.activeCount}
            sub="paying members"
          />
          <Stat
            label="MRR"
            value={inr(metrics.mrr)}
            sub="monthly recurring revenue"
          />
          <Stat
            label="Expiring soon"
            value={metrics.expiringSoonCount}
            sub="within 7 days"
          />
          <Stat
            label="Free members"
            value={metrics.freeMembersCount}
            sub="not subscribed"
          />
        </div>

        {/* Status Filter Tabs with Live Metric Counts */}
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
            All Subscriptions ({metrics.total})
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("active")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "active"
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
                : "text-mist hover:text-emerald-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Active ({metrics.activeCount})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("expired")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "expired"
                ? "bg-white/20 text-ivory border border-white/30"
                : "text-mist hover:text-ivory bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-mist" />
            <span>Expired ({metrics.expiredCount})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("cancelled")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "cancelled"
                ? "bg-rose-500/25 text-rose-300 border border-rose-500/40"
                : "text-mist hover:text-rose-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>Cancelled ({metrics.cancelledCount})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("pending")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "pending"
                ? "bg-amber-500/25 text-amber-300 border border-amber-500/40"
                : "text-mist hover:text-amber-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span>Pending ({metrics.pendingCount})</span>
          </button>
        </div>

        {/* Filter, Search & Sort Control Bar */}
        <div className="glass rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Multi-field search */}
          <div className="relative flex-1 min-w-0 sm:min-w-[260px]">
            <Search className="w-4 h-4 text-mist absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by member, email, subscription ID, payment ID..."
              className={`${inputCls} pl-10 pr-10 w-full`}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => handleSearchChange("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-ivory"
              >
                <Ban className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Tier Filter */}
            <select
              value={tierFilter}
              onChange={(e) => handleTierFilter(e.target.value as "all" | PlanId)}
              className="w-full sm:w-auto min-h-[40px] bg-space-dark/80 text-xs text-ivory rounded-xl border hairline px-3 py-2 outline-none focus:border-champagne/40"
            >
              <option value="all">All Tiers</option>
              <option value="connect">Select (₹499)</option>
              <option value="plus">Signature (₹799)</option>
              <option value="elite">Privé (₹1,199)</option>
            </select>

            {/* Sort Toggle Controls */}
            <div className="flex flex-wrap items-center gap-1 bg-white/5 p-1 rounded-xl border hairline">
              <button
                type="button"
                onClick={() => handleSortToggle("startedAt")}
                className={`px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1 ${
                  sortField === "startedAt"
                    ? "text-champagne font-medium"
                    : "text-mist hover:text-ivory"
                }`}
              >
                <span>Started</span>
                {sortField === "startedAt" && (
                  <ArrowUpDown className="w-3 h-3 text-champagne" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSortToggle("expiresAt")}
                className={`px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1 ${
                  sortField === "expiresAt"
                    ? "text-champagne font-medium"
                    : "text-mist hover:text-ivory"
                }`}
              >
                <span>Expiry</span>
                {sortField === "expiresAt" && (
                  <ArrowUpDown className="w-3 h-3 text-champagne" />
                )}
              </button>

              <button
                type="button"
                onClick={() => handleSortToggle("memberName")}
                className={`px-2.5 py-1 rounded-lg text-xs transition-colors flex items-center gap-1 ${
                  sortField === "memberName"
                    ? "text-champagne font-medium"
                    : "text-mist hover:text-ivory"
                }`}
              >
                <span>Member</span>
                {sortField === "memberName" && (
                  <ArrowUpDown className="w-3 h-3 text-champagne" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Results summary label */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist px-1">
          <span>
            Showing {filteredSubs.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}–
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredSubs.length)} of {filteredSubs.length}{" "}
            subscriptions
          </span>
          {(filteredSubs.length !== subsRaw.length || statusFilter !== "all" || tierFilter !== "all") && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setTierFilter("all");
                setCurrentPage(1);
              }}
              className="text-champagne hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Main Subscription Lifecycle Table */}
        <div className="glass rounded-3xl overflow-hidden">
          {loading && subsRaw.length === 0 ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : filteredSubs.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="No subscriptions match your criteria"
                body="Adjust your search query, clear filters, or check active payment transactions."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead>
                  <tr>
                    <th className={thCls}>Subscription ID</th>
                    <th className={thCls}>Member</th>
                    <th className={thCls}>Plan / Tier</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Payment Ref</th>
                    <th className={thCls}>Started</th>
                    <th className={thCls}>Renewal / Expiry</th>
                    <th className={`${thCls} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedSubs.map((sub) => {
                    const u = userMap.get(sub.userId);
                    const isSubmitting = submittingIds.has(sub.id);
                    const isLifetime = sub.expiresAt == null;

                    return (
                      <tr key={sub.id} className={rowCls}>
                        {/* Subscription ID */}
                        <td className={tdCls}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-ivory">
                              {sub.id}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(sub.id, `sub-${sub.id}`)}
                              className="text-mist hover:text-champagne transition-colors"
                              title="Copy Subscription ID"
                            >
                              {copiedId === `sub-${sub.id}` ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>
                          <span className="text-[0.68rem] text-mist">
                            {sub.autoRenew ? "auto-renewing" : "manual renewal"}
                          </span>
                        </td>

                        {/* Member */}
                        <td className={tdCls}>
                          <p className="text-ivory font-medium">
                            {u ? u.firstName : "Unlinked Member"}
                          </p>
                          <p className="text-xs text-mist">{u?.email ?? sub.userId}</p>
                        </td>

                        {/* Plan */}
                        <td className={tdCls}>
                          <PlanBadge plan={sub.planId} />
                        </td>

                        {/* Status */}
                        <td className={tdCls}>{renderStatusBadge(sub.status)}</td>

                        {/* Linked Payment ID */}
                        <td className={tdCls}>
                          {sub.paymentId ? (
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-xs text-ivory-dim">
                                {sub.paymentId}
                              </span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(sub.paymentId!, `pay-${sub.paymentId}`)}
                                className="text-mist hover:text-champagne transition-colors"
                                title="Copy Payment ID"
                              >
                                {copiedId === `pay-${sub.paymentId}` ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-mist font-mono">—</span>
                          )}
                        </td>

                        {/* Started Date */}
                        <td className={`${tdCls} text-ivory-dim whitespace-nowrap text-xs`}>
                          {fmtDay(sub.startedAt)}
                        </td>

                        {/* Expiry Date */}
                        <td className={`${tdCls} whitespace-nowrap text-xs`}>
                          {isLifetime ? (
                            <span className="text-champagne font-medium">Lifetime</span>
                          ) : (
                            <span className={sub.status === "active" ? "text-ivory" : "text-mist"}>
                              {fmtDay(sub.expiresAt)}
                            </span>
                          )}
                        </td>

                        {/* Administrative Controls */}
                        <td className={`${tdCls} text-right`}>
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Extend Subscription Control (Available for active or expired) */}
                            {!isLifetime && sub.status !== "cancelled" && sub.status !== "pending" && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => setExtendTarget(sub)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium text-champagne bg-champagne/10 hover:bg-champagne/20 border border-champagne/25 transition-all disabled:opacity-40"
                              >
                                Extend
                              </button>
                            )}

                            {/* Cancel Subscription Control (Available for active only) */}
                            {sub.status === "active" && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => setCancelTarget(sub)}
                                className="px-2.5 py-1 rounded-lg text-xs font-medium text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 transition-all disabled:opacity-40"
                              >
                                Cancel
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
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-t hairline">
              <span className="text-xs text-mist">
                Page {currentPage} of {totalPages}
              </span>

              <div className="flex flex-wrap items-center gap-2">
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

      {/* In-App Administrative Cancellation Modal */}
      <AnimatePresence>
        {cancelTarget && (
          <Modal
            open={Boolean(cancelTarget)}
            onClose={() => setCancelTarget(null)}
            title="Cancel Member Subscription"
          >
            {(() => {
              const u = userMap.get(cancelTarget.userId);
              const isSubmitting = submittingIds.has(cancelTarget.id);

              return (
                <div className="space-y-5">
                  <div className="flex items-start gap-3 p-3.5 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-200">
                    <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
                    <div className="text-xs leading-relaxed space-y-1">
                      <p className="font-medium text-rose-300">
                        Immediate Access & Entitlement Consequences
                      </p>
                      <p>
                        Cancelling will immediately terminate this member&apos;s active plan.
                        Their profile will revert to the free tier and priority matchmaking will cease.
                      </p>
                      <p className="text-rose-300/80">
                        Note: No refund is issued automatically. If a refund is required, process it
                        separately in the Payments ledger.
                      </p>
                    </div>
                  </div>

                  <div className="glass rounded-2xl p-4 text-xs space-y-2 border hairline">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-mist">Member:</span>
                      <span className="text-ivory font-medium break-all">
                        {u?.firstName ?? "Unknown"} ({u?.email ?? cancelTarget.userId})
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-mist">Plan:</span>
                      <span className="text-champagne font-medium uppercase">
                        {cancelTarget.planId}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-mist">Expiration:</span>
                      <span className="text-ivory">{fmtDate(cancelTarget.expiresAt)}</span>
                    </div>
                    {cancelTarget.paymentId && (
                      <div className="flex flex-wrap justify-between gap-2">
                        <span className="text-mist">Associated Payment:</span>
                        <span className="font-mono text-ivory-dim break-all">
                          {cancelTarget.paymentId}
                        </span>
                      </div>
                    )}
                  </div>

                  <Field
                    label="Reason for cancellation"
                    hint="Recorded in the administrative audit logs and sent to the member."
                  >
                    <textarea
                      value={cancelReason}
                      onChange={(e) => setCancelReason(e.target.value)}
                      placeholder="e.g. Member requested cancellation via support, terms violation, administrative dispute resolution..."
                      rows={3}
                      className={`${inputCls} resize-none w-full`}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setCancelTarget(null)}
                      className="btn-ghost px-4 py-2.5 rounded-xl text-xs text-mist hover:text-ivory min-h-[44px]"
                    >
                      Keep Subscription
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handleExecuteCancel}
                      className="bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded-xl px-5 py-2.5 text-xs font-medium transition-all min-h-[44px]"
                    >
                      {isSubmitting ? "Cancelling…" : "Confirm Cancellation"}
                    </button>
                  </div>
                </div>
              );
            })()}
          </Modal>
        )}
      </AnimatePresence>

      {/* In-App Administrative Extension Modal */}
      <AnimatePresence>
        {extendTarget && (
          <Modal
            open={Boolean(extendTarget)}
            onClose={() => {
              setExtendTarget(null);
              setExtendDays(30);
              setCustomDays("");
              setExtendReason("");
            }}
            title="Extend Membership Subscription"
          >
            {(() => {
              const u = userMap.get(extendTarget.userId);
              const isSubmitting = submittingIds.has(extendTarget.id);

              const currentExpiry = extendTarget.expiresAt
                ? new Date(extendTarget.expiresAt)
                : null;
              const now = new Date();
              const baseDate = currentExpiry && currentExpiry > now ? currentExpiry : now;
              const effectiveDays = customDays ? parseInt(customDays, 10) || 0 : extendDays;
              const projectedExpiry = new Date(baseDate.getTime() + effectiveDays * 864e5);

              return (
                <div className="space-y-5">
                  <div className="glass rounded-2xl p-4 text-xs space-y-2 border hairline">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-mist">Member:</span>
                      <span className="text-ivory font-medium break-all">
                        {u?.firstName ?? "Unknown"} ({u?.email ?? extendTarget.userId})
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-mist">Tier:</span>
                      <span className="text-champagne font-medium uppercase">
                        {extendTarget.planId}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-mist">Current Status:</span>
                      <span className="capitalize text-ivory">{extendTarget.status}</span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span className="text-mist">Current Expiry:</span>
                      <span className="text-ivory font-mono">
                        {fmtDate(extendTarget.expiresAt)}
                      </span>
                    </div>
                    <div className="flex flex-wrap justify-between gap-2 border-t hairline pt-2">
                      <span className="text-champagne font-medium">New Expiration:</span>
                      <span className="text-emerald-300 font-mono font-medium">
                        {effectiveDays > 0 ? fmtDate(projectedExpiry.toISOString()) : "—"}
                      </span>
                    </div>
                  </div>

                  <Field label="Extension Duration" hint="Select preset days or enter custom duration.">
                    <div className="space-y-3">
                      <div className="grid grid-cols-3 gap-2">
                        {[7, 14, 30].map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() => {
                              setExtendDays(d);
                              setCustomDays("");
                            }}
                            className={`py-2 px-3 rounded-xl text-xs font-medium transition-all ${
                              extendDays === d && !customDays
                                ? "bg-champagne/20 text-champagne border border-champagne/40"
                                : "text-mist hover:text-ivory bg-white/5 border border-white/5"
                            }`}
                          >
                            +{d} Days
                          </button>
                        ))}
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          max="365"
                          value={customDays}
                          onChange={(e) => setCustomDays(e.target.value)}
                          placeholder="Or custom days (e.g. 45, 60, 90)"
                          className={`${inputCls} text-xs w-full`}
                        />
                        <span className="text-xs text-mist shrink-0">days</span>
                      </div>
                    </div>
                  </Field>

                  <Field
                    label="Reason for extension"
                    hint="Recorded in audit logs and sent to the member notification feed."
                  >
                    <input
                      type="text"
                      value={extendReason}
                      onChange={(e) => setExtendReason(e.target.value)}
                      placeholder="e.g. Courtesy service compensation, promotional extension, special event reward..."
                      className={inputCls}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => setExtendTarget(null)}
                      className="btn-ghost px-4 py-2.5 rounded-xl text-xs text-mist hover:text-ivory min-h-[44px]"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={isSubmitting || effectiveDays <= 0}
                      onClick={handleExecuteExtend}
                      className="btn-gold rounded-xl px-5 py-2.5 text-xs font-medium disabled:opacity-40 min-h-[44px]"
                    >
                      {isSubmitting ? "Extending…" : `Extend (+${effectiveDays} Days)`}
                    </button>
                  </div>
                </div>
              );
            })()}
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
