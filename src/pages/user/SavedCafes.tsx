import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Badge, EmptyState, Reveal, Skeleton, useToast } from "../../components/ui";
import { useDbRefresh } from "./shared";
import type { Cafe } from "../../lib/types";

export default function SavedCafes() {
  const { user } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const tick = useDbRefresh("profiles");

  const {
    data: cafes,
    loading,
    error,
    refresh,
  } = useAsync(
    async (b): Promise<Cafe[]> => {
      if (!user) return [];
      const ids = await b.savedCafeIds(user.id);
      const list = await Promise.all(ids.map((id) => b.getCafe(id)));
      return list.filter((c): c is Cafe => !!c);
    },
    [user?.id, tick],
    [] as Cafe[],
  );

  if (!user) return null;
  const me = user;

  const unsave = async (id: string, name: string) => {
    try {
      await db.unsaveCafe(me.id, id);
      refresh();
      toast(`${name} removed from saved.`, "rose");
    } catch (e) {
      toast(
        e instanceof Error ? e.message : "Couldn't update saved cafés.",
        "rose",
      );
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-5 py-10">
      <Reveal>
        <p className="text-[0.72rem] uppercase tracking-[0.28em] text-rosegold">Saved cafés</p>
        <h1 className="font-display text-3xl text-ivory mt-1 mb-8">Your shortlist of lovely places</h1>
      </Reveal>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64" />
          ))}
        </div>
      ) : error ? (
        <p className="text-sm text-rosegold">Couldn't load saved cafés: {error}</p>
      ) : cafes.length === 0 ? (
        <EmptyState
          title="No saved cafés"
          body="Save cafés you love while exploring — perfect spots for a first coffee are worth keeping."
          action={
            <Link to="/cafes" className="btn-gold rounded-full px-6 py-2.5 text-sm inline-block">
              Explore cafés
            </Link>
          }
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {cafes.map((c) => (
            <Reveal key={c.id}>
              <div className="glass rounded-3xl overflow-hidden card-hover h-full flex flex-col">
                {c.image ? (
                  <img src={c.image} alt={c.name} className="h-40 w-full object-cover" />
                ) : (
                  <div className="h-40 w-full bg-gradient-to-br from-burgundy-deep via-burgundy to-[#3d1a12] flex items-center justify-center">
                    <span className="font-display text-3xl text-champagne/80">☕</span>
                  </div>
                )}
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-xl text-ivory">{c.name}</p>
                    <Badge tone="muted">{c.priceRange}</Badge>
                  </div>
                  <p className="text-sm text-mist mt-1">{c.city} · ★ {c.rating.toFixed(1)}</p>
                  <p className="text-xs text-mist/80 mt-2 line-clamp-2">{c.description}</p>
                  <div className="flex gap-2 mt-4 pt-2">
                    <Link
                      to={`/cafes/${c.id}`}
                      className="btn-ghost rounded-full px-4 py-2 text-xs flex-1 text-center"
                    >
                      View details
                    </Link>
                    <button
                      onClick={() => unsave(c.id, c.name)}
                      className="btn-ghost rounded-full px-4 py-2 text-xs"
                    >
                      ★ Saved
                    </button>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}
    </div>
  );
}
