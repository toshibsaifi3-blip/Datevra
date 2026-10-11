import { useState } from "react";
import { motion } from "framer-motion";
import { useAuth } from "../context/AuthContext";
import { PageHero } from "../components/ui";
import CafesPublic from "./public/CafesPublic";
import SavedCafes from "./user/SavedCafes";

type Tab = "all" | "saved";

const TABS: { id: Tab; label: string }[] = [
  { id: "all", label: "All cafés" },
  { id: "saved", label: "Saved" },
];

/**
 * /cafes — dual-mode page.
 * Logged-out visitors see partner listings; members also get a Saved tab.
 */
export default function CafesPage() {
  const { user } = useAuth();
  if (!user) return <CafesPublic />;
  return <MemberCafes />;
}

function MemberCafes() {
  const [tab, setTab] = useState<Tab>("all");
  return (
    <div>
      <PageHero
        kicker="Explore cafés"
        title="Rooms made for conversation"
        sub="Hand-picked partner cafés across India — held tables, priority seating and concierge booking for Datevra members."
      />
      <div className="max-w-6xl mx-auto px-5">
        <div
          className="flex gap-2 p-1.5 rounded-full glass border border-white/10 w-fit mx-auto"
          role="tablist"
          aria-label="Café sections"
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
                  layoutId="cafe-tab"
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
        {tab === "all" && <CafesPublic hideHero />}
        {tab === "saved" && (
          <div className="max-w-6xl mx-auto px-5 pb-20">
            <SavedCafes />
          </div>
        )}
      </div>
    </div>
  );
}
