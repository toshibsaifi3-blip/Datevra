import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Gift, Plus, Search, ShieldAlert, Sparkles, X } from "lucide-react";
import type {
  CreateMembershipPassInput,
  MembershipPass,
  MembershipPassStatus,
  PlanId,
  UserProfile,
} from "../../lib/types";
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
import { MigrationAlertBanner } from "../../components/MigrationAlertBanner";
import { fmtDate, fmtDay, rowCls, tdCls, thCls } from "./_util";

const STATUS_TONES: Record<MembershipPassStatus, "gold" | "green" | "muted" | "rose"> = {
  active: "gold",
  redeemed: "green",
  expired: "muted",
  revoked: "rose",
};

const PLAN_META: Record<
  PlanId,
  { name: string; subtitle: string; tone: "gold" | "rose" | "muted" }
> = {
  connect: { name: "Select", subtitle: "Essential verified access", tone: "muted" },
  plus: { name: "Signature", subtitle: "Priority matching & venues", tone: "gold" },
  elite: { name: "Privé", subtitle: "Ultra-exclusive concierge", tone: "rose" },
};

const DURATION_PRESETS = [
  { label: "1 Month (30d)", days: 30 },
  { label: "3 Months (90d)", days: 90 },
  { label: "6 Months (180d)", days: 180 },
  { label: "1 Year (365d)", days: 365 },
];

