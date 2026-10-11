import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { PageHero, Reveal, SectionHead } from "../../components/ui";

const STEPS = [
  {
    n: "01",
    icon: "✎",
    title: "Create your profile",
    body: "Share your story in minutes — photos, interests, hobbies and what you're looking for. The more complete your profile, the better your matches. Verification adds a trusted badge.",
    points: ["Photos & a genuine bio", "Interests, hobbies & intentions", "Optional verification badge"],
  },
  {
    n: "02",
    icon: "◈",
    title: "Discover & like",
    body: "Browse profiles filtered by your real preferences — age, city, interests. Like who intrigues you, pass on the rest. Every like stays private until it's mutual.",
    points: ["Preference-based discovery", "Private likes", "Save profiles for later"],
  },
  {
    n: "03",
    icon: "✉",
    title: "Match & chat",
    body: "When interest is mutual, a match is born — with a little celebration. Private chat opens only between the two of you, with typing indicators, read receipts and shared-interest conversation starters.",
    points: ["Mutual-match celebration", "Private, secure messaging", "Block & report built in"],
  },
  {
    n: "04",
    icon: "✦",
    title: "Curated dates",
    body: "Apply for a Datevra experience — a golden-hour coffee tasting, a candlelit courtyard, a chef's table. Our team reviews every application and hand-arranges the evening. Selection is never guaranteed, always human.",
    points: ["Apply for experiences", "Human-reviewed selection", "Concierge-arranged venues"],
  },
];

const FACTORS = [
  { label: "Age & location preferences", pct: 92 },
  { label: "Shared interests & hobbies", pct: 84 },
  { label: "Relationship intentions", pct: 78 },
  { label: "Profile completeness", pct: 64 },
];

export default function HowItWorks() {
  return (
    <div>
      <PageHero
        kicker="How it works"
        title="From first hello to first date"
        sub="A deliberate, human-guided journey — designed for people who are done with endless swiping."
      />

      {/* Animated timeline */}
      <section className="max-w-4xl mx-auto px-5 py-16 relative">
        <div className="absolute left-[2.35rem] md:left-1/2 top-16 bottom-16 w-px bg-gradient-to-b from-champagne/60 via-rosegold/30 to-transparent" aria-hidden />
        <div className="space-y-10">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={0.05}>
              <div className={`relative flex gap-6 md:gap-0 ${i % 2 === 1 ? "md:flex-row-reverse" : ""}`}>
                <motion.div
                  initial={{ scale: 0 }}
                  whileInView={{ scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ type: "spring", stiffness: 260, damping: 18 }}
                  className="relative z-10 shrink-0 md:absolute md:left-1/2 md:-translate-x-1/2 w-[4.7rem] h-[4.7rem] rounded-full glass-strong border border-rosegold/40 flex items-center justify-center"
                >
                  <span className="font-display text-2xl text-champagne">{s.icon}</span>
                  <span className="absolute -bottom-6 text-[0.65rem] tracking-[0.25em] text-mist/70">{s.n}</span>
                </motion.div>
                <div className={`flex-1 ${i % 2 === 1 ? "md:pr-[calc(50%+3.5rem)]" : "md:pl-[calc(50%+3.5rem)]"}`}>
                  <div className="glass rounded-3xl p-7 card-hover">
                    <h3 className="font-display text-2xl text-ivory">{s.title}</h3>
                    <p className="mt-3 text-ivory-dim/85 leading-relaxed text-[0.95rem]">{s.body}</p>
                    <ul className="mt-4 space-y-1.5">
                      {s.points.map((p) => (
                        <li key={p} className="text-sm text-ivory-dim/80 flex gap-2.5">
                          <span className="text-rosegold">✦</span> {p}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Compatibility */}
      <section className="max-w-4xl mx-auto px-5 py-16">
        <SectionHead
          kicker="Transparency"
          title="What your compatibility score means"
          sub="Computed from your stated preferences — never fabricated, never implying psychological certainty."
        />
        <Reveal className="mt-10">
          <div className="glass-strong rounded-3xl p-8">
            {FACTORS.map((f, i) => (
              <div key={f.label} className="mb-6 last:mb-0">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-ivory">{f.label}</span>
                  <span className="text-champagne font-semibold">{f.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    whileInView={{ width: `${f.pct}%` }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.12, duration: 1, ease: [0.22, 1, 0.36, 1] }}
                    className="h-full rounded-full bg-gradient-to-r from-burgundy via-rosegold to-champagne"
                  />
                </div>
              </div>
            ))}
            <p className="mt-6 text-xs text-mist/75 leading-relaxed">
              Illustrative weights — your actual score reflects how closely two
              people's stated preferences overlap. Paid visibility or priority
              never overrides anyone's preferences, consent or privacy.
            </p>
          </div>
        </Reveal>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-16 text-center">
        <Reveal>
          <h2 className="font-display text-3xl md:text-4xl text-ivory">
            Ready to begin the ritual?
          </h2>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register" className="btn-gold rounded-full px-10 py-4 text-base font-semibold">
              Create your profile
            </Link>
            <Link to="/experiences" className="btn-ghost rounded-full px-10 py-4 text-base">
              Browse experiences
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
