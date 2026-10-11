import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { PageHero, Reveal } from "../../components/ui";

interface LegalSection {
  h: string;
  body: string[];
}

const CONTENT: Record<
  "terms" | "privacy" | "refund",
  { kicker: string; title: string; sub: string; updated: string; sections: LegalSection[] }
> = {
  terms: {
    kicker: "Legal",
    title: "Terms of Service",
    sub: "The agreement between you and Datevra. Written in plain language, because fine print shouldn't need a translator.",
    updated: "Last updated: 1 October 2026",
    sections: [
      {
        h: "1. Who can join",
        body: [
          "Datevra is strictly for adults. You must be at least 18 years old to create an account, and we may ask you to verify your age. Accounts found to belong to minors are removed immediately.",
          "You may hold only one account, registered with accurate personal details and genuine photographs of yourself. Impersonation, fake profiles and misleading information are grounds for removal.",
        ],
      },
      {
        h: "2. Your account & conduct",
        body: [
          "You are responsible for keeping your login credentials confidential. Notify us immediately at our support email if you suspect unauthorised access.",
          "Our community guidelines apply everywhere on Datevra: be respectful, obtain consent, never harass, threaten or exploit anyone, and never post explicit, hateful or illegal content. Violations may lead to warnings, restrictions or permanent removal.",
        ],
      },
      {
        h: "3. Membership & payments",
        body: [
          "Datevra offers paid monthly memberships — Connect (₹499), Plus (₹799) and Elite (₹1,199) — which enhance profile visibility, matchmaking priority and access to selected experiences. Payments are processed securely via Razorpay, currently operating in test mode.",
          "Before every purchase you will see a clear confirmation explaining what membership does and does not include. Membership never guarantees a match, a relationship, commitment, a date, curated-date selection, or any particular romantic outcome. Fees are non-transferable.",
        ],
      },
      {
        h: "4. Matching, messaging & curated experiences",
        body: [
          "A match is created only when both members express mutual interest. Messaging is available only between matched members. Compatibility scores are computed transparently from stated preferences and imply no psychological certainty.",
          "Curated date experiences are arranged by our team. Applying is free; selection is manual, subject to eligibility and safety review, and never guaranteed. Confirmed bookings may carry experience fees, communicated clearly before payment.",
        ],
      },
      {
        h: "5. Safety & moderation",
        body: [
          "We provide blocking, reporting and profile moderation tools. We review every report with human moderators and may remove content or accounts that threaten member safety. We cooperate with law enforcement where legally required.",
          "Datevra is not liable for the actions of members you meet through the platform. Always follow our Safety Centre guidance: meet in public, tell someone your plans, and trust your instincts.",
        ],
      },
      {
        h: "6. Termination",
        body: [
          "You may delete your account at any time from Settings; deletion removes your profile and personal data per our Privacy Policy. We may suspend or terminate accounts that breach these terms, with or without notice for serious safety violations.",
        ],
      },
      {
        h: "7. Governing law",
        body: [
          "These terms are governed by the laws of India. Disputes will first be addressed through good-faith discussion with our support team, and thereafter through the courts of competent jurisdiction in India.",
        ],
      },
    ],
  },
  privacy: {
    kicker: "Legal",
    title: "Privacy Policy",
    sub: "What we collect, why we collect it, and the control you keep over your data.",
    updated: "Last updated: 1 October 2026",
    sections: [
      {
        h: "1. Data we collect",
        body: [
          "Account data: name, email, age, gender, city and the profile details you choose to share — photos, bio, interests, hobbies and relationship intentions.",
          "Activity data: likes, passes, matches, messages, experience applications and bookings, membership and payment records, reports and blocks.",
          "Technical data: device and session information needed for security, fraud prevention and keeping you signed in.",
        ],
      },
      {
        h: "2. How we use it",
        body: [
          "To operate Datevra: matching based on your stated preferences, private messaging between mutual matches, experience curation, payments and customer support.",
          "To keep the platform safe: verification, moderation, investigating reports and preventing abuse. We never sell your personal data, and we never use your messages to train advertising models.",
        ],
      },
      {
        h: "3. What we share — and don't",
        body: [
          "Your profile is visible only to other Datevra members, and only the details you choose to publish. We never publicly expose sensitive data such as exact location, payment details or report history.",
          "Date-booking details are shared only with the participants and authorised personnel who need them. We share data with service providers (hosting, payments via Razorpay, communications) strictly as needed to operate the service, and with authorities only when legally compelled.",
        ],
      },
      {
        h: "4. Your rights & controls",
        body: [
          "You can view, edit and download your profile data at any time. Privacy controls let you manage visibility and messaging preferences. You may request correction or deletion of your personal data by writing to our support email.",
          "Deleting your account removes your profile and personal data from our active systems. Some records (e.g. payment receipts, moderation decisions) are retained as required by law and for platform safety.",
        ],
      },
      {
        h: "5. Security & retention",
        body: [
          "We use industry-standard safeguards — encrypted connections, access controls and audit logs for sensitive operations. No system is perfectly secure, so we also encourage strong, unique passwords.",
          "We retain data only as long as needed for the purposes above or as required by Indian law, after which it is deleted or anonymised.",
        ],
      },
      {
        h: "6. Contact",
        body: [
          "For privacy questions, access or deletion requests, write to our support email listed on the Contact page. We respond to privacy requests within 30 days.",
        ],
      },
    ],
  },
  refund: {
    kicker: "Legal",
    title: "Refund Policy",
    sub: "Clear, fair and honest — when you get your money back, and how.",
    updated: "Last updated: 1 October 2026",
    sections: [
      {
        h: "1. Membership refunds",
        body: [
          "If you purchase a membership (Connect ₹499, Plus ₹799, Elite ₹1,199) and have not used any paid benefits, you may request a full refund within 7 days of purchase. 'Unused' means no priority matching boosts applied, no exclusive experience applications submitted under the plan, and no premium support tickets raised.",
          "After 7 days, or once paid benefits have been used, membership fees are non-refundable. Cancelling stops future billing; your membership remains active until the end of the paid period.",
        ],
      },
      {
        h: "2. Curated experience payments",
        body: [
          "Fees paid for confirmed curated experiences are refundable in full if Datevra cancels the evening. If you cancel at least 72 hours before the scheduled date and time, you receive a full refund; cancellations within 72 hours are non-refundable, as venues and arrangements are already committed.",
          "Applying for an experience is always free. You only pay when a booking is confirmed with you.",
        ],
      },
      {
        h: "3. How to request a refund",
        body: [
          "Write to our support email with your registered email address, the payment reference and the reason for your request. We acknowledge every request within 2 business days.",
          "Approved refunds are processed to the original payment method within 7–10 business days. Razorpay is currently in test mode, so no real charges occur during this phase.",
        ],
      },
      {
        h: "4. What this policy doesn't cover",
        body: [
          "Refunds don't apply to outcomes: membership and experiences never guarantee matches, dates, selection or romantic results, and dissatisfaction with romantic outcomes is not grounds for a refund. Fraudulent refund claims may lead to account review.",
        ],
      },
    ],
  },
};

