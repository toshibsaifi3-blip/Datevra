import { useState } from "react";
import { motion } from "framer-motion";
import { Link, useNavigate } from "react-router-dom";
import { DreamField } from "../../components/dream";
import { Skeleton, useToast } from "../../components/ui";
import { LimitReachedModal } from "../../components/LimitModal";
import { useAuth } from "../../context/AuthContext";
import { useBackend, useAsync } from "../../lib/data";
import type { UserProfile } from "../../lib/types";

/** Inline SVG hero scene — heart-shaped moon over a dreamy night sky.
 *  Replaces the binary hero artwork with a resolution-independent,
 *  premium Dreamy Fantasy visual (no external assets). */
function HeroScene() {
  return (
    <svg
      viewBox="0 0 1200 640"
      preserveAspectRatio="xMidYMid slice"
      className="absolute inset-0 w-full h-full animate-dream-zoom"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id="heroSky" cx="50%" cy="18%" r="90%">
          <stop offset="0%" stopColor="#3b1f5e" />
          <stop offset="45%" stopColor="#241243" />
          <stop offset="100%" stopColor="#0d0718" />
        </radialGradient>
        <radialGradient id="moonGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffd9e8" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#ff9ec7" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#ff9ec7" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="moonBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffe9f3" />
          <stop offset="60%" stopColor="#ffc4da" />
          <stop offset="100%" stopColor="#f78fb8" />
        </linearGradient>
        <linearGradient id="hillFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a1650" />
          <stop offset="100%" stopColor="#160b2b" />
        </linearGradient>
        <linearGradient id="hillNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#1c0f38" />
          <stop offset="100%" stopColor="#0b0616" />
        </linearGradient>
        <radialGradient id="lanternGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffca7a" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#ffca7a" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* night sky */}
      <rect width="1200" height="640" fill="url(#heroSky)" />

      {/* scattered stars */}
      <g fill="#ffffff">
        {[
          [80, 90, 2.2], [190, 150, 1.4], [260, 60, 1.8], [340, 120, 1.2],
          [430, 70, 2], [520, 140, 1.3], [700, 80, 1.7], [790, 130, 1.2],
          [880, 60, 2.1], [960, 150, 1.4], [1040, 90, 1.8], [1120, 170, 1.2],
          [150, 230, 1.1], [1050, 250, 1.3], [620, 200, 1], [420, 210, 1.2],
        ].map(([x, y, r], i) => (
          <circle key={i} cx={x} cy={y} r={r} opacity={0.55 + (i % 3) * 0.15} />
        ))}
      </g>

      {/* moon halo */}
      <circle cx="600" cy="215" r="190" fill="url(#moonGlow)" />

      {/* heart-shaped moon */}
      <path
        d="M600 330
           C 600 330 445 225 445 140
           C 445 85 490 55 535 55
           C 565 55 590 72 600 95
           C 610 72 635 55 665 55
           C 710 55 755 85 755 140
           C 755 225 600 330 600 330 Z"
        fill="url(#moonBody)"
      />
      {/* moon craters / soft shading */}
      <g fill="#e87ba4" opacity="0.35">
        <ellipse cx="545" cy="150" rx="26" ry="20" />
        <ellipse cx="650" cy="180" rx="18" ry="15" />
        <ellipse cx="600" cy="230" rx="30" ry="22" />
      </g>

      {/* drifting lantern glows */}
      <g>
        <circle cx="150" cy="300" r="46" fill="url(#lanternGlow)" opacity="0.7" />
        <circle cx="1050" cy="330" r="52" fill="url(#lanternGlow)" opacity="0.65" />
        <circle cx="240" cy="420" r="34" fill="url(#lanternGlow)" opacity="0.55" />
        <circle cx="960" cy="440" r="38" fill="url(#lanternGlow)" opacity="0.5" />
      </g>

      {/* distant hills */}
      <path d="M0 520 Q 200 440 400 505 T 800 495 T 1200 515 V 640 H 0 Z" fill="url(#hillFar)" />
      {/* near hill */}
      <path d="M0 580 Q 300 520 620 575 T 1200 565 V 640 H 0 Z" fill="url(#hillNear)" />

      {/* couple silhouette on the hill */}
      <g fill="#05030a">
        <ellipse cx="600" cy="588" rx="150" ry="10" opacity="0.6" />
        {/* person 1 */}
        <circle cx="572" cy="520" r="14" />
        <path d="M558 534 q 14 -8 28 0 l 6 44 q -20 8 -40 0 Z" />
        {/* person 2 */}
        <circle cx="628" cy="522" r="13" />
        <path d="M615 536 q 13 -8 26 0 l 5 42 q -18 8 -36 0 Z" />
        {/* joined hands hint */}
        <path d="M592 556 q 8 6 16 0" stroke="#05030a" strokeWidth="6" fill="none" strokeLinecap="round" />
      </g>

      {/* tiny heart rising between them */}
      <path
        d="M600 492 c -3 -6 -12 -6 -12 1 c 0 5 7 9 12 13 c 5 -4 12 -8 12 -13 c 0 -7 -9 -7 -12 -1 Z"
        fill="#ff5c9e"
        opacity="0.9"
      />
    </svg>
  );
}

