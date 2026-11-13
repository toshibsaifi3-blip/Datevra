import { Link } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useAsync, useBackend } from "../../lib/data";
import { Badge, EmptyState, Reveal, Skeleton, useToast } from "../../components/ui";
import { useDbRefresh } from "./shared";
import type { Cafe } from "../../lib/types";
import { isDemoCafe } from "../../lib/cafeFilter";
import { CafePhotoSlider } from "../../components/CafePhotoSlider";

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
    <div className="max-w-5xl mx-auto px-0 sm:px-4 py-4 sm:py-8">
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
          {cafes.filter((c) => !isDemoCafe(c)).map((c) => (
            <Reveal key={c.id}>
              <div className="glass rounded-3xl overflow-hidden card-hover h-full flex flex-col">
                <CafePhotoSlider
                  images={c.images && c.images.length > 0 ? c.images : c.image ? [c.image] : []}
                  cafeName={c.name}
                  aspectRatioClassName="h-44 sm:h-48"
                  fallbackLetter="☕"
                />
                <div className="p-5 flex-1 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-xl text-ivory">{c.name}</p>
                    <Badge tone="muted">{c.priceRange}</Badge>
                  </div>
                  <p className="text-xs text-champagne/90 mt-1.5 leading-relaxed break-words font-medium">
                    {c.address}
                  </p>
                  <p className="text-[11px] text-mist/80 mt-1 flex items-center gap-1.5 flex-wrap">
                    <span aria-hidden>✦</span> {c.city}{c.rating > 0 ? ` · ★ ${c.rating.toFixed(1)}` : ""}
                  </p>
                  {c.description ? (
                    <p className="text-xs text-mist/80 mt-2 line-clamp-2 flex-1">{c.description}</p>
                  ) : (
                    <div className="flex-1" />
                  )}
                  <div className="flex flex-wrap gap-2 mt-4 pt-2">
                    <Link
                      to={`/cafes/${c.id}`}
                      className="btn-ghost rounded-full px-4 min-h-[44px] inline-flex items-center justify-center text-xs flex-1 text-center"
                    >
                      View details
                    </Link>
                    <button
                      onClick={() => unsave(c.id, c.name)}
                      className="btn-ghost rounded-full px-4 min-h-[44px] text-xs"
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
