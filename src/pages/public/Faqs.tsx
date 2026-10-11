import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { PageHero, Reveal } from "../../components/ui";
import { FAQS } from "../../data/seed";

export default function Faqs() {
  const groups = Array.from(new Set(FAQS.map((f) => f.group)));
  const [open, setOpen] = useState<string | null>(FAQS[0]?.q ?? null);

  return (
    <div>
      <PageHero
        kicker="FAQs"
        title="Questions, answered honestly"
        sub="Everything about joining, matching, membership, curated experiences and safety."
      />

      <section className="max-w-3xl mx-auto px-5 py-14 space-y-12">
        {groups.map((g) => (
          <div key={g}>
            <Reveal>
              <h2 className="text-[0.72rem] uppercase tracking-[0.32em] text-rosegold/90 mb-5">
                {g}
              </h2>
            </Reveal>
            <div className="space-y-3">
              {FAQS.filter((f) => f.group === g).map((f) => {
                const isOpen = open === f.q;
                return (
                  <Reveal key={f.q}>
                    <div
                      className={`glass rounded-2xl overflow-hidden transition-colors ${
                        isOpen ? "border-rosegold/30" : ""
                      }`}
                    >
                      <button
                        onClick={() => setOpen(isOpen ? null : f.q)}
                        className="w-full text-left px-6 py-5 flex items-center justify-between gap-4"
                        aria-expanded={isOpen}
                      >
                        <span className="font-display text-lg text-ivory">{f.q}</span>
                        <motion.span
                          animate={{ rotate: isOpen ? 45 : 0 }}
                          transition={{ duration: 0.25 }}
                          className="text-champagne text-2xl leading-none shrink-0"
                        >
                          +
                        </motion.span>
                      </button>
                      <AnimatePresence initial={false}>
                        {isOpen && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                          >
                            <p className="px-6 pb-6 text-[0.95rem] text-ivory-dim/85 leading-relaxed">
                              {f.a}
                            </p>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </Reveal>
                );
              })}
            </div>
          </div>
        ))}

        <Reveal className="text-center pt-4">
          <p className="text-ivory-dim/85">Still curious about something?</p>
          <Link to="/contact" className="btn-ghost rounded-full px-8 py-3 text-sm inline-block mt-5">
            Ask us directly
          </Link>
        </Reveal>
      </section>
    </div>
  );
}
