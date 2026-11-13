import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  CreditCard,
  Sparkles,
  RefreshCw,
  PieChart,
  BarChart2,
  AlertCircle,
} from "lucide-react";
import { useAsync, useBackend } from "../../lib/data";
import type { Payment, UserProfile, DateApplication, DateBooking } from "../../lib/types";
import { Skeleton } from "../../components/ui";
import { inr } from "./_util";
import { countActiveOnlineUsers } from "../../lib/presence";

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
  const [dateFilter, setDateFilter] = useState<"all" | "30d" | "7d">("all");

  // Summary figures
  const {
    data: s,
    loading: sLoading,
    error: sError,
    refresh: refreshSummary,
  } = useAsync((b) => b.revenueSummary(), [db], EMPTY_SUMMARY);

  // All users for cohort / registration trends
  const {
    data: users,
    loading: uLoading,
    refresh: refreshUsers,
  } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  // All payments for status breakdown & transaction trends
  const {
    data: payments,
    loading: pLoading,
    refresh: refreshPayments,
  } = useAsync((b) => b.allPayments(), [db], [] as Payment[]);

  // Date applications for status distribution
  const {
    data: applications,
    loading: appLoading,
    refresh: refreshApps,
  } = useAsync((b) => b.allApplications(), [db], [] as DateApplication[]);

  // Bookings
  const {
    data: bookings,
    loading: bLoading,
    refresh: refreshBookings,
  } = useAsync((b) => b.allBookings(), [db], [] as DateBooking[]);

  useEffect(() => {
    const off1 = db.subscribe("payments", () => {
      refreshSummary();
      refreshPayments();
    });
    const off2 = db.subscribe("profiles", refreshUsers);
    const off3 = db.subscribe("applications", refreshApps);
    const off4 = db.subscribe("bookings", refreshBookings);
    return () => {
      off1();
      off2();
      off3();
      off4();
    };
  }, [db, refreshSummary, refreshPayments, refreshUsers, refreshApps, refreshBookings]);

  // Analytics Computations
  const analytics = useMemo(() => {
    const now = Date.now();
    const cutoff =
      dateFilter === "7d"
        ? now - 7 * 24 * 60 * 60 * 1000
        : dateFilter === "30d"
        ? now - 30 * 24 * 60 * 60 * 1000
        : 0;

    const filteredUsers = cutoff ? users.filter((u) => new Date(u.createdAt).getTime() >= cutoff) : users;
    const filteredPayments = cutoff ? payments.filter((p) => new Date(p.createdAt).getTime() >= cutoff) : payments;
    const filteredApps = cutoff ? applications.filter((a) => new Date(a.createdAt).getTime() >= cutoff) : applications;
    const filteredBookings = cutoff ? bookings.filter((b) => new Date(b.createdAt).getTime() >= cutoff) : bookings;

    // 1. Payment status breakdown & date-range filtered financials
    const paymentStatuses = {
      verified: filteredPayments.filter((p) => p.status === "verified"),
      pending: filteredPayments.filter((p) => p.status === "pending"),
      refunded: filteredPayments.filter((p) => p.status === "refunded"),
      failed: filteredPayments.filter((p) => p.status === "failed"),
    };

    const totalTxnCount = Math.max(1, filteredPayments.length);

    // Filter-consistent revenue calculations strictly from filtered payment records:
    // Only verified payments contribute to positive revenue; refunded payments are subtracted once to determine net.
    const verifiedPayments = paymentStatuses.verified;
    const verifiedMembership = verifiedPayments
      .filter((p) => p.kind === "membership")
      .reduce((sum, p) => sum + p.amount, 0);
    const verifiedExperience = verifiedPayments
      .filter((p) => p.kind === "experience")
      .reduce((sum, p) => sum + p.amount, 0);
    const verifiedCash = verifiedPayments
      .filter((p) => p.kind === "cash")
      .reduce((sum, p) => sum + p.amount, 0);
    const verifiedTotal = verifiedMembership + verifiedExperience + verifiedCash;

    // Refunded amount strictly within the selected reporting period
    const periodRefunded = paymentStatuses.refunded.reduce((sum, p) => sum + p.amount, 0);
    const netRevenue = Math.max(0, verifiedTotal - periodRefunded);

    // 2. Membership distribution (canonical names with secondary ID)
    const membershipDistribution = [
      { name: "Select", id: "connect", count: filteredUsers.filter((u) => u.plan === "connect").length, color: "bg-champagne", text: "text-champagne" },
      { name: "Signature", id: "plus", count: filteredUsers.filter((u) => u.plan === "plus").length, color: "bg-rosegold", text: "text-rosegold" },
      { name: "Privé", id: "elite", count: filteredUsers.filter((u) => u.plan === "elite").length, color: "bg-burgundy", text: "text-rose-300" },
      { name: "Free Tier", id: "none", count: filteredUsers.filter((u) => !u.plan).length, color: "bg-white/20", text: "text-mist" },
    ];
    const totalUsersCount = Math.max(1, filteredUsers.length);

    // 3. User registration trend (grouped by intervals)
    const dayMap = new Map<string, number>();
    const sortedUsers = [...filteredUsers].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    // Group users by date (YYYY-MM-DD)
    sortedUsers.forEach((u) => {
      const day = u.createdAt ? u.createdAt.slice(0, 10) : "Unknown";
      dayMap.set(day, (dayMap.get(day) || 0) + 1);
    });

    const userRegistrationBars = Array.from(dayMap.entries())
      .slice(-10) // show up to last 10 date buckets with activity
      .map(([date, count]) => ({ date, count }));

    const maxRegCount = Math.max(1, ...userRegistrationBars.map((b) => b.count));

    // 4. Date application statistics by status
    const appStatusMap = {
      submitted: filteredApps.filter((a) => a.status === "submitted").length,
      under_review: filteredApps.filter((a) => a.status === "under_review").length,
      eligible: filteredApps.filter((a) => a.status === "eligible").length,
      confirmed: filteredApps.filter((a) => a.status === "confirmed").length,
      completed: filteredApps.filter((a) => a.status === "completed").length,
      declined: filteredApps.filter((a) => a.status === "declined").length,
    };

    // 5. Booking statistics
    const bookingStats = {
      upcoming: filteredBookings.filter((b) => b.status === "upcoming").length,
      completed: filteredBookings.filter((b) => b.status === "completed").length,
      cancelled: filteredBookings.filter((b) => b.status === "cancelled").length,
      totalRevenue: filteredBookings.reduce((sum, b) => sum + (b.amount || 0), 0),
    };

    // 6. Verified revenue breakdown respecting the date filter
    // If dateFilter === "all", use s summary directly; otherwise use period-filtered sums
    const verifiedRevenue = {
      total: dateFilter === "all" ? s.total : verifiedTotal,
      membership: dateFilter === "all" ? s.membership : verifiedMembership,
      experience: dateFilter === "all" ? s.experience : verifiedExperience,
      cash: dateFilter === "all" ? s.cash : verifiedCash,
      refunded: dateFilter === "all" ? s.refunded : periodRefunded,
      cafeCommissions: s.cafeCommissions,
      net: dateFilter === "all" ? s.total - s.refunded : netRevenue,
    };

    return {
      filteredPayments,
      paymentStatuses,
      totalTxnCount,
      membershipDistribution,
      totalUsersCount,
      userRegistrationBars,
      maxRegCount,
      appStatusMap,
      bookingStats,
      verifiedRevenue,
    };
  }, [dateFilter, users, payments, applications, bookings, s]);

  const isLoading = sLoading && uLoading && pLoading && appLoading && bLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-72" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header with Title & Filter Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b hairline">
        <div>
          <div className="flex items-center gap-2">
            <TrendingUp size={14} className="text-rosegold" />
            <span className="text-[0.68rem] uppercase tracking-widest text-mist font-semibold">
              Financial & Member Intelligence
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-medium tracking-wide text-ivory mt-1">
            Revenue & Growth Analytics
          </h1>
          <p className="text-xs text-mist mt-0.5">
            Verified performance metrics derived from actual database records and transactions.
          </p>
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center p-1 rounded-xl glass border hairline text-xs">
            <button
              onClick={() => setDateFilter("all")}
              className={`px-3 py-1 rounded-lg transition-colors font-medium ${
                dateFilter === "all"
                  ? "bg-rosegold/20 text-ivory border border-rosegold/40"
                  : "text-mist hover:text-ivory"
              }`}
            >
              All-Time
            </button>
            <button
              onClick={() => setDateFilter("30d")}
              className={`px-3 py-1 rounded-lg transition-colors font-medium ${
                dateFilter === "30d"
                  ? "bg-rosegold/20 text-ivory border border-rosegold/40"
                  : "text-mist hover:text-ivory"
              }`}
            >
              Last 30 Days
            </button>
            <button
              onClick={() => setDateFilter("7d")}
              className={`px-3 py-1 rounded-lg transition-colors font-medium ${
                dateFilter === "7d"
                  ? "bg-rosegold/20 text-ivory border border-rosegold/40"
                  : "text-mist hover:text-ivory"
              }`}
            >
              Last 7 Days
            </button>
          </div>

          <button
            onClick={() => {
              refreshSummary();
              refreshUsers();
              refreshPayments();
              refreshApps();
              refreshBookings();
            }}
            className="p-2 rounded-xl glass hover:border-rosegold/40 text-mist hover:text-ivory transition-colors"
            title="Refresh analytics data"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {sError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle size={16} className="shrink-0" />
          <span>Error loading revenue figures: {sError}</span>
        </div>
      )}

      {/* Primary KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="glass rounded-2xl p-5 border hairline">
          <div className="flex items-center justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Net Realized Revenue</p>
            <span className="text-[0.62rem] text-champagne bg-champagne/10 px-1.5 py-0.5 rounded border border-champagne/20 font-medium">
              {dateFilter === "all" ? "All-Time" : dateFilter === "30d" ? "Last 30d" : "Last 7d"}
            </span>
          </div>
          <p className="font-display text-3xl text-gradient-gold font-semibold mt-2">
            {inr(analytics.verifiedRevenue.net)}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-mist">
            <span>Verified: {inr(analytics.verifiedRevenue.total)}</span>
            <span>•</span>
            <span className="text-rose-300">-{inr(analytics.verifiedRevenue.refunded)}</span>
          </div>
        </div>

        <div className="glass rounded-2xl p-5 border hairline">
          <div className="flex items-center justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Verified Memberships</p>
            <span className="text-[0.62rem] text-champagne bg-champagne/10 px-1.5 py-0.5 rounded border border-champagne/20 font-medium">
              {dateFilter === "all" ? "All-Time" : dateFilter === "30d" ? "Last 30d" : "Last 7d"}
            </span>
          </div>
          <p className="font-display text-3xl text-ivory font-semibold mt-2">
            {inr(analytics.verifiedRevenue.membership)}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-mist">
            <span className="text-champagne font-medium">{s.activeSubscriptions} active subscriptions</span>
          </div>
        </div>

        <div className="glass rounded-2xl p-5 border hairline">
          <div className="flex items-center justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Experience & Date Fees</p>
            <span className="text-[0.62rem] text-champagne bg-champagne/10 px-1.5 py-0.5 rounded border border-champagne/20 font-medium">
              {dateFilter === "all" ? "All-Time" : dateFilter === "30d" ? "Last 30d" : "Last 7d"}
            </span>
          </div>
          <p className="font-display text-3xl text-ivory font-semibold mt-2">
            {inr(analytics.verifiedRevenue.experience)}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-mist">
            <span className="text-pink-300 font-medium">{analytics.bookingStats.completed} completed dates</span>
          </div>
        </div>

        <div className="glass rounded-2xl p-5 border hairline">
          <div className="flex items-center justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Partner Café Share</p>
            <span className="text-[0.62rem] text-mist bg-white/5 px-1.5 py-0.5 rounded border border-white/10 font-medium">
              Cumulative
            </span>
          </div>
          <p className="font-display text-3xl text-ivory font-semibold mt-2">
            {inr(analytics.verifiedRevenue.cafeCommissions)}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-mist">
            <span>Payable partner commission</span>
          </div>
        </div>
      </div>

      {/* Chart Section 1: User Growth Timeline & Membership Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Registration Activity Chart */}
        <div className="glass rounded-2xl p-4 sm:p-6 border hairline space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <BarChart2 size={16} className="text-rosegold" />
                <h2 className="font-display text-lg text-ivory">User Registration Pace</h2>
              </div>
              <p className="text-xs text-mist mt-0.5">Profiles created per date bucket ({dateFilter})</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className="text-xs font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20 flex items-center gap-1.5"
                title="Members with verifiable activity in the last 15 minutes"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {countActiveOnlineUsers(users)} Active Recently
              </span>
              <span className="text-xs font-mono font-medium text-champagne bg-champagne/10 px-2 py-0.5 rounded border border-champagne/20">
                {users.length} Registered
              </span>
            </div>
          </div>

          {analytics.userRegistrationBars.length === 0 ? (
            <div className="h-48 flex items-center justify-center text-xs text-mist">
              No registration records found for this period.
            </div>
          ) : (
            <div className="pt-6">
              <div className="h-44 flex items-end gap-2 border-b hairline pb-2">
                {analytics.userRegistrationBars.map((b) => {
                  const heightPct = Math.max(8, (b.count / analytics.maxRegCount) * 100);
                  return (
                    <div key={b.date} className="flex-1 flex flex-col items-center gap-1.5 group relative">
                      <div className="w-full flex justify-center">
                        <motion.div
                          initial={{ height: 0 }}
                          animate={{ height: `${heightPct}%` }}
                          transition={{ duration: 0.6, ease: "easeOut" }}
                          className="w-full max-w-[28px] rounded-t-lg bg-gradient-to-t from-rosegold/50 via-rosegold to-champagne group-hover:brightness-125 transition-all"
                        />
                      </div>
                      <span className="text-[0.62rem] text-mist font-mono truncate max-w-[42px]">
                        {b.date.slice(5)}
                      </span>

                      {/* Tooltip on hover */}
                      <div className="pointer-events-none absolute bottom-full mb-2 hidden group-hover:flex flex-col items-center z-20">
                        <div className="px-2 py-1 rounded bg-onyx text-ivory text-[0.68rem] shadow-lg border hairline whitespace-nowrap">
                          <p className="font-semibold">{b.count} registrations</p>
                          <p className="text-[0.6rem] text-mist">{b.date}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Membership Tier Distribution */}
        <div className="glass rounded-2xl p-4 sm:p-6 border hairline space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <PieChart size={16} className="text-champagne" />
                <h2 className="font-display text-lg text-ivory">Membership Tier Composition</h2>
              </div>
              <p className="text-xs text-mist mt-0.5">Active profiles across tiers</p>
            </div>
            <span className="text-xs font-mono font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
              {s.activeSubscriptions} Paid Subscriptions
            </span>
          </div>

          <div className="space-y-3.5 pt-2">
            {analytics.membershipDistribution.map((m) => {
              const sharePct = (m.count / analytics.totalUsersCount) * 100;
              return (
                <div key={m.name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ivory font-medium flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${m.color}`} />
                      <span>{m.name}</span>
                      {m.id !== "none" && (
                        <span className="text-[0.65rem] text-mist/60 font-mono">({m.id})</span>
                      )}
                    </span>
                    <div className="flex items-center gap-2 font-mono">
                      <span className={m.text}>{m.count} members</span>
                      <span className="text-mist text-[0.68rem]">({sharePct.toFixed(1)}%)</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, sharePct)}%` }}
                      transition={{ duration: 0.8 }}
                      className={`h-full rounded-full ${m.color}`}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-[0.68rem] text-mist/80 pt-2 border-t hairline">
            Higher tiers (Signature & Privé) unlock unlimited daily interests, verified badge priority, and complimentary curated date bookings.
          </p>
        </div>
      </div>

      {/* Chart Section 2: Payment Status Breakdown & Date Experience Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Status Breakdown */}
        <div className="glass rounded-2xl p-4 sm:p-6 border hairline space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <CreditCard size={16} className="text-emerald-400" />
                <h2 className="font-display text-lg text-ivory">Payment Transaction Statuses</h2>
              </div>
              <p className="text-xs text-mist mt-0.5">Distribution across verified, pending, and refunded</p>
            </div>
            <span className="text-xs text-mist font-mono font-medium">
              {analytics.filteredPayments.length} Transactions
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-center">
              <p className="text-[0.68rem] uppercase tracking-wider text-emerald-300 font-medium">Verified</p>
              <p className="font-display text-2xl font-semibold text-emerald-200 mt-1">
                {analytics.paymentStatuses.verified.length}
              </p>
              <p className="text-[0.65rem] text-emerald-400/80 mt-0.5 font-mono">
                {((analytics.paymentStatuses.verified.length / analytics.totalTxnCount) * 100).toFixed(0)}%
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-center">
              <p className="text-[0.68rem] uppercase tracking-wider text-amber-300 font-medium">Pending</p>
              <p className="font-display text-2xl font-semibold text-amber-200 mt-1">
                {analytics.paymentStatuses.pending.length}
              </p>
              <p className="text-[0.65rem] text-amber-400/80 mt-0.5 font-mono">
                {((analytics.paymentStatuses.pending.length / analytics.totalTxnCount) * 100).toFixed(0)}%
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-center">
              <p className="text-[0.68rem] uppercase tracking-wider text-rose-300 font-medium">Refunded</p>
              <p className="font-display text-2xl font-semibold text-rose-200 mt-1">
                {analytics.paymentStatuses.refunded.length}
              </p>
              <p className="text-[0.65rem] text-rose-400/80 mt-0.5 font-mono">
                {((analytics.paymentStatuses.refunded.length / analytics.totalTxnCount) * 100).toFixed(0)}%
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 text-center">
              <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Failed</p>
              <p className="font-display text-2xl font-semibold text-ivory-dim mt-1">
                {analytics.paymentStatuses.failed.length}
              </p>
              <p className="text-[0.65rem] text-mist mt-0.5 font-mono">
                {((analytics.paymentStatuses.failed.length / analytics.totalTxnCount) * 100).toFixed(0)}%
              </p>
            </div>
          </div>

          <div className="pt-2">
            <div className="h-3 rounded-full bg-white/5 overflow-hidden flex gap-0.5 p-0.5">
              <div
                className="h-full rounded-sm bg-emerald-400"
                style={{ width: `${(analytics.paymentStatuses.verified.length / analytics.totalTxnCount) * 100}%` }}
                title="Verified"
              />
              <div
                className="h-full rounded-sm bg-amber-400"
                style={{ width: `${(analytics.paymentStatuses.pending.length / analytics.totalTxnCount) * 100}%` }}
                title="Pending"
              />
              <div
                className="h-full rounded-sm bg-rose-400"
                style={{ width: `${(analytics.paymentStatuses.refunded.length / analytics.totalTxnCount) * 100}%` }}
                title="Refunded"
              />
              <div
                className="h-full rounded-sm bg-gray-500"
                style={{ width: `${(analytics.paymentStatuses.failed.length / analytics.totalTxnCount) * 100}%` }}
                title="Failed"
              />
            </div>
          </div>
        </div>

        {/* Date Application Funnel & Bookings */}
        <div className="glass rounded-2xl p-4 sm:p-6 border hairline space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={16} className="text-rosegold" />
                <h2 className="font-display text-lg text-ivory">Date Experience Funnel</h2>
              </div>
              <p className="text-xs text-mist mt-0.5">Applications lifecycle from review to booked date</p>
            </div>
            <span className="text-xs text-champagne font-mono font-medium">
              {applications.length} Total Applications
            </span>
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border hairline text-xs">
              <span className="text-ivory font-medium">1. Submitted & Under Review</span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-semibold">
                {analytics.appStatusMap.submitted + analytics.appStatusMap.under_review}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border hairline text-xs">
              <span className="text-ivory font-medium">2. Eligible Candidates Matched</span>
              <span className="px-2 py-0.5 rounded bg-champagne/20 text-champagne font-mono font-semibold">
                {analytics.appStatusMap.eligible}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border hairline text-xs">
              <span className="text-ivory font-medium">3. Confirmed & Scheduled</span>
              <span className="px-2 py-0.5 rounded bg-rosegold/20 text-rosegold font-mono font-semibold">
                {analytics.appStatusMap.confirmed}
              </span>
            </div>

            <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.02] border hairline text-xs">
              <span className="text-ivory font-medium">4. Completed Dates</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono font-semibold">
                {analytics.appStatusMap.completed}
              </span>
            </div>
          </div>

          <div className="pt-2 border-t hairline flex flex-wrap items-center justify-between gap-2 text-xs text-mist">
            <span>Upcoming Scheduled Dates: <strong className="text-ivory">{analytics.bookingStats.upcoming}</strong></span>
            <span>Total Booking Revenue: <strong className="text-champagne font-mono">{inr(analytics.bookingStats.totalRevenue)}</strong></span>
          </div>
        </div>
      </div>
    </div>
  );
}
