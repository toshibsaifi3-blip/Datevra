import { Link } from "react-router-dom";
import { PageHero, Reveal, SectionHead, Stat } from "../../components/ui";

const VALUES = [
  {
    icon: "◈",
    title: "Intentional",
    body: "Every profile field, every like, every evening exists for one reason: genuine connection. We don't optimise for time-on-app.",
  },
  {
    icon: "🛡",
    title: "Safe by design",
    body: "Mutual matches only, private messaging, verification, human moderation and blocking everywhere it matters.",
  },
  {
    icon: "✦",
    title: "Curated, not algorithmic",
    body: "Our signature date experiences are arranged by real people who read your application — never auto-assigned by a machine.",
  },
  {
    icon: "❋",
    title: "Honest",
    body: "We never promise matches, dates or outcomes. Compatibility scores show their real factors. Payments never buy affection.",
  },
];

export default function About() {
  return (
    <div>
      <PageHero
        kicker="Our story"
        title="Datevra: where romance is a craft"
        sub="We started Datevra with a simple frustration — dating apps had become slot machines. We wanted an atelier instead: slower, more beautiful, and honest about what love actually needs."
      />

      <section className="max-w-4xl mx-auto px-5 py-16">
        <Reveal>
          <div className="glass rounded-[2rem] p-8 md:p-12">
            <p className="text-lg md:text-xl text-ivory/95 leading-relaxed font-light">
              "Datevra" grew from the idea that a first meeting deserves the
              same care as a first edition — chosen paper, honest ink, nothing
              rushed. So we built a dating platform around{" "}
              <span className="text-champagne">thoughtful matchmaking</span> and{" "}
              <span className="text-champagne">hand-curated date experiences</span>{" "}
              in India's most romantic rooms.
            </p>
            <div className="ornament-divider my-8 max-w-xs">
              <span>✦</span>
            </div>
            <p className="text-ivory-dim/85 leading-relaxed">
              Today, Datevra pairs preference-based matching with a human
              curation team that reads every experience application and
              arranges every evening personally. Members discover each other
              through transparent compatibility, chat privately only when
              interest is mutual, and can apply for evenings — golden-hour
              coffee tastings, candlelit courtyards, chef's tables — that our
              team stages down to the last detail.
            </p>
            <p className="text-ivory-dim/85 leading-relaxed mt-4">
              We're a small team based in India, building slowly and
              deliberately. No growth hacks, no dark patterns, no inflated
              promises — just a beautiful room where modern romance can happen
              on its own terms.
            </p>
          </div>
        </Reveal>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-14">
        <SectionHead
          kicker="What we believe"
          title="Four promises we keep"
        />
        <div className="mt-12 grid sm:grid-cols-2 gap-5">
          {VALUES.map((v, i) => (
            <Reveal key={v.title} delay={i * 0.08}>
              <div className="glass rounded-3xl p-8 h-full card-hover">
                <p className="font-display text-3xl text-rosegold">{v.icon}</p>
                <h3 className="font-display text-2xl text-ivory mt-4">{v.title}</h3>
                <p className="mt-3 text-ivory-dim/85 leading-relaxed text-[0.95rem]">{v.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-14">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Reveal><Stat label="Cities" value="6" sub="Mumbai · Delhi · Bengaluru · Pune · Jaipur · Hyderabad" /></Reveal>
          <Reveal delay={0.08}><Stat label="Partner cafés" value="180+" sub="held tables & concierge booking" /></Reveal>
          <Reveal delay={0.16}><Stat label="Evenings curated" value="3,200+" sub="each arranged by a human" /></Reveal>
          <Reveal delay={0.24}><Stat label="Reports reviewed" value="100%" sub="every single one, by hand" /></Reveal>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-5 py-20 text-center">
        <Reveal>
          <h2 className="font-display text-3xl md:text-4xl text-ivory">
            Come as you are. <span className="text-gradient-gold">Leave with a story.</span>
          </h2>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/register" className="btn-gold rounded-full px-10 py-4 text-base font-semibold">
              Join Datevra
            </Link>
            <Link to="/contact" className="btn-ghost rounded-full px-10 py-4 text-base">
              Talk to us
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
