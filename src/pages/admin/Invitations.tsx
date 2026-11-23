import { useEffect, useMemo, useState } from "react";
import { MailPlus, Shield, Users } from "lucide-react";
import type {
  Cafe,
  DateExperience,
  DateInvitation,
  DateInvitationMode,
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
import { fmtDay } from "./_util";

const RESP_TONE: Record<string, "gold" | "green" | "rose" | "muted"> = {
  pending: "gold",
  accepted: "green",
  declined: "rose",
  expired: "muted",
};

export default function AdminInvitations() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  const [showCreate, setShowCreate] = useState(false);
  const [mode, setMode] = useState<DateInvitationMode>("individual");
  const [title, setTitle] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [memberSearch, setMemberSearch] = useState("");
  const [experienceId, setExperienceId] = useState("");
  const [cafeId, setCafeId] = useState("");
  const [date, setDate] = useState(() => new Date(Date.now() + 4 * 86400000).toISOString().slice(0, 10));
  const [time, setTime] = useState("18:30");
  const [venue, setVenue] = useState("");
  const [message, setMessage] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [saving, setSaving] = useState(false);

  const {
    data: invitations,
    loading,
    error,
    refresh,
  } = useAsync((b) => b.listDateInvitations(), [db], [] as DateInvitation[]);

  const { data: users } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);
  const { data: experiences } = useAsync((b) => b.listExperiences(), [db], [] as DateExperience[]);
  const { data: cafes } = useAsync((b) => b.listCafes(), [db], [] as Cafe[]);

  useEffect(() => db.subscribe("invitations", refresh), [db, refresh]);

  const members = useMemo(
    () => users.filter((u) => !u.isAdmin && u.id !== "admin-1"),
    [users],
  );

  const filteredMembers = useMemo(() => {
    const q = memberSearch.trim().toLowerCase();
    if (!q) return members.slice(0, 15);
    return members
      .filter(
        (m) =>
          m.firstName.toLowerCase().includes(q) ||
          m.city.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [members, memberSearch]);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (mode === "individual") return [id];
      if (mode === "pair" && prev.length >= 2) return [prev[1], id];
      return [...prev, id];
    });
  };

  const handleCreate = async () => {
    if (!title.trim()) {
      toast("Invitation title is required.", "rose");
      return;
    }
    if (mode === "individual" && selectedIds.length !== 1) {
      toast("Select exactly 1 member for an individual invitation.", "rose");
      return;
    }
    if (mode === "pair" && selectedIds.length !== 2) {
      toast("Select exactly 2 members for a paired invitation.", "rose");
      return;
    }
    if (mode === "pair" && !experienceId) {
      toast("Select a curated experience for a paired invitation.", "rose");
      return;
    }
    if (mode === "group" && selectedIds.length < 1) {
      toast("Select at least 1 member to invite.", "rose");
      return;
    }

    const chosenCafe = cafes.find((c) => c.id === cafeId);
    const resolvedVenue =
      venue.trim() || (chosenCafe ? `${chosenCafe.name}, ${chosenCafe.city}` : "Curated Venue");

    setSaving(true);
    try {
      await db.createDateInvitation(
        {
          title: title.trim(),
          invitationMode: mode,
          userIds: selectedIds,
          experienceId: experienceId || null,
          cafeId: cafeId || null,
          date,
          time,
          venue: resolvedVenue,
          message: message.trim() || null,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        },
        actor,
      );
      toast(`Invitation sent to ${selectedIds.length} member(s).`, "gold");
      setShowCreate(false);
      setTitle("");
      setSelectedIds([]);
      setVenue("");
      setMessage("");
      setExpiresAt("");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not send invitation", "rose");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await db.cancelDateInvitation(id, actor);
      toast("Invitation cancelled.", "gold");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not cancel invitation", "rose");
    }
  };

  return (
    <div className="px-0 sm:px-4 pb-16 sm:pb-24 pt-2 sm:pt-6 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
        <SectionHead
          align="left"
          kicker="Curated Invitations"
          title="Invitation Dates"
          sub="Invite an individual member, a curated group, or an explicit pair to an exclusive Datevra experience. Individual responses are tracked privately."
        />
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="btn-gold rounded-full px-5 py-2.5 min-h-[44px] text-sm font-semibold inline-flex items-center gap-2 self-start md:self-end"
        >
          <MailPlus className="w-4 h-4" />
          New Invitation
        </button>
      </div>

      {error?.includes("MIGRATION_REQUIRED") && (
        <MigrationAlertBanner
          migrationId="030"
          migrationFile="db/migrations/030_date_offers_and_invitations.sql"
          featureName="Invitation Dates"
          description="Execute Migration 030 in Supabase to activate Invitation Dates and private per-invitee response records."
          onRefresh={refresh}
        />
      )}

      <div className="glass rounded-2xl p-4 mb-6 flex items-start gap-3 text-xs text-ivory-dim border border-champagne/20">
        <Shield className="w-4 h-4 text-champagne shrink-0 mt-0.5" />
        <p>
          <strong>Privacy &amp; Booking Safeguard:</strong> Invitees can only view their own invitation record and never see other invitees&apos; private details. Accepting an individual or group invitation records attendance only and never creates a two-person booking; paired invitations require both invitees to accept.
        </p>
      </div>

      {loading ? (
        <Skeleton />
      ) : invitations.length === 0 ? (
        <EmptyState
          title="No invitations sent yet"
          body="Create an individual, group, or paired event invitation for Datevra members."
        />
      ) : (
        <div className="grid gap-4">
          {invitations.map((inv) => {
            const acceptedCount = inv.recipients.filter((r) => r.response === "accepted").length;
            const declinedCount = inv.recipients.filter((r) => r.response === "declined").length;
            const pendingCount = inv.recipients.filter((r) => r.response === "pending").length;
            return (
              <div key={inv.id} className="glass rounded-3xl p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={inv.invitationMode === "pair" ? "rose" : "gold"}>
                        {inv.invitationMode}
                      </Badge>
                      <Badge tone={inv.status === "active" ? "green" : "muted"}>
                        {inv.status}
                      </Badge>
                      <span className="text-xs text-mist">Expires {fmtDay(inv.expiresAt)}</span>
                    </div>
                    <h3 className="font-display text-2xl text-ivory mt-2">{inv.title}</h3>
                    <p className="text-sm text-ivory-dim mt-1">
                      {inv.venue} · {inv.date} at {inv.time}
                    </p>
                    {inv.message && (
                      <p className="text-xs text-mist mt-1.5 max-w-2xl">“{inv.message}”</p>
                    )}
                  </div>
                  {inv.status === "active" && (
                    <button
                      type="button"
                      onClick={() => handleCancel(inv.id)}
                      className="px-3.5 py-2 rounded-xl border border-rose-500/30 text-xs text-rose-300 hover:bg-rose-500/10 min-h-[40px]"
                    >
                      Cancel Invitation
                    </button>
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-white/10">
                  <div className="flex flex-wrap items-center gap-3 text-xs text-mist mb-3">
                    <span className="inline-flex items-center gap-1 text-ivory">
                      <Users className="w-3.5 h-3.5 text-champagne" />
                      {inv.recipients.length} Invitee(s)
                    </span>
                    <span className="text-emerald-400">{acceptedCount} accepted</span>
                    <span className="text-champagne">{pendingCount} pending</span>
                    <span className="text-rosegold">{declinedCount} declined</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {inv.recipients.map((r) => (
                      <div
                        key={r.id}
                        className="rounded-xl bg-white/[0.03] border border-white/10 px-3 py-2.5 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="text-ivory font-medium truncate">
                            {r.userName ?? r.userId.slice(0, 8)}
                          </p>
                          {r.userCity && <p className="text-mist text-[0.7rem]">{r.userCity}</p>}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <Badge tone={RESP_TONE[r.response] ?? "muted"}>{r.response}</Badge>
                          {r.bookingId && <Badge tone="green">Booked</Badge>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Date Invitation" wide>
        <div className="space-y-4">
          <Field label="Invitation Mode">
            <div className="grid grid-cols-3 gap-2">
              {(["individual", "group", "pair"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m);
                    setSelectedIds([]);
                    if (m === "pair" && !experienceId && experiences[0]) {
                      setExperienceId(experiences[0].id);
                    }
                  }}
                  className={`py-2.5 px-3 rounded-xl border text-xs font-medium capitalize transition-all ${
                    mode === m
                      ? "border-champagne bg-champagne/15 text-champagne"
                      : "border-white/10 text-ivory-dim hover:bg-white/5"
                  }`}
                >
                  {m === "individual" ? "Individual (1)" : m === "group" ? "Group (Multi)" : "Paired (2)"}
                </button>
              ))}
            </div>
          </Field>

          <Field label="Event / Invitation Title">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Candlelight Tasting Evening"
              className={inputCls}
            />
          </Field>

          <Field
            label={`Select Invitees (${selectedIds.length} selected)`}
            hint={
              mode === "individual"
                ? "Select 1 member. Acceptance records attendance only."
                : mode === "pair"
                  ? "Select 2 non-blocked members. Both must accept to create a paired booking."
                  : "Select multiple members. Each member sees only their own private invitation."
            }
          >
            <input
              type="text"
              value={memberSearch}
              onChange={(e) => setMemberSearch(e.target.value)}
              placeholder="Filter members by name, city, or email…"
              className={`${inputCls} mb-2`}
            />
            <div className="max-h-44 overflow-y-auto rounded-xl border border-white/10 bg-black/30 divide-y divide-white/5">
              {filteredMembers.map((m) => {
                const active = selectedIds.includes(m.id);
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => toggleMember(m.id)}
                    className={`w-full text-left px-3 py-2.5 text-xs flex items-center justify-between transition-colors ${
                      active ? "bg-champagne/15 text-champagne" : "text-ivory hover:bg-white/5"
                    }`}
                  >
                    <span>
                      <strong>{m.firstName}</strong> · {m.city}
                    </span>
                    <span>{active ? "Selected ✓" : "Select"}</span>
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label={mode === "pair" ? "Experience (Required for Paired)" : "Experience (Optional)"}>
              <select value={experienceId} onChange={(e) => setExperienceId(e.target.value)} className={inputCls}>
                {mode !== "pair" && <option value="">Standalone event / none</option>}
                {experiences.map((ex) => (
                  <option key={ex.id} value={ex.id}>{ex.title}</option>
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
                <option value="">Custom venue</option>
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
              <input type="text" value={time} onChange={(e) => setTime(e.target.value)} placeholder="18:30" className={inputCls} />
            </Field>
            <Field label="Expires At (Optional)">
              <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
            </Field>
          </div>

          <Field label="Venue">
            <input
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              placeholder="Venue address or lounge name"
              className={inputCls}
            />
          </Field>

          <Field label="Personal Message (Optional)">
            <textarea
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Dress code, arrival instructions, or host note…"
              className={inputCls}
            />
          </Field>

          <div className="flex justify-end gap-3 pt-3 border-t border-white/10">
            <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost rounded-full px-5 py-2.5 text-sm min-h-[44px]">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleCreate}
              className="btn-gold rounded-full px-6 py-2.5 text-sm font-semibold min-h-[44px]"
            >
              {saving ? "Sending…" : "Send Invitation"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
