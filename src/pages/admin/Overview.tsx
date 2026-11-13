import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Users,
  CreditCard,
  Crown,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  Clock,
  Calendar,
  AlertCircle,
  RefreshCw,
  BadgeCheck,
} from "lucide-react";
import { useAsync, useBackend } from "../../lib/data";
import type { ActivityLog, Payment, UserProfile, DateApplication, DateBooking } from "../../lib/types";
import { countActiveOnlineUsers } from "../../lib/presence";
import { EmptyState, Skeleton } from "../../components/ui";
import { fmtDate, inr, rowCls, tdCls, thCls, timeAgo } from "./_util";

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
  const [activeTab, setActiveTab] = useState<"activity" | "payments">("activity");

  // Revenue summary (aggregated)
  const {
    data: s,
    loading: sLoading,
    error: sError,
    refresh: refreshSummary,
  } = useAsync((b) => b.revenueSummary(), [db], EMPTY_SUMMARY);

  // All users to compute new registrations & verification queues
  const {
    data: users,
    loading: uLoading,
    refresh: refreshUsers,
  } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  // Real recent payments
  const {
    data: payments,
    loading: pLoading,
    refresh: refreshPayments,
  } = useAsync((b) => b.allPayments(), [db], [] as Payment[]);

  // Date applications
  const {
    data: applications,
    loading: appLoading,
    refresh: refreshApps,
  } = useAsync((b) => b.allApplications(), [db], [] as DateApplication[]);

  // Date bookings
  const {
    data: bookings,
    loading: bLoading,
    refresh: refreshBookings,
  } = useAsync((b) => b.allBookings(), [db], [] as DateBooking[]);

  // Audit logs
  const {
    data: activityRaw,
    loading: aLoading,
    refresh: refreshActivity,
  } = useAsync((b) => b.listActivity(), [db], [] as ActivityLog[]);

  // Real-time synchronization
  useEffect(() => {
    const off1 = db.subscribe("payments", () => {
      refreshSummary();
      refreshPayments();
      refreshActivity();
    });
    const off2 = db.subscribe("activity", refreshActivity);
    const off3 = db.subscribe("profiles", refreshUsers);
    const off4 = db.subscribe("applications", refreshApps);
    const off5 = db.subscribe("bookings", refreshBookings);
    return () => {
      off1();
      off2();
      off3();
      off4();
      off5();
    };
  }, [db, refreshSummary, refreshPayments, refreshActivity, refreshUsers, refreshApps, refreshBookings]);

  // Derived real figures
  const metrics = useMemo(() => {
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Registrations
    const newRegistrations7d = users.filter((u) => new Date(u.createdAt).getTime() >= sevenDaysAgo).length;
    const newRegistrations30d = users.filter((u) => new Date(u.createdAt).getTime() >= thirtyDaysAgo).length;

    // Unverified profiles
    const pendingVerification = users.filter((u) => !u.verified).length;

    // Membership tier distribution
    const tierCounts = {
      connect: users.filter((u) => u.plan === "connect").length,
      plus: users.filter((u) => u.plan === "plus").length,
      elite: users.filter((u) => u.plan === "elite").length,
      none: users.filter((u) => !u.plan).length,
    };

    // Pending applications & upcoming bookings
    const pendingAppsCount = applications.filter(
      (a) => a.status === "submitted" || a.status === "under_review",
    ).length;

    const upcomingBookingsCount = bookings.filter((b) => b.status === "upcoming").length;

    // Recent payments slice
    const sortedPayments = [...payments].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return {
      newRegistrations7d,
      newRegistrations30d,
      pendingVerification,
      tierCounts,
      pendingAppsCount,
      upcomingBookingsCount,
      onlineCount: countActiveOnlineUsers(users),
      recentPayments: sortedPayments.slice(0, 7),
    };
  }, [users, applications, bookings, payments]);

  const recentActivity = activityRaw.slice(0, 8);

  const revenueChannels = [
    { label: "Memberships", value: s.membership, color: "from-champagne to-rosegold", share: s.total > 0 ? (s.membership / s.total) * 100 : 0 },
    { label: "Date Experiences", value: s.experience, color: "from-rosegold to-burgundy", share: s.total > 0 ? (s.experience / s.total) * 100 : 0 },
    { label: "Counter & Cash", value: s.cash, color: "from-[#a388ee] to-[#60359f]", share: s.total > 0 ? (s.cash / s.total) * 100 : 0 },
  ];

  const isLoading = sLoading && uLoading && pLoading && appLoading && bLoading && aLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64 lg:col-span-2" />
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Title & Status Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b hairline">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-[0.68rem] uppercase tracking-widest text-mist font-semibold">
              Live Operations Control
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-medium tracking-wide text-ivory mt-1">
            Platform Overview
          </h1>
          <p className="text-xs text-mist mt-0.5">
            Operational pulse across member subscriptions, curated dates, verified revenue, and safety.
          </p>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            onClick={() => {
              refreshSummary();
              refreshUsers();
              refreshPayments();
              refreshApps();
              refreshBookings();
              refreshActivity();
            }}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass hover:border-rosegold/40 text-xs text-mist hover:text-ivory transition-colors"
            title="Refresh operational data"
          >
            <RefreshCw size={13} />
            <span>Sync</span>
          </button>
          <Link
            to="/admin/analytics"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gradient-to-r from-burgundy/80 to-rosegold/80 text-xs text-ivory font-medium border border-rosegold/40 hover:opacity-90 shadow-sm transition-opacity"
          >
            <TrendingUp size={13} />
            <span>Detailed Analytics</span>
          </Link>
        </div>
      </div>

      {sError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle size={16} className="shrink-0" />
          <span>Error loading revenue summary: {sError}</span>
        </div>
      )}

      {/* Primary KPI SaaS Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Revenue */}
        <div className="glass rounded-2xl p-5 border hairline relative overflow-hidden group hover:border-rosegold/30 transition-all">
          <div className="flex items-start justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Total Verified Revenue</p>
            <div className="p-2 rounded-xl bg-rosegold/10 text-rosegold border border-rosegold/20">
              <CreditCard size={18} />
            </div>
          </div>
          <div className="mt-3">
            <p className="font-display text-3xl text-gradient-gold font-semibold">{inr(s.total)}</p>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-mist">
              <span className="text-emerald-400 font-medium">{s.payments} txns</span>
              <span>•</span>
              <span>{inr(s.refunded)} refunded</span>
            </div>
          </div>
          <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-rosegold/5 rounded-full blur-xl pointer-events-none group-hover:bg-rosegold/10 transition-colors" />
        </div>

        {/* Card 2: Registered Members */}
        <div className="glass rounded-2xl p-5 border hairline relative overflow-hidden group hover:border-rosegold/30 transition-all">
          <div className="flex items-start justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Total Registered Members</p>
            <div className="p-2 rounded-xl bg-champagne/10 text-champagne border border-champagne/20">
              <Users size={18} />
            </div>
          </div>
          <div className="mt-3">
            <p className="font-display text-3xl text-ivory font-semibold">{s.totalUsers}</p>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-mist flex-wrap">
              <span className="text-emerald-400 font-medium flex items-center gap-1.5" title="Members with verifiable activity in the last 15 minutes">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse" />
                {metrics.onlineCount} active recently
              </span>
              <span>•</span>
              <span className="text-champagne font-medium">+{metrics.newRegistrations7d} this week</span>
            </div>
          </div>
          <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-champagne/5 rounded-full blur-xl pointer-events-none group-hover:bg-champagne/10 transition-colors" />
        </div>

        {/* Card 3: Active Subscriptions */}
        <div className="glass rounded-2xl p-5 border hairline relative overflow-hidden group hover:border-rosegold/30 transition-all">
          <div className="flex items-start justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Active Subscriptions</p>
            <div className="p-2 rounded-xl bg-burgundy/30 text-rose-300 border border-rosegold/20">
              <Crown size={18} />
            </div>
          </div>
          <div className="mt-3">
            <p className="font-display text-3xl text-ivory font-semibold">{s.activeSubscriptions}</p>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-mist">
              <span>{inr(s.membership)} membership revenue</span>
            </div>
          </div>
          <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-burgundy/10 rounded-full blur-xl pointer-events-none group-hover:bg-burgundy/20 transition-colors" />
        </div>

        {/* Card 4: Curated Matches & Dates */}
        <div className="glass rounded-2xl p-5 border hairline relative overflow-hidden group hover:border-rosegold/30 transition-all">
          <div className="flex items-start justify-between">
            <p className="text-[0.68rem] uppercase tracking-wider text-mist font-medium">Mutual Matches</p>
            <div className="p-2 rounded-xl bg-pink-500/10 text-pink-400 border border-pink-500/20">
              <Sparkles size={18} />
            </div>
          </div>
          <div className="mt-3">
            <p className="font-display text-3xl text-ivory font-semibold">{s.totalMatches}</p>
            <div className="flex items-center gap-2 mt-1.5 text-xs text-mist">
              <span className="text-pink-300 font-medium">{metrics.upcomingBookingsCount} upcoming dates</span>
              <span>•</span>
              <span>{inr(s.experience)} date fees</span>
            </div>
          </div>
          <div className="absolute -bottom-6 -right-6 w-24 h-24 bg-pink-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-pink-500/10 transition-colors" />
        </div>
      </div>

      {/* Actionable Queues & Revenue Distribution Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Operational Action Queues */}
        <div className="lg:col-span-2 glass rounded-2xl p-6 border hairline space-y-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-display text-xl text-ivory">Actionable Attention Queues</h2>
              <p className="text-xs text-mist mt-0.5">Real items awaiting administrative action or review</p>
            </div>
            <span className="text-[0.68rem] uppercase tracking-wider text-rosegold bg-rosegold/10 px-2.5 py-1 rounded-full border border-rosegold/30">
              High Priority
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-1">
            {/* Queue Item 1: Pending Verification */}
            <Link
              to="/admin/verification"
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border hairline hover:border-rosegold/40 transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 flex items-center justify-center shrink-0">
                  <BadgeCheck size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ivory group-hover:text-rosegold transition-colors truncate">
                    Profile Verification
                  </p>
                  <p className="text-xs text-mist">Profiles awaiting approval</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {metrics.pendingVerification}
                </span>
                <ArrowRight size={14} className="text-mist group-hover:text-ivory group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>

            {/* Queue Item 2: Date Applications */}
            <Link
              to="/admin/applications"
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border hairline hover:border-rosegold/40 transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-rosegold/10 border border-rosegold/20 text-rosegold flex items-center justify-center shrink-0">
                  <Sparkles size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ivory group-hover:text-rosegold transition-colors truncate">
                    Date Applications
                  </p>
                  <p className="text-xs text-mist">Curated experience requests</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rosegold/20 text-rosegold border border-rosegold/30">
                  {metrics.pendingAppsCount}
                </span>
                <ArrowRight size={14} className="text-mist group-hover:text-ivory group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>

            {/* Queue Item 3: Upcoming Bookings */}
            <Link
              to="/admin/bookings"
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border hairline hover:border-rosegold/40 transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-champagne/10 border border-champagne/20 text-champagne flex items-center justify-center shrink-0">
                  <Calendar size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ivory group-hover:text-rosegold transition-colors truncate">
                    Date Bookings
                  </p>
                  <p className="text-xs text-mist">Upcoming scheduled dates</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-champagne/20 text-champagne border border-champagne/30">
                  {metrics.upcomingBookingsCount}
                </span>
                <ArrowRight size={14} className="text-mist group-hover:text-ivory group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>

            {/* Queue Item 4: Moderation Reports */}
            <Link
              to="/admin/reports"
              className="p-4 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] border hairline hover:border-rosegold/40 transition-all flex items-center justify-between group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 flex items-center justify-center shrink-0">
                  <ShieldAlert size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-ivory group-hover:text-rosegold transition-colors truncate">
                    Moderation & Safety
                  </p>
                  <p className="text-xs text-mist">User safety reports</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  Review
                </span>
                <ArrowRight size={14} className="text-mist group-hover:text-ivory group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          </div>

          {/* Membership Tier Breakdown Bar */}
          <div className="pt-4 border-t hairline">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-mist font-medium">Membership Tiers Distribution</span>
              <span className="text-ivory font-medium">
                {metrics.tierCounts.connect + metrics.tierCounts.plus + metrics.tierCounts.elite} Active Paid
              </span>
            </div>
            <div className="h-3 rounded-full bg-white/5 overflow-hidden flex gap-0.5 p-0.5">
              {metrics.tierCounts.connect > 0 && (
                <div
                  className="h-full rounded-sm bg-gradient-to-r from-champagne/70 to-champagne"
                  style={{ width: `${(metrics.tierCounts.connect / (s.totalUsers || 1)) * 100}%` }}
                  title={`Select: ${metrics.tierCounts.connect}`}
                />
              )}
              {metrics.tierCounts.plus > 0 && (
                <div
                  className="h-full rounded-sm bg-gradient-to-r from-rosegold to-pink-500"
                  style={{ width: `${(metrics.tierCounts.plus / (s.totalUsers || 1)) * 100}%` }}
                  title={`Signature: ${metrics.tierCounts.plus}`}
                />
              )}
              {metrics.tierCounts.elite > 0 && (
                <div
                  className="h-full rounded-sm bg-gradient-to-r from-burgundy to-burgundy-deep"
                  style={{ width: `${(metrics.tierCounts.elite / (s.totalUsers || 1)) * 100}%` }}
                  title={`Privé: ${metrics.tierCounts.elite}`}
                />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-4 mt-2.5 text-xs text-mist">
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-champagne" />
                <span>Select ({metrics.tierCounts.connect})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-rosegold" />
                <span>Signature ({metrics.tierCounts.plus})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-burgundy" />
                <span>Privé ({metrics.tierCounts.elite})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-white/20" />
                <span>Free Tier ({metrics.tierCounts.none})</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Col: Revenue Breakdown Widget */}
        <div className="glass rounded-2xl p-6 border hairline flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl text-ivory">Revenue Channels</h2>
              <span className="text-xs text-champagne font-mono font-medium">{inr(s.total)}</span>
            </div>
            <p className="text-xs text-mist mt-0.5">Verified payment breakdown</p>

            <div className="mt-6 space-y-4">
              {revenueChannels.map((c) => (
                <div key={c.label} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-ivory-dim font-medium">{c.label}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-ivory font-mono">{inr(c.value)}</span>
                      <span className="text-mist text-[0.68rem]">({c.share.toFixed(0)}%)</span>
                    </div>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(2, c.share)}%` }}
                      transition={{ duration: 0.8, ease: "easeOut" }}
                      className={`h-full rounded-full bg-gradient-to-r ${c.color}`}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-6 pt-4 border-t hairline space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-mist">Partner Café Commissions</span>
              <span className="text-champagne font-mono font-medium">{inr(s.cafeCommissions)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-mist">Total Refunded</span>
              <span className="text-rose-300 font-mono font-medium">{inr(s.refunded)}</span>
            </div>
            <Link
              to="/admin/payments"
              className="mt-2 block w-full py-2 text-center rounded-xl glass hover:border-rosegold/40 text-xs text-ivory font-medium transition-colors"
            >
              Open Transaction Ledger →
            </Link>
          </div>
        </div>
      </div>

      {/* Tabs: Recent Operational Updates & Real Activity Log */}
      <div className="glass rounded-2xl border hairline overflow-hidden">
        {/* Tab Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b hairline bg-white/[0.01]">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setActiveTab("activity")}
              className={`text-sm font-medium pb-1 relative transition-colors ${
                activeTab === "activity" ? "text-ivory" : "text-mist hover:text-ivory"
              }`}
            >
              Recent Audit Log
              {activeTab === "activity" && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-rosegold to-champagne rounded-full"
                />
              )}
            </button>
            <button
              onClick={() => setActiveTab("payments")}
              className={`text-sm font-medium pb-1 relative transition-colors ${
                activeTab === "payments" ? "text-ivory" : "text-mist hover:text-ivory"
              }`}
            >
              Recent Transactions ({metrics.recentPayments.length})
              {activeTab === "payments" && (
                <motion.div
                  layoutId="activeTabIndicator"
                  className="absolute bottom-0 inset-x-0 h-0.5 bg-gradient-to-r from-rosegold to-champagne rounded-full"
                />
              )}
            </button>
          </div>

          <Link
            to={activeTab === "activity" ? "/admin/activity" : "/admin/payments"}
            className="text-xs text-champagne hover:text-rosegold flex items-center gap-1 transition-colors"
          >
            <span>View All</span>
            <ArrowRight size={13} />
          </Link>
        </div>

        {/* Tab 1: Activity Log Table */}
        {activeTab === "activity" && (
          <div>
            {recentActivity.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="No admin events yet"
                  body="Administrative actions such as verifications, payment approvals, and status changes will record here."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.01]">
                      <th className={thCls}>Timestamp</th>
                      <th className={thCls}>Action Type</th>
                      <th className={thCls}>Details & Payload</th>
                      <th className={thCls}>Admin ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentActivity.map((a) => (
                      <tr key={a.id} className={rowCls}>
                        <td className={`${tdCls} whitespace-nowrap text-xs text-mist flex items-center gap-1.5`}>
                          <Clock size={12} className="text-mist/70" />
                          <span>{timeAgo(a.createdAt)}</span>
                        </td>
                        <td className={`${tdCls} whitespace-nowrap`}>
                          <span className="px-2 py-0.5 rounded-md font-mono text-[0.72rem] bg-rosegold/10 text-rosegold border border-rosegold/20">
                            {a.action}
                          </span>
                        </td>
                        <td className={`${tdCls} text-xs text-ivory-dim font-medium`}>{a.detail}</td>
                        <td className={`${tdCls} whitespace-nowrap text-xs text-mist font-mono`}>
                          {a.actorId ? `${a.actorId.slice(0, 8)}...` : "system"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Recent Payments Table */}
        {activeTab === "payments" && (
          <div>
            {metrics.recentPayments.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="No payment records found"
                  body="Recent member transactions and date bookings will appear in this ledger."
                />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.01]">
                      <th className={thCls}>Date</th>
                      <th className={thCls}>Transaction ID</th>
                      <th className={thCls}>Channel</th>
                      <th className={thCls}>Amount</th>
                      <th className={thCls}>Status</th>
                      <th className={thCls}>Method</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.recentPayments.map((p) => {
                      const isVerified = p.status === "verified";
                      const isRefunded = p.status === "refunded";
                      return (
                        <tr key={p.id} className={rowCls}>
                          <td className={`${tdCls} whitespace-nowrap text-xs text-mist`}>
                            {fmtDate(p.createdAt)}
                          </td>
                          <td className={`${tdCls} whitespace-nowrap text-xs font-mono text-ivory-dim`}>
                            {p.id}
                          </td>
                          <td className={`${tdCls} whitespace-nowrap text-xs capitalize text-ivory`}>
                            {p.kind}
                            {p.planId && (
                              <span className="ml-1.5 text-[0.68rem] text-champagne bg-champagne/10 px-1.5 py-0.5 rounded border border-champagne/20">
                                {p.planId === "connect" ? "Select" : p.planId === "plus" ? "Signature" : p.planId === "elite" ? "Privé" : p.planId}
                              </span>
                            )}
                          </td>
                          <td className={`${tdCls} whitespace-nowrap text-xs font-mono font-medium text-ivory`}>
                            {inr(p.amount)}
                          </td>
                          <td className={`${tdCls} whitespace-nowrap`}>
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.68rem] font-medium border ${
                                isVerified
                                  ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                                  : isRefunded
                                  ? "bg-rose-500/10 text-rose-300 border-rose-500/20"
                                  : "bg-amber-500/10 text-amber-300 border-amber-500/20"
                              }`}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${
                                  isVerified ? "bg-emerald-400" : isRefunded ? "bg-rose-400" : "bg-amber-400"
                                }`}
                              />
                              {p.status}
                            </span>
                          </td>
                          <td className={`${tdCls} whitespace-nowrap text-xs text-mist uppercase font-mono`}>
                            {p.method || "card"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
