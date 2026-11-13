import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Check,
  AlertTriangle,
  Receipt,
  CreditCard,
  Banknote,
  RotateCcw,
  Eye,
  Plus,
} from "lucide-react";
import type { Payment, PaymentStatus, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import {
  Badge,
  EmptyState,
  Field,
  Modal,
  SectionHead,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { fmtDate, inr, rowCls, tdCls, thCls, timeAgo } from "./_util";

const STATUS_TONES: Record<PaymentStatus, "gold" | "green" | "rose" | "muted"> = {
  pending: "gold",
  verified: "green",
  failed: "rose",
  refunded: "muted",
};

const ITEMS_PER_PAGE = 10;

type SortField = "createdAt" | "amount";
type SortOrder = "asc" | "desc";

export default function Payments() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  // Filter & Search states
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  // Modals & Action targets
  const [cashOpen, setCashOpen] = useState(false);
  const [cashEmail, setCashEmail] = useState("");
  const [cashAmount, setCashAmount] = useState("");
  const [cashNote, setCashNote] = useState("");

  const [refundTarget, setRefundTarget] = useState<Payment | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [inspectPayment, setInspectPayment] = useState<Payment | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // In-flight state tracking
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [cashSubmitting, setCashSubmitting] = useState(false);

  // Load raw payments and users
  const { data: paymentsRaw, loading, error, refresh: refreshPayments } = useAsync(
    (b) => b.allPayments(),
    [db],
    [] as Payment[],
  );
  const { data: all } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => {
    const unsub = db.subscribe("payments", refreshPayments);
    return () => unsub();
  }, [db, refreshPayments]);

  const userMap = useMemo(() => new Map(all.map((u) => [u.id, u])), [all]);

  // Financial KPI Calculations from complete raw ledger
  const financialMetrics = useMemo(() => {
    let grossCaptured = 0;
    let totalRefunds = 0;
    let netRevenue = 0;
    let verifiedCount = 0;
    let pendingCount = 0;
    let refundedCount = 0;
    let failedCount = 0;

    for (const p of paymentsRaw) {
      if (p.status === "verified") {
        grossCaptured += p.amount;
        netRevenue += p.amount;
        verifiedCount++;
      } else if (p.status === "refunded") {
        grossCaptured += p.amount; // Captured originally before refund
        totalRefunds += p.amount;
        refundedCount++;
      } else if (p.status === "pending") {
        pendingCount++;
      } else if (p.status === "failed") {
        failedCount++;
      }
    }

    return {
      grossCaptured,
      totalRefunds,
      netRevenue,
      totalCount: paymentsRaw.length,
      verifiedCount,
      pendingCount,
      refundedCount,
      failedCount,
    };
  }, [paymentsRaw]);

  // Filter, search, and sort logic
  const filteredPayments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return paymentsRaw
      .filter((p) => {
        // Status filter
        if (statusFilter !== "all" && p.status !== statusFilter) return false;

        // Kind filter
        if (kindFilter !== "all" && p.kind !== kindFilter) return false;

        // Search across member name, email, payment ID, gateway IDs
        if (q) {
          const u = userMap.get(p.userId);
          const name = (u?.firstName || "").toLowerCase();
          const email = (u?.email || "").toLowerCase();
          const id = p.id.toLowerCase();
          const orderId = (p.razorpayOrderId || "").toLowerCase();
          const payId = (p.razorpayPaymentId || "").toLowerCase();
          const method = (p.method || "").toLowerCase();

          if (
            !name.includes(q) &&
            !email.includes(q) &&
            !id.includes(q) &&
            !orderId.includes(q) &&
            !payId.includes(q) &&
            !method.includes(q)
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
        } else if (sortField === "amount") {
          diff = a.amount - b.amount;
        }
        return sortOrder === "asc" ? diff : -diff;
      });
  }, [paymentsRaw, statusFilter, kindFilter, searchQuery, sortField, sortOrder, userMap]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredPayments.length / ITEMS_PER_PAGE));
  const paginatedPayments = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredPayments.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredPayments, currentPage]);

  // Reset pagination on filter or search changes
  const handleSearchChange = (val: string) => {
    setSearchQuery(val);
    setCurrentPage(1);
  };

  const handleStatusFilter = (st: string) => {
    setStatusFilter(st);
    setCurrentPage(1);
  };

  const handleKindFilter = (kd: string) => {
    setKindFilter(kd);
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

  // Payment Verification with in-flight guard
  const onVerify = async (p: Payment) => {
    if (submittingIds.has(p.id)) return;

    setSubmittingIds((prev) => new Set(prev).add(p.id));
    try {
      const res = await db.verifyPayment(p.id, actor);
      refreshPayments();
      if (res && res.status === "verified") {
        toast(`Payment ${p.id} verified and membership provisioned`, "gold");
      } else {
        toast("Payment could not be verified", "rose");
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : "Verification failed", "rose");
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
    }
  };

  // Administrative Refund Execution with in-flight guard
  const handleExecuteRefund = async () => {
    if (!refundTarget || submittingIds.has(refundTarget.id)) return;

    const p = refundTarget;
    setSubmittingIds((prev) => new Set(prev).add(p.id));

    try {
      await db.refundPayment(p.id, actor, refundReason.trim());
      refreshPayments();
      toast(
        `Refund of ${inr(p.amount)} recorded in ledger and entitlements reconciled`,
        "gold",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Refund failed", "rose");
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      setRefundTarget(null);
      setRefundReason("");
    }
  };

  // Submit manual cash payment
  const submitCash = async () => {
    const u = all.find((x) => x.email.toLowerCase() === cashEmail.trim().toLowerCase());
    const amount = Number(cashAmount);
    if (!u) return toast("No member with that email", "rose");
    if (!Number.isFinite(amount) || amount <= 0) return toast("Enter a valid amount", "rose");

    setCashSubmitting(true);
    try {
      await db.recordCashPayment(u.id, amount, cashNote.trim() || "counter payment", actor);
      setCashOpen(false);
      setCashEmail("");
      setCashAmount("");
      setCashNote("");
      refreshPayments();
      toast(`Cash payment of ${inr(amount)} recorded for ${u.firstName}`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not record payment", "rose");
    } finally {
      setCashSubmitting(false);
    }
  };

  // Copy helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(text);
    toast(`${label} copied to clipboard`, "gold");
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="px-0 sm:px-5 pb-16 sm:pb-24 pt-4 sm:pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <SectionHead
            kicker="Money movement"
            title="Payments & Ledger"
            sub="Verify online payments, record cash receipts, and reconcile administrative refunds. History is permanent and immutable."
            align="left"
          />
          <button
            type="button"
            onClick={() => setCashOpen(true)}
            className="btn-gold rounded-xl px-5 py-3 min-h-[44px] text-sm font-medium flex items-center justify-center gap-2 shrink-0 sm:self-start mt-2 sm:mt-0 w-full sm:w-auto"
          >
            <Plus className="w-4 h-4" />
            <span>Record Cash Payment</span>
          </button>
        </div>

        {error && (
          <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-sm flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>Couldn&apos;t load payments: {error}</span>
          </div>
        )}

        {/* Financial KPI Summary Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Net Realized Revenue */}
          <div className="glass rounded-2xl p-5 border border-white/10 relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-mist">
              <span className="uppercase tracking-wider font-semibold">Net Realized Revenue</span>
              <Banknote className="w-4 h-4 text-champagne" />
            </div>
            <p className="font-display text-2xl md:text-3xl font-semibold text-gradient-gold mt-2">
              {inr(financialMetrics.netRevenue)}
            </p>
            <p className="text-[0.68rem] text-mist/80 mt-1">
              Realized captured revenue after refunds
            </p>
          </div>

          {/* Gross Captured Revenue */}
          <div className="glass rounded-2xl p-5 border border-white/10 relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-mist">
              <span className="uppercase tracking-wider font-semibold">Gross Captured</span>
              <Receipt className="w-4 h-4 text-emerald-400" />
            </div>
            <p className="font-display text-2xl md:text-3xl font-semibold text-ivory mt-2">
              {inr(financialMetrics.grossCaptured)}
            </p>
            <p className="text-[0.68rem] text-emerald-400/80 mt-1">
              {financialMetrics.verifiedCount + financialMetrics.refundedCount} transactions captured
            </p>
          </div>

          {/* Total Refunds */}
          <div className="glass rounded-2xl p-5 border border-white/10 relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-mist">
              <span className="uppercase tracking-wider font-semibold">Total Refunds</span>
              <RotateCcw className="w-4 h-4 text-rose-400" />
            </div>
            <p className="font-display text-2xl md:text-3xl font-semibold text-rose-300 mt-2">
              {inr(financialMetrics.totalRefunds)}
            </p>
            <p className="text-[0.68rem] text-rose-300/80 mt-1">
              {financialMetrics.refundedCount} refunded transaction{financialMetrics.refundedCount === 1 ? "" : "s"}
            </p>
          </div>

          {/* Pending Verification */}
          <div className="glass rounded-2xl p-5 border border-white/10 relative overflow-hidden">
            <div className="flex items-center justify-between text-xs text-mist">
              <span className="uppercase tracking-wider font-semibold">Pending Triage</span>
              <CreditCard className="w-4 h-4 text-amber-400" />
            </div>
            <p className="font-display text-2xl md:text-3xl font-semibold text-amber-300 mt-2">
              {financialMetrics.pendingCount}
            </p>
            <p className="text-[0.68rem] text-amber-300/80 mt-1">
              Transactions awaiting verification
            </p>
          </div>
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
            All Payments ({financialMetrics.totalCount})
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("verified")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "verified"
                ? "bg-emerald-500/25 text-emerald-300 border border-emerald-500/40"
                : "text-mist hover:text-emerald-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            <span>Verified ({financialMetrics.verifiedCount})</span>
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
            <span>Pending ({financialMetrics.pendingCount})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("refunded")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "refunded"
                ? "bg-white/20 text-ivory border border-white/30"
                : "text-mist hover:text-ivory bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-mist" />
            <span>Refunded ({financialMetrics.refundedCount})</span>
          </button>
          <button
            type="button"
            onClick={() => handleStatusFilter("failed")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 ${
              statusFilter === "failed"
                ? "bg-rose-500/25 text-rose-300 border border-rose-500/40"
                : "text-mist hover:text-rose-300 bg-white/5 border border-white/5"
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
            <span>Failed ({financialMetrics.failedCount})</span>
          </button>
        </div>

        {/* Filter, Search & Sort Control Bar */}
        <div className="glass rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          <div className="relative flex-1 min-w-0 sm:min-w-[260px]">
            <Search className="w-4 h-4 text-mist absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Search by member, email, payment ID, order ID, gateway pay ID..."
              className={`${inputCls} pl-10 pr-14 w-full`}
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
            {/* Kind filter */}
            <select
              value={kindFilter}
              onChange={(e) => handleKindFilter(e.target.value)}
              className={`${inputCls} text-xs py-2 w-full sm:w-auto`}
            >
              <option value="all">All Types</option>
              <option value="membership">Membership</option>
              <option value="experience">Experience</option>
              <option value="cash">Cash / Offline</option>
            </select>

            {/* Sort Toggle */}
            <div className="flex flex-wrap items-center gap-1 bg-white/5 border border-white/10 rounded-xl px-2 py-1">
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
                onClick={() => handleSortToggle("amount")}
                className={`px-2 py-1 rounded-lg text-xs transition-colors flex items-center gap-1 ${
                  sortField === "amount" ? "text-champagne font-medium" : "text-mist hover:text-ivory"
                }`}
              >
                <span>Amount</span>
                {sortField === "amount" && (
                  <ArrowUpDown className="w-3 h-3 text-champagne" />
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Results summary label */}
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-mist px-1">
          <span>
            Showing {filteredPayments.length === 0 ? 0 : (currentPage - 1) * ITEMS_PER_PAGE + 1}–
            {Math.min(currentPage * ITEMS_PER_PAGE, filteredPayments.length)} of {filteredPayments.length}{" "}
            transactions
          </span>
          {filteredPayments.length !== paymentsRaw.length && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery("");
                setStatusFilter("all");
                setKindFilter("all");
                setCurrentPage(1);
              }}
              className="text-champagne hover:underline"
            >
              Reset filters
            </button>
          )}
        </div>

        {/* Ledger Table */}
        <div className="glass rounded-3xl overflow-hidden">
          {loading && paymentsRaw.length === 0 ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : filteredPayments.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="No transactions match your criteria"
                body="Adjust your search query, clear filters, or record a new transaction."
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[960px]">
                <thead>
                  <tr>
                    <th className={thCls}>Transaction ID</th>
                    <th className={thCls}>Member</th>
                    <th className={thCls}>Kind / Plan</th>
                    <th className={thCls}>Amount</th>
                    <th className={thCls}>Gateway Reference</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Created</th>
                    <th className={`${thCls} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedPayments.map((p) => {
                    const u = userMap.get(p.userId);
                    const isSubmitting = submittingIds.has(p.id);

                    return (
                      <tr key={p.id} className={rowCls}>
                        {/* Transaction ID */}
                        <td className={tdCls}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs text-mist">{p.id.slice(0, 10)}…</span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(p.id, "Payment ID")}
                              className="text-mist hover:text-champagne p-0.5 rounded transition-colors"
                              title="Copy full payment ID"
                            >
                              {copiedId === p.id ? (
                                <Check className="w-3 h-3 text-champagne" />
                              ) : (
                                <Copy className="w-3 h-3" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* Member */}
                        <td className={tdCls}>
                          <p className="text-ivory font-medium whitespace-nowrap">
                            {u?.firstName ?? "Unknown Member"}
                          </p>
                          <p className="text-xs text-mist font-mono">{u?.email ?? "—"}</p>
                        </td>

                        {/* Kind / Plan */}
                        <td className={tdCls}>
                          <span className="text-ivory-dim capitalize font-medium">{p.kind}</span>
                          {p.planId && (
                            <span className="block text-[0.68rem] text-champagne capitalize">
                              ✦ {p.planId}
                            </span>
                          )}
                        </td>

                        {/* Amount */}
                        <td className={`${tdCls} text-champagne font-medium whitespace-nowrap text-base`}>
                          {inr(p.amount)}
                        </td>

                        {/* Gateway Reference */}
                        <td className={`${tdCls} text-xs text-mist max-w-[200px]`}>
                          {p.razorpayPaymentId ? (
                            <div className="flex items-center gap-1 font-mono text-[0.72rem] text-ivory">
                              <span className="truncate">{p.razorpayPaymentId}</span>
                              <button
                                type="button"
                                onClick={() => copyToClipboard(p.razorpayPaymentId!, "Gateway Payment ID")}
                                className="text-mist hover:text-champagne shrink-0"
                                title="Copy Gateway ID"
                              >
                                {copiedId === p.razorpayPaymentId ? (
                                  <Check className="w-3 h-3 text-champagne" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                              </button>
                            </div>
                          ) : p.kind === "cash" ? (
                            <span className="text-mist/70 italic">Cash / Counter</span>
                          ) : (
                            <span className="text-mist/50">Pending capture</span>
                          )}
                          <p className="text-[0.68rem] text-mist/70 truncate">{p.method}</p>
                        </td>

                        {/* Status */}
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONES[p.status]}>{p.status}</Badge>
                        </td>

                        {/* Created Date */}
                        <td className={`${tdCls} text-mist whitespace-nowrap text-xs`}>
                          <p>{fmtDate(p.createdAt)}</p>
                          <p className="text-[0.68rem] text-mist/70">{timeAgo(p.createdAt)}</p>
                        </td>

                        {/* Actions */}
                        <td className={`${tdCls} text-right`}>
                          <div className="flex items-center justify-end gap-1.5 flex-wrap">
                            {/* Inspect Detail Button */}
                            <button
                              type="button"
                              onClick={() => setInspectPayment(p)}
                              className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-mist hover:text-ivory flex items-center gap-1"
                              title="Inspect full transaction record"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              <span>Details</span>
                            </button>

                            {/* Verify Action */}
                            {p.status === "pending" && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => onVerify(p)}
                                className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-emerald-300 hover:text-emerald-200 border-emerald-500/30 hover:bg-emerald-500/10 whitespace-nowrap disabled:opacity-40"
                              >
                                {isSubmitting ? "Verifying…" : "Verify"}
                              </button>
                            )}

                            {/* Refund Action */}
                            {p.status === "verified" && (
                              <button
                                type="button"
                                disabled={isSubmitting}
                                onClick={() => {
                                  setRefundTarget(p);
                                  setRefundReason("");
                                }}
                                className="btn-ghost rounded-lg px-2.5 py-1 text-xs text-rose-300 hover:text-rose-200 border-rose-500/30 hover:bg-rose-500/10 whitespace-nowrap disabled:opacity-40"
                              >
                                {isSubmitting ? "Refunding…" : "Refund"}
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

      {/* Record Cash Payment Modal */}
      <AnimatePresence>
        {cashOpen && (
          <Modal open onClose={() => setCashOpen(false)} title="Record Cash Payment">
            <div className="space-y-4">
              <Field label="Member email" hint="The payment is credited to this member's account.">
                <input
                  value={cashEmail}
                  onChange={(e) => setCashEmail(e.target.value)}
                  placeholder="member@example.com"
                  className={inputCls}
                />
              </Field>
              <Field label="Amount (₹)">
                <input
                  value={cashAmount}
                  onChange={(e) => setCashAmount(e.target.value)}
                  placeholder="1200"
                  inputMode="numeric"
                  className={inputCls}
                />
              </Field>
              <Field label="Note" hint="Counter receipt, purpose, reference.">
                <input
                  value={cashNote}
                  onChange={(e) => setCashNote(e.target.value)}
                  placeholder="Experience fee — cash at venue"
                  className={inputCls}
                />
              </Field>
              <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setCashOpen(false)}
                  className="btn-ghost px-4 py-2.5 rounded-xl text-xs text-mist hover:text-ivory min-h-[44px]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={cashSubmitting}
                  onClick={submitCash}
                  className="btn-gold rounded-xl px-5 py-2.5 text-xs font-medium min-h-[44px]"
                >
                  {cashSubmitting ? "Recording…" : "Record Payment"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* In-App Refund Confirmation Modal */}
      {refundTarget && (
        <Modal
          open={Boolean(refundTarget)}
          onClose={() => setRefundTarget(null)}
          title="Record Administrative Refund"
        >
          {(() => {
            const u = userMap.get(refundTarget.userId);
            const isSubmitting = submittingIds.has(refundTarget.id);

            return (
              <div className="space-y-5">
                <p className="text-sm text-ivory-dim leading-relaxed">
                  You are recording a full refund of{" "}
                  <strong className="text-champagne font-semibold">{inr(refundTarget.amount)}</strong>{" "}
                  for member{" "}
                  <strong className="text-ivory">{u?.firstName ?? "Unknown Member"}</strong>.
                </p>

                {/* Transaction details card */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-mist">Transaction ID:</span>
                    <span className="text-ivory font-mono text-[0.72rem] break-all">{refundTarget.id}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-mist">Kind:</span>
                    <span className="text-ivory capitalize font-medium">{refundTarget.kind}</span>
                  </div>
                  {refundTarget.planId && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-mist">Associated Tier:</span>
                      <span className="text-champagne capitalize">✦ {refundTarget.planId}</span>
                    </div>
                  )}
                  {refundTarget.razorpayPaymentId && (
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-mist">Gateway Payment Ref:</span>
                      <span className="text-ivory font-mono text-[0.72rem] break-all">
                        {refundTarget.razorpayPaymentId}
                      </span>
                    </div>
                  )}
                </div>

                {/* Entitlement Consequence Notice */}
                {refundTarget.kind === "membership" && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs space-y-1 text-amber-200/90 leading-relaxed">
                    <p className="font-semibold text-amber-300 flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>Membership Entitlement Reconciled</span>
                    </p>
                    <p>
                      Recording this refund will cancel the active subscription funded by this
                      payment and revert the member&apos;s profile plan access (unless superseded by
                      a newer verified payment).
                    </p>
                  </div>
                )}

                {/* Gateway Distinction Disclaimer */}
                <div className="p-3 rounded-xl bg-white/[0.02] border border-white/5 text-[0.72rem] text-mist leading-relaxed">
                  <strong>Ledger Notice:</strong> This operation records an administrative refund in
                  Datevra&apos;s internal financial database and notifies the member. External
                  gateway and card refunds must be processed through your Razorpay Merchant
                  Dashboard.
                </div>

                {/* Optional Refund Note */}
                <Field label="Administrative Reason / Note (optional)">
                  <input
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Customer request, duplicate charge, dissatisfaction..."
                    className={inputCls}
                  />
                </Field>

                {/* Modal Buttons */}
                <div className="flex flex-wrap items-center justify-end gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setRefundTarget(null)}
                    className="btn-ghost px-4 py-2.5 rounded-xl text-xs text-mist hover:text-ivory min-h-[44px]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handleExecuteRefund}
                    className="btn-ghost rounded-xl px-4 py-2.5 text-xs font-medium text-rose-300 hover:text-rose-200 border-rose-500/40 hover:bg-rose-500/20 disabled:opacity-40 min-h-[44px]"
                  >
                    {isSubmitting ? "Recording Refund…" : "Record Refund in Ledger"}
                  </button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}

      {/* Transaction Details & Gateway Inspection Modal */}
      {inspectPayment && (
        <Modal
          open={Boolean(inspectPayment)}
          onClose={() => setInspectPayment(null)}
          title={`Transaction Audit — #${inspectPayment.id.slice(0, 10)}`}
          wide={true}
        >
          {(() => {
            const u = userMap.get(inspectPayment.userId);
            return (
              <div className="space-y-6 text-xs">
                {/* Status bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-white/[0.03] border border-white/10">
                  <div className="flex items-center gap-2">
                    <span className="text-mist">Status:</span>
                    <Badge tone={STATUS_TONES[inspectPayment.status]}>{inspectPayment.status}</Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-mist">Amount:</span>
                    <span className="text-base font-semibold text-champagne">
                      {inr(inspectPayment.amount)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-mist">Date:</span>
                    <span className="text-ivory">{fmtDate(inspectPayment.createdAt)}</span>
                  </div>
                </div>

                {/* Customer Information Card */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-2">
                  <p className="text-[0.68rem] uppercase tracking-wider text-mist font-semibold">
                    Customer Account
                  </p>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-ivory font-medium text-sm">
                      {u?.firstName ?? "Unknown Member"}
                    </span>
                    <span className="text-mist font-mono break-all">{u?.email ?? "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-mist pt-1">
                    <span>User UUID:</span>
                    <span className="font-mono break-all">{inspectPayment.userId}</span>
                  </div>
                </div>

                {/* Gateway & Reconciliation Identifiers */}
                <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                  <p className="text-[0.68rem] uppercase tracking-wider text-mist font-semibold">
                    Gateway & Reconciliation Identifiers
                  </p>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-white/5">
                      <span className="text-mist">Internal Payment ID:</span>
                      <div className="flex items-center gap-2 font-mono text-ivory min-w-0">
                        <span className="break-all">{inspectPayment.id}</span>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(inspectPayment.id, "Payment ID")}
                          className="text-mist hover:text-champagne shrink-0"
                        >
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-white/5">
                      <span className="text-mist">Razorpay Order ID:</span>
                      <div className="flex items-center gap-2 font-mono text-ivory min-w-0">
                        <span className="break-all">{inspectPayment.razorpayOrderId ?? "None / Offline"}</span>
                        {inspectPayment.razorpayOrderId && (
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(inspectPayment.razorpayOrderId!, "Order ID")
                            }
                            className="text-mist hover:text-champagne shrink-0"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-white/5">
                      <span className="text-mist">Razorpay Payment ID:</span>
                      <div className="flex items-center gap-2 font-mono text-ivory min-w-0">
                        <span className="break-all">{inspectPayment.razorpayPaymentId ?? "None / Pending"}</span>
                        {inspectPayment.razorpayPaymentId && (
                          <button
                            type="button"
                            onClick={() =>
                              copyToClipboard(inspectPayment.razorpayPaymentId!, "Payment ID")
                            }
                            className="text-mist hover:text-champagne shrink-0"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-black/40 border border-white/5">
                      <span className="text-mist">Payment Method Description:</span>
                      <span className="text-ivory font-mono break-all">{inspectPayment.method}</span>
                    </div>
                  </div>
                </div>

                {/* Audit & Legal retention note */}
                <div className="p-3.5 rounded-2xl bg-white/[0.02] border border-white/5 text-[0.72rem] text-mist leading-relaxed space-y-1">
                  <p>
                    • <strong>Accounting Retention:</strong> Per Migration 008 (Tax & Audit
                    Compliance), financial transaction rows are permanently retained and cannot be
                    deleted even if the member deletes their Datevra account.
                  </p>
                  <p>
                    • <strong>Refund Policy:</strong> Datevra supports transaction-level full
                    refunds. Partial refunds are not supported by the financial schema.
                  </p>
                </div>

                <div className="flex justify-end pt-2">
                  <button
                    type="button"
                    onClick={() => setInspectPayment(null)}
                    className="btn-ghost px-5 py-2.5 rounded-xl text-xs text-mist hover:text-ivory min-h-[44px]"
                  >
                    Close Inspection
                  </button>
                </div>
              </div>
            );
          })()}
        </Modal>
      )}
    </div>
  );
}
