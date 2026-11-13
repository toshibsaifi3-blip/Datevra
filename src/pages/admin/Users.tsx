import { useEffect, useMemo, useState } from "react";
import { AnimatePresence } from "framer-motion";
import {
  Search,
  CheckCircle2,
  XCircle,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  UserCheck,
  CreditCard,
  Heart,
  MapPin,
  Mail,
  Copy,
  AlertTriangle,
  RefreshCw,
  X,
} from "lucide-react";
import type { UserProfile, Payment, Match, Subscription } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import {
  Avatar,
  EmptyState,
  Modal,
  Skeleton,
  useToast,
} from "../../components/ui";
import { fmtDate, inr, rowCls, tdCls, thCls } from "./_util";

type VerificationFilter = "all" | "verified" | "unverified";
type PlanFilter = "all" | "connect" | "plus" | "elite" | "free";
type SortField = "createdAt" | "firstName" | "profileComplete" | "lastActive";
type SortOrder = "asc" | "desc";

const ITEMS_PER_PAGE = 12;

export default function Users() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [verificationFilter, setVerificationFilter] = useState<VerificationFilter>("all");
  const [planFilter, setPlanFilter] = useState<PlanFilter>("all");
  const [sortField, setSortField] = useState<SortField>("createdAt");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");
  const [currentPage, setCurrentPage] = useState(1);

  // Detail Modal / Drawer state
  const [detailUser, setDetailUser] = useState<UserProfile | null>(null);

  // Confirmation modal state for consequential action
  const [confirmAction, setConfirmAction] = useState<{
    user: UserProfile;
    targetVerified: boolean;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Load all user profiles
  const {
    data: allUsersRaw,
    loading: usersLoading,
    error: usersError,
    refresh: refreshUsers,
  } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => {
    const unsub = db.subscribe("profiles", refreshUsers);
    return () => unsub();
  }, [db, refreshUsers]);

  // Load detail-specific data when detailUser is open
  const [detailPayments, setDetailPayments] = useState<Payment[]>([]);
  const [detailMatches, setDetailMatches] = useState<Match[]>([]);
  const [detailSubscription, setDetailSubscription] = useState<Subscription | undefined>(undefined);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    if (!detailUser) {
      setDetailPayments([]);
      setDetailMatches([]);
      setDetailSubscription(undefined);
      return;
    }

    let isMounted = true;
    setDetailLoading(true);

    Promise.all([
      db.paymentsFor(detailUser.id).catch(() => [] as Payment[]),
      db.matchesFor(detailUser.id).catch(() => [] as Match[]),
      db.activeSubscription(detailUser.id).catch(() => undefined),
    ])
      .then(([pays, matches, sub]) => {
        if (isMounted) {
          setDetailPayments(pays);
          setDetailMatches(matches);
          setDetailSubscription(sub);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (isMounted) setDetailLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [detailUser, db]);

  // Filter & Search logic
  const filteredUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return allUsersRaw
      .filter((u) => {
        // Multi-field search by Name, ID, or Email
        if (q) {
          const nameMatch = u.firstName.toLowerCase().includes(q);
          const emailMatch = u.email.toLowerCase().includes(q);
          const idMatch = u.id.toLowerCase().includes(q);
          const cityMatch = (u.city || "").toLowerCase().includes(q);
          if (!nameMatch && !emailMatch && !idMatch && !cityMatch) return false;
        }

        // Verification filter
        if (verificationFilter === "verified" && !u.verified) return false;
        if (verificationFilter === "unverified" && u.verified) return false;

        // Plan filter
        if (planFilter === "free" && u.plan) return false;
        if (planFilter !== "all" && planFilter !== "free" && u.plan !== planFilter) return false;

        return true;
      })
      .sort((a, b) => {
        let cmp = 0;
        if (sortField === "createdAt") {
          cmp = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        } else if (sortField === "firstName") {
          cmp = a.firstName.localeCompare(b.firstName);
        } else if (sortField === "profileComplete") {
          cmp = a.profileComplete - b.profileComplete;
        } else if (sortField === "lastActive") {
          cmp = new Date(a.lastActive || 0).getTime() - new Date(b.lastActive || 0).getTime();
        }
        return sortOrder === "asc" ? cmp : -cmp;
      });
  }, [allUsersRaw, searchQuery, verificationFilter, planFilter, sortField, sortOrder]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredUsers.length / ITEMS_PER_PAGE) || 1;
  const paginatedUsers = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredUsers.slice(start, start + ITEMS_PER_PAGE);
  }, [filteredUsers, currentPage]);

  // Reset page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, verificationFilter, planFilter]);

  // Toggle sort order or field
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("desc");
    }
  };

  // Execute verification update
  const handleExecuteVerification = async () => {
    if (!confirmAction) return;
    const { user, targetVerified } = confirmAction;

    // Safety check: Prevent modifying the logged-in admin's status
    if (user.id === session?.userId) {
      toast("You cannot modify your own administrative verification status.", "rose");
      setConfirmAction(null);
      return;
    }

    setSubmitting(true);
    try {
      await db.setUserVerified(user.id, targetVerified, actor);
      refreshUsers();

      // Update current detail state if open
      if (detailUser && detailUser.id === user.id) {
        setDetailUser({ ...detailUser, verified: targetVerified });
      }

      toast(
        targetVerified
          ? `${user.firstName} verified successfully.`
          : `Verification revoked for ${user.firstName}.`,
        targetVerified ? "gold" : "rose",
      );
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update user verification", "rose");
    } finally {
      setSubmitting(false);
      setConfirmAction(null);
    }
  };

  // Copy text helper
  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard?.writeText(text);
    toast(`${label} copied to clipboard`, "gold");
  };

  // Helper for canonical plan name and badge styling
  const renderPlanBadge = (planId: string | null) => {
    if (!planId) {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/5 border border-white/10 text-mist">
          Free
        </span>
      );
    }
    if (planId === "connect") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-champagne/10 border border-champagne/30 text-champagne">
          ✦ Select
        </span>
      );
    }
    if (planId === "plus") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rosegold/10 border border-rosegold/30 text-rosegold">
          ✦ Signature
        </span>
      );
    }
    if (planId === "elite") {
      return (
        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-burgundy/40 border border-rosegold/40 text-rose-300">
          ✦ Privé
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-white/10 border border-white/15 text-ivory">
        {planId}
      </span>
    );
  };

  if (usersLoading && allUsersRaw.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between pb-2 border-b hairline">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14" />
          ))}
        </div>
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b hairline">
        <div>
          <div className="flex items-center gap-2">
            <UserCheck size={14} className="text-rosegold" />
            <span className="text-[0.68rem] uppercase tracking-widest text-mist font-semibold">
              Member Administration
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-medium tracking-wide text-ivory mt-1">
            User Management Centre
          </h1>
          <p className="text-xs text-mist mt-0.5">
            Search, inspect profile signals, manage verification, and review member transaction histories.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refreshUsers()}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl glass hover:border-rosegold/40 text-xs text-mist hover:text-ivory transition-colors"
            title="Refresh members"
          >
            <RefreshCw size={13} />
            <span>Sync Directory</span>
          </button>
        </div>
      </div>

      {usersError && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs flex items-center gap-3">
          <AlertTriangle size={16} className="shrink-0" />
          <span>Error loading directory: {usersError}</span>
        </div>
      )}

      {/* Advanced Search & Filter Toolbar */}
      <div className="glass rounded-2xl p-4 border hairline space-y-3">
        <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
          {/* Universal Search Input */}
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mist" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by full name, user ID, email address, or city..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-white/[0.03] border hairline text-xs text-ivory placeholder-mist/70 focus:outline-none focus:border-rosegold/40 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-ivory p-1"
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap items-center gap-2">
            {/* Verification status filter */}
            <select
              value={verificationFilter}
              onChange={(e) => setVerificationFilter(e.target.value as VerificationFilter)}
              className="px-3 py-2 rounded-xl bg-white/[0.04] border hairline text-xs text-ivory focus:outline-none focus:border-rosegold/40"
            >
              <option value="all" className="bg-[#120a20] text-ivory">All Verification States</option>
              <option value="verified" className="bg-[#120a20] text-ivory">Verified Only</option>
              <option value="unverified" className="bg-[#120a20] text-ivory">Unverified Only</option>
            </select>

            {/* Plan filter */}
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value as PlanFilter)}
              className="px-3 py-2 rounded-xl bg-white/[0.04] border hairline text-xs text-ivory focus:outline-none focus:border-rosegold/40"
            >
              <option value="all" className="bg-[#120a20] text-ivory">All Membership Tiers</option>
              <option value="connect" className="bg-[#120a20] text-ivory">Select (Connect)</option>
              <option value="plus" className="bg-[#120a20] text-ivory">Signature (Plus)</option>
              <option value="elite" className="bg-[#120a20] text-ivory">Privé (Elite)</option>
              <option value="free" className="bg-[#120a20] text-ivory">Free Tier Only</option>
            </select>

            {/* Sort toggle */}
            <button
              onClick={() => handleSort("createdAt")}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl glass hover:border-rosegold/40 text-xs text-mist hover:text-ivory transition-colors"
              title="Toggle sort direction"
            >
              <ArrowUpDown size={13} className="text-rosegold" />
              <span>{sortOrder === "desc" ? "Newest First" : "Oldest First"}</span>
            </button>
          </div>
        </div>

        {/* Filter Summary */}
        <div className="flex items-center justify-between text-xs text-mist pt-1 border-t border-white/5">
          <span>
            Showing <strong className="text-ivory font-mono">{filteredUsers.length}</strong> of{" "}
            <strong className="text-ivory font-mono">{allUsersRaw.length}</strong> registered members
          </span>
          {(searchQuery || verificationFilter !== "all" || planFilter !== "all") && (
            <button
              onClick={() => {
                setSearchQuery("");
                setVerificationFilter("all");
                setPlanFilter("all");
              }}
              className="text-rosegold hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Directory Table */}
      <div className="glass rounded-2xl border hairline overflow-hidden">
        {paginatedUsers.length === 0 ? (
          <div className="p-12">
            <EmptyState
              title="No members match criteria"
              body="No user records matched your search query or active filter settings."
              action={
                <button
                  onClick={() => {
                    setSearchQuery("");
                    setVerificationFilter("all");
                    setPlanFilter("all");
                  }}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 text-xs text-ivory font-medium transition-colors"
                >
                  Reset Directory Filters
                </button>
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[850px]">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.01]">
                  <th className={thCls}>Member Profile</th>
                  <th className={thCls}>User Identifier</th>
                  <th className={thCls}>Membership Plan</th>
                  <th className={thCls}>Verification</th>
                  <th className={thCls}>City / Age</th>
                  <th className={thCls}>Registration Date</th>
                  <th className={`${thCls} text-right`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map((u) => {
                  const isCurrentAdmin = u.id === session?.userId;
                  return (
                    <tr key={u.id} className={rowCls}>
                      {/* Name & Avatar */}
                      <td className={tdCls}>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.firstName} photo={u.photos[0]} size={38} ring={u.verified} />
                          <div className="min-w-0">
                            <p className="text-ivory font-medium text-xs sm:text-sm truncate flex items-center gap-1.5">
                              <span>{u.firstName}</span>
                              {isCurrentAdmin && (
                                <span className="text-[0.62rem] text-rosegold bg-rosegold/10 px-1.5 py-0.5 rounded border border-rosegold/30 font-semibold">
                                  You
                                </span>
                              )}
                            </p>
                            <p className="text-[0.72rem] text-mist truncate font-mono max-w-[200px]">
                              {u.email}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* User ID */}
                      <td className={`${tdCls} whitespace-nowrap`}>
                        <div className="flex items-center gap-1 text-xs font-mono text-mist">
                          <span>{u.id.slice(0, 10)}...</span>
                          <button
                            onClick={() => copyToClipboard(u.id, "User ID")}
                            className="p-1 hover:text-ivory text-mist/60 transition-colors"
                            title="Copy full user ID"
                          >
                            <Copy size={12} />
                          </button>
                        </div>
                      </td>

                      {/* Plan Badge */}
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {renderPlanBadge(u.plan)}
                      </td>

                      {/* Verification Status */}
                      <td className={`${tdCls} whitespace-nowrap`}>
                        {u.verified ? (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-300">
                            <CheckCircle2 size={14} className="text-emerald-400" />
                            Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-mist/75">
                            <XCircle size={14} className="text-mist/50" />
                            Unverified
                          </span>
                        )}
                      </td>

                      {/* City & Age */}
                      <td className={`${tdCls} whitespace-nowrap text-xs text-ivory-dim`}>
                        <span>{u.city || "—"}</span>
                        <span className="text-mist ml-1.5">({u.age} yrs)</span>
                      </td>

                      {/* Registration Date */}
                      <td className={`${tdCls} whitespace-nowrap text-xs text-mist`}>
                        {fmtDate(u.createdAt)}
                      </td>

                      {/* Action buttons */}
                      <td className={`${tdCls} whitespace-nowrap text-right space-x-2`}>
                        <button
                          onClick={() => setDetailUser(u)}
                          className="px-2.5 py-1.5 rounded-lg glass hover:border-rosegold/40 text-xs text-champagne hover:text-rosegold font-medium transition-colors"
                        >
                          Details
                        </button>

                        <button
                          disabled={isCurrentAdmin}
                          onClick={() =>
                            setConfirmAction({
                              user: u,
                              targetVerified: !u.verified,
                            })
                          }
                          className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isCurrentAdmin
                              ? "opacity-30 cursor-not-allowed bg-white/5 text-mist"
                              : u.verified
                              ? "bg-rose-500/10 text-rose-300 border border-rose-500/20 hover:bg-rose-500/20"
                              : "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20"
                          }`}
                          title={
                            isCurrentAdmin
                              ? "Cannot change your own admin account"
                              : u.verified
                              ? "Revoke verification"
                              : "Verify user profile"
                          }
                        >
                          {u.verified ? "Revoke" : "Verify"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Toolbar */}
        {totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3.5 border-t border-white/5 bg-white/[0.01] text-xs text-mist">
            <span>
              Page <strong className="text-ivory font-mono">{currentPage}</strong> of{" "}
              <strong className="text-ivory font-mono">{totalPages}</strong>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                className="p-1.5 rounded-lg glass disabled:opacity-30 hover:border-rosegold/40 text-ivory transition-colors"
                aria-label="Previous page"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                className="p-1.5 rounded-lg glass disabled:opacity-30 hover:border-rosegold/40 text-ivory transition-colors"
                aria-label="Next page"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* User Detail Inspection Modal / Drawer */}
      <AnimatePresence>
        {detailUser && (
          <Modal
            open
            onClose={() => setDetailUser(null)}
            title={`${detailUser.firstName}'s Profile Information`}
            wide
          >
            <div className="space-y-6">
              {/* Profile Header Widget */}
              <div className="p-5 rounded-2xl bg-white/[0.02] border hairline flex flex-col sm:flex-row items-center sm:items-start gap-5">
                <Avatar name={detailUser.firstName} photo={detailUser.photos[0]} size={80} ring={detailUser.verified} />
                <div className="flex-1 text-center sm:text-left min-w-0">
                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                    <h2 className="font-display text-2xl text-ivory font-medium">
                      {detailUser.firstName}, {detailUser.age}
                    </h2>
                    {renderPlanBadge(detailUser.plan)}
                    {detailUser.verified ? (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
                        ✓ Verified
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-500/10 border border-rose-500/30 text-rose-300">
                        Unverified
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-2 text-xs text-mist">
                    <span className="flex items-center gap-1">
                      <MapPin size={12} className="text-rosegold" />
                      {detailUser.city || "No city set"}
                    </span>
                    <span>•</span>
                    <span className="flex items-center gap-1 font-mono">
                      <Mail size={12} className="text-champagne" />
                      {detailUser.email}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 mt-2 text-xs font-mono text-mist/70">
                    <span>ID: {detailUser.id}</span>
                    <button
                      onClick={() => copyToClipboard(detailUser.id, "User ID")}
                      className="p-1 hover:text-ivory"
                      title="Copy full ID"
                    >
                      <Copy size={11} />
                    </button>
                  </div>
                </div>

                <div className="shrink-0 flex sm:flex-col gap-2">
                  <button
                    disabled={detailUser.id === session?.userId}
                    onClick={() => {
                      setConfirmAction({
                        user: detailUser,
                        targetVerified: !detailUser.verified,
                      });
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-medium transition-colors ${
                      detailUser.id === session?.userId
                        ? "opacity-30 cursor-not-allowed bg-white/5 text-mist"
                        : detailUser.verified
                        ? "bg-rose-500/15 text-rose-300 border border-rose-500/30 hover:bg-rose-500/25"
                        : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/25"
                    }`}
                  >
                    {detailUser.verified ? "Revoke Verification" : "Approve Verification"}
                  </button>
                </div>
              </div>

              {/* Bio & Intent Card */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="md:col-span-2 p-5 rounded-2xl bg-white/[0.02] border hairline space-y-4 text-xs">
                  <div>
                    <p className="text-[0.68rem] uppercase tracking-wider text-mist font-semibold mb-1">
                      Personal Bio
                    </p>
                    <p className="text-ivory-dim leading-relaxed">
                      {detailUser.bio || "No personal bio written yet."}
                    </p>
                  </div>

                  <div>
                    <p className="text-[0.68rem] uppercase tracking-wider text-mist font-semibold mb-1.5">
                      Interests & Hobbies
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {detailUser.interests.concat(detailUser.hobbies).length === 0 ? (
                        <span className="text-mist/60 italic">No interests declared.</span>
                      ) : (
                        detailUser.interests.concat(detailUser.hobbies).map((tag, i) => (
                          <span
                            key={i}
                            className="px-2 py-0.5 rounded-lg bg-white/5 border border-white/10 text-ivory text-[0.68rem]"
                          >
                            {tag}
                          </span>
                        ))
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t hairline text-xs">
                    <div>
                      <span className="text-mist">Relationship Intent:</span>
                      <p className="text-ivory font-medium mt-0.5">
                        {detailUser.relationshipIntent || "Not specified"}
                      </p>
                    </div>
                    <div>
                      <span className="text-mist">Gender Preference:</span>
                      <p className="text-ivory font-medium capitalize mt-0.5">
                        {detailUser.gender} seeking {detailUser.interestedIn}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Account & Activity Metadata */}
                <div className="p-5 rounded-2xl bg-white/[0.02] border hairline space-y-3.5 text-xs">
                  <div>
                    <span className="text-mist">Account Registration:</span>
                    <p className="text-ivory font-medium mt-0.5">{fmtDate(detailUser.createdAt)}</p>
                  </div>

                  <div>
                    <span className="text-mist">Profile Completeness:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-champagne to-rosegold"
                          style={{ width: `${detailUser.profileComplete}%` }}
                        />
                      </div>
                      <span className="font-mono text-champagne font-medium">
                        {detailUser.profileComplete}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-mist">Active Plan Status:</span>
                    <p className="text-ivory font-medium mt-0.5 capitalize">
                      {detailUser.plan ? `${detailUser.plan === "connect" ? "Select" : detailUser.plan === "plus" ? "Signature" : "Privé"}` : "Free Tier"}
                      {detailSubscription && (
                        <span className="ml-1.5 text-[0.62rem] text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20 font-mono">
                          {detailSubscription.status}
                        </span>
                      )}
                    </p>
                    {(detailSubscription?.expiresAt || detailUser.planExpiresAt) && (
                      <p className="text-[0.68rem] text-mist">
                        Renews/Expires: {fmtDate(detailSubscription?.expiresAt ?? detailUser.planExpiresAt)}
                      </p>
                    )}
                  </div>

                  <div>
                    <span className="text-mist">Last Active Signal:</span>
                    <p className="text-ivory font-medium mt-0.5">
                      {detailUser.online ? "Online Now" : fmtDate(detailUser.lastActive)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Photo Gallery Signals */}
              {detailUser.photos.length > 0 && (
                <div className="p-5 rounded-2xl bg-white/[0.02] border hairline">
                  <p className="text-[0.68rem] uppercase tracking-wider text-mist font-semibold mb-3">
                    Uploaded Photos ({detailUser.photos.length})
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                    {detailUser.photos.map((url, idx) => (
                      <div key={idx} className="relative aspect-square rounded-xl overflow-hidden border hairline bg-black/40">
                        <img
                          src={url}
                          alt={`${detailUser.firstName} photo ${idx + 1}`}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Real Activity & Payment Records */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Transaction History for user */}
                <div className="p-5 rounded-2xl bg-white/[0.02] border hairline space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-mist flex items-center gap-1.5">
                      <CreditCard size={13} className="text-rosegold" />
                      Payment History
                    </span>
                    <span className="text-[0.68rem] font-mono text-mist">
                      {detailPayments.length} txns
                    </span>
                  </div>

                  {detailLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : detailPayments.length === 0 ? (
                    <p className="text-xs text-mist/60 py-3 italic">
                      No payment or subscription transactions recorded for this user.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {detailPayments.map((p) => (
                        <div
                          key={p.id}
                          className="p-2.5 rounded-xl bg-white/[0.02] border hairline flex items-center justify-between text-xs"
                        >
                          <div>
                            <p className="text-ivory font-medium capitalize">{p.kind}</p>
                            <p className="text-[0.65rem] text-mist">{fmtDate(p.createdAt)}</p>
                          </div>
                          <div className="text-right">
                            <p className="font-mono font-medium text-ivory">{inr(p.amount)}</p>
                            <span
                              className={`text-[0.62rem] font-medium ${
                                p.status === "verified"
                                  ? "text-emerald-300"
                                  : p.status === "refunded"
                                  ? "text-rose-300"
                                  : "text-amber-300"
                              }`}
                            >
                              {p.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Mutual Matches Record */}
                <div className="p-5 rounded-2xl bg-white/[0.02] border hairline space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold uppercase tracking-wider text-mist flex items-center gap-1.5">
                      <Heart size={13} className="text-pink-400" />
                      Mutual Matches
                    </span>
                    <span className="text-[0.68rem] font-mono text-mist">
                      {detailMatches.length} matches
                    </span>
                  </div>

                  {detailLoading ? (
                    <Skeleton className="h-20 w-full" />
                  ) : detailMatches.length === 0 ? (
                    <p className="text-xs text-mist/60 py-3 italic">
                      No mutual matches formed yet for this profile.
                    </p>
                  ) : (
                    <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                      {detailMatches.map((m) => (
                        <div
                          key={m.id}
                          className="p-2.5 rounded-xl bg-white/[0.02] border hairline flex items-center justify-between text-xs"
                        >
                          <div>
                            <p className="text-ivory font-medium">Match #{m.id.slice(0, 8)}</p>
                            <p className="text-[0.65rem] text-mist">{fmtDate(m.createdAt)}</p>
                          </div>
                          <span className="text-[0.65rem] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                            Active Match
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>

      {/* Confirmation Modal for Verification Management */}
      <AnimatePresence>
        {confirmAction && (
          <Modal
            open
            onClose={() => !submitting && setConfirmAction(null)}
            title={confirmAction.targetVerified ? "Confirm Profile Verification" : "Revoke Profile Verification"}
          >
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-ivory">
                    {confirmAction.targetVerified
                      ? `Mark ${confirmAction.user.firstName} as Verified?`
                      : `Revoke verification badge from ${confirmAction.user.firstName}?`}
                  </p>
                  <p className="text-amber-300/80 leading-relaxed">
                    {confirmAction.targetVerified
                      ? "This grants the verified identity badge on their profile and increases discovery trust signals. This action is recorded in the platform audit log."
                      : "This immediately removes their verified identity badge. This action is recorded in the platform audit log."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-3 pt-3">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() => setConfirmAction(null)}
                  className="px-4 py-2 rounded-xl glass hover:border-rosegold/40 text-xs text-ivory font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={submitting}
                  onClick={handleExecuteVerification}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold text-ivory transition-opacity shadow-sm ${
                    confirmAction.targetVerified
                      ? "bg-gradient-to-r from-emerald-600 to-teal-500 hover:opacity-90"
                      : "bg-gradient-to-r from-rose-600 to-burgundy hover:opacity-90"
                  } ${submitting ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  {submitting
                    ? "Updating..."
                    : confirmAction.targetVerified
                    ? "Confirm Verification"
                    : "Confirm Revocation"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
