import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { UserProfile, VerificationStatus } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Avatar, Badge, EmptyState, Modal, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { MigrationAlertBanner } from "../../components/MigrationAlertBanner";
import { fmtDate, fmtDay, timeAgo } from "./_util";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";

type VerificationTab = "pending" | "verified" | "declined";
type SortOption = "oldest" | "newest" | "completeness_high" | "completeness_low";
type CompletenessFilter = "all" | "high" | "medium" | "low";

const PAGE_SIZE = 10;

const DECLINE_REASONS = [
  "Face is not clearly visible in uploaded photos.",
  "Incomplete profile information or insufficient portrait photos.",
  "Suspected impersonation, fake account, or celebrity imagery.",
  "Photos or bio violate Datevra trust & safety guidelines.",
];

export default function Verification() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  // Data loading
  const { data: allUsersRaw, loading, error, refresh } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );

  useEffect(() => db.subscribe("profiles", refresh), [db, refresh]);

  // Tab & Filters state
  const [activeTab, setActiveTab] = useState<VerificationTab>("pending");
  const [searchQuery, setSearchQuery] = useState("");
  const [cityFilter, setCityFilter] = useState("all");
  const [completenessFilter, setCompletenessFilter] = useState<CompletenessFilter>("all");
  const [sortOrder, setSortOrder] = useState<SortOption>("oldest");
  const [currentPage, setCurrentPage] = useState(1);

  // In-flight submission tracking
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());

  // Modal inspection & decline note states
  const [inspectUser, setInspectUser] = useState<UserProfile | null>(null);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [declineTarget, setDeclineTarget] = useState<UserProfile | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [migrationError, setMigrationError] = useState<string | null>(null);

  const selectTab = (t: VerificationTab) => {
    setActiveTab(t);
    setCurrentPage(1);
  };
  const changeSearch = (q: string) => {
    setSearchQuery(q);
    setCurrentPage(1);
  };
  const changeCity = (c: string) => {
    setCityFilter(c);
    setCurrentPage(1);
  };
  const changeCompleteness = (cf: CompletenessFilter) => {
    setCompletenessFilter(cf);
    setCurrentPage(1);
  };
  const changeSort = (s: SortOption) => {
    setSortOrder(s);
    setCurrentPage(1);
  };

  // Derive all unique cities from loaded users
  const availableCities = useMemo(() => {
    const set = new Set<string>();
    for (const u of allUsersRaw) {
      if (u.city && u.city.trim()) set.add(u.city.trim());
    }
    return Array.from(set).sort();
  }, [allUsersRaw]);

  // Tab count metrics
  const tabCounts = useMemo(() => {
    let pending = 0;
    let verified = 0;
    let declined = 0;

    for (const u of allUsersRaw) {
      // Exclude reviewing admin from verification queue
      if (u.id === session?.userId) continue;

      const status = u.verificationStatus ?? (u.verified ? "verified" : "pending");
      if (status === "verified") verified++;
      else if (status === "declined") declined++;
      else pending++;
    }
    return { pending, verified, declined };
  }, [allUsersRaw, session?.userId]);

  // Filtered & sorted users
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return allUsersRaw
      .filter((u) => {
        // Exclude reviewing administrator
        if (u.id === session?.userId) return false;

        // Effective verification status
        const status: VerificationStatus = u.verificationStatus ?? (u.verified ? "verified" : "pending");

        // Tab filter
        if (status !== activeTab) return false;

        // City filter
        if (cityFilter !== "all" && u.city !== cityFilter) return false;

        // Completeness filter
        if (completenessFilter === "high" && u.profileComplete < 80) return false;
        if (completenessFilter === "medium" && (u.profileComplete < 50 || u.profileComplete >= 80)) return false;
        if (completenessFilter === "low" && u.profileComplete >= 50) return false;

        // Search query across name, email, city, ID
        if (q) {
          const name = (u.firstName || "").toLowerCase();
          const email = (u.email || "").toLowerCase();
          const city = (u.city || "").toLowerCase();
          const id = (u.id || "").toLowerCase();
          const searchString = `${name} ${email} ${city} ${id}`;
          if (!searchString.includes(q)) return false;
        }

        return true;
      })
      .sort((a, b) => {
        if (sortOrder === "oldest") {
          return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        }
        if (sortOrder === "newest") {
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        }
        if (sortOrder === "completeness_high") {
          return b.profileComplete - a.profileComplete;
        }
        if (sortOrder === "completeness_low") {
          return a.profileComplete - b.profileComplete;
        }
        return 0;
      });
  }, [allUsersRaw, session?.userId, activeTab, cityFilter, completenessFilter, searchQuery, sortOrder]);

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE));
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredUsers.slice(start, start + PAGE_SIZE);
  }, [filteredUsers, currentPage]);

  // Core decision handler with in-flight guard
  const handleDecision = async (user: UserProfile, ok: boolean, note?: string) => {
    if (submittingIds.has(user.id)) return;

    setSubmittingIds((prev) => new Set(prev).add(user.id));
    try {
      await db.setUserVerified(user.id, ok, actor, note);
      refresh();
      toast(
        ok
          ? `${user.firstName} verified successfully`
          : `Verification for ${user.firstName} declined`,
        ok ? "gold" : "rose",
      );

      // Close modal if acting on currently inspected user
      if (inspectUser?.id === user.id) {
        setInspectUser(null);
      }
      if (declineTarget?.id === user.id) {
        setDeclineTarget(null);
        setDeclineReason("");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not update verification status";
      if (msg.includes("MIGRATION_REQUIRED")) {
        setMigrationError(msg);
      }
      toast(msg, "rose");
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(user.id);
        return next;
      });
    }
  };

  // Open inspection modal
  const openInspectModal = (user: UserProfile) => {
    setInspectUser(user);
    setActivePhotoIdx(0);
  };

  // Copy ID helper
  const handleCopyId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="px-0 sm:px-5 pb-16 sm:pb-24 pt-4 sm:pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <SectionHead
          kicker="Trust & safety"
          title="Profile Verification Queue"
          sub="Review member identity signals, portrait authenticity, and trust standing before approving verification badges."
          align="left"
        />

        {migrationError && (
          <MigrationAlertBanner
            migrationId="019"
            migrationFile="db/migrations/019_verification_defense_in_depth.sql"
            featureName="Profile Verification RPC"
            description="The database function public.set_user_verified is not installed in your Supabase backend. Please execute Migration 019 in your Supabase Dashboard SQL Editor to activate administrative verification actions."
            onRefresh={() => setMigrationError(null)}
          />
        )}

        {error && (
          <div className="glass rounded-2xl p-4 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-3">
            <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
            <span>Could not load verification queue: {error}</span>
            <button
              onClick={() => refresh()}
              className="ml-auto underline hover:text-ivory"
            >
              Retry
            </button>
          </div>
        )}

        {/* Status Lifecycle Navigation Tabs */}
        <div className="flex border-b border-white/10 gap-2 overflow-x-auto pb-px">
          <button
            onClick={() => selectTab("pending")}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === "pending"
                ? "border-champagne text-ivory"
                : "border-transparent text-mist hover:text-ivory"
            }`}
          >
            <ShieldAlert className="w-4 h-4 text-champagne" />
            <span>Pending Review</span>
            <span className={`text-[0.65rem] px-2 py-0.5 rounded-full font-mono ${
              activeTab === "pending"
                ? "bg-champagne/20 text-champagne font-semibold"
                : "bg-white/5 text-mist"
            }`}>
              {tabCounts.pending}
            </span>
          </button>

          <button
            onClick={() => selectTab("verified")}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === "verified"
                ? "border-champagne text-ivory"
                : "border-transparent text-mist hover:text-ivory"
            }`}
          >
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>Verified Members</span>
            <span className={`text-[0.65rem] px-2 py-0.5 rounded-full font-mono ${
              activeTab === "verified"
                ? "bg-emerald-500/20 text-emerald-300 font-semibold"
                : "bg-white/5 text-mist"
            }`}>
              {tabCounts.verified}
            </span>
          </button>

          <button
            onClick={() => selectTab("declined")}
            className={`flex items-center gap-2 pb-3 px-3 text-sm font-medium transition-colors border-b-2 whitespace-nowrap ${
              activeTab === "declined"
                ? "border-champagne text-ivory"
                : "border-transparent text-mist hover:text-ivory"
            }`}
          >
            <Shield className="w-4 h-4 text-rose-400" />
            <span>Declined</span>
            <span className={`text-[0.65rem] px-2 py-0.5 rounded-full font-mono ${
              activeTab === "declined"
                ? "bg-rose-500/20 text-rose-300 font-semibold"
                : "bg-white/5 text-mist"
            }`}>
              {tabCounts.declined}
            </span>
          </button>
        </div>

        {/* Search & Filter Toolbar */}
        <div className="glass rounded-3xl p-5 space-y-4">
          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-mist absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                value={searchQuery}
                onChange={(e) => changeSearch(e.target.value)}
                placeholder="Search member name, email, city, ID..."
                className={`${inputCls} pl-10 pr-9 w-full`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => changeSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-ivory p-1"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Filters Row */}
            <div className="flex flex-wrap items-center gap-2">
              {/* City Filter */}
              <select
                value={cityFilter}
                onChange={(e) => changeCity(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ivory focus:outline-none focus:border-champagne/40"
              >
                <option value="all" className="bg-midnight text-ivory">All Cities</option>
                {availableCities.map((c) => (
                  <option key={c} value={c} className="bg-midnight text-ivory">{c}</option>
                ))}
              </select>

              {/* Profile Completeness Filter */}
              <select
                value={completenessFilter}
                onChange={(e) => changeCompleteness(e.target.value as CompletenessFilter)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ivory focus:outline-none focus:border-champagne/40"
              >
                <option value="all" className="bg-midnight text-ivory">All Completeness</option>
                <option value="high" className="bg-midnight text-ivory">High (80%+)</option>
                <option value="medium" className="bg-midnight text-ivory">Medium (50–79%)</option>
                <option value="low" className="bg-midnight text-ivory">Low (&lt;50%)</option>
              </select>

              {/* Sorting Order */}
              <select
                value={sortOrder}
                onChange={(e) => changeSort(e.target.value as SortOption)}
                className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-ivory focus:outline-none focus:border-champagne/40"
              >
                <option value="oldest" className="bg-midnight text-ivory">Oldest Registered</option>
                <option value="newest" className="bg-midnight text-ivory">Newest Registered</option>
                <option value="completeness_high" className="bg-midnight text-ivory">Highest Completeness</option>
                <option value="completeness_low" className="bg-midnight text-ivory">Lowest Completeness</option>
              </select>
            </div>
          </div>

          {/* Active Filters Pill Bar */}
          {(searchQuery || cityFilter !== "all" || completenessFilter !== "all" || sortOrder !== "oldest") && (
            <div className="flex items-center justify-between pt-2 text-xs text-mist border-t border-white/5 flex-wrap gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span>Active filters:</span>
                {searchQuery && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    &ldquo;{searchQuery}&rdquo;
                    <button type="button" onClick={() => setSearchQuery("")}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {cityFilter !== "all" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    City: {cityFilter}
                    <button type="button" onClick={() => setCityFilter("all")}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {completenessFilter !== "all" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    Completeness: {completenessFilter}
                    <button type="button" onClick={() => setCompletenessFilter("all")}><X className="w-3 h-3" /></button>
                  </span>
                )}
                {sortOrder !== "oldest" && (
                  <span className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-ivory flex items-center gap-1">
                    Sorted: {sortOrder}
                    <button type="button" onClick={() => setSortOrder("oldest")}><X className="w-3 h-3" /></button>
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setCityFilter("all");
                  setCompletenessFilter("all");
                  setSortOrder("oldest");
                }}
                className="text-champagne/80 hover:text-champagne text-xs underline"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>

        {/* Content Body */}
        {loading ? (
          <div className="grid md:grid-cols-2 gap-5 mt-6">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-3xl" />
            ))}
          </div>
        ) : filteredUsers.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title={
                activeTab === "pending"
                  ? "Pending verification queue is clear"
                  : activeTab === "verified"
                  ? "No verified members match the criteria"
                  : "No declined verification records found"
              }
              body={
                searchQuery || cityFilter !== "all" || completenessFilter !== "all"
                  ? "Try loosening your search query or filter selections."
                  : activeTab === "pending"
                  ? "All registered members have been reviewed. New accounts will appear here automatically."
                  : activeTab === "verified"
                  ? "Verified members will appear here once approved by an administrator."
                  : "Declined profiles will be archived here with their review notes."
              }
            />
          </div>
        ) : (
          <div className="space-y-6">
            {/* Results Count Banner */}
            <div className="flex items-center justify-between text-xs text-mist px-1">
              <span>
                Showing {Math.min(filteredUsers.length, (currentPage - 1) * PAGE_SIZE + 1)}–
                {Math.min(filteredUsers.length, currentPage * PAGE_SIZE)} of {filteredUsers.length} members
              </span>
              <span>Page {currentPage} of {totalPages}</span>
            </div>

            {/* Member Cards Grid */}
            <div className="grid md:grid-cols-2 gap-5">
              {paginatedUsers.map((u, idx) => {
                const isSubmitting = submittingIds.has(u.id);
                const hasPhotos = Array.isArray(u.photos) && u.photos.length > 0;
                const primaryPhoto = hasPhotos ? u.photos[0] : null;
                const status = u.verificationStatus ?? (u.verified ? "verified" : "pending");

                return (
                  <motion.div
                    key={u.id}
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.04, 0.3) }}
                    className="glass rounded-3xl p-4 sm:p-6 flex flex-col justify-between space-y-4 hover:border-champagne/25 transition-colors"
                  >
                    <div>
                      {/* Top Row: Portrait Photo & Header Info */}
                      <div className="flex items-start gap-3 sm:gap-4">
                        {/* Portrait Photo with fallback */}
                        <div className="relative shrink-0 w-16 h-16 sm:w-20 sm:h-20 rounded-2xl overflow-hidden bg-white/5 border border-white/10 group">
                          {primaryPhoto ? (
                            <img
                              src={primaryPhoto}
                              alt={u.firstName}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              loading="lazy"
                              decoding="async"
                              onError={(e) => {
                                // Fallback on broken image link
                                (e.target as HTMLElement).style.display = "none";
                              }}
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Avatar name={u.firstName} size={56} />
                            </div>
                          )}
                          {hasPhotos && u.photos.length > 1 && (
                            <span className="absolute bottom-1 right-1 bg-black/75 backdrop-blur-xs text-[0.6rem] font-mono text-champagne px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                              <Camera className="w-2.5 h-2.5" />
                              +{u.photos.length - 1}
                            </span>
                          )}
                        </div>

                        {/* Member Identity & Details */}
                        <div className="flex-1 min-w-0 space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <h3 className="font-display text-xl text-ivory truncate">
                              {u.firstName}, {u.age}
                            </h3>
                            {status === "verified" ? (
                              <Badge tone="green">Verified</Badge>
                            ) : status === "declined" ? (
                              <Badge tone="rose">Declined</Badge>
                            ) : (
                              <Badge tone="gold">Pending</Badge>
                            )}
                          </div>

                          <p className="text-xs text-mist truncate">
                            {u.city} · joined {fmtDay(u.createdAt)}
                          </p>

                          <div className="flex items-center gap-2 text-[0.7rem] font-mono text-mist/70">
                            <span className="truncate">{u.email}</span>
                            <span>•</span>
                            <span className="truncate">ID: {u.id.slice(0, 8)}…</span>
                            <button
                              type="button"
                              onClick={() => handleCopyId(u.id)}
                              className="hover:text-ivory"
                              title={copiedId === u.id ? "Copied!" : "Copy User ID"}
                            >
                              {copiedId === u.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Bio Excerpt */}
                      {u.bio ? (
                        <p className="text-xs text-ivory-dim leading-relaxed mt-3.5 line-clamp-2">
                          &ldquo;{u.bio}&rdquo;
                        </p>
                      ) : (
                        <p className="text-xs italic text-mist/60 mt-3.5">
                          No personal bio provided yet.
                        </p>
                      )}

                      {/* Badges / Lifestyle Pills */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-3">
                        {u.relationshipIntent && (
                          <span className="px-2 py-0.5 rounded-full text-[0.68rem] bg-white/5 border border-white/10 text-champagne">
                            {u.relationshipIntent}
                          </span>
                        )}
                        {Array.isArray(u.lifestyle) &&
                          u.lifestyle.slice(0, 3).map((l) => (
                            <span
                              key={l}
                              className="px-2 py-0.5 rounded-full text-[0.68rem] bg-white/[0.03] border border-white/5 text-mist"
                            >
                              {l}
                            </span>
                          ))}
                        {u.plan && (
                          <span className="px-2 py-0.5 rounded-full text-[0.68rem] bg-rosegold/10 border border-rosegold/20 text-rosegold">
                            {u.plan.toUpperCase()}
                          </span>
                        )}
                      </div>

                      {/* Profile Completeness Bar */}
                      <div className="mt-3.5 space-y-1">
                        <div className="flex justify-between text-[0.7rem] text-mist">
                          <span>Profile Completeness</span>
                          <span className="font-mono">{u.profileComplete}%</span>
                        </div>
                        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-champagne via-rosegold to-champagne"
                            style={{ width: `${u.profileComplete}%` }}
                          />
                        </div>
                      </div>

                      {/* Review Decision Metadata for Verified or Declined Tabs */}
                      {status === "declined" && u.verificationNote && (
                        <div className="mt-3 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
                          <p className="font-medium text-[0.7rem] uppercase tracking-wider text-rose-400">Decline Reason</p>
                          <p className="mt-0.5 italic text-ivory-dim text-xs leading-relaxed">&ldquo;{u.verificationNote}&rdquo;</p>
                          {u.verificationReviewedAt && (
                            <p className="text-[0.65rem] text-mist mt-1">Reviewed {fmtDay(u.verificationReviewedAt)}</p>
                          )}
                        </div>
                      )}

                      {status === "verified" && u.verificationReviewedAt && (
                        <p className="mt-2 text-[0.7rem] text-emerald-400/80 flex items-center gap-1 font-mono">
                          <CheckCircle2 className="w-3 h-3 inline text-emerald-400" />
                          <span>Verified {fmtDay(u.verificationReviewedAt)}</span>
                        </p>
                      )}
                    </div>

                    {/* Action Buttons Toolbar */}
                    <div className="pt-2 border-t border-white/5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openInspectModal(u)}
                        className="btn-ghost rounded-xl px-3 py-2 text-xs flex items-center gap-1.5 shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5 text-champagne" />
                        <span>Inspect</span>
                      </button>

                      {status === "pending" && (
                        <>
                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => handleDecision(u, true)}
                            className="btn-gold rounded-xl px-3 py-2 text-xs flex-1 flex items-center justify-center gap-1 disabled:opacity-50"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>{isSubmitting ? "Approving…" : "Approve"}</span>
                          </button>

                          <button
                            type="button"
                            disabled={isSubmitting}
                            onClick={() => {
                              setDeclineTarget(u);
                              setDeclineReason("");
                            }}
                            className="btn-ghost rounded-xl px-3 py-2 text-xs text-rose-300 hover:text-rose-200 border-rose-500/30 hover:bg-rose-500/15 disabled:opacity-50"
                          >
                            <span>Decline</span>
                          </button>
                        </>
                      )}

                      {status === "verified" && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => {
                            setDeclineTarget(u);
                            setDeclineReason("");
                          }}
                          className="btn-ghost rounded-xl px-3 py-2 text-xs text-rose-300 hover:text-rose-200 border-rose-500/30 hover:bg-rose-500/15 flex-1 disabled:opacity-50"
                        >
                          <span>{isSubmitting ? "Revoking…" : "Revoke Verification"}</span>
                        </button>
                      )}

                      {status === "declined" && (
                        <button
                          type="button"
                          disabled={isSubmitting}
                          onClick={() => handleDecision(u, true)}
                          className="btn-gold rounded-xl px-3 py-2 text-xs flex-1 flex items-center justify-center gap-1 disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>{isSubmitting ? "Approving…" : "Re-evaluate & Approve"}</span>
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-2 pt-4">
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
                      return <span key={page} className="text-mist px-1 text-xs">…</span>;
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
            )}
          </div>
        )}
      </div>

      {/* Profile Inspection Modal (High Fidelity) */}
      {inspectUser && (
        <Modal
          open={Boolean(inspectUser)}
          onClose={() => setInspectUser(null)}
          title={`Member Profile Inspection — ${inspectUser.firstName}`}
          wide={true}
        >
          <div className="space-y-6">
            {/* Photo Gallery / Carousel View */}
            <div>
              {Array.isArray(inspectUser.photos) && inspectUser.photos.length > 0 ? (
                <div className="space-y-3">
                  <div className="relative w-full h-64 sm:h-80 rounded-2xl overflow-hidden bg-black/40 border border-white/10 flex items-center justify-center">
                    <img
                      src={inspectUser.photos[activePhotoIdx] ?? inspectUser.photos[0]}
                      alt={`${inspectUser.firstName} portrait ${activePhotoIdx + 1}`}
                      className="w-full h-full object-cover"
                      decoding="async"
                    />

                    {inspectUser.photos.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            setActivePhotoIdx((prev) =>
                              prev === 0 ? inspectUser.photos.length - 1 : prev - 1,
                            )
                          }
                          className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors"
                          aria-label="Previous photo"
                        >
                          <ChevronLeft className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setActivePhotoIdx((prev) =>
                              prev === inspectUser.photos.length - 1 ? 0 : prev + 1,
                            )
                          }
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/60 text-white hover:bg-black/90 transition-colors"
                          aria-label="Next photo"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>

                        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-xs text-[0.7rem] text-champagne font-mono">
                          Photo {activePhotoIdx + 1} of {inspectUser.photos.length}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Thumbnails row */}
                  {inspectUser.photos.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-1">
                      {inspectUser.photos.map((url, i) => (
                        <button
                          key={url}
                          type="button"
                          onClick={() => setActivePhotoIdx(i)}
                          className={`relative w-16 h-16 rounded-xl overflow-hidden shrink-0 border-2 transition-all ${
                            activePhotoIdx === i
                              ? "border-champagne scale-105"
                              : "border-white/10 opacity-70 hover:opacity-100"
                          }`}
                        >
                          <img src={url} alt="thumbnail" className="w-full h-full object-cover" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="w-full h-48 rounded-2xl bg-white/[0.03] border border-white/10 flex flex-col items-center justify-center gap-2 text-mist">
                  <Avatar name={inspectUser.firstName} size={64} />
                  <p className="text-xs">No profile photos uploaded by this member</p>
                </div>
              )}
            </div>

            {/* Profile Overview Meta */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-[0.68rem] text-mist uppercase tracking-wider">Age & Gender</p>
                <p className="text-sm font-medium text-ivory mt-0.5 capitalize">
                  {inspectUser.age} yrs · {inspectUser.gender}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-[0.68rem] text-mist uppercase tracking-wider">City Location</p>
                <p className="text-sm font-medium text-ivory mt-0.5">{inspectUser.city}</p>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-[0.68rem] text-mist uppercase tracking-wider">Completeness</p>
                <p className="text-sm font-mono font-medium text-champagne mt-0.5">
                  {inspectUser.profileComplete}%
                </p>
              </div>

              <div className="p-3 rounded-xl bg-white/[0.03] border border-white/5">
                <p className="text-[0.68rem] text-mist uppercase tracking-wider">Membership</p>
                <p className="text-sm font-medium text-rosegold mt-0.5 capitalize">
                  {inspectUser.plan ? `${inspectUser.plan} Plan` : "Free Tier"}
                </p>
              </div>
            </div>

            {/* Bio */}
            <div className="space-y-1.5 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
              <p className="text-xs uppercase tracking-wider font-semibold text-champagne/90">Personal Bio</p>
              <p className="text-xs text-ivory-dim leading-relaxed">
                {inspectUser.bio || "No written bio provided."}
              </p>
            </div>

            {/* Intent & Interests */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-2 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <p className="text-xs uppercase tracking-wider font-semibold text-mist">Intent & Seeking</p>
                <p className="text-xs text-ivory">
                  <span className="text-mist">Relationship Goal: </span>
                  {inspectUser.relationshipIntent || "Not specified"}
                </p>
                <p className="text-xs text-ivory">
                  <span className="text-mist">Interested In: </span>
                  <span className="capitalize">{inspectUser.interestedIn}</span>
                </p>
              </div>

              <div className="space-y-2 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
                <p className="text-xs uppercase tracking-wider font-semibold text-mist">Interests & Hobbies</p>
                <div className="flex flex-wrap gap-1">
                  {Array.isArray(inspectUser.interests) && inspectUser.interests.length > 0 ? (
                    inspectUser.interests.map((it) => (
                      <span key={it} className="px-2 py-0.5 rounded-full text-[0.68rem] bg-white/5 text-ivory">
                        {it}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-mist/60 italic">None selected</span>
                  )}
                </div>
              </div>
            </div>

            {/* Account & Safety Audit Details */}
            <div className="p-4 rounded-2xl bg-white/[0.02] border border-white/5 space-y-2 text-xs">
              <p className="text-[0.7rem] uppercase tracking-wider font-semibold text-mist">Audit & Registration Details</p>
              <div className="grid sm:grid-cols-2 gap-2 text-mist">
                <div>
                  <span className="text-ivory font-mono">ID: </span>
                  <span>{inspectUser.id}</span>
                </div>
                <div>
                  <span className="text-ivory">Email: </span>
                  <span>{inspectUser.email}</span>
                </div>
                <div>
                  <span className="text-ivory">Account Created: </span>
                  <span>{fmtDate(inspectUser.createdAt)}</span>
                </div>
                <div>
                  <span className="text-ivory">Last Active: </span>
                  <span>{timeAgo(inspectUser.lastActive)}</span>
                </div>
              </div>

              {inspectUser.verificationReviewedAt && (
                <div className="pt-2 mt-2 border-t border-white/5 text-mist">
                  <span className="text-champagne">Last Decision: </span>
                  <span>{fmtDate(inspectUser.verificationReviewedAt)}</span>
                  {inspectUser.verificationNote && (
                    <p className="mt-1 text-ivory-dim italic">Note: &ldquo;{inspectUser.verificationNote}&rdquo;</p>
                  )}
                </div>
              )}
            </div>

            {/* Modal Action Buttons */}
            <div className="pt-3 border-t border-white/10 flex flex-wrap items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => setInspectUser(null)}
                className="btn-ghost rounded-xl px-4 py-2.5 text-xs"
              >
                Close
              </button>

              <button
                type="button"
                disabled={submittingIds.has(inspectUser.id)}
                onClick={() => {
                  setDeclineTarget(inspectUser);
                  setDeclineReason("");
                }}
                className="btn-ghost rounded-xl px-4 py-2.5 text-xs text-rose-300 hover:text-rose-200 border-rose-500/30 hover:bg-rose-500/15 disabled:opacity-50"
              >
                Decline Verification
              </button>

              <button
                type="button"
                disabled={submittingIds.has(inspectUser.id)}
                onClick={() => handleDecision(inspectUser, true)}
                className="btn-gold rounded-xl px-5 py-2.5 text-xs flex items-center gap-1.5 disabled:opacity-50"
              >
                <Check className="w-3.5 h-3.5" />
                <span>{submittingIds.has(inspectUser.id) ? "Approving…" : "Approve Verification"}</span>
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Decline Reason Confirmation Modal */}
      {declineTarget && (
        <Modal
          open={Boolean(declineTarget)}
          onClose={() => {
            setDeclineTarget(null);
            setDeclineReason("");
          }}
          title="Decline Profile Verification"
          wide={false}
        >
          <div className="space-y-4">
            <p className="text-xs text-mist">
              Provide feedback or a reason for declining <span className="text-ivory font-medium">{declineTarget.firstName}</span>. This will be recorded in the audit log and sent to the member so they can correct their profile.
            </p>

            {/* Quick-Pick Preset Reasons */}
            <div className="space-y-1.5">
              <p className="text-[0.68rem] uppercase tracking-wider text-mist">Quick Reason Presets</p>
              <div className="flex flex-col gap-1.5">
                {DECLINE_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDeclineReason(r)}
                    className="text-left text-xs p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.07] border border-white/5 hover:border-champagne/30 text-ivory-dim transition-colors"
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>

            {/* Custom Note Textarea */}
            <div className="space-y-1">
              <label className="text-[0.68rem] uppercase tracking-wider text-mist block">
                Verification Note / Guidance
              </label>
              <textarea
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                placeholder="Explain what the member needs to update to qualify for verification..."
                rows={3}
                className="w-full bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-ivory placeholder-mist/60 focus:outline-none focus:border-champagne/40 leading-relaxed"
              />
            </div>

            {/* Modal Actions */}
            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={() => {
                  setDeclineTarget(null);
                  setDeclineReason("");
                }}
                className="btn-ghost rounded-xl px-4 py-2 text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submittingIds.has(declineTarget.id)}
                onClick={() => handleDecision(declineTarget, false, declineReason)}
                className="btn-ghost rounded-xl px-4 py-2 text-xs text-rose-300 border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 disabled:opacity-50"
              >
                {submittingIds.has(declineTarget.id) ? "Declining…" : "Confirm Decline"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
