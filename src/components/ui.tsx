import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { PlanId } from "../lib/types";

/* ============================== Logo ============================== */

export function Logo({ size = 38, withWordmark = true }: { size?: number; withWordmark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none">
      <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
        <defs>
          <linearGradient id="dv-gold" x1="0" y1="0" x2="48" y2="48">
            <stop offset="0%" stopColor="#f0dcae" />
            <stop offset="55%" stopColor="#e2a183" />
            <stop offset="100%" stopColor="#c97e5f" />
          </linearGradient>
          <radialGradient id="dv-glow" cx="50%" cy="42%" r="60%">
            <stop offset="0%" stopColor="#6e1b2e" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#2a0e18" stopOpacity="0.9" />
          </radialGradient>
        </defs>
        <circle cx="24" cy="24" r="22" fill="url(#dv-glow)" stroke="url(#dv-gold)" strokeWidth="1.6" />
        <circle cx="24" cy="24" r="18.5" stroke="url(#dv-gold)" strokeWidth="0.7" opacity="0.5" />
        {/* Interlocking D + V monogram */}
        <path
          d="M15 14h6.2c5.4 0 9.3 4.4 9.3 10s-3.9 10-9.3 10H15V14z"
          stroke="url(#dv-gold)"
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
        <path
          d="M27 15l4.6 9.4L36.5 15"
          stroke="url(#dv-gold)"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="31.6" cy="31.5" r="1.7" fill="url(#dv-gold)" />
      </svg>
      {withWordmark && (
        <span className="font-display text-[1.55rem] leading-none tracking-[0.22em] text-gradient-gold font-semibold">
          DATEVRA
        </span>
      )}
    </span>
  );
}

/* ============================== Ambient ============================== */

export function PetalField({ count = 14 }: { count?: number }) {
  const petals = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: (i * 97) % 100,
        delay: -((i * 37) % 140) / 10,
        duration: 11 + ((i * 53) % 70) / 10,
        size: 7 + ((i * 29) % 8),
        hue: i % 3,
      })),
    [count],
  );
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      {petals.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 animate-petal-fall"
          style={{
            left: `${p.left}%`,
            animationDelay: `${p.delay}s`,
            animationDuration: `${p.duration}s`,
          }}
        >
          <svg
            width={p.size}
            height={p.size}
            viewBox="0 0 10 10"
            style={{ opacity: 0.5 }}
            aria-hidden
          >
            <path
              d="M5 0C7.5 2.5 8.5 6 5 10 1.5 6 2.5 2.5 5 0z"
              fill={p.hue === 0 ? "#e2a183" : p.hue === 1 ? "#8f2c42" : "#f0dcae"}
            />
          </svg>
        </span>
      ))}
    </div>
  );
}

export function GlowOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
      <div className="absolute -top-32 right-[-10%] h-[480px] w-[480px] rounded-full bg-burgundy/25 blur-[130px]" />
      <div className="absolute bottom-[-15%] left-[-8%] h-[420px] w-[420px] rounded-full bg-burgundy-deep/40 blur-[120px]" />
      <div className="absolute top-[38%] left-[55%] h-[300px] w-[300px] rounded-full bg-rosegold/8 blur-[110px]" />
    </div>
  );
}

/* ============================== Typography ============================== */

export function SectionHead({
  kicker,
  title,
  sub,
  align = "center",
}: {
  kicker: string;
  title: string;
  sub?: string;
  align?: "center" | "left";
}) {
  const alignCls = align === "center" ? "text-center mx-auto" : "text-left";
  return (
    <motion.div
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={`max-w-2xl ${alignCls}`}
    >
      <p className="text-[0.72rem] uppercase tracking-[0.32em] text-rosegold/90">{kicker}</p>
      <h2 className="font-display text-4xl md:text-5xl mt-3 text-ivory leading-tight">{title}</h2>
      {sub && <p className="mt-4 text-ivory-dim/90 leading-relaxed">{sub}</p>}
      <div className={`ornament-divider mt-6 ${align === "center" ? "max-w-xs mx-auto" : "max-w-xs"}`}>
        <span className="text-lg">✦</span>
      </div>
    </motion.div>
  );
}

export function PageHero({
  kicker,
  title,
  sub,
  children,
}: {
  kicker: string;
  title: string;
  sub?: string;
  children?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-burgundy-deep/50 via-transparent to-transparent" />
      <div className="relative max-w-6xl mx-auto px-5 pt-28 pb-14 md:pt-36 md:pb-20 text-center">
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-[0.72rem] uppercase tracking-[0.32em] text-rosegold/90"
        >
          {kicker}
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          className="font-display text-5xl md:text-6xl mt-4 text-ivory leading-tight"
        >
          {title}
        </motion.h1>
        {sub && (
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.22, duration: 0.7 }}
            className="mt-5 max-w-2xl mx-auto text-ivory-dim/90 leading-relaxed"
          >
            {sub}
          </motion.p>
        )}
        {children && <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }}>{children}</motion.div>}
      </div>
    </div>
  );
}

