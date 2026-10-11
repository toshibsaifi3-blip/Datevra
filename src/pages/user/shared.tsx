import { useEffect, useState } from "react";
import { useBackend, type Backend, type BackendEvent } from "../../lib/data";
import type { ApplicationStatus, Match } from "../../lib/types";

/**
 * Shared helpers for the member (logged-in user) pages.
 * Not a route — imported by the pages in this directory.
 */

/** Force a re-render whenever any of the named backend events fire. Returns a tick counter. */
export function useDbRefresh(...events: BackendEvent[]): number {
  const db = useBackend();
  const [tick, setTick] = useState(0);
  const key = events.join(",");
  useEffect(() => {
    const list = key ? (key.split(",") as BackendEvent[]) : [];
    const offs = list.map((e) => db.subscribe(e, () => setTick((t) => t + 1)));
    return () => {
      offs.forEach((off) => off());
    };
  }, [db, key]);
  return tick;
}

export function timeAgo(iso: string): string {
  const s = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000),
  );
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export const inr = (n: number): string => `₹${n.toLocaleString("en-IN")}`;

/** Ids the discovery deck must skip: self, liked, passed, and anyone blocked either way. */
export async function excludedIdsFor(db: Backend, meId: string): Promise<Set<string>> {
  const ex = new Set<string>([meId]);
  const [sent, profiles] = await Promise.all([
    db.likesSent(meId),
    db.listProfiles(),
  ]);
  for (const l of sent) ex.add(l.toUserId);
  await Promise.all(
    profiles.map(async (p) => {
      const [passed, blockedA, blockedB] = await Promise.all([
        db.hasPassed(meId, p.id),
        db.isBlocked(meId, p.id),
        db.isBlocked(p.id, meId),
      ]);
      if (passed || blockedA || blockedB) ex.add(p.id);
    }),
  );
  return ex;
}

export function partnerOf(match: Match, meId: string): string {
  return match.userA === meId ? match.userB : match.userA;
}

export function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

export const APP_STATUS_META: Record<
  ApplicationStatus,
  { label: string; tone: "gold" | "rose" | "muted" | "green" }
> = {
  submitted: { label: "Submitted", tone: "muted" },
  under_review: { label: "Under review", tone: "gold" },
  eligible: { label: "Eligible", tone: "green" },
  selected: { label: "Selected", tone: "green" },
  confirmed: { label: "Confirmed", tone: "green" },
  completed: { label: "Completed", tone: "gold" },
  declined: { label: "Declined", tone: "rose" },
  cancelled: { label: "Cancelled", tone: "rose" },
};

export const APP_TIMELINE: ApplicationStatus[] = [
  "submitted",
  "under_review",
  "eligible",
  "selected",
  "confirmed",
  "completed",
];

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Membership expiry display — NULL means a lifetime / no-expiry membership. */
export function fmtExpiry(expiresAt: string | null | undefined): string {
  return expiresAt ? fmtDate(expiresAt) : "Lifetime";
}
