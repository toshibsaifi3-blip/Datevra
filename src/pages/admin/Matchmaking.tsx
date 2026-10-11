import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { Match, MatchProposal, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Avatar, Badge, EmptyState, Field, Modal, SectionHead, Skeleton, Stat, inputCls, useToast } from "../../components/ui";
import { fmtDate, rowCls, tdCls, thCls } from "./_util";

const PROPOSAL_TONES: Record<MatchProposal["status"], "gold" | "green" | "muted" | "rose"> = {
  pending: "gold",
  accepted: "green",
  declined: "rose",
  expired: "muted",
};

export default function Matchmaking() {
  const db = useBackend();
  const { session } = useAuth();
  const { toast } = useToast();
  const actor = session?.userId ?? "admin-1";
  const [city, setCity] = useState("all");
  const [tab, setTab] = useState<"matches" | "proposals">("matches");
  const [showPropose, setShowPropose] = useState(false);
  const [userASearch, setUserASearch] = useState("");
  const [userBSearch, setUserBSearch] = useState("");
  const [userAId, setUserAId] = useState("");
  const [userBId, setUserBId] = useState("");
  const [proposalMsg, setProposalMsg] = useState("");

  const { data: users, loading: uLoading, error: uError } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );
  const {
    data: matchLists,
    loading: mLoading,
    error: mError,
    refresh,
  } = useAsync(
    (b) => Promise.all(users.map((u) => b.matchesFor(u.id))),
    [db, users],
    [] as Match[][],
  );

  useEffect(() => db.subscribe("matches", refresh), [db, refresh]);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);

  const matches = useMemo(() => {
    const seen = new Map<string, Match>();
    for (const list of matchLists) {
      for (const m of list) seen.set(m.id, m);
    }
    return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [matchLists]);

  const cities = useMemo(() => {
    const s = new Set<string>();
    for (const m of matches) {
      const a = userMap.get(m.userA);
      const b = userMap.get(m.userB);
      if (a) s.add(a.city);
      if (b) s.add(b.city);
    }
    return [...s].sort();
  }, [matches, userMap]);

  const filtered = matches.filter((m) => {
    if (city === "all") return true;
    return userMap.get(m.userA)?.city === city || userMap.get(m.userB)?.city === city;
  });

  const avgCompat =
    matches.length === 0
      ? 0
      : Math.round(matches.reduce((s, m) => s + m.compatibility, 0) / matches.length);

  const loading = uLoading || mLoading;
  const error = uError ?? mError;

  const { data: proposals, loading: pLoading, refresh: refreshProposals } = useAsync(
    (b) => b.listMatchProposals(), [db], [] as MatchProposal[],
  );
  useEffect(() => db.subscribe("proposals", refreshProposals), [db, refreshProposals]);

  const matchingA = useMemo(() => {
    const q = userASearch.trim().toLowerCase();
    if (!q) return [];
    return users.filter((u) => u.firstName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 6);
  }, [users, userASearch]);
  const matchingB = useMemo(() => {
    const q = userBSearch.trim().toLowerCase();
    if (!q) return [];
    return users.filter((u) => u.firstName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)).slice(0, 6);
  }, [users, userBSearch]);

  const propose = async () => {
    if (!userAId || !userBId) { toast("Select both members", "rose"); return; }
    if (userAId === userBId) { toast("Select two different members", "rose"); return; }
    try {
      await db.createMatchProposal(userAId, userBId, proposalMsg || null, actor);
      toast("Proposal sent to both members", "gold");
      setShowPropose(false);
      setUserAId(""); setUserBId(""); setUserASearch(""); setUserBSearch(""); setProposalMsg("");
      refreshProposals();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create proposal", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Match engine"
          title="Matchmaking"
          sub="Mutual match analytics plus curated proposals. Proposals require both members' consent — nothing is forced."
          align="left"
        />
        <div className="flex gap-2 mt-6 mb-2 items-center flex-wrap">
          {(["matches", "proposals"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-full text-sm ${tab === t ? "bg-champagne text-ink" : "bg-white/5 text-white/60"}`}>
              {t === "matches" ? "Mutual matches" : `Proposals${proposals.length ? ` (${proposals.length})` : ""}`}
            </button>
          ))}
          {tab === "proposals" && (
            <button className="btn-gold ml-auto" onClick={() => setShowPropose(true)}>Propose match</button>
          )}
        </div>
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load matches: {error}</p>}

        {tab === "proposals" ? (
          pLoading ? <Skeleton /> : proposals.length === 0 ? (
            <EmptyState title="No proposals yet" body="Propose a curated match between two members. Both must accept for a match to form." />
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 mt-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className={rowCls}>
                    <th className={thCls}>Members</th>
                    <th className={thCls}>Message</th>
                    <th className={thCls}>Status</th>
                    <th className={thCls}>Responses</th>
                    <th className={thCls}>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr key={p.id} className="border-t border-white/5">
                      <td className={tdCls}>{p.userAName} ♥ {p.userBName}</td>
                      <td className={`${tdCls} max-w-[200px] truncate`}>{p.message ?? "—"}</td>
                      <td className={tdCls}><Badge tone={PROPOSAL_TONES[p.status]}>{p.status}</Badge></td>
                      <td className={tdCls}>
                        {p.userAResponse === null ? "⏳" : p.userAResponse ? "✓" : "✗"} / {p.userBResponse === null ? "⏳" : p.userBResponse ? "✓" : "✗"}
                      </td>
                      <td className={tdCls}>{fmtDate(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-10">
              <Stat label="Total matches" value={matches.length} sub="mutual interest pairs" />
              <Stat label="Avg compatibility" value={`${avgCompat}%`} sub="preference-based score" />
              <Stat label="Cities active" value={cities.length} sub="with at least one match" />
              <Stat
                label="In view"
                value={filtered.length}
                sub={city === "all" ? "all cities" : city}
              />
            </div>

            <div className="mt-8 glass rounded-2xl p-4 flex items-center gap-3">
              <select value={city} onChange={(e) => setCity(e.target.value)} className={`${inputCls} max-w-xs`}>
                <option value="all">All cities</option>
                {cities.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <span className="text-sm text-mist">{filtered.length} matches</span>
            </div>

            {filtered.length === 0 ? (
              <div className="mt-6">
                <EmptyState title="No matches yet" body="Mutual likes will create matches that appear here." />
              </div>
            ) : (
              <div className="grid md:grid-cols-2 gap-5 mt-6">
                {filtered.map((m, idx) => {
                  const a = userMap.get(m.userA);
                  const b = userMap.get(m.userB);
                  return (
                    <motion.div
                      key={m.id}
                      initial={{ opacity: 0, y: 20 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: Math.min(idx * 0.05, 0.3) }}
                      className="glass rounded-3xl p-6"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Avatar name={a?.firstName ?? "?"} size={52} ring />
                          <Avatar name={b?.firstName ?? "?"} size={52} ring />
                          <div>
                            <p className="text-ivory font-medium">
                              {a?.firstName} <span className="text-rosegold">✦</span> {b?.firstName}
                            </p>
                            <p className="text-xs text-mist">
                              {a?.city} · {b?.city} · {fmtDate(m.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="text-center">
                          <p className="font-display text-3xl text-gradient-gold">{m.compatibility}%</p>
                          <p className="text-[0.65rem] uppercase tracking-[0.2em] text-mist">compatible</p>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-white/5 overflow-hidden mt-4">
                        <motion.div
                          initial={{ width: 0 }}
                          whileInView={{ width: `${m.compatibility}%` }}
                          viewport={{ once: true }}
                          transition={{ duration: 0.8 }}
                          className="h-full rounded-full bg-gradient-to-r from-champagne to-rosegold"
                        />
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-4">
                        {m.factors.map((f) => (
                          <Badge key={f} tone="muted">
                            {f}
                          </Badge>
                        ))}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </>
        )}

        <Modal open={showPropose} onClose={() => setShowPropose(false)} title="Propose curated match">
          <div className="space-y-4">
            <p className="text-sm text-white/60">Both members will be notified and must each accept. A mutual match forms only on dual consent.</p>
            <Field label="First member">
              <input value={userASearch} onChange={(e) => setUserASearch(e.target.value)} className={inputCls} placeholder="Search name or email…" />
              {userASearch && (
                <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-white/10">
                  {matchingA.map((u) => (
                    <button key={u.id} onClick={() => { setUserAId(u.id); setUserASearch(u.firstName); }}
                      className={`w-full text-left px-3 py-2 text-sm ${userAId === u.id ? "bg-champagne/20" : "hover:bg-white/5"}`}>
                      {u.firstName} <span className="text-white/40">· {u.city}</span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Second member">
              <input value={userBSearch} onChange={(e) => setUserBSearch(e.target.value)} className={inputCls} placeholder="Search name or email…" />
              {userBSearch && (
                <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-white/10">
                  {matchingB.map((u) => (
                    <button key={u.id} onClick={() => { setUserBId(u.id); setUserBSearch(u.firstName); }}
                      className={`w-full text-left px-3 py-2 text-sm ${userBId === u.id ? "bg-champagne/20" : "hover:bg-white/5"}`}>
                      {u.firstName} <span className="text-white/40">· {u.city}</span>
                    </button>
                  ))}
                </div>
              )}
            </Field>
            <Field label="Note for both members (optional)">
              <textarea value={proposalMsg} onChange={(e) => setProposalMsg(e.target.value)} className={inputCls} rows={3}
                placeholder="Why you think they'd be wonderful together…" />
            </Field>
            <button onClick={propose} className="btn-gold w-full">Send proposal</button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
