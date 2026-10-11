import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Avatar, PageHero, Reveal, SectionHead, Badge } from "../../components/ui";

const TEASERS = [
  {
    name: "Aarav M.",
    age: 27,
    city: "Mumbai",
    note: "Photographer · slow mornings · filter coffee",
    hue: "from-[#5c2540] to-[#2c1020]",
  },
  {
    name: "Meera S.",
    age: 25,
    city: "Bengaluru",
    note: "Architect · gallery weekends · old Bollywood",
    hue: "from-burgundy to-burgundy-deep",
  },
  {
    name: "Kabir R.",
    age: 29,
    city: "Delhi",
    note: "Chef · vinyl records · long evening walks",
    hue: "from-[#6e4a1b] to-[#3a2410]",
  },
];

const FACTORS = [
  { title: "Real preferences", body: "Age, city and who you're interested in — never overridden by anyone's paid priority." },
  { title: "Shared ground", body: "Interests, hobbies and relationship intentions you genuinely have in common." },
  { title: "Transparent scoring", body: "Every compatibility score shows the actual factors behind it. No black boxes, no false certainty." },
  { title: "Mutual only", body: "A match exists only when both people say yes. Your likes stay private until then." },
];

export default function DiscoverPublic() {
  return (
    <div>
      <PageHero
        kicker="Discovery"
        title="Someone wonderful is nearby"
        sub="A glimpse of what discovery feels like on Datevra. Join free to reveal full profiles, like, and start matching."
      >
        <div className="mt-8">
          <Link to="/register" className="btn-gold rounded-full px-9 py-3.5 text-sm font-semibold">
            Join to reveal
          </Link>
        </div>
      </PageHero>

      {/* Blurred teaser cards */}
      <section className="max-w-6xl mx-auto px-5 pb-8">
        <div className="grid md:grid-cols-3 gap-5">
          {TEASERS.map((t, i) => (
            <Reveal key={t.name} delay={i * 0.1}>
              <div className="relative glass rounded-3xl overflow-hidden card-hover">
                <div className={`h-56 bg-gradient-to-br ${t.hue} relative`}>
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_60%_30%,rgba(240,220,174,0.22),transparent_55%)]" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Avatar name={t.name} size={96} ring />
                  </div>
                  <div className="absolute top-4 right-4">
                    <Badge tone="muted">✦ 94%</Badge>
                  </div>
                </div>
                <div className="p-6 relative">
                  <div className="blur-[7px] select-none pointer-events-none" aria-hidden>
                    <h3 className="font-display text-xl text-ivory">
                      {t.name}, {t.age}
                    </h3>
                    <p className="text-xs text-mist mt-1">{t.city}</p>
                    <p className="text-sm text-ivory-dim/85 mt-2">{t.note}</p>
                  </div>
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-midnight/35 backdrop-blur-[2px]">
                    <motion.span
                      animate={{ scale: [1, 1.08, 1] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="text-3xl"
                    >
                      🔒
                    </motion.span>
                    <Link
                      to="/register"
                      className="btn-gold rounded-full px-6 py-2.5 text-sm font-semibold"
                    >
                      Join to reveal
                    </Link>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="text-center text-xs text-mist/70 mt-6">
          Illustrative preview — real profiles appear after you join. Faces are hidden here to protect member privacy.
        </p>
      </section>

      {/* Matching explained */}
      <section className="max-w-6xl mx-auto px-5 py-20">
        <SectionHead
          kicker="How matching works"
          title="Compatibility, honestly computed"
          sub="No mystery algorithms promising destiny. Just your stated preferences, compared transparently."
        />
        <div className="mt-12 grid sm:grid-cols-2 gap-5">
          {FACTORS.map((f, i) => (
            <Reveal key={f.title} delay={i * 0.08}>
              <div className="glass rounded-3xl p-7 h-full card-hover">
                <p className="text-rosegold">✦</p>
                <h3 className="font-display text-xl text-ivory mt-3">{f.title}</h3>
                <p className="mt-2 text-sm text-ivory-dim/85 leading-relaxed">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal className="text-center mt-12">
          <Link to="/register" className="btn-gold rounded-full px-10 py-4 text-base font-semibold">
            Start discovering
          </Link>
          <p className="mt-4 text-xs text-mist/70">
            Free to join · 18+ only · membership never guarantees a match
          </p>
        </Reveal>
      </section>
    </div>
  );
}
