import { useEffect, useMemo, useState } from "react";
import { CalendarHeart, CheckCircle2, Clock, History, Plus, RefreshCw, Sparkles, XCircle } from "lucide-react";
import type {
  AutoDateOfferSummary,
  AutomaticDateOffer,
  Cafe,
  DateExperience,
  DateOfferEvent,
  ManualDateOffer,
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

type TabKey = "automatic" | "manual";

const STATUS_TONE: Record<string, "gold" | "green" | "rose" | "muted"> = {
  pending: "gold",
  accepted: "green",
  declined: "rose",
  expired: "muted",
  cancelled: "muted",
};

const EMPTY_SUMMARY: AutoDateOfferSummary = {
  thresholdTarget: 100,
  targetOfferCount: 10,
  totalEligibleMatches: 0,
  remainingEligiblePairs: 0,
  batchStatus: "not_triggered",
  batchId: null,
  batchCompletedAt: null,
  shortfallCount: 0,
  offersCreated: 0,
  offersPending: 0,
  offersAccepted: 0,
  offersDeclined: 0,
  offersExpired: 0,
};

function responseLabel(val: boolean | null): string {
  if (val === true) return "Accepted";
  if (val === false) return "Declined";
  return "Pending";
}

export default function AdminDateOffers() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  const [tab, setTab] = useState<TabKey>("automatic");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [evaluating, setEvaluating] = useState(false);

  // Manual offer creation modal
  const [showCreate, setShowCreate] = useState(false);
  const [userAId, setUserAId] = useState("");
  const [userBId, setUserBId] = useState("");
  const [experienceId, setExperienceId] = useState("");
  const [cafeId, setCafeId] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10));
  const [time, setTime] = useState("19:30");
  const [venue, setVenue] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<ManualDateOffer | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  // Events drawer
  const [historyOfferId, setHistoryOfferId] = useState<string | null>(null);

  const {
    data: summary,
    loading: loadingSummary,
    error: summaryError,
    refresh: refreshSummary,
  } = useAsync((b) => b.getAutoDateOfferSummary(), [db], EMPTY_SUMMARY);

  const {
    data: autoOffers,
    loading: loadingAuto,
    error: autoError,
    refresh: refreshAuto,
  } = useAsync((b) => b.listAutomaticDateOffers(), [db], [] as AutomaticDateOffer[]);

  const {
    data: manualOffers,
    loading: loadingManual,
    error: manualError,
    refresh: refreshManual,
  } = useAsync((b) => b.listManualDateOffers(), [db], [] as ManualDateOffer[]);

  const { data: events, refresh: refreshEvents } = useAsync(
    (b) => b.listDateOfferEvents(),
    [db],
    [] as DateOfferEvent[],
  );

  const { data: users } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);
  const { data: experiences } = useAsync((b) => b.listExperiences(), [db], [] as DateExperience[]);
  const { data: cafes } = useAsync((b) => b.listCafes(), [db], [] as Cafe[]);

  const refreshAll = () => {
    refreshSummary();
    refreshAuto();
    refreshManual();
    refreshEvents();
  };

  useEffect(() => db.subscribe("date_offers", refreshAll), [db]);

  const members = useMemo(
    () => users.filter((u) => !u.isAdmin && u.id !== "admin-1"),
    [users],
  );

  const expMap = useMemo(() => new Map(experiences.map((e) => [e.id, e])), [experiences]);
  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const progressPct = Math.min(
    100,
    Math.round((summary.totalEligibleMatches / Math.max(1, summary.thresholdTarget)) * 100),
  );

  const filteredManual = useMemo(
    () => manualOffers.filter((o) => statusFilter === "all" || o.status === statusFilter),
    [manualOffers, statusFilter],
  );

  const offerHistory = useMemo(
    () => (historyOfferId ? events.filter((e) => e.offerId === historyOfferId) : []),
    [events, historyOfferId],
  );

  const handleEvaluate = async () => {
    setEvaluating(true);
    try {
      const res = await db.evaluateInitialAutoDateOffers();
      if (res.triggered) {
        toast(`Initial batch completed: ${String(res.created_offers ?? 0)} automatic offer(s) created.`, "gold");
      } else if (res.already_completed) {
        toast("The one-time 100-match automatic batch has already completed.", "rose");
      } else {
        toast(
          `Threshold not yet met (${String(res.eligible_matches ?? 0)}/${String(res.threshold_target ?? 100)} eligible matches).`,
          "rose",
        );
      }
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not evaluate automatic batch", "rose");
    } finally {
      setEvaluating(false);
    }
  };

  const handleCreateManual = async () => {
    if (!userAId || !userBId || userAId === userBId) {
      toast("Select two distinct members.", "rose");
      return;
    }
    const chosenExp = experienceId || experiences[0]?.id || "";
    if (!chosenExp) {
      toast("Select a curated experience.", "rose");
      return;
    }
    if (!date || !time) {
      toast("Date and time are required.", "rose");
      return;
    }
    const selectedCafe = cafes.find((c) => c.id === cafeId);
    const resolvedVenue =
      venue.trim() || (selectedCafe ? `${selectedCafe.name}, ${selectedCafe.city}` : "Curated Partner Venue");

    setSubmitting(true);
    try {
      await db.createManualDateOffer(
        {
          userAId,
          userBId,
          experienceId: chosenExp,
          cafeId: cafeId || null,
          date,
          time,
          venue: resolvedVenue,
          message: message.trim() || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
        actor,
      );
      toast("Manual date offer sent to both members.", "gold");
      setShowCreate(false);
      setUserAId("");
      setUserBId("");
      setVenue("");
      setMessage("");
      setExpiresAt("");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create manual date offer", "rose");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancelManual = async () => {
    if (!cancelTarget) return;
    try {
      await db.cancelManualDateOffer(cancelTarget.id, cancelReason.trim() || null, actor);
      toast("Manual date offer cancelled.", "gold");
      setCancelTarget(null);
      setCancelReason("");
      refreshAll();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not cancel offer", "rose");
    }
  };

  const migrationError = summaryError ?? autoError ?? manualError;

  return (
    <div className="px-0 sm:px-4 pb-16 sm:pb-24 pt-2 sm:pt-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <SectionHead
          align="left"
          kicker="Curated Dates"
          title="Date Offers"
          sub="Monitor the one-time 100-match automatic date offer milestone and issue dedicated admin-to-pair manual date offers (separate from match proposals)."
        />
        <div className="flex flex-wrap gap-2.5">
          <button
            type="button"
            onClick={() => setTab("automatic")}
            className={`px-4 py-2.5 rounded-full text-xs font-medium min-h-[44px] transition-all ${
              tab === "automatic"
                ? "btn-gold"
                : "btn-ghost text-ivory-dim"
            }`}
          >
            Automatic 100-Match System
          </button>
          <button
            type="button"
            onClick={() => setTab("manual")}
            className={`px-4 py-2.5 rounded-full text-xs font-medium min-h-[44px] transition-all ${
              tab === "manual"
                ? "btn-gold"
                : "btn-ghost text-ivory-dim"
            }`}
          >
            Manual Date Offers ({manualOffers.length})
          </button>
        </div>
      </div>

      {migrationError?.includes("MIGRATION_REQUIRED") && (
        <MigrationAlertBanner
          migrationId="030"
          migrationFile="db/migrations/030_date_offers_and_invitations.sql"
          featureName="Automatic & Manual Date Offers"
          description="Execute Migration 030 in your Supabase SQL Editor to enable the Automatic 100-Match Date Offer batch tables, Manual Date Offers, and transactional RPCs."
          onRefresh={refreshAll}
        />
      )}

      {/* ==================== TAB 1: AUTOMATIC 100-MATCH SYSTEM ==================== */}
      {tab === "automatic" && (
        <div className="space-y-6">
          <div className="glass glow-border rounded-3xl p-5 sm:p-7">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-champagne" />
                  <span className="text-xs uppercase tracking-[0.22em] text-champagne">
                    One-Time Milestone Batch
                  </span>
                </div>
                <h2 className="font-display text-2xl sm:text-3xl text-ivory mt-1">
                  {summary.totalEligibleMatches} / {summary.thresholdTarget} Eligible Mutual Matches
                </h2>
                <p className="text-sm text-mist mt-1 max-w-2xl">
                  Once Datevra reaches 100 eligible mutual matches (≥ 75% compatibility, non-blocked, active members), the system triggers exactly one initial batch of up to 10 automatic date offers. Both partners must accept before any booking is created.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 shrink-0">
                <Badge
                  tone={
                    summary.batchStatus === "completed"
                      ? "green"
                      : summary.batchStatus === "failed"
                        ? "rose"
                        : "gold"
                  }
                >
                  Batch: {summary.batchStatus.replace("_", " ")}
                </Badge>
                <button
                  type="button"
                  disabled={evaluating || summary.batchStatus === "completed"}
                  onClick={handleEvaluate}
                  className="btn-ghost rounded-full px-4 py-2.5 text-xs min-h-[44px] inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${evaluating ? "animate-spin" : ""}`} />
                  {summary.batchStatus === "completed" ? "One-Time Batch Completed" : "Check Threshold Now"}
                </button>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-5">
              <div className="flex justify-between text-xs text-mist mb-1.5">
                <span>Threshold progress</span>
                <span className="text-champagne font-medium">{progressPct}%</span>
              </div>
              <div className="h-2.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rosegold via-champagne to-champagne-light transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-6">
              {[
                { label: "Offers Created", val: summary.offersCreated, tone: "text-champagne" },
                { label: "Pending", val: summary.offersPending, tone: "text-ivory" },
                { label: "Accepted", val: summary.offersAccepted, tone: "text-emerald-400" },
                { label: "Declined", val: summary.offersDeclined, tone: "text-rosegold" },
                { label: "Expired", val: summary.offersExpired, tone: "text-mist" },
                { label: "Remaining Eligible", val: summary.remainingEligiblePairs, tone: "text-ivory" },
              ].map((m) => (
                <div key={m.label} className="rounded-2xl bg-white/[0.03] border border-white/10 p-3.5">
                  <p className="text-[0.68rem] uppercase tracking-wider text-mist">{m.label}</p>
                  <p className={`font-display text-2xl mt-1 ${m.tone}`}>{m.val}</p>
                </div>
              ))}
            </div>

            {summary.batchCompletedAt && (
              <p className="text-xs text-mist mt-4">
                Initial batch completed on {fmtDate(summary.batchCompletedAt)}
                {summary.shortfallCount > 0 ? ` · Shortfall recorded: ${summary.shortfallCount} pair(s)` : ""}.
              </p>
            )}
          </div>

          {loadingSummary || loadingAuto ? (
            <Skeleton />
          ) : autoOffers.length === 0 ? (
            <EmptyState
              title="No automatic date offers generated yet"
              body="Automatic date offers are generated once when the platform crosses 100 eligible mutual matches (≥ 75% compatibility)."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 glass">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className={thCls}>Matched Pair</th>
                    <th className={thCls}>Experience & Venue</th>
                    <th className={thCls}>Schedule</th>
                    <th className={thCls}>Partner Responses</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Booking</th>
                  </tr>
                </thead>
                <tbody>
                  {autoOffers.map((o) => {
                    const nameA = o.userAName ?? userMap.get(o.userA)?.firstName ?? o.userA.slice(0, 8);
                    const nameB = o.userBName ?? userMap.get(o.userB)?.firstName ?? o.userB.slice(0, 8);
                    return (
                      <tr key={o.id} className={rowCls}>
                        <td className={tdCls}>
                          <p className="text-ivory font-medium">{nameA} &amp; {nameB}</p>
                          <p className="text-xs text-mist">Expires {fmtDay(o.expiresAt)}</p>
                        </td>
                        <td className={tdCls}>
                          <p className="text-ivory">{expMap.get(o.experienceId)?.title ?? o.experienceId}</p>
                          <p className="text-xs text-mist">{o.venue}</p>
                        </td>
                        <td className={tdCls}>
                          <span className="text-ivory">{o.suggestedDate}</span>
                          <span className="text-xs text-mist block">{o.suggestedTime}</span>
                        </td>
                        <td className={tdCls}>
                          <div className="text-xs space-y-0.5">
                            <p>{nameA}: <span className="text-champagne">{responseLabel(o.userAResponse)}</span></p>
                            <p>{nameB}: <span className="text-champagne">{responseLabel(o.userBResponse)}</span></p>
                          </div>
                        </td>
                        <td className={tdCls}>
                          <Badge tone={STATUS_TONE[o.status] ?? "muted"}>{o.status}</Badge>
                        </td>
                        <td className={tdCls}>
                          {o.bookingId ? (
                            <Badge tone="green">Confirmed</Badge>
                          ) : (
                            <span className="text-xs text-mist">—</span>
                          )}
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

      {/* ==================== TAB 2: MANUAL DATE OFFERS ==================== */}
      {tab === "manual" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5 text-xs">
              {(["all", "pending", "accepted", "declined", "expired", "cancelled"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className={`px-3.5 py-2 rounded-full capitalize transition-all ${
                    statusFilter === s
                      ? "bg-champagne text-ink font-medium"
                      : "bg-white/5 text-ivory/70 hover:bg-white/10"
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!experienceId && experiences[0]) setExperienceId(experiences[0].id);
                setShowCreate(true);
              }}
              className="btn-gold rounded-full px-5 py-2.5 min-h-[44px] text-sm font-semibold inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Create Manual Date Offer
            </button>
          </div>

          {loadingManual ? (
            <Skeleton />
          ) : filteredManual.length === 0 ? (
            <EmptyState
              title="No manual date offers found"
              body="Curate a dedicated date offer for two members. Both members must independently accept before a booking is created."
            />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 glass">
              <table className="w-full min-w-[880px] text-sm">
                <thead>
                  <tr className="border-b border-white/10 bg-white/[0.02]">
                    <th className={thCls}>Pair</th>
                    <th className={thCls}>Experience & Venue</th>
                    <th className={thCls}>Date / Time</th>
                    <th className={thCls}>Acceptance</th>
                    <th className={thCls}>Status</th>
                    <th className={`${thCls} text-right`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredManual.map((o) => {
                    const nameA = o.userAName ?? userMap.get(o.userA)?.firstName ?? o.userA.slice(0, 8);
                    const nameB = o.userBName ?? userMap.get(o.userB)?.firstName ?? o.userB.slice(0, 8);
                    return (
                      <tr key={o.id} className={rowCls}>
                        <td className={tdCls}>
                          <p className="text-ivory font-medium">{nameA} &amp; {nameB}</p>
                          <p className="text-xs text-mist">Expires {fmtDay(o.expiresAt)}</p>
                        </td>
                        <td className={tdCls}>
                          <p className="text-ivory">{expMap.get(o.experienceId)?.title ?? o.experienceId}</p>
                          <p className="text-xs text-mist">{o.venue}</p>
                          {o.message && <p className="text-xs text-ivory-dim/75 mt-0.5 line-clamp-1">“{o.message}”</p>}
                        </td>
                        <td className={tdCls}>
                          <p className="text-ivory">{o.suggestedDate}</p>
                          <p className="text-xs text-mist">{o.suggestedTime}</p>
                        </td>
                        <td className={tdCls}>
                          <div className="text-xs space-y-1">
                            <span className="flex items-center gap-1.5">
                              {o.userAResponse ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : o.userAResponse === false ? <XCircle className="w-3.5 h-3.5 text-rosegold" /> : <Clock className="w-3.5 h-3.5 text-champagne" />}
                              {nameA}: {responseLabel(o.userAResponse)}
                            </span>
                            <span className="flex items-center gap-1.5">
                              {o.userBResponse ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : o.userBResponse === false ? <XCircle className="w-3.5 h-3.5 text-rosegold" /> : <Clock className="w-3.5 h-3.5 text-champagne" />}
                              {nameB}: {responseLabel(o.userBResponse)}
                            </span>
                          </div>
                        </td>
                        <td className={tdCls}>
                          <div className="flex flex-col items-start gap-1">
                            <Badge tone={STATUS_TONE[o.status] ?? "muted"}>{o.status}</Badge>
                            {o.bookingId && <Badge tone="green">Booking Created</Badge>}
                          </div>
                        </td>
                        <td className={`${tdCls} text-right`}>
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setHistoryOfferId(o.id)}
                              className="px-2.5 py-1.5 rounded-lg border border-white/10 text-xs text-mist hover:text-ivory inline-flex items-center gap-1"
                            >
                              <History className="w-3.5 h-3.5" />
                              History
                            </button>
                            {o.status === "pending" && (
                              <button
                                type="button"
                                onClick={() => setCancelTarget(o)}
                                className="px-2.5 py-1.5 rounded-lg border border-rose-500/30 text-xs text-rose-300 hover:bg-rose-500/10"
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
        </div>
      )}

      {/* ==================== CREATE MANUAL DATE OFFER MODAL ==================== */}
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Manual Date Offer" wide>
        <div className="space-y-4">
          <p className="text-sm text-ivory-dim">
            Select two members, experience, venue, and timing. Blocks and duplicate active offers for the same date are automatically prevented.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Member A">
              <select value={userAId} onChange={(e) => setUserAId(e.target.value)} className={inputCls}>
                <option value="">Select member A…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>{m.firstName} ({m.city})</option>
                ))}
              </select>
            </Field>
            <Field label="Member B">
              <select value={userBId} onChange={(e) => setUserBId(e.target.value)} className={inputCls}>
                <option value="">Select member B…</option>
                {members.filter((m) => m.id !== userAId).map((m) => (
                  <option key={m.id} value={m.id}>{m.firstName} ({m.city})</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Curated Experience">
              <select value={experienceId} onChange={(e) => setExperienceId(e.target.value)} className={inputCls}>
                {experiences.map((ex) => (
                  <option key={ex.id} value={ex.id}>{ex.title} ({ex.city})</option>
                ))}
              </select>
            </Field>
            <Field label="Partner Café (Optional)">
              <select
                value={cafeId}
                onChange={(e) => {
                  setCafeId(e.target.value);
                  const c = cafes.find((x) => x.id === e.target.value);
                  if (c && !venue) setVenue(`${c.name}, ${c.city}`);
                }}
                className={inputCls}
              >
                <option value="">Custom venue / none</option>
                {cafes.map((c) => (
                  <option key={c.id} value={c.id}>{c.name} — {c.city}</option>
                ))}
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Date">
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </Field>
            <Field label="Time">
              <input type="text" value={time} onChange={(e) => setTime(e.target.value)} placeholder="19:30" className={inputCls} />
            </Field>
            <Field label="Offer Expiry (Optional)">
              <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Venue">
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="e.g. Colocal Coffee Roasters, Khan Market"
              className={inputCls}
            />
          </Field>

          <Field label="Concierge Note (Optional)">
            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Personal concierge note visible to both members…"
              className={inputCls}
            />
          </Field>

          <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost rounded-full px-5 py-2.5 text-sm min-h-[44px]">
              Cancel
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={handleCreateManual}
              className="btn-gold rounded-full px-6 py-2.5 text-sm font-semibold min-h-[44px] inline-flex items-center gap-2"
            >
              <CalendarHeart className="w-4 h-4" />
              {submitting ? "Sending…" : "Send Manual Offer"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== CANCEL MODAL ==================== */}
      <Modal open={Boolean(cancelTarget)} onClose={() => setCancelTarget(null)} title="Cancel Manual Date Offer">
        <div className="space-y-4">
          <p className="text-sm text-ivory-dim">
            Cancel this pending manual date offer so it can no longer be accepted.
          </p>
          <Field label="Reason (Optional)">
            <input
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g. Rescheduled by concierge"
              className={inputCls}
            />
          </Field>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setCancelTarget(null)} className="btn-ghost rounded-full px-4 py-2 text-xs min-h-[44px]">
              Back
            </button>
            <button type="button" onClick={handleCancelManual} className="px-5 py-2 rounded-full bg-rose-600 text-white text-xs font-medium min-h-[44px]">
              Confirm Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ==================== ACTION HISTORY MODAL ==================== */}
      <Modal open={Boolean(historyOfferId)} onClose={() => setHistoryOfferId(null)} title="Offer Action History">
        <div className="space-y-3 max-h-80 overflow-y-auto">
          {offerHistory.length === 0 ? (
            <p className="text-sm text-mist">No history events recorded for this offer yet.</p>
          ) : (
            offerHistory.map((ev) => (
              <div key={ev.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs">
                <div className="flex justify-between items-center gap-2">
                  <Badge tone="gold">{ev.eventType}</Badge>
                  <span className="text-mist">{fmtDate(ev.createdAt)}</span>
                </div>
                <p className="text-ivory-dim mt-1.5">{ev.detail}</p>
              </div>
            ))
          )}
        </div>
      </Modal>
    </div>
  );
}