const ease = [0.22, 1, 0.36, 1] as const;

function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 36 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.9, delay, ease }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* Floating paper lantern (CSS) */
function Lantern({ className = "", delay = "0s", duration = "9s" }: { className?: string; delay?: string; duration?: string }) {
  return (
    <span
      aria-hidden
      className={`absolute pointer-events-none ${className}`}
      style={{ animation: `floatSlow ${duration} ease-in-out infinite`, animationDelay: delay }}
    >
      <span className="block w-7 h-9 rounded-[45%] bg-gradient-to-b from-blush/90 via-rosegold/70 to-rosegold-deep/50 blur-[1px] shadow-[0_0_24px_rgba(255,181,213,0.8)]" />
      <span className="block mx-auto -mt-1 w-3 h-1.5 rounded-b-full bg-rosegold-deep/60" />
    </span>
  );
}

const SHORTCUTS = [
  { label: "People", icon: "◈", to: "/discover" },
  { label: "Cafés", icon: "☕", to: "/cafes" },
  { label: "Experiences", icon: "❧", to: "/experiences" },
  { label: "More", icon: "✦", to: "" },
];

function Shortcut({ label, icon, to }: { label: string; icon: string; to: string }) {
  const openMenu = () => window.dispatchEvent(new CustomEvent("datevra:open-menu"));
  const inner = (
    <>
      <span className="w-16 h-16 rounded-full glass flex items-center justify-center text-2xl text-champagne shadow-[0_0_20px_rgba(197,164,255,0.25)] border border-champagne/25 transition-transform group-active:scale-95">
        <span className="drop-shadow-[0_0_8px_rgba(255,61,154,0.7)]">{icon}</span>
      </span>
      <span className="mt-2 text-xs tracking-wide text-ivory-dim/90">{label}</span>
    </>
  );
  const cls = "group flex flex-col items-center";
  return to ? (
    <Link to={to} className={cls} aria-label={label}>
      {inner}
    </Link>
  ) : (
    <button onClick={openMenu} className={cls} aria-label="More options">
      {inner}
    </button>
  );
}

