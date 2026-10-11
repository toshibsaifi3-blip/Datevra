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

/** Simple client-side id for entities created from admin forms (the backend generates its own ids where applicable). */
export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

export const thCls =
  "text-left text-[0.7rem] uppercase tracking-[0.2em] text-mist px-4 py-3 whitespace-nowrap";
export const tdCls = "px-4 py-3 align-top";
export const rowCls = "border-t border-white/5 hover:bg-white/[0.03] transition-colors";
