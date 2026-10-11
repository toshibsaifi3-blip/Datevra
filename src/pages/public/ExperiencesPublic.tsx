import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Badge,
  Field,
  Modal,
  PageHero,
  Reveal,
  SectionHead,
  Skeleton,
  inputCls,
  useToast,
} from "../../components/ui";
import { useBackend, useAsync } from "../../lib/data";
import { useAuth } from "../../context/AuthContext";
import type { DateExperience } from "../../lib/types";

const KIND_GRADIENTS: Record<string, string> = {
  "Premium Dining": "from-[#6e4a1b] via-[#3a2410] to-[#1c0f08]",
  "Romantic Café": "from-[#5c2540] via-[#33122a] to-[#1c0a16]",
  "Coffee Date": "from-burgundy via-burgundy-deep to-[#20090f]",
  "Casual First Date": "from-[#3d2b52] via-[#241638] to-[#120a1c]",
};

function kindGradient(kind: string): string {
  return KIND_GRADIENTS[kind] ?? "from-burgundy via-burgundy-deep to-[#20090f]";
}

export default function ExperiencesPublic({ hideHero = false }: { hideHero?: boolean }) {
  const { session, user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const db = useBackend();

  const { data: experiences, loading, error } = useAsync(
    (b) => b.listExperiences(),
    [db],
    [] as DateExperience[],
    { cacheKey: "experiences" },
  );

  const [target, setTarget] = useState<DateExperience | null>(null);
  const [slotIdx, setSlotIdx] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const openApply = (exp: DateExperience) => {
    if (!session || !user) {
      navigate("/login");
      return;
    }
    if (exp.eliteOnly && user.plan !== "elite") {
      navigate("/membership");
      return;
    }
    setSlotIdx(0);
    setNote("");
    setTarget(exp);
  };

  const confirmApply = async () => {
    if (!target || !user) return;
    const slot = target.slots[slotIdx];
    if (!slot) return;
    setBusy(true);
    try {
      await db.applyForExperience({
        userId: user.id,
        experienceId: target.id,
        slotDate: slot.date,
        slotTime: slot.time,
        note,
      });
      setTarget(null);
      toast("Application submitted — our team reviews every application by hand.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not submit your application.", "rose");
    } finally {
      setBusy(false);
    }
  };

  const isLocked = (exp: DateExperience) => exp.eliteOnly && (!user || user.plan !== "elite");

  return (
    <div className="relative">
      {/* dreamy ambience */}
      <div className="pointer-events-none absolute top-0 right-1/4 h-96 w-96 rounded-full bg-rosegold/10 blur-[130px] animate-aura-shift" />
      {[8, 30, 52, 76, 92].map((left, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-champagne/25 animate-twinkle"
          style={{ left: `${left}%`, top: `${70 + i * 170}px`, animationDelay: `${i * 0.7}s`, fontSize: `${9 + (i % 3) * 4}px` }}
        >
          ✦
        </span>
      ))}

      {!hideHero && (
        <PageHero
          kicker="Curated experiences"
          title="Dates, arranged like art"
          sub="Golden-hour tastings, candlelit courtyards, chef's tables for two. Apply — our team personally reviews every application and hand-selects each evening's guests."
        />
      )}

      <section className="relative max-w-6xl mx-auto px-5 py-14">
        {loading ? (
          <div className="grid md:grid-cols-2 gap-6">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[30rem]" />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-rosegold">{error}</p>
        ) : experiences.length === 0 ? (
          <div className="glass rounded-[2rem] p-12 text-center max-w-xl mx-auto">
            <p className="font-display text-2xl text-ivory">No evenings on the calendar</p>
            <p className="text-sm text-mist mt-2">
              Our curators are still composing the next season. Check back soon.
            </p>
          </div>
        ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {experiences.map((e, i) => (
            <Reveal key={e.id} delay={(i % 2) * 0.1} className="h-full">
              <motion.article
                whileHover={{ y: -8 }}
                transition={{ type: "spring", stiffness: 240, damping: 22 }}
                className={`glass rounded-[2rem] overflow-hidden h-full flex flex-col card-hover relative ${
                  e.eliteOnly ? "glow-border" : ""
                }`}
              >
                <div className={`relative h-56 bg-gradient-to-br ${kindGradient(e.kind)}`}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_65%_25%,rgba(197,164,255,0.3),transparent_55%)]" />
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_80%,rgba(255,61,154,0.28),transparent_50%)]" />
                  <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 font-display text-8xl text-champagne/15 select-none">
                    {e.kind.charAt(0)}
                  </span>
                  <div className="absolute top-4 left-4 flex gap-2 flex-wrap">
                    <Badge tone="gold">✦ {e.kind}</Badge>
                    {e.eliteOnly && <Badge tone="rose">🔒 Elite only</Badge>}
                  </div>
                  <div className="absolute bottom-4 right-5 text-right">
                    <p className="text-[0.65rem] uppercase tracking-[0.25em] text-mist">from</p>
                    <p className="font-display text-3xl text-gradient-gold font-semibold">
                      ₹{e.priceFrom.toLocaleString("en-IN")}
                    </p>
                  </div>
                  <div className="absolute bottom-4 left-5 text-xs text-ivory/80">
                    {e.slots[0] ? (
                      <span>
                        Next <span className="text-champagne">{e.slots[0].date}</span> · {e.slots[0].time}
                      </span>
                    ) : (
                      <span className="text-mist">Dates announced soon</span>
                    )}
                  </div>
                </div>

                <div className="p-7 flex-1 flex flex-col">
                  <h3 className="font-display text-2xl text-gradient-dream">{e.title}</h3>
                  <p className="text-xs text-mist mt-1.5 tracking-wide flex items-center gap-1.5">
                    <span aria-hidden>✦</span> {e.city} · {e.durationMins} minutes · {e.slots.length} upcoming slots
                  </p>
                  <p className="mt-4 text-[0.95rem] text-ivory-dim/85 leading-relaxed flex-1">
                    {e.description}
                  </p>

                  <div className="mt-5">
                    <p className="text-[0.68rem] uppercase tracking-[0.25em] text-mist mb-2">
                      Who it's for
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {e.eligibility.map((el) => (
                        <Badge key={el} tone="muted">
                          {el}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  {/* slots preview */}
                  {e.slots.length > 0 && (
                    <div className="mt-5">
                      <p className="text-[0.68rem] uppercase tracking-[0.25em] text-mist mb-2">
                        Upcoming slots
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {e.slots.slice(0, 3).map((s) => (
                          <span
                            key={`${s.date}-${s.time}`}
                            className="text-xs text-ivory-dim border border-white/10 rounded-full px-3 py-1.5 bg-white/[0.03]"
                          >
                            {s.date} · {s.time} · {s.seats} seats
                          </span>
                        ))}
                        {e.slots.length > 3 && (
                          <span className="text-xs text-mist px-2 py-1.5">
                            +{e.slots.length - 3} more
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  <div className="mt-6 pt-5 border-t border-white/10">
                    <button
                      onClick={() => openApply(e)}
                      className={`w-full rounded-full px-7 py-3 text-sm font-semibold ${
                        isLocked(e) ? "btn-ghost" : "btn-gold"
                      }`}
                    >
                      {isLocked(e) ? (session ? "Elite members only" : "Login to apply") : "Apply for this evening"}
                    </button>
                    {!isLocked(e) && (
                      <p className="text-[0.7rem] text-mist/70 text-center mt-2">
                        Applying is free · selection is manual and never guaranteed
                      </p>
                    )}
                  </div>
                </div>
              </motion.article>
            </Reveal>
          ))}
        </div>
        )}

        <Reveal className="mt-12">
          <div className="glass-strong glow-border rounded-[2rem] p-8 text-center max-w-3xl mx-auto relative overflow-hidden">
            <div className="absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-72 rounded-full bg-rosegold/15 blur-[80px]" />
            <p className="text-[0.7rem] uppercase tracking-[0.3em] text-rosegold relative">Honest by design</p>
            <h3 className="font-display text-2xl text-ivory mt-2 relative">How selection works</h3>
            <p className="mt-3 text-sm text-ivory-dim/85 leading-relaxed relative">
              You apply → our team reviews your profile and eligibility → we
              hand-select guests for each evening → you receive a confirmation
              with venue and time. Selection is never guaranteed and never
              automated — every evening is curated by a human.
            </p>
          </div>
        </Reveal>
      </section>

      {/* Apply modal */}
      <Modal open={!!target} onClose={() => setTarget(null)} title={target ? `Apply · ${target.title}` : ""}>
        {target && (
          <div className="space-y-5">
            <p className="text-sm text-ivory-dim/85 leading-relaxed">
              Choose your preferred slot and add a short note for our curation
              team. Applying is free — selection is manual and never guaranteed.
            </p>
            <Field label="Preferred slot">
              <select
                className={inputCls}
                value={slotIdx}
                onChange={(e) => setSlotIdx(Number(e.target.value))}
              >
                {target.slots.map((s, i) => (
                  <option key={`${s.date}-${s.time}`} value={i}>
                    {s.date} · {s.time} ({s.seats} seats)
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note for the curation team" hint="Optional — a line about you helps us seat evenings well.">
              <textarea
                className={`${inputCls} min-h-[96px] resize-y`}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. I love slow conversations over single-origin coffee…"
                maxLength={500}
              />
            </Field>
            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setTarget(null)}
                className="btn-ghost rounded-full px-6 py-3 text-sm flex-1"
              >
                Cancel
              </button>
              <button
                onClick={confirmApply}
                disabled={busy}
                className="btn-gold rounded-full px-6 py-3 text-sm font-semibold flex-1 disabled:opacity-60"
              >
                {busy ? "Submitting…" : "Submit application"}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <section className="relative max-w-6xl mx-auto px-5 pb-20 text-center">
        <SectionHead
          kicker="Privé"
          title="Some evenings are members-only"
          sub="Privé membership unlocks our most exclusive experiences — intimate chef's tables and private venues."
        />
        <Reveal className="mt-8">
          <Link to="/membership" className="btn-ghost rounded-full px-8 py-3 text-sm">
            View Elite membership
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