function SuggestedCard({ profile }: { profile: UserProfile }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const db = useBackend();
  const navigate = useNavigate();
  const [liked, setLiked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [limitHit, setLimitHit] = useState(false);

  const like = async () => {
    if (!user) {
      navigate("/register");
      return;
    }
    if (busy || liked) return;
    setBusy(true);
    try {
      const { match } = await db.sendLike(user.id, profile.id);
      setLiked(true);
      toast(match ? `It's a match with ${profile.firstName}! Say hello in Matches.` : `You liked ${profile.firstName} ♥`);
    } catch (e) {
      if (e instanceof Error && e.message.includes("DAILY_LIKE_LIMIT_REACHED")) {
        setLimitHit(true);
      } else {
        toast(e instanceof Error ? e.message : "Couldn't send that like.", "rose");
      }
    } finally {
      setBusy(false);
    }
  };

  const photo = profile.photos?.[0];
  return (
    <div className="glass rounded-3xl overflow-hidden card-hover flex flex-col min-w-0">
      <div className="relative h-44 bg-gradient-to-br from-burgundy via-coal to-midnight">
        {photo ? (
          <img src={photo} alt={profile.firstName} className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
        ) : (
          <span className="absolute inset-0 flex items-center justify-center font-display text-6xl text-champagne/40">
            {profile.firstName.charAt(0)}
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-midnight/70 via-transparent to-transparent" />
        <button
          onClick={like}
          aria-label={liked ? "Liked" : `Like ${profile.firstName}`}
          className={`absolute top-3 right-3 w-9 h-9 rounded-full flex items-center justify-center text-lg backdrop-blur-md transition-all active:scale-90 ${
            liked
              ? "bg-rosegold text-white shadow-[0_0_16px_rgba(255,61,154,0.9)]"
              : "bg-black/35 text-blush border border-white/20 hover:border-rosegold/60"
          }`}
        >
          <span className={liked ? "animate-heartbeat inline-block" : ""}>♥</span>
        </button>
        {profile.verified && (
          <span className="absolute bottom-3 left-3 text-[0.65rem] px-2.5 py-1 rounded-full bg-celestial/25 border border-celestial/40 text-blush backdrop-blur-md">
            ✓ Verified
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="font-display text-lg text-ivory leading-tight">
          {profile.firstName}, {profile.age}
        </p>
        <p className="text-xs text-mist mt-1 flex items-center gap-1">
          <span className="text-rosegold/70">✦</span> {profile.city}
          {profile.online && <span className="ml-1 inline-block w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />}
        </p>
      </div>
      {limitHit && (
        <LimitReachedModal open={true} kind="likes" onClose={() => setLimitHit(false)} />
      )}
    </div>
  );
}

export default function Home() {
  const db = useBackend();
  const { user } = useAuth();
  const { data: profiles, loading } = useAsync((b) => b.listProfiles(), [db], [] as UserProfile[], {
    cacheKey: "profiles",
  });
  const suggested = profiles.filter((p) => p.id !== user?.id).slice(0, 3);

  return (
    <div className="relative">
      {/* ================= HERO ================= */}
      <section className="relative px-5 pt-28 pb-10 max-w-6xl mx-auto">
        <Reveal>
          <div className="relative rounded-[2rem] overflow-hidden glow-border">
            {/* illustration with slow cinematic zoom */}
            <div className="relative h-[52svh] min-h-[380px] max-h-[560px] overflow-hidden">
              <HeroScene />
              <div className="absolute inset-0 bg-gradient-to-t from-midnight via-transparent to-midnight/30" />
              {/* heartbeat glow over the heart-moon */}
              <div className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <span className="block w-40 h-40 rounded-full bg-rosegold/25 blur-3xl animate-heartbeat" />
              </div>
              {/* glowing heart trail orbiting the moon */}
              <div className="absolute left-1/2 top-[30%] -translate-x-1/2 -translate-y-1/2 pointer-events-none">
                <span className="block animate-orbit-glow text-2xl text-blush drop-shadow-[0_0_12px_rgba(255,61,154,1)]">
                  ♥
                </span>
              </div>
              {/* floating lanterns on both sides */}
              <Lantern className="left-[6%] top-[38%]" delay="-2s" duration="8s" />
              <Lantern className="left-[13%] top-[62%]" delay="-5s" duration="11s" />
              <Lantern className="right-[7%] top-[44%]" delay="-1s" duration="9s" />
              <Lantern className="right-[14%] top-[68%]" delay="-6s" duration="12s" />
              <DreamField count={22} seed={11} className="opacity-80" />
            </div>
          </div>
        </Reveal>

        {/* headline below the illustration */}
        <div className="text-center mt-10 max-w-2xl mx-auto">
          <Reveal delay={0.1}>
            <h1 className="font-display text-[2.6rem] leading-[1.12] md:text-6xl text-ivory">
              Some Moments
              <br />
              <span className="text-gradient-dream">Feel Like Magic</span>
            </h1>
          </Reveal>
          <Reveal delay={0.22}>
            <p className="mt-5 text-ivory-dim/85 text-[1.02rem] leading-relaxed">
              Connect with people who make life more beautiful.
            </p>
          </Reveal>
          <Reveal delay={0.32}>
            <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                to="/register"
                className="btn-gold rounded-full px-10 py-4 text-base font-semibold w-full sm:w-auto text-center"
              >
                Sign Up
              </Link>
              <Link
                to="/discover"
                className="rounded-full px-10 py-4 text-base font-medium w-full sm:w-auto text-center border border-rosegold/50 border-champagne/40 bg-white/[0.03] backdrop-blur-md text-ivory hover:border-rosegold transition-all hover:-translate-y-0.5"
              >
                Explore
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ================= SHORTCUTS ================= */}
      <section className="px-5 pb-4 max-w-6xl mx-auto">
        <Reveal>
          <div className="grid grid-cols-4 gap-2 max-w-md mx-auto">
            {SHORTCUTS.map((s) => (
              <Shortcut key={s.label} {...s} />
            ))}
          </div>
        </Reveal>
      </section>

      {/* ================= SUGGESTED ================= */}
      <section className="px-5 py-10 max-w-6xl mx-auto">
        <Reveal>
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-display text-3xl text-ivory">Suggested For You</h2>
            <Link to="/discover" className="text-sm text-rosegold hover:text-blush transition-colors">
              See All →
            </Link>
          </div>
        </Reveal>
        {loading ? (
          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 rounded-3xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {suggested.map((p, i) => (
              <Reveal key={p.id} delay={i * 0.1}>
                <SuggestedCard profile={p} />
              </Reveal>
            ))}
          </div>
        )}
      </section>

      {/* ================= CLOSING CTA ================= */}
      <section className="px-5 py-16 max-w-6xl mx-auto text-center">
        <Reveal>
          <div className="relative glass-strong rounded-[2rem] px-8 py-14 overflow-hidden">
            <DreamField count={16} seed={23} hearts sparkles={false} stars={false} className="opacity-60" />
            <p className="text-[0.7rem] uppercase tracking-[0.42em] text-rosegold/90">✦ Begin ✦</p>
            <h2 className="font-display text-4xl text-ivory mt-4">
              Your story starts <span className="text-gradient-dream">tonight</span>
            </h2>
            <p className="mt-4 text-ivory-dim/80 max-w-xl mx-auto">
              Join Datevra — verified profiles, thoughtful matching, and dates arranged like art.
            </p>
            <Link to="/register" className="btn-gold rounded-full px-10 py-4 text-base font-semibold inline-block mt-8">
              Sign Up Free
            </Link>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
