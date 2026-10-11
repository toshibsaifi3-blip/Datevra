import { AnimatePresence, motion } from "framer-motion";
import { Avatar } from "./ui";

export interface MatchCelebration {
  /** Display name of the person they matched with */
  name: string;
  /** Real photo URL of the matched person (from their profile) */
  matchPhoto?: string;
  /** Real photo URL of the current user */
  mePhoto?: string;
  /** Conversation id for this match, if one exists yet */
  convId: string | null;
}

interface MatchOverlayProps {
  /** Set only for a verified REAL mutual match — never for a one-sided like */
  celebration: MatchCelebration | null;
  onClose: () => void;
  onChat: (convId: string | null) => void;
}

const FLOATING_HEARTS = [
  { left: "8%", delay: "0s", size: "text-2xl", dur: "9s" },
  { left: "18%", delay: "2.4s", size: "text-lg", dur: "12s" },
  { left: "78%", delay: "1.1s", size: "text-xl", dur: "10s" },
  { left: "88%", delay: "3.2s", size: "text-3xl", dur: "13s" },
  { left: "32%", delay: "4s", size: "text-sm", dur: "11s" },
  { left: "65%", delay: "0.6s", size: "text-sm", dur: "9.5s" },
];

export default function MatchOverlay({ celebration, onClose, onChat }: MatchOverlayProps) {
  return (
    <AnimatePresence>
      {celebration && (
        <motion.div
          key="match-overlay"
          className="fixed inset-0 z-[90] flex items-center justify-center px-6 overflow-hidden"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35, ease: "easeInOut" } }}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-midnight/85 backdrop-blur-xl"
            onClick={onClose}
            aria-hidden
          />
          {/* Dreamy ambience */}
          <div className="absolute -top-32 left-1/2 -translate-x-1/2 h-96 w-96 rounded-full bg-burgundy/50 blur-[120px] animate-glow-pulse pointer-events-none" />
          <div className="absolute bottom-0 left-1/4 h-72 w-72 rounded-full bg-rosegold/25 blur-[110px] pointer-events-none" />
          <div className="absolute top-1/3 right-[8%] h-56 w-56 rounded-full bg-champagne/20 blur-[100px] pointer-events-none" />
          {/* Floating hearts */}
          {FLOATING_HEARTS.map((h, i) => (
            <span
              key={i}
              aria-hidden
              className={`absolute bottom-[-4rem] text-rosegold/60 animate-float-heart ${h.size}`}
              style={{ left: h.left, animationDelay: h.delay, animationDuration: h.dur }}
            >
              ♥
            </span>
          ))}
          {/* Twinkles */}
          {[{ t: "12%", l: "20%", d: "0s" }, { t: "22%", l: "75%", d: "1.2s" }, { t: "68%", l: "14%", d: "2.1s" }, { t: "75%", l: "82%", d: "0.7s" }].map(
            (s, i) => (
              <span
                key={`tw-${i}`}
                aria-hidden
                className="absolute text-champagne animate-twinkle text-sm"
                style={{ top: s.t, left: s.l, animationDelay: s.d }}
              >
                ✦
              </span>
            ),
          )}

          {/* Card */}
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="It's a match"
            className="relative glass-strong glow-border rounded-[2rem] px-8 pt-10 pb-8 max-w-sm w-full text-center overflow-hidden"
            initial={{ scale: 0.82, y: 40, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.9, y: 24, opacity: 0, transition: { duration: 0.3, ease: "easeIn" } }}
            transition={{ type: "spring", damping: 22, stiffness: 220 }}
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-4 right-4 h-9 w-9 rounded-full btn-ghost flex items-center justify-center text-mist hover:text-ivory text-sm"
            >
              ✕
            </button>

            {/* Converging profiles */}
            <div className="relative flex items-center justify-center h-36 mb-6">
              <motion.div
                initial={{ x: -110, opacity: 0, scale: 0.7 }}
                animate={{ x: -46, opacity: 1, scale: 1 }}
                transition={{ type: "spring", damping: 16, stiffness: 160, delay: 0.15 }}
                className="absolute animate-match-ring rounded-full"
              >
                <Avatar name="You" photo={celebration.mePhoto} size={104} ring />
              </motion.div>
              <motion.div
                initial={{ x: 110, opacity: 0, scale: 0.7 }}
                animate={{ x: 46, opacity: 1, scale: 1 }}
                transition={{ type: "spring", damping: 16, stiffness: 160, delay: 0.15 }}
                className="absolute animate-match-ring rounded-full"
              >
                <Avatar name={celebration.name} photo={celebration.matchPhoto} size={104} ring />
              </motion.div>
              <motion.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [0, 1.25, 1], opacity: 1 }}
                transition={{ delay: 0.55, duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                className="absolute z-10 h-14 w-14 rounded-full bg-gradient-to-br from-rosegold to-burgundy border border-champagne/60 flex items-center justify-center shadow-[0_0_36px_rgba(255,61,154,0.6)]"
              >
                <span className="text-2xl text-ivory animate-heartbeat">♥</span>
              </motion.div>
            </div>

            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="font-display text-4xl text-gradient-dream tracking-wide"
            >
              IT&apos;S A MATCH!
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-ivory-dim mt-3"
            >
              You and <span className="text-champagne font-medium">{celebration.name}</span> liked
              each other.
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.75 }}
              className="text-xs text-mist mt-2"
            >
              Say hello — be kind, be yourself. ✨
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.85 }}
              className="flex flex-col gap-3 mt-8 pb-[env(safe-area-inset-bottom)]"
            >
              <button
                onClick={() => onChat(celebration.convId)}
                className="btn-gold rounded-full px-6 py-3.5 text-sm font-semibold w-full"
              >
                💬 Send a Message
              </button>
              <button
                onClick={onClose}
                className="btn-ghost rounded-full px-6 py-3 text-sm w-full"
              >
                Keep Discovering
              </button>
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