export default function Legal({ slug }: { slug: "terms" | "privacy" | "refund" }) {
  const c = CONTENT[slug];
  const links: { slug: "terms" | "privacy" | "refund"; label: string }[] = [
    { slug: "terms", label: "Terms" },
    { slug: "privacy", label: "Privacy" },
    { slug: "refund", label: "Refunds" },
  ];

  return (
    <div>
      <PageHero kicker={c.kicker} title={c.title} sub={c.sub}>
        <p className="mt-6 text-xs text-mist/70">{c.updated}</p>
        <div className="mt-4 flex items-center justify-center gap-2">
          {links.map((l) => (
            <Link
              key={l.slug}
              to={`/${l.slug}`}
              className={`rounded-full px-5 py-2 text-xs transition-colors ${
                l.slug === slug
                  ? "bg-champagne/15 text-champagne border border-champagne/40"
                  : "text-mist hover:text-ivory border border-white/10"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </PageHero>

      <section className="max-w-3xl mx-auto px-5 pb-24">
        <div className="space-y-4">
          {c.sections.map((s, i) => (
            <Reveal key={s.h} delay={Math.min(i * 0.04, 0.3)}>
              <motion.article
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-40px" }}
                className="glass rounded-3xl p-7 md:p-8"
              >
                <h2 className="font-display text-xl md:text-2xl text-ivory">{s.h}</h2>
                <div className="mt-4 space-y-3">
                  {s.body.map((p, j) => (
                    <p key={j} className="text-[0.95rem] text-ivory-dim/85 leading-relaxed">
                      {p}
                    </p>
                  ))}
                </div>
              </motion.article>
            </Reveal>
          ))}
        </div>

        <Reveal className="text-center mt-12">
          <p className="text-sm text-ivory-dim/80">
            Questions about these terms?{" "}
            <Link to="/contact" className="text-champagne hover:text-rosegold transition-colors">
              Talk to us
            </Link>
            .
          </p>
        </Reveal>
      </section>
    </div>
  );
}
