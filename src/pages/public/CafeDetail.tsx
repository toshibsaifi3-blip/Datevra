import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { Badge, EmptyState, Skeleton, useToast } from "../../components/ui";
import { useBackend, useAsync } from "../../lib/data";
import type { Cafe } from "../../lib/types";
import { useAuth } from "../../context/AuthContext";

export default function CafeDetail() {
  const { id } = useParams<{ id: string }>();
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const db = useBackend();

  const { data: cafe, loading } = useAsync(
    (b) => (id ? b.getCafe(id) : Promise.resolve(undefined)),
    [db, id],
    undefined as Cafe | undefined,
  );
  const { data: savedIds, refresh: refreshSaved } = useAsync(
    (b) => (user ? b.savedCafeIds(user.id) : Promise.resolve([] as string[])),
    [db, user?.id],
    [] as string[],
  );
  const saved = !!id && savedIds.includes(id);

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-5 pt-32 pb-20 space-y-6">
        <Skeleton className="h-64" />
        <div className="grid md:grid-cols-3 gap-6">
          <Skeleton className="h-72 md:col-span-2" />
          <Skeleton className="h-72" />
        </div>
      </div>
    );
  }

  if (!cafe) {
    return (
      <div className="max-w-2xl mx-auto px-5 py-32">
        <EmptyState
          title="Café not found"
          body="This café may have been removed or the link is incorrect."
          action={
            <Link to="/cafes" className="btn-gold rounded-full px-8 py-3 text-sm font-semibold">
              Back to cafés
            </Link>
          }
        />
      </div>
    );
  }

  const toggleSave = async () => {
    if (!session || !user || !id) {
      navigate("/login");
      return;
    }
    try {
      if (saved) {
        await db.unsaveCafe(user.id, id);
        toast("Removed from your saved cafés.");
      } else {
        await db.saveCafe(user.id, id);
        toast("Saved — find it anytime under Saved Cafés.");
      }
      refreshSaved();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not update saved cafés.", "rose");
    }
  };

  return (
    <div>
      {/* Hero */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-burgundy via-burgundy-deep to-[#20090f]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_30%,rgba(240,220,174,0.25),transparent_60%)]" />
        <div className="relative max-w-6xl mx-auto px-5 pt-32 pb-16">
          <Link to="/cafes" className="text-rosegold text-sm hover:text-champagne transition-colors">
            ← All cafés
          </Link>
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="mt-6 flex flex-col md:flex-row md:items-end md:justify-between gap-6"
          >
            <div>
              <div className="flex items-center gap-2 mb-4">
                {cafe.partner && <Badge tone="gold">✦ Datevra Partner</Badge>}
                <Badge tone="muted">★ {cafe.rating.toFixed(1)}</Badge>
                <Badge tone="muted">{cafe.priceRange}</Badge>
              </div>
              <h1 className="font-display text-5xl md:text-6xl text-ivory leading-tight">
                {cafe.name}
              </h1>
              <p className="mt-3 text-ivory-dim/90">
                {cafe.address} · {cafe.city}
              </p>
            </div>
            <button
              onClick={toggleSave}
              className={`rounded-full px-8 py-3.5 text-sm font-semibold shrink-0 ${
                saved ? "btn-ghost" : "btn-gold"
              }`}
            >
              {saved ? "✓ Saved" : "♡ Save café"}
            </button>
          </motion.div>
        </div>
      </div>

      {/* Details */}
      <section className="max-w-6xl mx-auto px-5 py-14 grid md:grid-cols-3 gap-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.6 }}
          className="md:col-span-2 glass rounded-3xl p-8"
        >
          <h2 className="font-display text-2xl text-ivory">About this café</h2>
          <p className="mt-4 text-ivory-dim/90 leading-relaxed">{cafe.description}</p>

          <h3 className="font-display text-xl text-ivory mt-8">Experiences hosted</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            {cafe.experiences.map((x) => (
              <Badge key={x} tone="rose">
                {x}
              </Badge>
            ))}
          </div>

          <h3 className="font-display text-xl text-ivory mt-8">Booking information</h3>
          <p className="mt-3 text-ivory-dim/90 leading-relaxed text-[0.95rem]">{cafe.bookingInfo}</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.28, duration: 0.6 }}
          className="glass-strong rounded-3xl p-8 h-fit"
        >
          <h3 className="text-[0.72rem] uppercase tracking-[0.25em] text-mist">Visit</h3>
          <dl className="mt-5 space-y-5 text-sm">
            <div>
              <dt className="text-mist/80">Opening hours</dt>
              <dd className="text-ivory mt-1">{cafe.openingHours}</dd>
            </div>
            <div>
              <dt className="text-mist/80">Price range</dt>
              <dd className="text-ivory mt-1">{cafe.priceRange} · relaxed fine-café pricing</dd>
            </div>
            <div>
              <dt className="text-mist/80">City</dt>
              <dd className="text-ivory mt-1">{cafe.city}</dd>
            </div>
            {cafe.menu && (
              <div>
                <dt className="text-mist/80">Menu highlights</dt>
                <dd className="text-ivory mt-1 whitespace-pre-line">{cafe.menu}</dd>
              </div>
            )}
          </dl>
          <div className="ornament-divider my-6">
            <span className="text-sm">✦</span>
          </div>
          <p className="text-xs text-mist/80 leading-relaxed">
            Members can save cafés and book them as venues for curated Datevra
            experiences through the concierge.
          </p>
          {!session && (
            <Link
              to="/register"
              className="btn-gold rounded-full px-6 py-2.5 text-sm font-semibold block text-center mt-5"
            >
              Join to save & book
            </Link>
          )}
        </motion.div>
      </section>
    </div>
  );
}
