import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { AlertCircle, AlertTriangle, Heart, Info, Loader2, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import type { Match, MatchPreferences, MatchProposal, UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { evaluatePairwiseCompatibility, type PairwiseCompatibilityAssessment } from "../../lib/compat";
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
  const [blockCheckState, setBlockCheckState] = useState<{ pair: string; status: "clear" | "blocked" | "error" }>({
    pair: "",
    status: "clear",
  });
  const [prefsState, setPrefsState] = useState<{
    pair: string;
    prefsA: MatchPreferences | null;
    prefsB: MatchPreferences | null;
    loading: boolean;
  }>({
    pair: "",
    prefsA: null,
    prefsB: null,
    loading: false,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // In-memory session caches to eliminate repeated requests when switching members
  const blockCheckCache = useRef<Map<string, boolean>>(new Map());
  const prefsCache = useRef<Map<string, MatchPreferences | null>>(new Map());

  const { data: users, loading: uLoading, error: uError } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );
  // Efficient batched matches query (eliminates previous N+1 Promise.all(users.map(...)))
  const {
    data: matches,
    loading: mLoading,
    error: mError,
    refresh: refreshMatches,
  } = useAsync(
    (b) => b.allMatches(),
    [db],
    [] as Match[],
  );

  useEffect(() => db.subscribe("matches", refreshMatches), [db, refreshMatches]);

  const userMap = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const userA = userAId ? userMap.get(userAId) : null;
  const userB = userBId ? userMap.get(userBId) : null;

  // Selected pair key for block check & pair assessments
  const selectedPairKey = userAId && userBId && userAId !== userBId ? `${userAId}:${userBId}` : "";
  const isCheckingBlock = Boolean(selectedPairKey && blockCheckState.pair !== selectedPairKey);
  const effectiveBlockStatus = !selectedPairKey
    ? "idle"
    : isCheckingBlock
    ? "checking"
    : blockCheckState.status;

  // Automatically verify block restrictions as soon as both members are selected
  useEffect(() => {
    if (!selectedPairKey || !userAId || !userBId) return;

    if (blockCheckCache.current.has(selectedPairKey)) {
      setBlockCheckState({
        pair: selectedPairKey,
        status: blockCheckCache.current.get(selectedPairKey) ? "blocked" : "clear",
      });
      return;
    }

    const pairAtStart = selectedPairKey;

    db.isBlocked(userAId, userBId)
      .then((blocked) => {
        blockCheckCache.current.set(pairAtStart, blocked);
        blockCheckCache.current.set(`${userBId}:${userAId}`, blocked);
        setBlockCheckState((curr) =>
          curr.pair === pairAtStart ? { pair: pairAtStart, status: blocked ? "blocked" : "clear" } : curr
        );
      })
      .catch((err) => {
        console.error("Safety block check failed:", err);
        setBlockCheckState((curr) =>
          curr.pair === pairAtStart ? { pair: pairAtStart, status: "error" } : curr
        );
      });
  }, [selectedPairKey, userAId, userBId, db]);

  // Load preferences for selected pair (best effort, non-blocking, cached)
  useEffect(() => {
    if (!selectedPairKey || !userAId || !userBId) return;

    const cachedA = prefsCache.current.has(userAId);
    const cachedB = prefsCache.current.has(userBId);

    if (cachedA && cachedB) {
      setPrefsState({
        pair: selectedPairKey,
        prefsA: prefsCache.current.get(userAId) ?? null,
        prefsB: prefsCache.current.get(userBId) ?? null,
        loading: false,
      });
      return;
    }

    const pairAtStart = selectedPairKey;

    const pA = cachedA
      ? Promise.resolve(prefsCache.current.get(userAId) ?? null)
      : db.getPrefs(userAId).then((p) => {
          prefsCache.current.set(userAId, p);
          return p;
        }).catch(() => {
          prefsCache.current.set(userAId, null);
          return null;
        });

    const pB = cachedB
      ? Promise.resolve(prefsCache.current.get(userBId) ?? null)
      : db.getPrefs(userBId).then((p) => {
          prefsCache.current.set(userBId, p);
          return p;
        }).catch(() => {
          prefsCache.current.set(userBId, null);
          return null;
        });

    Promise.all([pA, pB]).then(([prefsA, prefsB]) => {
      setPrefsState((curr) =>
        curr.pair === pairAtStart
          ? {
              pair: pairAtStart,
              prefsA,
              prefsB,
              loading: false,
            }
          : curr
      );
    });
  }, [selectedPairKey, userAId, userBId, db]);

  const { data: proposals, loading: pLoading, refresh: refreshProposals } = useAsync(
    (b) => b.listMatchProposals(), [db], [] as MatchProposal[],
  );
  useEffect(() => db.subscribe("proposals", refreshProposals), [db, refreshProposals]);

  // Existing match detection between selected pair
  const existingMatch = useMemo(() => {
    if (!userAId || !userBId || userAId === userBId) return null;
    return matches.find(
      (m) =>
        (m.userA === userAId && m.userB === userBId) ||
        (m.userA === userBId && m.userB === userAId),
    ) ?? null;
  }, [matches, userAId, userBId]);

  // Pending proposal detection between selected pair
  const pendingProposal = useMemo(() => {
    if (!userAId || !userBId || userAId === userBId) return null;
    return proposals.find(
      (p) =>
        p.status === "pending" &&
        ((p.userAId === userAId && p.userBId === userBId) ||
          (p.userAId === userBId && p.userBId === userAId)),
    ) ?? null;
  }, [proposals, userAId, userBId]);

  // Automatic compatibility assessment using Datevra's computeCompatibility
  const compatibilityAssessment = useMemo<PairwiseCompatibilityAssessment | null>(() => {
    if (!userA || !userB || userA.id === userB.id) return null;
    const currentPrefs = prefsState.pair === selectedPairKey ? prefsState : null;
    return evaluatePairwiseCompatibility(
      userA,
      userB,
      currentPrefs?.prefsA ?? null,
      currentPrefs?.prefsB ?? null,
    );
  }, [userA, userB, prefsState, selectedPairKey]);

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

  const matchingA = useMemo(() => {
    const q = userASearch.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter((u) => u.id !== userBId && (u.firstName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [users, userASearch, userBId]);

  const matchingB = useMemo(() => {
    const q = userBSearch.trim().toLowerCase();
    if (!q) return [];
    return users
      .filter((u) => u.id !== userAId && (u.firstName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
      .slice(0, 6);
  }, [users, userBSearch, userAId]);

  const closeProposeModal = () => {
    if (isSubmitting) return;
    setShowPropose(false);
    setUserAId("");
    setUserBId("");
    setUserASearch("");
    setUserBSearch("");
    setProposalMsg("");
    setBlockCheckState({ pair: "", status: "clear" });
    setPrefsState({ pair: "", prefsA: null, prefsB: null, loading: false });
  };

  const hasDuplicateBlocker = Boolean(existingMatch || pendingProposal);

  const propose = async () => {
    if (!userAId || !userBId) {
      toast("Select both members", "rose");
      return;
    }
    if (userAId === userBId) {
      toast("Select two different members", "rose");
      return;
    }
    if (effectiveBlockStatus === "blocked") {
      toast("This introduction cannot be created because a blocking restriction exists.", "rose");
      return;
    }
    if (effectiveBlockStatus !== "clear") {
      toast("Please wait for safety verification to complete.", "rose");
      return;
    }
    if (existingMatch) {
      toast("These members are already matched.", "rose");
      return;
    }
    if (pendingProposal) {
      toast("A proposal is already pending between these members.", "rose");
      return;
    }

    setIsSubmitting(true);
    try {
      await db.createMatchProposal(userAId, userBId, proposalMsg.trim() || null, actor);
      toast("Proposal sent to both members", "gold");
      closeProposeModal();
      refreshProposals();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create proposal", "rose");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="px-0 sm:px-5 pb-16 sm:pb-24 pt-4 sm:pt-10 md:pt-14">
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
          <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 sm:mt-10">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 min-[380px]:grid-cols-2 lg:grid-cols-4 gap-4 mt-8 sm:mt-10">
              <Stat label="Total matches" value={matches.length} sub="mutual interest pairs" />
              <Stat label="Avg compatibility" value={`${avgCompat}%`} sub="preference-based score" />
              <Stat label="Cities active" value={cities.length} sub="with at least one match" />
              <Stat
                label="In view"
                value={filtered.length}
                sub={city === "all" ? "all cities" : city}
              />
            </div>

            <div className="mt-8 glass rounded-2xl p-4 flex flex-wrap items-center gap-3">
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
                      className="glass rounded-3xl p-4 sm:p-6"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
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

        <Modal open={showPropose} onClose={closeProposeModal} title="Propose curated match">
          <div className="space-y-4">
            <p className="text-sm text-white/60">
              Both members will be notified and must each accept. A mutual match forms only on dual consent.
            </p>

            {/* Member A Selection */}
            <div>
              <label className="text-xs uppercase tracking-[0.18em] text-mist font-medium block mb-2">
                Member A
              </label>
              {userA ? (
                <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Avatar name={userA.firstName} photo={userA.photos?.[0]} size={44} ring />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ivory">{userA.firstName}</p>
                          {userA.verified && <Badge tone="green">Verified</Badge>}
                        </div>
                        <p className="text-xs text-mist">
                          {userA.age ? `${userA.age} yrs · ` : ""}{userA.city}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setUserAId("");
                        setUserASearch("");
                      }}
                      className="text-xs text-mist hover:text-ivory px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      Change
                    </button>
                  </div>

                  {/* Available Profile Details & Missing Attributes */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[0.7rem]">
                    {userA.gender && (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/80 border border-white/5">
                        {userA.gender}
                      </span>
                    )}
                    {userA.interestedIn && (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-champagne/90 border border-white/5">
                        Seeking {userA.interestedIn}
                      </span>
                    )}
                    {userA.relationshipIntent ? (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/80 border border-white/5">
                        Seeking “{userA.relationshipIntent}”
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-white/[0.02] text-mist/60 border border-white/5 italic">
                        Intent not specified
                      </span>
                    )}
                    {userA.interests && userA.interests.length > 0 ? (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/70 border border-white/5">
                        {userA.interests.slice(0, 3).join(", ")}{userA.interests.length > 3 ? ` +${userA.interests.length - 3}` : ""}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-white/[0.02] text-mist/60 border border-white/5 italic">
                        No interests listed
                      </span>
                    )}
                    <span className="ml-auto text-mist/70">
                      {userA.profileComplete}% complete
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={userASearch}
                    onChange={(e) => setUserASearch(e.target.value)}
                    disabled={isSubmitting}
                    className={inputCls}
                    placeholder="Search Member A by name or email…"
                  />
                  {userASearch && (
                    <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-midnight/95 divide-y divide-white/5">
                      {matchingA.length === 0 ? (
                        <p className="p-3 text-xs text-mist">No members found</p>
                      ) : (
                        matchingA.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setUserAId(u.id);
                              setUserASearch("");
                            }}
                            className="w-full text-left p-2.5 flex items-center justify-between hover:bg-white/5 transition-colors"
                          >
                            <div className="flex items-center gap-2.5">
                              <Avatar name={u.firstName} photo={u.photos?.[0]} size={32} />
                              <div>
                                <p className="text-sm text-ivory font-medium">{u.firstName}</p>
                                <p className="text-xs text-mist">{u.age ? `${u.age} yrs · ` : ""}{u.city}</p>
                              </div>
                            </div>
                            <span className="text-xs text-champagne/80 font-mono">Select</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Member B Selection */}
            <div>
              <label className="text-xs uppercase tracking-[0.18em] text-mist font-medium block mb-2">
                Member B
              </label>
              {userB ? (
                <div className="p-3.5 rounded-2xl bg-white/[0.04] border border-white/10 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <Avatar name={userB.firstName} photo={userB.photos?.[0]} size={44} ring />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-ivory">{userB.firstName}</p>
                          {userB.verified && <Badge tone="green">Verified</Badge>}
                        </div>
                        <p className="text-xs text-mist">
                          {userB.age ? `${userB.age} yrs · ` : ""}{userB.city}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={() => {
                        setUserBId("");
                        setUserBSearch("");
                      }}
                      className="text-xs text-mist hover:text-ivory px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 transition-colors disabled:opacity-50"
                    >
                      Change
                    </button>
                  </div>

                  {/* Available Profile Details & Missing Attributes */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[0.7rem]">
                    {userB.gender && (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/80 border border-white/5">
                        {userB.gender}
                      </span>
                    )}
                    {userB.interestedIn && (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-champagne/90 border border-white/5">
                        Seeking {userB.interestedIn}
                      </span>
                    )}
                    {userB.relationshipIntent ? (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/80 border border-white/5">
                        Seeking “{userB.relationshipIntent}”
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-white/[0.02] text-mist/60 border border-white/5 italic">
                        Intent not specified
                      </span>
                    )}
                    {userB.interests && userB.interests.length > 0 ? (
                      <span className="px-2 py-0.5 rounded-md bg-white/5 text-white/70 border border-white/5">
                        {userB.interests.slice(0, 3).join(", ")}{userB.interests.length > 3 ? ` +${userB.interests.length - 3}` : ""}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md bg-white/[0.02] text-mist/60 border border-white/5 italic">
                        No interests listed
                      </span>
                    )}
                    <span className="ml-auto text-mist/70">
                      {userB.profileComplete}% complete
                    </span>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <input
                    value={userBSearch}
                    onChange={(e) => setUserBSearch(e.target.value)}
                    disabled={isSubmitting}
                    className={inputCls}
                    placeholder="Search Member B by name or email…"
                  />
                  {userBSearch && (
                    <div className="mt-2 max-h-36 overflow-y-auto rounded-xl border border-white/10 bg-midnight/95 divide-y divide-white/5">
                      {matchingB.length === 0 ? (
                        <p className="p-3 text-xs text-mist">No members found</p>
                      ) : (
                        matchingB.map((u) => (
                          <button
                            key={u.id}
                            type="button"
                            onClick={() => {
                              setUserBId(u.id);
                              setUserBSearch("");
                            }}
                            className="w-full text-left p-2.5 flex items-center justify-between hover:bg-white/5 transition-colors"
                          >
                            <div className="flex items-center gap-2.5">
                              <Avatar name={u.firstName} photo={u.photos?.[0]} size={32} />
                              <div>
                                <p className="text-sm text-ivory font-medium">{u.firstName}</p>
                                <p className="text-xs text-mist">{u.age ? `${u.age} yrs · ` : ""}{u.city}</p>
                              </div>
                            </div>
                            <span className="text-xs text-champagne/80 font-mono">Select</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Self-Match Warning */}
            {userAId && userBId && userAId === userBId && (
              <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-semibold text-amber-300">Self-Proposal Prevented</p>
                  <p className="text-amber-200/80 leading-relaxed">
                    A curated introduction requires two distinct members. Please select two different profiles.
                  </p>
                </div>
              </div>
            )}

            {/* Existing Match or Pending Proposal Warnings */}
            {userA && userB && userAId !== userBId && (
              <>
                {existingMatch && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
                    <Heart className="w-4 h-4 text-amber-400 shrink-0 mt-0.5 fill-amber-400/20" />
                    <div className="space-y-1">
                      <p className="font-semibold text-amber-300">Proposal Blocked: Members already matched</p>
                      <p className="text-amber-200/80 leading-relaxed">
                        {userA.firstName} and {userB.firstName} are already connected in Datevra ({fmtDate(existingMatch.createdAt)}). A curated proposal cannot be created for existing matches.
                      </p>
                    </div>
                  </div>
                )}

                {pendingProposal && (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-200">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-amber-300">Proposal Blocked: Proposal already pending</p>
                      <p className="text-amber-200/80 leading-relaxed">
                        A curated proposal between {userA.firstName} and {userB.firstName} was already sent on {fmtDate(pendingProposal.createdAt)} and is awaiting responses. Duplicate proposals are prohibited.
                      </p>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Automatic Safety Check Box */}
            {userA && userB && userAId !== userBId && (
              <div>
                {isCheckingBlock ? (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-mist">
                    <Loader2 className="w-4 h-4 animate-spin text-champagne shrink-0" />
                    <span>Verifying safety restrictions…</span>
                  </div>
                ) : effectiveBlockStatus === "clear" && !existingMatch && !pendingProposal ? (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                    <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span className="font-medium">No blocking restrictions found. Pair is eligible for introduction.</span>
                  </div>
                ) : effectiveBlockStatus === "blocked" ? (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-rose-300">Proposal Blocked: Safety restriction exists</p>
                      <p className="text-rose-200/80 leading-relaxed">
                        This introduction cannot be created because an active block restriction exists between these members. Introductions between blocked members are strictly forbidden.
                      </p>
                    </div>
                  </div>
                ) : effectiveBlockStatus === "error" ? (
                  <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/25 text-xs text-rose-300">
                    <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                    <div className="space-y-1">
                      <p className="font-semibold text-rose-300">Verification Error</p>
                      <p className="text-rose-200/80 leading-relaxed">
                        Could not verify safety restrictions. Please reselect the members to retry.
                      </p>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Automatic Compatibility Intelligence Panel */}
            {userA && userB && userAId !== userBId && compatibilityAssessment && (
              <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/10 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-champagne" />
                    <span className="text-xs font-semibold uppercase tracking-[0.16em] text-ivory">
                      Compatibility Assessment
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      tone={
                        compatibilityAssessment.tier === "compatible"
                          ? "gold"
                          : compatibilityAssessment.tier === "potential_concern"
                          ? "gold"
                          : compatibilityAssessment.tier === "incompatible"
                          ? "rose"
                          : "muted"
                      }
                    >
                      {compatibilityAssessment.tierLabel}
                    </Badge>
                    <span className="font-display text-lg text-gradient-gold">
                      {compatibilityAssessment.score}%
                    </span>
                  </div>
                </div>

                <p className="text-xs text-white/70 leading-relaxed">
                  {compatibilityAssessment.summary}
                </p>

                {/* Missing Profile Information Notice */}
                {compatibilityAssessment.insufficientInfo && (
                  <div className="flex items-start gap-2 p-2.5 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-mist">
                    <Info className="w-3.5 h-3.5 text-champagne/80 shrink-0 mt-0.5" />
                    <div>
                      <p className="text-white/80 font-medium">Limited Profile Data</p>
                      <p className="text-mist/80 mt-0.5 leading-relaxed">
                        {(!userA.bio && !userA.interests?.length) && (!userB.bio && !userB.interests?.length)
                          ? `Both ${userA.firstName} and ${userB.firstName} have incomplete profile information.`
                          : (!userA.bio && !userA.interests?.length)
                          ? `${userA.firstName} has not listed bio or interests.`
                          : `${userB.firstName} has not listed bio or interests.`}{" "}
                        Compatibility score is advisory and reflects available data only.
                      </p>
                    </div>
                  </div>
                )}

                {/* Compatibility Factors */}
                {compatibilityAssessment.factors.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {compatibilityAssessment.factors.map((f) => (
                      <Badge key={f} tone="muted">
                        {f}
                      </Badge>
                    ))}
                  </div>
                )}

                {/* Highlighted Concerns / Noticed Preferences */}
                {compatibilityAssessment.concerns.length > 0 && (
                  <div className="pt-2 border-t border-white/5 space-y-1.5">
                    <p className="text-[0.7rem] uppercase tracking-wider text-rosegold font-medium">
                      Noticed Preferences (Advisory)
                    </p>
                    {compatibilityAssessment.concerns.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs text-rosegold/90">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-rosegold" />
                        <span>{c}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <Field label="Note for both members (optional)">
              <textarea
                value={proposalMsg}
                onChange={(e) => setProposalMsg(e.target.value)}
                disabled={isSubmitting}
                className={inputCls}
                rows={3}
                placeholder="Why you think they'd be wonderful together…"
              />
            </Field>

            <button
              type="button"
              disabled={
                !userAId ||
                !userBId ||
                userAId === userBId ||
                isCheckingBlock ||
                effectiveBlockStatus !== "clear" ||
                hasDuplicateBlocker ||
                isSubmitting
              }
              onClick={propose}
              className="btn-gold w-full disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Sending proposal…</span>
                </>
              ) : isCheckingBlock ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Verifying safety…</span>
                </>
              ) : !userAId || !userBId ? (
                <span>Select both members</span>
              ) : userAId === userBId ? (
                <span>Select two different members</span>
              ) : effectiveBlockStatus === "blocked" ? (
                <span>Blocked by safety restriction</span>
              ) : effectiveBlockStatus === "error" ? (
                <span>Safety verification failed</span>
              ) : existingMatch ? (
                <span>Members already matched</span>
              ) : pendingProposal ? (
                <span>Proposal already pending</span>
              ) : (
                <span>Send proposal</span>
              )}
            </button>
          </div>
        </Modal>
      </div>
    </div>
  );
}
