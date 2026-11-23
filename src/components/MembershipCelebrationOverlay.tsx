import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Crown, Sparkles } from "lucide-react";

export interface MembershipCelebrationPayload {
  /** Verified payment ID — guarantees celebration is bound to a verified server payment */
  paymentId: string;
  planName: string;
  planTagline?: string;
}

interface MembershipCelebrationOverlayProps {
  celebration: MembershipCelebrationPayload | null;
  /** Duration in ms before auto-completing (5000–6000ms per Requirement 7; default 5500ms) */
  durationMs?: number;
  onDismiss: () => void;
}

const SPARKLES = [
  { top: "14%", left: "16%", delay: "0s" },
  { top: "20%", left: "80%", delay: "0.7s" },
  { top: "36%", left: "10%", delay: "1.4s" },
  { top: "68%", left: "18%", delay: "0.4s" },
  { top: "74%", left: "84%", delay: "1.1s" },
  { top: "26%", left: "50%", delay: "0.9s" },
];

export default function MembershipCelebrationOverlay({
  celebration,
  durationMs = 5500,
  onDismiss,
}: MembershipCelebrationOverlayProps) {
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(() => {
      onDismiss();
    }, durationMs);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [celebration, durationMs, onDismiss]);

  return (
    <AnimatePresence>
      {celebration && (
        <motion.div
          key={`membership-celebration-${celebration.paymentId}`}
          role="dialog"
          aria-modal="true"
          aria-label={`Welcome to ${celebration.planName}`}
          className="fixed inset-0 z-[95] flex items-center justify-center px-4 sm:px-6 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: reducedMotion ? 0.15 : 0.4 } }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-midnight/90 backdrop-blur-2xl"
            onClick={onDismiss}
            aria-hidden
          />

          {/* Ambient Datevra Champagne / Rosegold / Burgundy Glow */}
          <div className="absolute -top-28 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-champagne/25 blur-[130px] pointer-events-none" />
          <div className="absolute bottom-0 left-1/4 h-80 w-80 rounded-full bg-burgundy/55 blur-[120px] pointer-events-none" />
          <div className="absolute top-1/3 right-[10%] h-64 w-64 rounded-full bg-rosegold/25 blur-[110px] pointer-events-none" />

          {/* Subtle champagne twinkles (disabled when prefers-reduced-motion) */}
          {!reducedMotion &&
            SPARKLES.map((s, i) => (
              <span
                key={i}
                aria-hidden
                className="absolute text-champagne/80 animate-twinkle text-base pointer-events-none"
                style={{ top: s.top, left: s.left, animationDelay: s.delay }}
              >
                ✦
              </span>
            ))}

          {/* Celebration Card */}
          <motion.div
            className="relative glass-strong glow-border rounded-[2rem] px-6 sm:px-10 pt-10 pb-8 max-w-md w-full text-center overflow-hidden"
            initial={reducedMotion ? { opacity: 0 } : { scale: 0.86, y: 28, opacity: 0 }}
            animate={reducedMotion ? { opacity: 1 } : { scale: 1, y: 0, opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { scale: 0.94, y: 16, opacity: 0 }}
            transition={
              reducedMotion
                ? { duration: 0.2 }
                : { type: "spring", damping: 22, stiffness: 210 }
            }
          >
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Close celebration"
              className="absolute top-4 right-4 h-10 w-10 rounded-full btn-ghost flex items-center justify-center text-mist hover:text-ivory text-sm"
            >
              ✕
            </button>

            <motion.div
              initial={reducedMotion ? { opacity: 1 } : { scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={reducedMotion ? { duration: 0.1 } : { delay: 0.15, type: "spring", stiffness: 220 }}
              className="mx-auto h-20 w-20 rounded-full bg-gradient-to-br from-champagne/30 via-rosegold/25 to-burgundy border border-champagne/60 flex items-center justify-center shadow-[0_0_48px_rgba(245,213,160,0.45)] mb-6"
            >
              <Crown className="w-9 h-9 text-champagne" />
            </motion.div>

            <p className="text-[0.72rem] uppercase tracking-[0.3em] text-champagne flex items-center justify-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Membership Activated
            </p>

            <h2 className="font-display text-3xl sm:text-4xl text-gradient-gold mt-3">
              Welcome to {celebration.planName}
            </h2>

            <p className="text-sm sm:text-base text-ivory-dim mt-3 leading-relaxed">
              Your verified Datevra membership is now active. Enjoy elevated visibility,
              priority curation, and unforgettable evenings ahead.
            </p>

            {celebration.planTagline && (
              <p className="text-xs text-mist mt-2 italic">{celebration.planTagline}</p>
            )}

            {/* Smooth 5.5s completion progress indicator */}
            <div className="mt-7 h-1 w-full rounded-full bg-white/10 overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-rosegold via-champagne to-champagne-light"
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: durationMs / 1000, ease: "linear" }}
              />
            </div>

            <div className="mt-6 pb-[env(safe-area-inset-bottom)]">
              <button
                type="button"
                onClick={onDismiss}
                className="btn-gold rounded-full px-8 py-3 min-h-[44px] text-sm font-semibold w-full"
              >
                Continue to Datevra
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
