import { useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { PageHero } from "../components/ui";
import ExperiencesPublic from "./public/ExperiencesPublic";
import Applications from "./user/Applications";
import Bookings from "./user/Bookings";

type Tab = "explore" | "applications" | "bookings";

const TABS: { id: Tab; label: string }[] = [
  { id: "explore", label: "Explore" },
  { id: "applications", label: "My applications" },
  { id: "bookings", label: "My bookings" },
];

/**
 * /experiences — dual-mode page.
 * Logged-out visitors see the curated listing; members get tabs for
 * exploring, their applications, and their bookings.
 */
export default function ExperiencesPage() {
  const { user } = useAuth();
  if (!user) return <ExperiencesPublic />;
  return <MemberExperiences />;
}

function MemberExperiences() {
  const [tab, setTab] = useState<Tab>("explore");
  return (
    <div>
      <PageHero
        kicker="Curated experiences"
        title="Dates, arranged like art"
        sub="Golden-hour tastings, candlelit courtyards, chef's tables for two — explore, apply, and track your evenings."
      />
      <div className="max-w-6xl mx-auto px-5">
        <div
          className="flex gap-2 p-1.5 rounded-full glass border border-white/10 w-fit mx-auto"
          role="tablist"
          aria-label="Experiences sections"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`relative rounded-full px-6 py-2.5 text-sm transition-colors ${
                tab === t.id ? "text-onyx font-semibold" : "text-ivory-dim/80 hover:text-ivory"
              }`}
            >
              {tab === t.id && (
                <motion.span
                  layoutId="exp-tab"
                  className="absolute inset-0 rounded-full bg-gradient-to-r from-champagne to-rosegold"
                  transition={{ type: "spring", stiffness: 400, damping: 32 }}
                />
              )}
              <span className="relative">{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="pt-2">
        {tab === "explore" && <ExperiencesPublic hideHero />}
        {tab === "applications" && (
          <div className="max-w-6xl mx-auto px-5 pb-20">
            <Applications />
          </div>
        )}
        {tab === "bookings" && (
          <div className="max-w-6xl mx-auto px-5 pb-20">
            <Bookings />
          </div>
        )}
      </div>
    </div>
  );
}
