import { Link } from "react-router-dom";
import { PageHero, Reveal, SectionHead } from "../../components/ui";
import { useBackend, useAsync } from "../../lib/data";
import type { PlatformSettings } from "../../lib/types";

const TIPS = [
  {
    icon: "◈",
    title: "Keep it on Datevra first",
    body: "Chat inside the app until you feel genuinely comfortable. Private messaging exists only between mutual matches — that's by design.",
  },
  {
    icon: "✦",
    title: "Meet in public, curated spaces",
    body: "First meetings should always be in public. Better yet — apply for a curated Datevra experience, where the venue and evening are arranged by our team.",
  },
  {
    icon: "❋",
    title: "Tell someone your plans",
    body: "Share the venue, time and who you're meeting with a trusted friend. Keep your phone charged and your own transport arranged.",
  },
  {
    icon: "🛡",
    title: "Trust your instincts",
    body: "Anyone pressuring you to meet privately, share personal details or move money is a red flag. Block, report, and walk away — no explanation owed.",
  },
  {
    icon: "✎",
    title: "Guard personal details",
    body: "Don't share your home address, workplace details, financial information or intimate photos. Ever. No exceptions.",
  },
  {
    icon: "⚑",
    title: "Money is a hard line",
    body: "Datevra will never ask for money outside official membership and experience payments. Anyone who does is not who they claim to be.",
  },
];

const GUIDELINES = [
  "Be 18 or older — no exceptions, no workarounds.",
  "Be who you are — real photos, honest details, one account per person.",
  "Consent is everything — respect passes, blocks and boundaries instantly.",
  "No harassment, hate, threats or explicit content — zero tolerance.",
  "No scams, spam, promotions or solicitation of any kind.",
  "Keep conversations respectful — disagreement is fine, cruelty is not.",
];

export default function Safety() {
  const db = useBackend();
  const { data: settings } = useAsync(
    (b) => b.getSettings(),
    [db],
    null as PlatformSettings | null,
  );
  const supportEmail = settings?.supportEmail ?? "care@datevra.in";

  return (
    <div>
      <PageHero
        kicker="Safety centre"
        title="Romance deserves to feel safe"
        sub="How we protect you, how you can protect yourself, and exactly what happens when you report someone."
      />

      {/* Tips */}
      <section className="max-w-6xl mx-auto px-5 py-14">
        <SectionHead
          kicker="Date safer"
          title="Six habits of safe dating"
        />
        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {TIPS.map((t, i) => (
            <Reveal key={t.title} delay={(i % 3) * 0.08}>
              <div className="glass rounded-3xl p-7 h-full card-hover">
                <p className="font-display text-3xl text-rosegold">{t.icon}</p>
                <h3 className="font-display text-xl text-ivory mt-4">{t.title}</h3>
                <p className="mt-2.5 text-sm text-ivory-dim/85 leading-relaxed">{t.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Blocking & reporting */}
      <section className="max-w-4xl mx-auto px-5 py-14">
        <SectionHead
          kicker="You're in control"
          title="Blocking & reporting, in seconds"
          sub="Every profile, conversation and match carries block and report actions. Here's what happens next."
        />
        <div className="mt-10 space-y-4">
          {[
            { n: "1", t: "Block instantly", b: "Blocked members can't see your profile, message you, or appear in your discovery. They are never told you blocked them." },
            { n: "2", t: "Report with context", b: "Choose a reason and add details. Reports go straight to our human moderation team — never an auto-dismiss bot." },
            { n: "3", t: "We review every report", b: "Our team reviews each report individually and can warn, restrict or permanently remove accounts that break community guidelines." },
            { n: "4", t: "Delete your data anytime", b: "You can delete your account and personal data from Settings whenever you choose. No dark patterns, no retention tricks." },
          ].map((s, i) => (
            <Reveal key={s.n} delay={i * 0.06}>
              <div className="glass rounded-2xl p-6 flex gap-5 items-start">
                <span className="font-display text-3xl text-gradient-gold font-semibold shrink-0">{s.n}</span>
                <div>
                  <h3 className="font-display text-lg text-ivory">{s.t}</h3>
                  <p className="mt-1.5 text-sm text-ivory-dim/85 leading-relaxed">{s.b}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* Guidelines */}
      <section className="max-w-4xl mx-auto px-5 py-14">
        <SectionHead
          kicker="Community guidelines"
          title="The rules of the room"
          sub="Short version. The full text lives in our Terms."
        />
        <Reveal className="mt-10">
          <div className="glass-strong rounded-3xl p-8">
            <ul className="space-y-3.5">
              {GUIDELINES.map((g) => (
                <li key={g} className="flex gap-3 text-[0.95rem] text-ivory-dim/90">
                  <span className="text-rosegold shrink-0">✦</span>
                  <span>{g}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-xs text-mist/75 leading-relaxed">
              Violations can lead to warnings, feature restrictions or permanent
              removal. We never publicly expose reports or reporter identities.
            </p>
          </div>
        </Reveal>
      </section>

      {/* Help */}
      <section className="max-w-4xl mx-auto px-5 py-14 text-center">
        <Reveal>
          <div className="glass rounded-[2rem] p-10">
            <h2 className="font-display text-3xl text-ivory">Need help or feel unsafe?</h2>
            <p className="mt-4 text-ivory-dim/85 leading-relaxed max-w-xl mx-auto">
              Write to us anytime at{" "}
              <a href={`mailto:${supportEmail}`} className="text-champagne hover:text-rosegold transition-colors">
                {supportEmail}
              </a>
              . Safety reports are prioritised and reviewed by a human — usually
              within 24 hours.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link to="/contact" className="btn-gold rounded-full px-8 py-3.5 text-sm font-semibold">
                Contact support
              </Link>
              <Link to="/faqs" className="btn-ghost rounded-full px-8 py-3.5 text-sm">
                Read FAQs
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
