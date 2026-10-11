import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import {
  Avatar,
  Badge,
  EmptyState,
  Modal,
  PlanBadge,
  SectionHead,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { fmtDate, rowCls, tdCls, thCls } from "./_util";

export default function Users() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const [query, setQuery] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const actor = session?.userId ?? "admin-1";

  const { data: all, loading, error, refresh } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );

  useEffect(() => db.subscribe("profiles", refresh), [db, refresh]);

  const users = all
    .filter((u) => u.id !== session?.userId)
    .filter((u) => {
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return `${u.firstName} ${u.email} ${u.city}`.toLowerCase().includes(q);
    });

  const toggleVerified = async (u: UserProfile) => {
    try {
      await db.setUserVerified(u.id, !u.verified, actor);
      refresh();
      toast(`${u.firstName} ${u.verified ? "unverified" : "marked verified"}`, "gold");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update verification", "rose");
    }
  };

  const detail = detailId ? all.find((u) => u.id === detailId) : undefined;

  if (loading) {
    return (
      <div className="px-5 pb-24 pt-10 md:pt-14">
        <div className="max-w-6xl mx-auto">
          <SectionHead
            kicker="Member directory"
            title="Users"
            sub="Loading members…"
            align="left"
          />
          <div className="mt-8 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Member directory"
          title="Users"
          sub="Every member profile — verify identities, inspect details and manage access."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load users: {error}</p>}

        <div className="mt-8 glass rounded-2xl p-4 flex flex-col sm:flex-row gap-3 sm:items-center">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or city…"
            className={inputCls}
          />
          <span className="text-sm text-mist whitespace-nowrap">{users.length} members</span>
        </div>

        <div className="glass rounded-3xl mt-6 overflow-hidden">
          {users.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No members found" body="Try a different search term." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
                <thead>
                  <tr>
                    <th className={thCls}>Member</th>
                    <th className={thCls}>Age</th>
                    <th className={thCls}>City</th>
                    <th className={thCls}>Plan</th>
                    <th className={thCls}>Verified</th>
                    <th className={thCls}>Joined</th>
                    <th className={thCls}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className={rowCls}>
                      <td className={tdCls}>
                        <div className="flex items-center gap-3">
                          <Avatar name={u.firstName} size={40} ring={u.verified} />
                          <div>
                            <p className="text-ivory font-medium">{u.firstName}</p>
                            <p className="text-xs text-mist">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className={`${tdCls} text-ivory-dim`}>{u.age}</td>
                      <td className={`${tdCls} text-ivory-dim`}>{u.city}</td>
                      <td className={tdCls}>
                        <PlanBadge plan={u.plan} />
                      </td>
                      <td className={tdCls}>
                        <button
                          onClick={() => toggleVerified(u)}
                          title={u.verified ? "Revoke verification" : "Mark verified"}
                          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                            u.verified ? "bg-emerald-400/40" : "bg-white/10"
                          }`}
                        >
                          <motion.span
                            layout
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            className={`inline-block h-4 w-4 rounded-full ${
                              u.verified ? "bg-emerald-300 ml-6" : "bg-mist ml-1"
                            }`}
                          />
                        </button>
                      </td>
                      <td className={`${tdCls} text-mist whitespace-nowrap`}>{fmtDate(u.createdAt)}</td>
                      <td className={tdCls}>
                        <button
                          onClick={() => setDetailId(u.id)}
                          className="text-sm text-champagne hover:text-rosegold"
                        >
                          View profile
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {detail && (
          <Modal open onClose={() => setDetailId(null)} title={`${detail.firstName}'s profile`} wide>
            <div className="grid md:grid-cols-3 gap-6">
              <div className="flex flex-col items-center text-center">
                <Avatar name={detail.firstName} size={96} ring={detail.verified} />
                <p className="font-display text-2xl text-ivory mt-3">
                  {detail.firstName}, {detail.age}
                </p>
                <p className="text-sm text-mist">{detail.city}</p>
                <div className="flex gap-2 mt-3 flex-wrap justify-center">
                  <PlanBadge plan={detail.plan} />
                  {detail.verified ? (
                    <Badge tone="green">✓ Verified</Badge>
                  ) : (
                    <Badge tone="rose">Unverified</Badge>
                  )}
                  <Badge tone="muted">{detail.relationshipIntent}</Badge>
                </div>
                <div className="mt-4 w-full">
                  <div className="flex justify-between text-xs text-mist mb-1">
                    <span>Profile completeness</span>
                    <span>{detail.profileComplete}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-champagne to-rosegold"
                      style={{ width: `${detail.profileComplete}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="md:col-span-2 space-y-4 text-sm">
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.2em] text-mist mb-1">Bio</p>
                  <p className="text-ivory-dim leading-relaxed">{detail.bio || "—"}</p>
                </div>
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.2em] text-mist mb-1">Interests</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.interests.map((i) => (
                      <Badge key={i} tone="muted">
                        {i}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="text-[0.7rem] uppercase tracking-[0.2em] text-mist mb-1">Hobbies</p>
                  <div className="flex flex-wrap gap-1.5">
                    {detail.hobbies.map((i) => (
                      <Badge key={i} tone="muted">
                        {i}
                      </Badge>
                    ))}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 text-ivory-dim">
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.2em] text-mist mb-1">Email</p>
                    <p>{detail.email}</p>
                  </div>
                  <div>
                    <p className="text-[0.7rem] uppercase tracking-[0.2em] text-mist mb-1">Online</p>
                    <p>{detail.online ? "Yes" : `Last seen ${fmtDate(detail.lastActive)}`}</p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    toggleVerified(detail);
                    setDetailId(null);
                  }}
                  className="btn-gold rounded-xl px-5 py-2.5 text-sm"
                >
                  {detail.verified ? "Revoke verification" : "Verify profile"}
                </button>
              </div>
            </div>
          </Modal>
        )}
      </AnimatePresence>
    </div>
  );
}
