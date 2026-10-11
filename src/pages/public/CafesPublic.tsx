import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { PageHero, Reveal, Badge, Skeleton, useToast } from "../../components/ui";
import { useBackend, useAsync } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import { useDbRefresh } from "../user/shared";
import type { Cafe } from "../../lib/types";

const GRADIENTS = [
  "from-[#5c2540] to-[#2c1020]",
  "from-[#6e4a1b] to-[#3a2410]",
  "from-burgundy to-burgundy-deep",
  "from-[#3d2b52] to-[#1c1028]",
  "from-[#7a3b2e] to-[#3d1a12]",
];

export default function CafesPublic({ hideHero = false }: { hideHero?: boolean }) {
  const db = useBackend();
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const tick = useDbRefresh("profiles");

  const { data: cafes, loading, error } = useAsync(
    (b) => b.listCafes(),
    [db],
    [] as Cafe[],
    { cacheKey: "cafes" },
  );
  const { data: savedIds, refresh: refreshSaved } = useAsync(
    (b) => (user ? b.savedCafeIds(user.id) : Promise.resolve([] as string[])),
    [db, user?.id, tick],
    [] as string[],
  );
  const [savingId, setSavingId] = useState<string | null>(null);

  const toggleSave = async (cafe: Cafe) => {
    if (!session || !user) {
      navigate("/login");
      return;
    }
    setSavingId(cafe.id);
    try {
      if (savedIds.includes(cafe.id)) {
        await db.unsaveCafe(user.id, cafe.id);
        toast(`Removed ${cafe.name} from your saved cafés.`, "rose");
      } else {
        await db.saveCafe(user.id, cafe.id);
        toast(`Saved ${cafe.name} — find it anytime under Saved Cafés.`);
      }
      refreshSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update saved cafés.", "rose");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div className="relative">
      {/* dreamy ambience */}
      <div className="pointer-events-none absolute top-0 left-1/4 h-96 w-96 rounded-full bg-burgundy/25 blur-[130px] animate-aura-shift" />
      {[10, 34, 58, 82].map((left, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-champagne/25 animate-twinkle"
          style={{ left: `${left}%`, top: `${90 + i * 160}px`, animationDelay: `${i * 0.9}s`, fontSize: `${9 + (i % 3) * 4}px` }}
        >
          ✦
        </span>
      ))}

      {!hideHero && (
        <PageHero
          kicker="Explore cafés"
          title="Rooms made for conversation"
          sub="Hand-picked partner cafés across India — held tables, priority seating and concierge booking for Datevra members."
        />
      )}

      <section className="relative max-w-6xl mx-auto px-5 py-14">
        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-96" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-rosegold">{error}</p>
        ) : cafes.length === 0 ? (
          <div className="glass rounded-[2rem] p-12 text-center max-w-xl mx-auto">
            <p className="font-display text-2xl text-ivory">No cafés yet</p>
            <p className="text-sm text-mist mt-2">
              Our curators are still hand-picking the first rooms. Check back soon.
            </p>
          </div>
        ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {cafes.map((c, i) => {
            const saved = savedIds.includes(c.id);
            return (
              <Reveal key={c.id} delay={(i % 3) * 0.08} className="h-full">
                <motion.div
                  whileHover={{ y: -8 }}
                  transition={{ type: "spring", stiffness: 240, damping: 22 }}
                  className="glass rounded-[2rem] overflow-hidden h-full flex flex-col card-hover relative"
                >
                  <div className={`relative h-48 bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]}`}>
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_30%,rgba(197,164,255,0.25),transparent_55%)]" />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_85%,rgba(255,61,154,0.18),transparent_50%)]" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="font-display text-8xl text-champagne/80 select-none drop-shadow-[0_0_25px_rgba(197,164,255,0.35)]">
                        {c.name.charAt(0)}
                      </span>
                    </div>
                    <div className="absolute top-4 left-4">
                      {c.partner && <Badge tone="gold">✦ Partner</Badge>}
                    </div>
                    <div className="absolute top-4 right-4 flex gap-2 items-center">
                      <Badge tone="muted">★ {c.rating.toFixed(1)}</Badge>
                    </div>
                    {user && (
                      <button
                        type="button"
                        aria-label={saved ? `Unsave ${c.name}` : `Save ${c.name}`}
                        aria-pressed={saved}
                        disabled={savingId === c.id}
                        onClick={() => void toggleSave(c)}
                        className={`absolute bottom-4 right-4 rounded-full w-10 h-10 flex items-center justify-center text-lg transition-all disabled:opacity-50 ${
                          saved
                            ? "bg-gradient-to-br from-rosegold to-champagne text-midnight shadow-[0_0_20px_rgba(255,61,154,0.5)]"
                            : "glass-strong text-ivory hover:text-rosegold"
                        }`}
                      >
                        {saved ? "♥" : "♡"}
                      </button>
                    )}
                  </div>
                  <div className="p-6 flex-1 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-xl text-ivory">{c.name}</h3>
                      <span className="text-[0.7rem] tracking-widest text-champagne border border-champagne/30 rounded-full px-2.5 py-0.5 shrink-0">
                        {c.priceRange}
                      </span>
                    </div>
                    <p className="text-xs text-mist mt-1 tracking-wide flex items-center gap-1.5">
                      <span aria-hidden>✦</span> {c.city} · {c.openingHours}
                    </p>
                    <p className="mt-3 text-sm text-ivory-dim/85 leading-relaxed line-clamp-2 flex-1">
                      {c.description}
                    </p>
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {c.experiences.slice(0, 2).map((x) => (
                        <Badge key={x} tone="muted">
                          {x}
                        </Badge>
                      ))}
                    </div>
                    <Link
                      to={`/cafes/${c.id}`}
                      className="btn-ghost rounded-full px-6 py-2.5 text-sm mt-5 text-center"
                    >
                      View café
                    </Link>
                  </div>
                </motion.div>
              </Reveal>
            );
          })}
        </div>
        )}
      </section>
    </div>
  );
}
