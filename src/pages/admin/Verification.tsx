import { useEffect } from "react";
import { motion } from "framer-motion";
import type { UserProfile } from "../../lib/types";
import { useAsync, useBackend } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { Avatar, EmptyState, SectionHead, Skeleton, useToast } from "../../components/ui";
import { fmtDay } from "./_util";

export default function Verification() {
  const { session } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const actor = session?.userId ?? "admin-1";

  const { data: all, loading, error, refresh } = useAsync(
    (b) => b.allUsers(),
    [db],
    [] as UserProfile[],
  );

  useEffect(() => db.subscribe("profiles", refresh), [db, refresh]);

  const pending = all
    .filter((u) => u.id !== session?.userId && !u.verified)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const decide = async (u: UserProfile, ok: boolean) => {
    try {
      await db.setUserVerified(u.id, ok, actor);
      refresh();
      toast(
        ok ? `${u.firstName} verified` : `${u.firstName}'s verification declined`,
        ok ? "gold" : "rose",
      );
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update verification", "rose");
    }
  };

  return (
    <div className="px-5 pb-24 pt-10 md:pt-14">
      <div className="max-w-6xl mx-auto">
        <SectionHead
          kicker="Trust & safety"
          title="Profile Verification"
          sub="Approve genuine members. Verification never guarantees behaviour — it confirms identity signals."
          align="left"
        />
        {error && <p className="mt-6 text-sm text-rosegold">Couldn&apos;t load queue: {error}</p>}

        {loading ? (
          <div className="grid md:grid-cols-2 gap-5 mt-10">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-56" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title="Queue is clear"
              body="Every member is verified. New registrations will appear here for review."
            />
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-5 mt-10">
            {pending.map((u, idx) => (
              <motion.div
                key={u.id}
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.06, 0.4) }}
                className="glass rounded-3xl p-6"
              >
                <div className="flex items-center gap-4">
                  <Avatar name={u.firstName} size={64} />
                  <div>
                    <p className="font-display text-xl text-ivory">
                      {u.firstName}, {u.age}
                    </p>
                    <p className="text-sm text-mist">
                      {u.city} · joined {fmtDay(u.createdAt)}
                    </p>
                    <p className="text-xs text-mist">{u.email}</p>
                  </div>
                </div>
                <p className="text-sm text-ivory-dim leading-relaxed mt-4 line-clamp-3">{u.bio}</p>
                <div className="mt-4">
                  <div className="flex justify-between text-xs text-mist mb-1">
                    <span>Profile completeness</span>
                    <span>{u.profileComplete}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-champagne to-rosegold"
                      style={{ width: `${u.profileComplete}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-5">
                  <button
                    onClick={() => decide(u, true)}
                    className="btn-gold rounded-xl px-4 py-2.5 text-sm"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decide(u, false)}
                    className="btn-ghost rounded-xl px-4 py-2.5 text-sm"
                  >
                    Reject
                  </button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