export default function MembershipPasses() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [passToRevoke, setPassToRevoke] = useState<MembershipPass | null>(null);
  const [revocationReason, setRevocationReason] = useState("");
  const [isRevoking, setIsRevoking] = useState(false);

  // Form state
  const [planId, setPlanId] = useState<PlanId>("plus");
  const [durationDays, setDurationDays] = useState<number>(30);
  const [customDuration, setCustomDuration] = useState<string>("");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [assigneeMode, setAssigneeMode] = useState<"unassigned" | "assigned">("unassigned");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [userSearch, setUserSearch] = useState("");
  const [note, setNote] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  // Success dialog state
  const [createdPass, setCreatedPass] = useState<MembershipPass | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Data fetching
  const {
    data: passes,
    loading,
    error,
    refresh,
  } = useAsync((b) => b.listMembershipPasses(), [db], [] as MembershipPass[]);
  const { data: users } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  // Subscribe to realtime / mock events
  useEffect(() => db.subscribe("membership_passes", refresh), [db, refresh]);

  // Copy helper
  const handleCopy = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast(`Copied ${code}`, "gold");
    setTimeout(() => {
      setCopiedCode((curr) => (curr === code ? null : curr));
    }, 2000);
  };

  // Filtered passes
  const filtered = useMemo(() => {
    return passes.filter((p) => {
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      if (planFilter !== "all" && p.planId !== planFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const codeMatch = p.code.toLowerCase().includes(q);
        const userMatch = (p.issuedToName ?? "").toLowerCase().includes(q) ||
          (p.issuedToEmail ?? "").toLowerCase().includes(q) ||
          (p.issuedToUserId ?? "").toLowerCase().includes(q);
        const noteMatch = (p.note ?? "").toLowerCase().includes(q);
        if (!codeMatch && !userMatch && !noteMatch) return false;
      }
      return true;
    });
  }, [passes, statusFilter, planFilter, searchQuery]);

  // Metrics summary
  const metrics = useMemo(() => {
    const total = passes.length;
    const active = passes.filter((p) => p.status === "active").length;
    const redeemed = passes.filter((p) => p.status === "redeemed").length;
    const revoked = passes.filter((p) => p.status === "revoked").length;
    const expired = passes.filter((p) => p.status === "expired").length;
    return { total, active, redeemed, revoked, expired };
  }, [passes]);

  // User search candidates
  const matchingUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users.slice(0, 6);
    return users
      .filter(
        (u) =>
          u.firstName.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.city.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [users, userSearch]);

  const resetForm = () => {
    setPlanId("plus");
    setDurationDays(30);
    setCustomDuration("");
    setExpiresAt("");
    setAssigneeMode("unassigned");
    setSelectedUser(null);
    setUserSearch("");
    setNote("");
  };

  const handleGenerate = async () => {
    const finalDays = customDuration ? parseInt(customDuration, 10) : durationDays;
    if (isNaN(finalDays) || finalDays <= 0) {
      toast("Please enter a valid positive duration in days", "rose");
      return;
    }

    if (assigneeMode === "assigned" && !selectedUser) {
      toast("Please select a member to assign this pass to, or choose Unassigned", "rose");
      return;
    }

    // Migration 011 requires expires_at to be NOT NULL and in the future.
    // If left blank by the administrator, default to 90 days from now.
    const finalExpiresAt = expiresAt
      ? new Date(expiresAt).toISOString()
      : new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();

    if (new Date(finalExpiresAt).getTime() <= Date.now()) {
      toast("Pass expiry must be in the future", "rose");
      return;
    }

    const input: CreateMembershipPassInput = {
      planId,
      durationDays: finalDays,
      expiresAt: finalExpiresAt,
      issuedToUserId: assigneeMode === "assigned" && selectedUser ? selectedUser.id : null,
      note: note.trim() || null,
    };

    setIsGenerating(true);
    try {
      const created = await db.createMembershipPass(input, actor);
      setCreatedPass(created);
      setShowGenerateModal(false);
      resetForm();
      toast(`Generated membership pass ${created.code}`, "gold");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to generate membership pass", "rose");
    } finally {
      setIsGenerating(false);
    }
  };

  const handleRevoke = async () => {
    if (!passToRevoke) return;
    setIsRevoking(true);
    try {
      await db.revokeMembershipPass(passToRevoke.id, revocationReason || null, actor);
      toast(`Revoked pass ${passToRevoke.code}`, "gold");
      setPassToRevoke(null);
      setRevocationReason("");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Failed to revoke pass", "rose");
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="px-0 sm:px-5 pb-16 sm:pb-24 pt-4 sm:pt-10 md:pt-14 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 sm:gap-6 mb-8">
        <SectionHead
          align="left"
          kicker="Revenue & Concierge"
          title="Membership Passes"
          sub="Generate, audit, and manage promotional and concierge membership passes. Passes grant complimentary access to Select, Signature, or Privé tiers without payment fees."
        />
        <button
          onClick={() => {
            resetForm();
            setShowGenerateModal(true);
          }}
          className="btn-gold shrink-0 inline-flex items-center gap-2 self-start md:self-end"
        >
          <Plus className="w-4 h-4" />
          <span>Generate Pass</span>
        </button>
      </div>

      {error?.includes("MIGRATION_REQUIRED") ? (
        <MigrationAlertBanner
          migrationId="011"
          migrationFile="db/migrations/011_membership_passes.sql"
          featureName="Membership Passes"
          description="The database table public.membership_passes and its generation RPCs have not been installed yet in your Supabase backend. Execute Migration 011 in the Supabase Dashboard SQL Editor to activate promotional and concierge membership passes."
          onRefresh={refresh}
        />
      ) : error ? (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs mb-6">
          Could not load membership passes: {error}
        </div>
      ) : null}

      {/* Metrics Summary Strip */}
      <div className="grid grid-cols-1 min-[380px]:grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <div className="glass-panel p-4 rounded-2xl border border-white/5">
          <p className="text-xs uppercase tracking-wider text-mist">Total Generated</p>
          <p className="font-display text-2xl text-ivory mt-1">{metrics.total}</p>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-champagne/20">
          <p className="text-xs uppercase tracking-wider text-champagne">Active (Unused)</p>
          <p className="font-display text-2xl text-champagne mt-1">{metrics.active}</p>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-white/5">
          <p className="text-xs uppercase tracking-wider text-green-400">Redeemed</p>
          <p className="font-display text-2xl text-green-400 mt-1">{metrics.redeemed}</p>
        </div>
        <div className="glass-panel p-4 rounded-2xl border border-white/5">
          <p className="text-xs uppercase tracking-wider text-mist">Revoked / Expired</p>
          <p className="font-display text-2xl text-mist mt-1">
            {metrics.revoked + metrics.expired}
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="glass-panel p-4 rounded-2xl border border-white/10 mb-6 flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mist" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code, member name, email, or note…"
            className={`${inputCls} pl-10 text-sm`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-ivory"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Plan Filter */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-mist mr-1">Plan:</span>
            {(["all", "connect", "plus", "elite"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPlanFilter(p)}
                className={`px-3 py-1.5 rounded-full transition-all capitalize ${
                  planFilter === p
                    ? "bg-champagne text-ink font-medium shadow-sm"
                    : "bg-white/5 text-ivory/60 hover:bg-white/10"
                }`}
              >
                {p === "all" ? "All Plans" : PLAN_META[p].name}
              </button>
            ))}
          </div>

          <div className="w-px h-5 bg-white/10 hidden md:block" />

          {/* Status Filter */}
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-mist mr-1">Status:</span>
            {(["all", "active", "redeemed", "expired", "revoked"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full transition-all capitalize ${
                  statusFilter === s
                    ? "bg-champagne text-ink font-medium shadow-sm"
                    : "bg-white/5 text-ivory/60 hover:bg-white/10"
                }`}
              >
                {s === "all" ? "All" : s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Ledger Table */}
      {loading ? (
        <Skeleton />
      ) : error ? (
        <EmptyState title="Could not load membership passes" body={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No membership passes found"
          body={
            searchQuery || statusFilter !== "all" || planFilter !== "all"
              ? "Try adjusting your filters or search terms."
              : "Generate a membership pass to grant complimentary tier access to members."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10 glass-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 bg-white/[0.02]">
                <th className={thCls}>Pass Code</th>
                <th className={thCls}>Plan</th>
                <th className={thCls}>Duration</th>
                <th className={thCls}>Assigned Member</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Expires</th>
                <th className={thCls}>Redeemed / Details</th>
                <th className={`${thCls} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const plan = PLAN_META[p.planId] ?? { name: p.planId, tone: "champagne" };
                const isCopied = copiedCode === p.code;
                return (
                  <tr key={p.id} className={rowCls}>
                    {/* Code */}
                    <td className={tdCls}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-champagne font-semibold tracking-wider">
                          {p.code}
                        </span>
                        <button
                          onClick={() => handleCopy(p.code)}
                          title="Copy pass code"
                          className="p-1 rounded hover:bg-white/10 text-mist hover:text-ivory transition-colors"
                        >
                          {isCopied ? (
                            <Check className="w-3.5 h-3.5 text-green-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                      {p.note && (
                        <p className="text-xs text-mist/80 mt-0.5 max-w-xs truncate" title={p.note}>
                          Note: {p.note}
                        </p>
                      )}
                    </td>

                    {/* Plan */}
                    <td className={tdCls}>
                      <Badge tone={plan.tone}>{plan.name}</Badge>
                    </td>

                    {/* Duration */}
                    <td className={tdCls}>
                      <span className="text-ivory font-medium">{p.durationDays} days</span>
                    </td>

                    {/* Assigned Member */}
                    <td className={tdCls}>
                      {p.issuedToName || p.issuedToEmail ? (
                        <div>
                          <p className="text-ivory font-medium">
                            {p.issuedToName ?? "Named Member"}
                          </p>
                          {p.issuedToEmail && (
                            <p className="text-xs text-mist">{p.issuedToEmail}</p>
                          )}
                        </div>
                      ) : p.issuedToUserId ? (
                        <span className="text-xs font-mono text-mist">
                          ID: {p.issuedToUserId.slice(0, 8)}…
                        </span>
                      ) : (
                        <span className="text-mist/60 italic text-xs">Unassigned (Open)</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className={tdCls}>
                      <Badge tone={STATUS_TONES[p.status]}>{p.status}</Badge>
                    </td>

                    {/* Expires */}
                    <td className={tdCls}>
                      <span className="text-mist text-xs">
                        {p.expiresAt ? fmtDate(p.expiresAt) : "Never (Valid indefinitely)"}
                      </span>
                    </td>

                    {/* Redeemed / Details */}
                    <td className={tdCls}>
                      {p.status === "redeemed" ? (
                        <div className="text-xs">
                          <span className="text-green-400 font-medium">Redeemed</span>
                          <span className="text-mist block">
                            {p.redeemedAt ? fmtDay(p.redeemedAt) : "Yes"}
                          </span>
                        </div>
                      ) : p.status === "revoked" ? (
                        <div className="text-xs">
                          <span className="text-rose-400 font-medium">Revoked</span>
                          {p.revocationReason && (
                            <span
                              className="text-mist block max-w-xs truncate"
                              title={p.revocationReason}
                            >
                              {p.revocationReason}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-mist/60">
                          Created {fmtDay(p.createdAt)}
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className={`${tdCls} text-right`}>
                      {p.status === "active" ? (
                        <button
                          onClick={() => {
                            setPassToRevoke(p);
                            setRevocationReason("");
                          }}
                          className="px-2.5 py-1 text-xs rounded-lg border border-rose-500/30 text-rose-300 hover:bg-rose-500/10 transition-colors"
                        >
                          Revoke
                        </button>
                      ) : (
                        <span className="text-xs text-mist/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ==================== GENERATE PASS MODAL ==================== */}
      <Modal
        open={showGenerateModal}
        onClose={() => setShowGenerateModal(false)}
        title="Generate Membership Pass"
        wide
      >
        <div className="space-y-6">
          <p className="text-sm text-ivory-dim leading-relaxed">
            Create an authenticated pass code redeemable for complimentary membership days.
            Passes bypass Razorpay checkout and grant ₹0 verified tier subscriptions.
          </p>

          {/* 1. Plan Tier Selection */}
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-mist block mb-2 font-medium">
              1. Select Membership Tier
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["connect", "plus", "elite"] as const).map((pid) => {
                const meta = PLAN_META[pid];
                const selected = planId === pid;
                return (
                  <button
                    key={pid}
                    type="button"
                    onClick={() => setPlanId(pid)}
                    className={`p-4 rounded-2xl border text-left transition-all ${
                      selected
                        ? "border-champagne bg-champagne/10 shadow-lg ring-1 ring-champagne/50"
                        : "border-white/10 bg-white/[0.02] hover:border-white/20"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display text-lg text-ivory">{meta.name}</span>
                      {selected && <Sparkles className="w-4 h-4 text-champagne" />}
                    </div>
                    <p className="text-xs text-mist mt-1">{meta.subtitle}</p>
                    <div className="mt-3">
                      <Badge tone={meta.tone}>{pid.toUpperCase()}</Badge>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Duration */}
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-mist block mb-2 font-medium">
              2. Membership Duration
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {DURATION_PRESETS.map((p) => {
                const isSelected = !customDuration && durationDays === p.days;
                return (
                  <button
                    key={p.days}
                    type="button"
                    onClick={() => {
                      setDurationDays(p.days);
                      setCustomDuration("");
                    }}
                    className={`py-2 px-3 rounded-xl border text-xs font-medium transition-all ${
                      isSelected
                        ? "border-champagne bg-champagne/15 text-champagne font-semibold"
                        : "border-white/10 text-ivory/70 hover:bg-white/5"
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min="1"
                placeholder="Or custom days (e.g. 45)…"
                value={customDuration}
                onChange={(e) => setCustomDuration(e.target.value)}
                className={`${inputCls} text-sm`}
              />
              <span className="text-xs text-mist shrink-0">days</span>
            </div>
          </div>

          {/* 3. Pass Expiration Date (Optional) */}
          <Field
            label="3. Pass Expiry Date (Optional)"
            hint="Leave blank to use the default 90-day redemption window."
          >
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className={inputCls}
            />
          </Field>

          {/* 4. Assignment Option */}
          <div>
            <label className="text-xs uppercase tracking-[0.2em] text-mist block mb-2 font-medium">
              4. Member Assignment
            </label>
            <div className="flex flex-col sm:flex-row gap-3 sm:gap-4 mb-3">
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ivory">
                <input
                  type="radio"
                  name="assigneeMode"
                  checked={assigneeMode === "unassigned"}
                  onChange={() => {
                    setAssigneeMode("unassigned");
                    setSelectedUser(null);
                  }}
                  className="accent-champagne"
                />
                <span>Open / Unassigned (Any member with code can redeem)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm text-ivory">
                <input
                  type="radio"
                  name="assigneeMode"
                  checked={assigneeMode === "assigned"}
                  onChange={() => setAssigneeMode("assigned")}
                  className="accent-champagne"
                />
                <span>Assigned to specific member</span>
              </label>
            </div>

            {assigneeMode === "assigned" && (
              <div className="space-y-2 mt-2">
                {selectedUser ? (
                  <div className="flex items-center justify-between p-3 rounded-xl border border-champagne/40 bg-champagne/5">
                    <div>
                      <p className="text-ivory font-medium text-sm">{selectedUser.firstName}</p>
                      <p className="text-xs text-mist">{selectedUser.email} · {selectedUser.city}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(null)}
                      className="text-xs text-rose-300 hover:underline"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search member by first name, email, or city…"
                      className={inputCls}
                    />
                    <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-black/40 divide-y divide-white/5">
                      {matchingUsers.length === 0 ? (
                        <p className="p-3 text-xs text-mist text-center">No members found</p>
                      ) : (
                        matchingUsers.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setSelectedUser(u);
                              setUserSearch("");
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-white/5 flex items-center justify-between transition-colors"
                          >
                            <div>
                              <span className="text-ivory font-medium">{u.firstName}</span>{" "}
                              <span className="text-mist text-xs">({u.email})</span>
                            </div>
                            <span className="text-xs text-champagne/70">{u.city}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 5. Internal Admin Note */}
          <Field
            label="5. Admin Note / Campaign Tag (Optional)"
            hint="Internal record explaining why this pass was generated (e.g., VIP onboarding, Concierge comp, Influencer partnership)."
          >
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Founder gift for Mumbai launch"
              className={inputCls}
            />
          </Field>

          {/* Action Buttons */}
          <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-white/10">
            <button
              type="button"
              onClick={() => setShowGenerateModal(false)}
              className="px-5 py-2.5 rounded-full border border-white/10 text-ivory/70 hover:bg-white/5 text-sm min-h-[44px]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isGenerating}
              onClick={handleGenerate}
              className="btn-gold inline-flex items-center gap-2 min-h-[44px]"
            >
              {isGenerating ? (
                <span>Generating…</span>
              ) : (
                <>
                  <Gift className="w-4 h-4" />
                  <span>Generate Pass Code</span>
                </>
              )}
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== PASS GENERATED SUCCESS MODAL ==================== */}
      <Modal
        open={Boolean(createdPass)}
        onClose={() => setCreatedPass(null)}
        title="Pass Generated Successfully"
      >
        {createdPass && (
          <div className="space-y-6 text-center">
            <div className="w-12 h-12 rounded-full bg-champagne/20 text-champagne flex items-center justify-center mx-auto">
              <Gift className="w-6 h-6" />
            </div>

            <div>
              <p className="text-xs uppercase tracking-widest text-mist">Pass Code</p>
              <div className="mt-2 p-4 rounded-2xl bg-white/5 border border-champagne/40 flex flex-wrap items-center justify-center gap-3">
                <span className="font-mono text-lg sm:text-2xl font-bold text-champagne tracking-wider break-all">
                  {createdPass.code}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy(createdPass.code)}
                  className="p-2 rounded-xl bg-champagne text-ink hover:bg-champagne-light transition-all flex items-center gap-1.5 text-xs font-semibold"
                >
                  {copiedCode === createdPass.code ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            <div className="text-left text-xs space-y-2 bg-white/[0.02] p-4 rounded-xl border border-white/5">
              <div className="flex justify-between">
                <span className="text-mist">Tier:</span>
                <span className="text-ivory font-medium">
                  {PLAN_META[createdPass.planId]?.name ?? createdPass.planId}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-mist">Duration:</span>
                <span className="text-ivory font-medium">{createdPass.durationDays} days</span>
              </div>
              <div className="flex justify-between">
                <span className="text-mist">Assigned to:</span>
                <span className="text-ivory font-medium">
                  {createdPass.issuedToName ?? createdPass.issuedToEmail ?? "Unassigned (Open)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-mist">Redemption Expiry:</span>
                <span className="text-ivory font-medium">
                  {createdPass.expiresAt ? fmtDate(createdPass.expiresAt) : "No expiry"}
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setCreatedPass(null)}
              className="btn-gold w-full"
            >
              Done
            </button>
          </div>
        )}
      </Modal>

      {/* ==================== REVOKE CONFIRMATION MODAL ==================== */}
      <Modal
        open={Boolean(passToRevoke)}
        onClose={() => {
          if (!isRevoking) setPassToRevoke(null);
        }}
        title="Revoke Membership Pass"
      >
        {passToRevoke && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-rose-300 bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-xs">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>
                Revoking will immediately deactivate this pass. It can no longer be redeemed by any
                member.
              </span>
            </div>

            <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-mist">Code:</span>
                <span className="font-mono text-champagne font-semibold">
                  {passToRevoke.code}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-mist">Plan:</span>
                <span className="text-ivory">
                  {PLAN_META[passToRevoke.planId]?.name} ({passToRevoke.durationDays} days)
                </span>
              </div>
              {passToRevoke.issuedToName && (
                <div className="flex justify-between">
                  <span className="text-mist">Issued To:</span>
                  <span className="text-ivory">{passToRevoke.issuedToName}</span>
                </div>
              )}
            </div>

            <Field label="Revocation Reason (Optional)">
              <input
                type="text"
                value={revocationReason}
                onChange={(e) => setRevocationReason(e.target.value)}
                placeholder="e.g. Issued by mistake, Replaced with Privé pass"
                className={inputCls}
              />
            </Field>

            <div className="flex flex-wrap justify-end gap-3 pt-3">
              <button
                type="button"
                disabled={isRevoking}
                onClick={() => setPassToRevoke(null)}
                className="px-4 py-2.5 rounded-full border border-white/10 text-ivory/70 hover:bg-white/5 text-xs min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRevoking}
                onClick={handleRevoke}
                className="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs transition-colors min-h-[44px]"
              >
                {isRevoking ? "Revoking…" : "Confirm Revoke"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
