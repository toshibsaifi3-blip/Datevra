import { useEffect, useMemo, useState } from "react";
import type { Cafe, ComplimentaryPass, ComplimentaryPassStatus, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Badge, EmptyState, Field, Modal, SectionHead, Skeleton, inputCls, useToast } from "../../components/ui";
import { fmtDate, rowCls, tdCls, thCls } from "./_util";

const STATUS_TONES: Record<ComplimentaryPassStatus, "gold" | "green" | "muted" | "rose"> = {
  active: "gold",
  redeemed: "green",
  expired: "muted",
  revoked: "rose",
};

export default function Passes() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";
  const [statusFilter, setStatusFilter] = useState("all");
  const [showCreate, setShowCreate] = useState(false);
  const [cafeId, setCafeId] = useState("");
  const [userId, setUserId] = useState("");
  const [note, setNote] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [userSearch, setUserSearch] = useState("");

  const { data: passes, loading, error, refresh } = useAsync(
    (b) => b.listComplimentaryPasses(), [db], [] as ComplimentaryPass[],
  );
  const { data: cafes } = useAsync((b) => b.listCafes(), [db], [] as Cafe[]);
  const { data: users } = useAsync((b) => b.allUsers(), [db], [] as UserProfile[]);

  useEffect(() => db.subscribe("passes", refresh), [db, refresh]);

  const filtered = passes.filter((p) => statusFilter === "all" || p.status === statusFilter);
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

  const revoke = async (p: ComplimentaryPass) => {
    if (!window.confirm(`Revoke pass ${p.code}?`)) return;
    try {
      await db.revokeComplimentaryPass(p.id, actor);
      toast(`Pass ${p.code} revoked`, "gold");
      refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <SectionHead
        kicker="Complimentary passes"
        title="Passes"
        sub="Generate complimentary cafe passes for members. Passes carry a unique code the member redeems at the venue."
      />
      <div className="flex justify-end mb-4">
        <button className="btn-gold" onClick={() => setShowCreate(true)}>Generate pass</button>
      </div>

      <div className="flex gap-2 mb-5 flex-wrap">
        {["all", "active", "redeemed", "expired", "revoked"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-2 rounded-full text-sm ${statusFilter === s ? "bg-champagne text-ink" : "bg-white/5 text-white/60"}`}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {loading ? <Skeleton /> : error ? (
        <EmptyState title="Could not load passes" body={error} />
      ) : filtered.length === 0 ? (
        <EmptyState title="No passes" body="Generate a complimentary pass to get started." />
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-white/10">
          <table className="w-full text-sm">
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
              {filtered.map((p) => (
                <tr key={p.id} className="border-t border-white/5">
                  <td className={`${tdCls} font-mono text-champagne`}>{p.code}</td>
                  <td className={tdCls}>{p.cafeName}</td>
                  <td className={tdCls}>{p.issuedToName ?? <span className="text-white/40">Open pass</span>}</td>
                  <td className={tdCls}><Badge tone={STATUS_TONES[p.status]}>{p.status}</Badge></td>
                  <td className={tdCls}>{p.expiresAt ? fmtDate(p.expiresAt) : "—"}</td>
                  <td className={tdCls}>{p.redeemedAt ? fmtDate(p.redeemedAt) : "—"}</td>
                  <td className={tdCls}>
                    {p.status === "active" && (
                      <button onClick={() => revoke(p)} className="text-rose-300 text-xs underline">Revoke</button>
                    )}
                  </td>
                </tr>
              ))}
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
            <input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className={inputCls} />
          </Field>
          <button onClick={create} className="btn-gold w-full">Generate pass</button>
        </div>
      </Modal>
    </div>
  );
}
