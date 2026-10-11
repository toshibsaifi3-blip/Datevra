import { Link } from "react-router-dom";
import { Modal } from "./ui";

/**
 * LimitReachedModal — shown when a free user hits a daily cap.
 * Dream-themed, consistent with the rest of the app. Never blocks paid users
 * (callers only render it for free users who were denied).
 */
export function LimitReachedModal({
  open,
  onClose,
  kind,
}: {
  open: boolean;
  onClose: () => void;
  kind: "likes" | "interests";
}) {
  const isLike = kind === "likes";
  return (
    <Modal open={open} onClose={onClose} title="">
      <div className="text-center px-2 py-4">
        <div className="mx-auto w-16 h-16 rounded-full glass flex items-center justify-center text-3xl text-rosegold shadow-[0_0_28px_rgba(255,61,154,0.35)]">
          {isLike ? "♥" : "✦"}
        </div>
        <h3 className="font-display text-2xl text-ivory mt-5">
          {isLike ? "You've used all 20 likes" : "You've viewed 20 profiles"}
        </h3>
        <p className="mt-3 text-sm text-ivory-dim/85 leading-relaxed max-w-xs mx-auto">
          {isLike
            ? "Free accounts get 20 likes per day. Your likes reset at midnight IST — or upgrade for unlimited likes right now."
            : "Free accounts can open 20 full profiles per day. They reset at midnight IST — or upgrade to browse without limits."}
        </p>
        <div className="mt-6 flex flex-col gap-3">
          <Link
            to="/membership"
            onClick={onClose}
            className="btn-gold rounded-full px-8 py-3 text-sm font-semibold text-center"
          >
            Upgrade for unlimited
          </Link>
          <button
            onClick={onClose}
            className="text-sm text-mist hover:text-ivory transition-colors"
          >
            Maybe later
          </button>
        </div>
        <p className="mt-4 text-[0.7rem] text-mist/70">
          Limits reset daily at midnight IST.
        </p>
      </div>
    </Modal>
  );
}

/**
 * DailyLimitCounters — the visible "12/20 likes used · 8/20 interests used"
 * pill row. Rendered only for free users; paid members see nothing.
 */
export function DailyLimitCounters({
  likesUsed,
  interestsUsed,
  likeLimit,
  interestLimit,
  isPaid,
  compact = false,
}: {
  likesUsed: number;
  interestsUsed: number;
  likeLimit: number;
  interestLimit: number;
  isPaid: boolean;
  compact?: boolean;
}) {
  if (isPaid) return null;
  const pill = (label: string, used: number, limit: number, icon: string) => {
    const done = used >= limit;
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs backdrop-blur-md ${
          done
            ? "border-rosegold/60 bg-rosegold/15 text-blush"
            : "border-champagne/25 bg-white/[0.04] text-ivory-dim"
        }`}
      >
        <span className={done ? "text-rosegold" : "text-champagne"}>{icon}</span>
        {used}/{limit} {label} used
      </span>
    );
  };
  return (
    <div className={`flex flex-wrap items-center gap-2 ${compact ? "" : "mt-3"}`}>
      {pill("likes", likesUsed, likeLimit, "♥")}
      {pill("interests", interestsUsed, interestLimit, "✦")}
    </div>
  );
}
