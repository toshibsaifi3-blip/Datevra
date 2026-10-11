import { useMemo } from "react";

/**
 * DreamField — a reusable ambient particle layer of floating hearts,
 * drifting sparkles and twinkling stars for the Dreamy Fantasy theme.
 *
 * Deterministic (seeded) so particles don't reshuffle on re-render.
 * Render it inside a `relative overflow-hidden` container; it is
 * absolutely positioned, pointer-transparent and screen-reader silent.
 */

type ParticleKind = "heart" | "sparkle" | "star";

interface Particle {
  kind: ParticleKind;
  left: number; // % across
  top: number; // % down
  size: number; // px / font-size
  duration: number; // s
  delay: number; // s (negative to start mid-flight)
  color: string;
  opacity: number;
}

export interface DreamFieldProps {
  /** Total particles to render. Capped at 60 for perf. Default 24. */
  count?: number;
  /** Seed for deterministic placement. */
  seed?: number;
  className?: string;
  hearts?: boolean;
  sparkles?: boolean;
  stars?: boolean;
}

const COLORS = ["#FF3D9A", "#FFB5D5", "#C5A4FF", "#438DFF"];

function mulberry32(seed: number) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default function DreamField({
  count = 24,
  seed = 7,
  className = "",
  hearts = true,
  sparkles = true,
  stars = true,
}: DreamFieldProps) {
  const particles = useMemo<Particle[]>(() => {
    const rand = mulberry32(seed);
    const pool: ParticleKind[] = [];
    if (hearts) pool.push("heart");
    if (sparkles) pool.push("sparkle");
    if (stars) pool.push("star");
    const kinds = pool.length ? pool : (["star"] as ParticleKind[]);

    const n = Math.max(0, Math.min(60, Math.round(count)));
    return Array.from({ length: n }, () => {
      const kind = kinds[Math.floor(rand() * kinds.length)];
      return {
        kind,
        left: rand() * 100,
        top: 8 + rand() * 88,
        size:
          kind === "heart"
            ? 12 + rand() * 18
            : kind === "sparkle"
              ? 10 + rand() * 16
              : 3 + rand() * 4,
        duration:
          kind === "heart"
            ? 9 + rand() * 6
            : kind === "sparkle"
              ? 13 + rand() * 8
              : 2.6 + rand() * 2.4,
        delay: -(rand() * 16),
        color: COLORS[Math.floor(rand() * COLORS.length)],
        opacity: 0.35 + rand() * 0.5,
      };
    });
  }, [count, seed, hearts, sparkles, stars]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {particles.map((p, i) =>
        p.kind === "star" ? (
          <span
            key={i}
            className="animate-twinkle absolute rounded-full"
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              width: p.size,
              height: p.size,
              backgroundColor: p.color,
              opacity: p.opacity,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              boxShadow: `0 0 ${p.size * 2}px ${p.color}`,
            }}
          />
        ) : (
          <span
            key={i}
            className={`absolute leading-none select-none ${
              p.kind === "heart" ? "animate-float-heart" : "animate-sparkle-drift"
            }`}
            style={{
              left: `${p.left}%`,
              top: `${p.top}%`,
              fontSize: p.size,
              color: p.color,
              opacity: p.opacity,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              textShadow: `0 0 ${p.size}px ${p.color}`,
            }}
          >
            {p.kind === "heart" ? "♥" : "✦"}
          </span>
        ),
      )}
    </div>
  );
}
