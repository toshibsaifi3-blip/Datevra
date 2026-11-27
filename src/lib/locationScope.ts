/**
 * Explicit Global Location Scope helpers for Datevra.
 *
 * Keeps "Worldwide" strictly distinct from ordinary city records:
 * - In app state (`UserProfile`), Worldwide is represented as:
 *     `{ locationScope: "worldwide", city: "" }`
 * - When persisted to databases that do not yet have a dedicated
 *   `location_scope` column (where `profiles.city` is `text NOT NULL`),
 *   we store the explicit non-city token `WORLDWIDE_SCOPE_TOKEN` and
 *   parse it immediately back into `{ locationScope: "worldwide", city: "" }`
 *   in `mapProfile()`.
 * - Never treats "Worldwide" as a fake city or country record.
 */

export type LocationScope = "city" | "worldwide";

/**
 * Explicit canonical storage sentinel used ONLY as a schema-compatible
 * fallback when the optional `profiles.location_scope` column has not yet
 * been applied in PostgreSQL.
 */
export const WORLDWIDE_SCOPE_TOKEN = "__WORLDWIDE__" as const;

export const WORLDWIDE_DISPLAY_LABEL = "Worldwide" as const;

export interface LocationScopedRecord {
  readonly locationScope?: LocationScope | null;
  readonly city?: string | null;
}

/**
 * Returns true if a raw persisted string represents the explicit global
 * Worldwide scope token (or legacy "Worldwide" value).
 */
export function isWorldwideToken(raw: string | null | undefined): boolean {
  const clean = (raw ?? "").trim().toLowerCase();
  return clean === WORLDWIDE_SCOPE_TOKEN.toLowerCase() || clean === "worldwide";
}

/**
 * Returns true if a user profile (or partial profile record) has Worldwide
 * global scope enabled.
 */
export function isWorldwideProfile(
  profile: LocationScopedRecord | null | undefined,
): boolean {
  if (!profile) return false;
  if (profile.locationScope === "worldwide") return true;
  if (profile.locationScope === "city") return false;
  return isWorldwideToken(profile.city);
}

/**
 * Formats a member's location for user-facing display.
 * - Worldwide scope -> "Worldwide"
 * - Specific city   -> trimmed city name (or fallback)
 */
export function formatProfileLocation(
  profile: LocationScopedRecord | null | undefined,
  fallback = "",
): string {
  if (!profile) return fallback;
  if (isWorldwideProfile(profile)) return WORLDWIDE_DISPLAY_LABEL;
  const trimmed = (profile.city ?? "").trim();
  return trimmed || fallback;
}

/**
 * Returns true when the member has configured either Worldwide scope or a
 * non-empty city/town location.
 */
export function hasConfiguredLocation(
  profile: LocationScopedRecord | null | undefined,
): boolean {
  if (!profile) return false;
  if (isWorldwideProfile(profile)) return true;
  return Boolean((profile.city ?? "").trim());
}

/**
 * Normalizes a `(city, locationScope)` pair so Worldwide is ALWAYS stored as
 * `{ locationScope: "worldwide", city: "" }` in application domain state.
 */
export function normalizeLocationState(
  city: string | null | undefined,
  locationScope?: LocationScope | null,
): { city: string; locationScope: LocationScope } {
  if (locationScope === "worldwide" || (locationScope !== "city" && isWorldwideToken(city))) {
    return { locationScope: "worldwide", city: "" };
  }
  const cleaned = (city ?? "").trim();
  if (isWorldwideToken(cleaned)) {
    return { locationScope: "worldwide", city: "" };
  }
  return { locationScope: "city", city: cleaned };
}
