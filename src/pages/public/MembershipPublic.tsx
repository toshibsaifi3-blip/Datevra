import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { PageHero, Reveal, SectionHead, Badge } from "../../components/ui";
import { PLANS, MEMBERSHIP_DISCLAIMER } from "../../data/seed";
import type { MembershipPlan } from "../../lib/types";

const connectFeatures = PLANS[0].features;
const plusOnly = PLANS[1].features.filter(
  (f) => !f.startsWith("Everything in") && !connectFeatures.includes(f),
);
const eliteOnly = PLANS[2].features.filter(
  (f) => !f.startsWith("Everything in") && !connectFeatures.includes(f) && !plusOnly.includes(f),
);
const ROWS = [...connectFeatures, ...plusOnly, ...eliteOnly];

function hasFeature(plan: MembershipPlan, feature: string): boolean {
  if (plan.id === "connect") return connectFeatures.includes(feature);
  if (plan.id === "plus") return connectFeatures.includes(feature) || plusOnly.includes(feature);
  return true;
}

const PLAN_TAGS: Record<string, string> = {
  connect: "Begin with intention",
  plus: "Be discovered, beautifully",
  elite: "The Datevra signature",
};

export default function MembershipPublic() {
  return (
    <div className="relative">
      {/* dreamy ambience */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 h-[28rem] w-[60rem] max-w-[120vw] rounded-full bg-burgundy/25 blur-[140px] animate-aura-shift" />
      {[6, 20, 44, 68, 82, 94].map((left, i) => (
        <span
          key={i}
          aria-hidden
          className="pointer-events-none absolute text-champagne/25 animate-twinkle z-0"
          style={{ left: `${left}%`, top: `${120 + i * 130}px`, animationDelay: `${i * 0.6}s`, fontSize: `${9 + (i % 3) * 4}px` }}
        >
          ✦
        </span>
      ))}

      <PageHero
        kicker="Membership"
        title="Choose how you're seen"
        sub="Monthly memberships that elevate your visibility and priority — with complete honesty about what money can and cannot buy."
      />

      {/* Pricing cards */}
      <section className="relative max-w-6xl mx-auto px-5 py-14">
        <div className="grid md:grid-cols-3 gap-6 items-stretch">
          {PLANS.map((p, i) => {
            const elite = p.id === "elite";
            return (
              <Reveal key={p.id} delay={i * 0.1} className="h-full">
                <motion.div
                  whileHover={{ y: -10 }}
                  transition={{ type: "spring", stiffness: 260, damping: 22 }}
                  className={`relative rounded-[2rem] p-8 h-full flex flex-col overflow-hidden ${
                    elite
                      ? "glass-strong glow-border animate-glow-pulse"
                      : "glass border border-white/10 card-hover"
                  }`}
                >
                  <div
                    className={`absolute inset-0 bg-gradient-to-b pointer-events-none ${
                      elite
                        ? "from-champagne/15 via-rosegold/5 to-transparent"
                        : "from-white/[0.04] to-transparent"
                    }`}
                  />
                  {elite && (
                    <div className="absolute -top-3.5 left-1/2 -translate-x-1/2 z-10">
                      <Badge tone="gold">✦ Most coveted</Badge>
                    </div>
                  )}
                  <div className="relative flex-1 flex flex-col">
                    <p className="text-[0.68rem] uppercase tracking-[0.3em] text-rosegold">
                      {PLAN_TAGS[p.id]}
                    </p>
                    <h3 className={`font-display text-3xl mt-1 ${elite ? "text-gradient-gold" : "text-ivory"}`}>
                      {p.name}
                    </h3>
                    <p className="text-sm text-mist mt-1 italic">{p.tagline}</p>
                    <p className="mt-6">
                      <span className="font-display text-5xl text-gradient-gold font-semibold">
                        ₹{p.price.toLocaleString("en-IN")}
                      </span>
                      <span className="text-mist text-sm"> /month</span>
                    </p>
                    <p className="mt-2 text-xs text-mist/75">{p.badge}</p>
                    <div className="ornament-divider my-6 max-w-[10rem]">
                      <span className="text-sm">✦</span>
                    </div>
                    <ul className="space-y-3 text-[0.95rem] text-ivory-dim/90 flex-1">
                      {p.features.map((f) => (
                        <li key={f} className="flex gap-3">
                          <motion.span
                            initial={{ scale: 0 }}
                            whileInView={{ scale: 1 }}
                            viewport={{ once: true }}
                            transition={{ delay: 0.2 }}
                            className="text-rosegold shrink-0"
                          >
                            ✦
                          </motion.span>
                          <span>{f}</span>
                        </li>
                      ))}
                    </ul>
                    <Link
                      to="/register"
                      className={`mt-8 rounded-full px-8 py-3.5 text-sm font-semibold text-center ${
                        elite ? "btn-gold" : "btn-ghost"
                      }`}
                    >
                      Choose {p.name}
                    </Link>
                  </div>
                </motion.div>
              </Reveal>
            );
          })}
        </div>

        <Reveal className="mt-10 text-center">
          <p className="text-sm text-ivory-dim/80">
            Billed monthly · cancel anytime · secure checkout via Razorpay (test mode)
          </p>
          <p className="mt-4 max-w-3xl mx-auto text-xs text-mist/80 leading-relaxed border border-champagne/20 rounded-2xl px-6 py-4 bg-white/[0.02]">
            {MEMBERSHIP_DISCLAIMER}
          </p>
        </Reveal>
      </section>

      {/* Comparison table */}
      <section className="relative max-w-5xl mx-auto px-5 py-16">
        <SectionHead
          kicker="Compare"
          title="Every plan, side by side"
          sub="Exactly what each membership includes — nothing hidden, nothing exaggerated."
        />
        <Reveal className="mt-10">
          <div className="glass-strong rounded-[2rem] overflow-hidden overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left p-5 text-mist font-normal text-xs uppercase tracking-[0.2em]">
                    Feature
                  </th>
                  {PLANS.map((p) => (
                    <th key={p.id} className={`p-5 text-center ${p.id === "elite" ? "bg-champagne/[0.04]" : ""}`}>
                      <span className={`font-display text-lg ${p.id === "elite" ? "text-gradient-gold" : "text-ivory"}`}>
                        {p.name}
                      </span>
                      <span className="block text-xs text-mist mt-0.5">
                        ₹{p.price.toLocaleString("en-IN")}/mo
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ROWS.map((f, ri) => (
                  <tr
                    key={f}
                    className={`border-b border-white/5 last:border-0 ${ri % 2 === 1 ? "bg-white/[0.02]" : ""}`}
                  >
                    <td className="p-4 pl-5 text-ivory-dim/90">{f}</td>
                    {PLANS.map((p) => (
                      <td key={p.id} className={`p-4 text-center ${p.id === "elite" ? "bg-champagne/[0.04]" : ""}`}>
                        {hasFeature(p, f) ? (
                          <span className="text-champagne text-lg">✓</span>
                        ) : (
                          <span className="text-mist/30">—</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Reveal>

        <Reveal className="text-center mt-12">
          <Link to="/register" className="btn-gold rounded-full px-10 py-4 text-base font-semibold">
            Join Datevra today
          </Link>
          <p className="mt-4 text-xs text-mist/70">
            Payments are processed securely. Razorpay is in test mode — no real charges occur.
          </p>
        </Reveal>
      </section>
    </div>
  );
}
