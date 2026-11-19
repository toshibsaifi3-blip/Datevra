import { Link } from "react-router-dom";
import { Modal } from "./ui";
import {
  COMPATIBILITY_THRESHOLD_MESSAGE,
  MIN_COMPATIBILITY_SCORE,
} from "../lib/compat";

/**
 * CompatibilityBlockedModal — displayed when a mutual like is attempted
 * with someone whose compatibility score is below MIN_COMPATIBILITY_SCORE (75%).
 * Styled to match Datevra's luxury purple glassmorphic design.
 */
export function CompatibilityBlockedModal({
  open,
  onClose,
  name,
  score,
  showDiscoverLink = false,
}: {
  open: boolean;
  onClose: () => void;
  name?: string;
  score?: number | null;
  showDiscoverLink?: boolean;
}) {
  const hasValidScore = typeof score === "number" && Number.isFinite(score);
  const clampedScore = hasValidScore ? Math.max(0, Math.min(100, Math.round(score))) : null;

  return (
    <Modal open={open} onClose={onClose} title="">
      <div className="text-center px-2 py-4">
        <div className="mx-auto w-16 h-16 rounded-full glass flex items-center justify-center text-3xl text-champagne shadow-[0_0_28px_rgba(197,164,255,0.35)] border border-champagne/30">
          ✦
        </div>

        <h3 className="font-display text-2xl text-ivory mt-5">
          Not quite a match yet!
        </h3>

        {clampedScore !== null && (
          <div className="mt-4 mx-auto max-w-xs rounded-2xl border border-champagne/25 bg-white/[0.04] px-4 py-3 text-left">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-mist">
                {name ? `Compatibility with ${name}` : "Compatibility score"}
              </span>
              <span className="text-rosegold font-semibold">
                {clampedScore}% / {MIN_COMPATIBILITY_SCORE}% min
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-rosegold/80 to-champagne/80"
                style={{ width: `${clampedScore}%` }}
              />
              <div
                aria-hidden="true"
                className="absolute inset-y-0 w-0.5 bg-champagne shadow-[0_0_8px_rgba(197,164,255,0.9)]"
                style={{ left: `${MIN_COMPATIBILITY_SCORE}%` }}
              />
            </div>
          </div>
        )}

        <p className="mt-4 text-sm text-ivory-dim/90 leading-relaxed max-w-xs mx-auto">
          {COMPATIBILITY_THRESHOLD_MESSAGE}
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {showDiscoverLink ? (
            <>
              <Link
                to="/discover"
                onClick={onClose}
                className="btn-gold rounded-full px-8 py-3 min-h-[44px] text-sm font-semibold text-center inline-flex items-center justify-center"
              >
                Keep discovering
              </Link>
              <button
                type="button"
                onClick={onClose}
                className="text-sm text-mist hover:text-ivory transition-colors min-h-[40px]"
              >
                Close
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="btn-gold rounded-full px-8 py-3 min-h-[44px] text-sm font-semibold text-center"
            >
              Keep discovering
            </button>
          )}
        </div>

        <p className="mt-4 text-[0.7rem] text-mist/75">
          Only pairs with {MIN_COMPATIBILITY_SCORE}%+ compatibility can form a match.
        </p>
      </div>
    </Modal>
  );
}
