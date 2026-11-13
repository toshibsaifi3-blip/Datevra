import { useEffect, useMemo, useState } from "react";
import { Search, ShieldAlert, X } from "lucide-react";
import type { Cafe, ComplimentaryPass, ComplimentaryPassStatus, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Badge, EmptyState, Field, Modal, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { MigrationAlertBanner } from "../../components/MigrationAlertBanner";
import { fmtDate, rowCls, tdCls, thCls } from "./_util";

const STATUS_TONES: Record<ComplimentaryPassStatus, "gold" | "green" | "muted" | "rose"> = {
  active: "gold",
  redeemed: "green",
  expired: "muted",
  revoked: "rose",
};

/**
 * Computes the effective display status for a café pass.
 * If the database status is "active" but expiresAt is in the past,
 * it is effectively "expired" in the UI.
 * Passes with null or invalid expiresAt timestamps are not classified as expired.
 */
function getEffectiveStatus(p: ComplimentaryPass): ComplimentaryPassStatus {
  if (p.status === "active" && p.expiresAt) {
    const expiryTime = Date.parse(p.expiresAt);
    if (!Number.isNaN(expiryTime) && expiryTime < Date.now()) {
      return "expired";
    }
  }
  return p.status;
}

export default function Passes() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";
  const [statusFilter, setStatusFilter] = useState("all");
  const [cafeFilter, setCafeFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [cafeId, setCafeId] = useState("");
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [passToRevoke, setPassToRevoke] = useState<ComplimentaryPass | null>(null);
  const [revocationReason, setRevocationReason] = useState("");
  const [isRevoking, setIsRevoking] = useState(false);

  const { data: passes, loading, error, refresh } = useAsync(
    (b) => b.listComplimentaryPasses(), [db], [] as ComplimentaryPass[],
  );
  const { data: cafes } = useAsync((b) => b.listCafes(), [db], [] as Cafe[]);
  const { data: users } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => db.subscribe("passes", refresh), [db, refresh]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return passes.filter((p) => {
      const effectiveStatus = getEffectiveStatus(p);
      if (statusFilter !== "all" && effectiveStatus !== statusFilter) return false;
      if (cafeFilter !== "all" && p.cafeId !== cafeFilter) return false;
      if (q) {
        const codeMatch = p.code.toLowerCase().includes(q);
        const cafeMatch = p.cafeName.toLowerCase().includes(q);
        const userMatch = (p.issuedToName ?? "").toLowerCase().includes(q);
        const noteMatch = (p.note ?? "").toLowerCase().includes(q);
        if (!codeMatch && !cafeMatch && !userMatch && !noteMatch) return false;
      }
      return true;
    });
  }, [passes, statusFilter, cafeFilter, searchQuery]);
  const matchingUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return users.slice(0, 8);
    return users.filter((u) =>
      u.firstName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [users, userSearch]);

  const create = async () => {
    if (!cafeId) { toast("Select a cafe", "rose"); return; }
    try {
      const pass = await db.createComplimentaryPass({
        cafeId,
        issuedToUserId: userId || null,
        note: note || null,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
      }, actor);
      toast(`Pass ${pass.code} created`, "gold");
      setShowCreate(false);
      setCafeId(""); setUserId(""); setNote(""); setExpiresAt(""); setUserSearch("");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create pass", "rose");
    }
  };

  const handleRevoke = async () => {
    if (!passToRevoke) return;
    setIsRevoking(true);
    try {
      const res = await db.revokeComplimentaryPass(
        passToRevoke.id,
        actor,
        revocationReason || null,
      );
      if (res?.warning) {
        toast(res.warning, "gold");
      } else {
        toast(`Pass ${res?.code ?? passToRevoke.code} revoked`, "gold");
      }
      setPassToRevoke(null);
      setRevocationReason("");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke pass", "rose");
    } finally {
      setIsRevoking(false);
    }
  };

  return (
    <div className="px-0 sm:px-5 pb-16 sm:pb-24 pt-4 sm:pt-10 md:pt-14">
      <SectionHead
        kicker="Complimentary passes"
        title="Passes"
        sub="Generate complimentary cafe passes for members. Passes carry a unique code the member redeems at the venue."
      />

      {error?.includes("MIGRATION_REQUIRED") ? (
        <MigrationAlertBanner
          migrationId="010"
          migrationFile="db/migrations/010_passes_proposals.sql"
          featureName="Complimentary Café Passes"
          description="The database table public.complimentary_passes has not been installed yet in your Supabase backend. Execute Migration 010 in the Supabase Dashboard SQL Editor to activate complimentary passes."
          onRefresh={refresh}
        />
      ) : error ? (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs mb-6">
          Could not load complimentary passes: {error}
        </div>
      ) : null}

      <div className="flex justify-end mb-4">
        <button className="btn-gold rounded-full px-5 py-2.5 text-sm font-semibold w-full sm:w-auto min-h-[44px]" onClick={() => setShowCreate(true)}>Generate pass</button>
      </div>

      <div className="glass-panel p-4 rounded-2xl border border-white/10 mb-6 flex flex-col lg:flex-row gap-4 items-stretch lg:items-center justify-between">
        {/* Search */}
        <div className="relative flex-1 min-w-0 lg:max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-mist" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by code, café, member, or note…"
            className={`${inputCls} pl-10 text-sm`}
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-mist hover:text-ivory"
              title="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Café Filter Dropdown */}
          <div className="flex flex-wrap items-center gap-2 text-xs w-full sm:w-auto">
            <span className="text-mist">Café:</span>
            <select
              value={cafeFilter}
              onChange={(e) => setCafeFilter(e.target.value)}
              className={`${inputCls} py-1.5 px-3 text-xs rounded-full w-full sm:w-auto sm:max-w-[200px] truncate`}
            >
              <option value="all">All cafés ({cafes.length})</option>
              {cafes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="w-px h-5 bg-white/10 hidden md:block" />

          {/* Status Filter Buttons */}
          <div className="flex items-center gap-1 text-xs flex-wrap">
            <span className="text-mist mr-1">Status:</span>
            {["all", "active", "redeemed", "expired", "revoked"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1.5 rounded-full transition-all text-xs capitalize ${
                  statusFilter === s
                    ? "bg-champagne text-ink font-medium shadow-sm"
                    : "bg-white/5 text-ivory/60 hover:bg-white/10"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <Skeleton />
      ) : error ? (
        <EmptyState title="Could not load passes" body={error} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No passes match your filters"
          body={
            searchQuery || statusFilter !== "all" || cafeFilter !== "all"
              ? "Try clearing your search query or selecting 'All' in the filters."
              : "Generate a complimentary pass to get started."
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className={rowCls}>
                <th className={thCls}>Code</th>
                <th className={thCls}>Cafe</th>
                <th className={thCls}>Issued to</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>Expires</th>
                <th className={thCls}>Redeemed</th>
                <th className={thCls}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => {
                const effectiveStatus = getEffectiveStatus(p);
                return (
                  <tr key={p.id} className="border-t border-white/5">
                    <td className={`${tdCls} font-mono text-champagne`}>{p.code}</td>
                    <td className={tdCls}>{p.cafeName}</td>
                    <td className={tdCls}>{p.issuedToName ?? <span className="text-white/40">Open pass</span>}</td>
                    <td className={tdCls}><Badge tone={STATUS_TONES[effectiveStatus]}>{effectiveStatus}</Badge></td>
                    <td className={tdCls}>{p.expiresAt ? fmtDate(p.expiresAt) : "—"}</td>
                    <td className={tdCls}>{p.redeemedAt ? fmtDate(p.redeemedAt) : "—"}</td>
                    <td className={tdCls}>
                      {effectiveStatus === "active" && (
                        <button
                          onClick={() => {
                            setPassToRevoke(p);
                            setRevocationReason("");
                          }}
                          className="text-rose-300 text-xs underline hover:text-rose-200 transition-colors"
                        >
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Generate complimentary pass">
        <div className="space-y-4">
          <Field label="Cafe">
            <select value={cafeId} onChange={(e) => setCafeId(e.target.value)} className={inputCls}>
              <option value="">Select cafe…</option>
              {cafes.map((c) => <option key={c.id} value={c.id}>{c.name} — {c.city}</option>)}
            </select>
          </Field>
          <Field label="Issue to member (optional — leave blank for open pass)">
            <input value={userSearch} onChange={(e) => setUserSearch(e.target.value)} className={inputCls} placeholder="Search by name or email…" />
            {userSearch && (
              <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-white/10">
                {matchingUsers.map((u) => (
                  <button key={u.id} onClick={() => { setUserId(u.id); setUserSearch(u.firstName); }}
                    className={`w-full text-left px-3 py-2 text-sm ${userId === u.id ? "bg-champagne/20" : "hover:bg-white/5"}`}>
                    {u.firstName} <span className="text-white/40">· {u.email}</span>
                  </button>
                ))}
              </div>
            )}
          </Field>
          <Field label="Note (optional)">
            <input value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} placeholder="e.g. Anniversary treat" />
          </Field>
          <Field label="Expires (optional)">
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={`${inputCls} appearance-none min-w-0`} />
          </Field>
          <button onClick={create} className="btn-gold rounded-full px-6 py-3 min-h-[44px] text-sm font-semibold w-full">Generate pass</button>
        </div>
      </Modal>

      {/* Revoke confirmation modal */}
      <Modal
        open={Boolean(passToRevoke)}
        onClose={() => {
          if (!isRevoking) setPassToRevoke(null);
        }}
        title="Revoke Café Pass"
      >
        {passToRevoke && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-rose-300 bg-rose-500/10 p-3 rounded-xl border border-rose-500/20 text-xs">
              <ShieldAlert className="w-5 h-5 shrink-0" />
              <span>
                Revoking will immediately deactivate this café pass. It can no longer be redeemed at the venue.
              </span>
            </div>

            <div className="p-3 bg-white/5 rounded-xl border border-white/10 text-xs space-y-1.5">
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-mist">Code:</span>
                <span className="font-mono text-champagne font-semibold break-all">
                  {passToRevoke.code}
                </span>
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <span className="text-mist">Café:</span>
                <span className="text-ivory">{passToRevoke.cafeName}</span>
              </div>
              {passToRevoke.issuedToName && (
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-mist">Issued To:</span>
                  <span className="text-ivory">{passToRevoke.issuedToName}</span>
                </div>
              )}
              {passToRevoke.note && (
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="text-mist">Current Note:</span>
                  <span className="text-ivory/80 max-w-xs truncate">{passToRevoke.note}</span>
                </div>
              )}
            </div>

            <Field label="Revocation Reason (Optional)">
              <input
                type="text"
                value={revocationReason}
                onChange={(e) => setRevocationReason(e.target.value)}
                placeholder="e.g. Issued by mistake, Customer requested change"
                className={inputCls}
                disabled={isRevoking}
              />
            </Field>

            <div className="flex flex-wrap justify-end gap-3 pt-3">
              <button
                type="button"
                disabled={isRevoking}
                onClick={() => setPassToRevoke(null)}
                className="px-4 py-2.5 rounded-full border border-white/10 text-ivory/70 hover:bg-white/5 text-xs transition-colors min-h-[44px]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRevoking}
                onClick={handleRevoke}
                className="px-5 py-2.5 rounded-full bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs transition-colors disabled:opacity-50 min-h-[44px]"
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
