/* Shared helpers for admin pages. */

export function inr(n: number): string {
  return `₹${n.toLocaleString("en-IN")}`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDay(iso: string | null): string {
  if (!iso) return "Lifetime";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Formats a date or timestamp to YYYY-MM-DD in Asia/Kolkata (IST).
 * Guarantees accurate calendar date calculation across midnight IST.
 */
export function toIstDateString(dateInput: string | number | Date | null | undefined): string {
  if (!dateInput) return "";
  const d = typeof dateInput === "object" ? dateInput : new Date(dateInput);
  if (isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Returns today's calendar date in Asia/Kolkata (IST) as YYYY-MM-DD.
 */
export function getIstToday(): string {
  return toIstDateString(new Date());
}

/** Simple client-side id for entities created from admin forms (the backend generates its own ids where applicable). */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export const thCls =
  "text-left text-[0.7rem] uppercase tracking-[0.2em] text-mist px-4 py-3 whitespace-nowrap";
export const tdCls = "px-4 py-3 align-top";
export const rowCls = "border-t border-white/5 hover:bg-white/[0.03] transition-colors";

export function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDay(iso);
}