/* ============================== Primitives ============================== */

export function Avatar({
  name,
  size = 64,
  ring = false,
  photo,
}: {
  name: string;
  size?: number;
  ring?: boolean;
  /** Optional profile photo URL — falls back to initials when absent or broken. */
  photo?: string;
}) {
  const [imgOk, setImgOk] = useState(true);
  useEffect(() => setImgOk(true), [photo]);
  const initials = name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
  const hues = [
    "from-burgundy to-burgundy-deep",
    "from-[#7a3b2e] to-[#3d1a12]",
    "from-[#5c2540] to-[#2c1020]",
    "from-[#6e4a1b] to-[#3a2410]",
  ];
  const hue = useMemo(() => {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 997;
    return hues[h % hues.length];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  return (
    <div
      className={`relative shrink-0 rounded-full bg-gradient-to-br ${hue} flex items-center justify-center font-display font-semibold text-champagne ${
        ring ? "ring-2 ring-rosegold/60 ring-offset-2 ring-offset-midnight" : ""
      }`}
      style={{ width: size, height: size, fontSize: size * 0.38 }}
      aria-hidden
    >
      {photo && imgOk ? (
        <img
          src={photo}
          alt=""
          className="h-full w-full rounded-full object-cover"
          loading="lazy"
          onError={() => setImgOk(false)}
        />
      ) : (
        initials
      )}
      <span className="absolute inset-0 rounded-full border border-white/10" />
    </div>
  );
}

export function Badge({
  children,
  tone = "gold",
}: {
  children: ReactNode;
  tone?: "gold" | "rose" | "muted" | "green";
}) {
  const tones: Record<string, string> = {
    gold: "border-champagne/40 text-champagne bg-champagne/10",
    rose: "border-rosegold/40 text-rosegold bg-rosegold/10",
    muted: "border-white/15 text-ivory-dim bg-white/5",
    green: "border-emerald-300/40 text-emerald-200 bg-emerald-400/10",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[0.72rem] tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function PlanBadge({ plan }: { plan: PlanId | null }) {
  if (!plan) return <Badge tone="muted">Free</Badge>;
  const labels: Record<PlanId, string> = {
    connect: "Select",
    plus: "Signature",
    elite: "Privé",
  };
  return <Badge tone="gold">✦ {labels[plan]}</Badge>;
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass rounded-3xl px-8 py-14 text-center max-w-md mx-auto"
    >
      <div className="mx-auto mb-5 h-16 w-16 rounded-full bg-gradient-to-br from-burgundy to-burgundy-deep flex items-center justify-center border border-rosegold/30">
        <span className="font-display text-3xl text-champagne">✦</span>
      </div>
      <h3 className="font-display text-2xl text-ivory">{title}</h3>
      <p className="mt-2 text-sm text-ivory-dim/85 leading-relaxed">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </motion.div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} />;
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="glass rounded-2xl p-5 card-hover">
      <p className="text-[0.7rem] uppercase tracking-[0.24em] text-mist">{label}</p>
      <p className="font-display text-4xl mt-2 text-gradient-gold font-semibold">{value}</p>
      {sub && <p className="text-xs text-ivory-dim/80 mt-1">{sub}</p>}
    </div>
  );
}

/* ============================== Modal ============================== */

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    if (open) window.addEventListener("keydown", fn);
    return () => window.removeEventListener("keydown", fn);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.94, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 12 }}
            transition={{ type: "spring", damping: 26, stiffness: 300 }}
            className={`glass-strong rounded-3xl p-6 md:p-8 w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[90vh] overflow-y-auto`}
            onClick={(e) => e.stopPropagation()}
          >
            {title && (
              <div className="flex items-start justify-between mb-5">
                <h3 className="font-display text-2xl text-ivory">{title}</h3>
                <button
                  onClick={onClose}
                  className="text-mist hover:text-ivory transition-colors text-xl leading-none"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            )}
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ============================== Toast ============================== */

interface Toast {
  id: number;
  message: string;
  tone: "gold" | "rose";
}

const ToastContext = createContext<{ toast: (message: string, tone?: Toast["tone"]) => void }>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const toast = useCallback((message: string, tone: Toast["tone"] = "gold") => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, message, tone }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex flex-col items-center gap-2 pointer-events-none px-4 w-full max-w-md">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 24, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.96 }}
              className={`glass-strong rounded-full px-5 py-3 text-sm border ${
                t.tone === "gold" ? "border-rosegold/40 text-ivory" : "border-burgundy-soft/60 text-ivory"
              } shadow-2xl`}
            >
              {t.message}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

/* ============================== Form bits ============================== */

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[0.72rem] uppercase tracking-[0.2em] text-mist">{label}</span>
      <div className="mt-1.5">{children}</div>
      {hint && <span className="block mt-1 text-xs text-mist/80">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "input-lux w-full rounded-xl px-4 py-3 text-[0.95rem]";

export function Reveal({
  children,
  delay = 0,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
