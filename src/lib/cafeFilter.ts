import type { Cafe } from "./types";
import { SEED_CAFES } from "../data/seed";

/**
 * Confirmed demo/sample café IDs from initial development / seed catalog.
 * These must never be shown on the live customer-facing website or admin tables.
 */
export const DEMO_CAFE_IDS = new Set<string>([
  "c-roastery-mum",   // Kala Ghoda Roastery
  "c-lodhi-del",       // Lodhi Art House
  "c-thirdwave-blr",   // Indiranagar Brew Room
  "c-suzette-pune",    // Maison Suzette
  "c-tapri-jpr",       // Johari Courtyard
  "c-aerocity-hyd",    // Deccan Table
]);

/**
 * Confirmed demo café name keywords (substring check, case-insensitive).
 */
export const DEMO_NAME_KEYWORDS = [
  "kala ghoda",
  "roastery",
  "lodhi art",
  "indiranagar brew",
  "maison suzette",
  "suzette",
  "johari courtyard",
  "deccan table",
];

/**
 * Confirmed demo café address / location keywords (case-insensitive).
 */
export const DEMO_LOCATION_KEYWORDS = [
  "kala ghoda",
  "lodhi colony market",
  "100 feet road, indiranagar",
  "koregaon park",
  "johari bazaar",
  "jubilee hills",
];

/**
 * Unconditional whitelist identifiers for the three verified Delhi partner/listed cafés.
 */
export const GENUINE_DELHI_CAFE_IDS = new Set<string>([
  "c-hot-stag-del",
  "c-karmala-del",
  "c-yumm-club-del",
]);

/**
 * Returns true if a café is confirmed to be demo/sample data.
 * Always returns false for the 3 genuine Delhi partner cafés.
 */
export function isDemoCafe(
  cafe: { id?: string; name?: string; address?: string; city?: string } | null | undefined,
): boolean {
  if (!cafe) return false;

  const id = (cafe.id || "").toLowerCase().trim();
  const name = (cafe.name || "").toLowerCase().trim();
  const address = (cafe.address || "").toLowerCase().trim();

  // 1. Whitelist exemption: NEVER flag the 3 genuine Delhi partner cafés as demo
  if (
    GENUINE_DELHI_CAFE_IDS.has(id) ||
    name.includes("hot stag") ||
    name.includes("karmala") ||
    name.includes("karma la") ||
    name.includes("yumm club") ||
    address.includes("dilshad garden") ||
    address.includes("majnu ka tilla") ||
    address.includes("new aruna nagar") ||
    address.includes("preet vihar")
  ) {
    return false;
  }

  // 2. Check exact known demo IDs
  if (DEMO_CAFE_IDS.has(id)) return true;

  // 3. Check demo ID substrings
  if (
    id.includes("roastery-mum") ||
    id.includes("lodhi-del") ||
    id.includes("thirdwave-blr") ||
    id.includes("suzette-pune") ||
    id.includes("tapri-jpr") ||
    id.includes("aerocity-hyd") ||
    id.includes("deccan") ||
    id.includes("suzette") ||
    id.includes("kala-ghoda")
  ) {
    return true;
  }

  // 4. Check name substrings
  for (const kw of DEMO_NAME_KEYWORDS) {
    if (name.includes(kw)) return true;
  }

  // 5. Check address / location substrings
  for (const loc of DEMO_LOCATION_KEYWORDS) {
    if (address.includes(loc)) return true;
  }

  return false;
}

/**
 * Sanitizes an array of cafés:
 * 1. Strictly filters out all demo/sample cafés using exhaustive ID, name, and location matching.
 * 2. Ensures the 3 genuine Delhi cafés (Café Hot Stag, KARMALA CAFE & RESTAURANT,
 *    The Yumm Club) are preserved with verified addresses and photographs without duplicates.
 * 3. Incorporates any genuine cafés created by administrators in Supabase or local storage.
 * 4. Ensures the final returned array contains 0 demo cafés under all circumstances.
 */
export function sanitizeCafeList(cafes: Cafe[]): Cafe[] {
  const genuineFromSource = (cafes || []).filter((c) => !isDemoCafe(c));
  const cafeMap = new Map<string, Cafe>();

  // Baseline: ensure the 3 genuine Delhi seed cafes exist with verified assets
  for (const sc of SEED_CAFES) {
    if (!isDemoCafe(sc)) {
      cafeMap.set(sc.id, sc);
    }
  }

  // Merge genuine cafes from source (Supabase / local DB)
  for (const c of genuineFromSource) {
    if (isDemoCafe(c)) continue;
    const existing = cafeMap.get(c.id);
    if (existing) {
      cafeMap.set(c.id, {
        ...existing,
        ...c,
        image: c.image || existing.image,
        images: c.images && c.images.length > 0 ? c.images : existing.images,
        address: c.address || existing.address,
        experiences: c.experiences && c.experiences.length > 0 ? c.experiences : existing.experiences,
      });
    } else {
      cafeMap.set(c.id, c);
    }
  }

  return Array.from(cafeMap.values()).filter((c) => !isDemoCafe(c));
}
