/**
 * Static, manually researched public business metadata for Datevra's
 * 3 genuine Delhi partner/listed cafés.
 *
 * STRICT RULES:
 * - Static data only — NO Google Places API, NO external API keys, NO runtime scraping.
 * - Covers ONLY the 3 genuine Datevra Delhi cafés already in the application.
 * - Static Google ratings are stored as exact numerical values supplied by the client.
 * - Review counts are NOT fabricated (kept null unless separately supplied).
 */

export interface VerifiedCafeResearch {
  readonly id: string;
  readonly name: string;
  readonly verifiedAddress: string;
  readonly googleRating: number | null;
  readonly googleReviewCount: number | null;
  readonly ratingVerified: boolean;
  readonly ratingStatusLabel: string;
  readonly ratingSource: string;
  readonly openingHoursSummary: string;
  readonly weeklyHours: Readonly<Record<string, string>> | null;
  readonly hoursVerified: boolean;
  readonly hoursStatusLabel: string;
  readonly priceVerified: boolean;
  readonly priceStatusLabel: string;
  readonly infoSource: string;
  readonly infoCheckedAt: string;
}

const DAILY = (hours: string): Readonly<Record<string, string>> => ({
  Monday: hours,
  Tuesday: hours,
  Wednesday: hours,
  Thursday: hours,
  Friday: hours,
  Saturday: hours,
  Sunday: hours,
});

export const VERIFIED_CAFE_RESEARCH: Readonly<Record<string, VerifiedCafeResearch>> = {
  "c-hot-stag-del": {
    id: "c-hot-stag-del",
    name: "Café Hot Stag",
    verifiedAddress: "1st Floor, Opp. Deer Park, Ayyappa Temple Road, Dilshad Garden, Delhi-110095",
    googleRating: 4.8,
    googleReviewCount: null,
    ratingVerified: true,
    ratingStatusLabel: "4.8 / 5 Google",
    ratingSource: "Google (supplied by client)",
    openingHoursSummary: "12:00 PM – 11:00 PM (Daily)",
    weeklyHours: DAILY("12:00 PM – 11:00 PM"),
    hoursVerified: true,
    hoursStatusLabel: "Verified via public dining listings",
    priceVerified: false,
    priceStatusLabel: "Price information unavailable",
    infoSource: "Google (rating supplied by client); Magicpin & Swiggy Dineout public listings (hours)",
    infoCheckedAt: "2026-11-26",
  },
  "c-karmala-del": {
    id: "c-karmala-del",
    name: "KARMALA CAFE & RESTAURANT",
    verifiedAddress: "Tsampa House, 5th Floor, Plot Nos. 18 & 19, Gate No. 3, Majnu Ka Tilla, New Aruna Nagar Colony, Delhi-110054",
    googleRating: 4.4,
    googleReviewCount: null,
    ratingVerified: true,
    ratingStatusLabel: "4.4 / 5 Google",
    ratingSource: "Google (supplied by client)",
    openingHoursSummary: "10:00 AM – 10:30 PM (Daily)",
    weeklyHours: DAILY("10:00 AM – 10:30 PM"),
    hoursVerified: true,
    hoursStatusLabel: "Verified via official site & public dining listings",
    priceVerified: false,
    priceStatusLabel: "Price information unavailable",
    infoSource: "Google (rating supplied by client); Karma La official website, Magicpin & EazyDiner public listings (hours)",
    infoCheckedAt: "2026-11-26",
  },
  "c-yumm-club-del": {
    id: "c-yumm-club-del",
    name: "The Yumm Club",
    verifiedAddress: "Shop no-G5, Aditya Arcade, C Block, Preet Vihar, Delhi, 110092",
    googleRating: 5.0,
    googleReviewCount: null,
    ratingVerified: true,
    ratingStatusLabel: "5.0 / 5 Google",
    ratingSource: "Google (supplied by client)",
    openingHoursSummary: "11:00 AM – 11:00 PM (Daily)",
    weeklyHours: DAILY("11:00 AM – 11:00 PM"),
    hoursVerified: true,
    hoursStatusLabel: "Verified via public dining listings",
    priceVerified: false,
    priceStatusLabel: "Price information unavailable",
    infoSource: "Google (rating supplied by client); Swiggy & Justdial public listings (hours)",
    infoCheckedAt: "2026-11-26",
  },
};

export function getVerifiedPartnerCafeCount(): number {
  return new Set(Object.values(VERIFIED_CAFE_RESEARCH).map((c) => c.id)).size;
}

export function getVerifiedCafeResearch(
  cafeOrId: string | { id?: string; name?: string; address?: string } | null | undefined,
): VerifiedCafeResearch | undefined {
  if (!cafeOrId) return undefined;
  if (typeof cafeOrId === "string") {
    return VERIFIED_CAFE_RESEARCH[cafeOrId];
  }
  if (cafeOrId.id && VERIFIED_CAFE_RESEARCH[cafeOrId.id]) {
    return VERIFIED_CAFE_RESEARCH[cafeOrId.id];
  }
  const name = (cafeOrId.name || "").toLowerCase().trim();
  const address = (cafeOrId.address || "").toLowerCase().trim();
  if (name.includes("hot stag") || address.includes("dilshad garden")) {
    return VERIFIED_CAFE_RESEARCH["c-hot-stag-del"];
  }
  if (
    name.includes("karmala") ||
    name.includes("karma la") ||
    address.includes("majnu ka tilla") ||
    address.includes("new aruna nagar")
  ) {
    return VERIFIED_CAFE_RESEARCH["c-karmala-del"];
  }
  if (name.includes("yumm club") || address.includes("preet vihar")) {
    return VERIFIED_CAFE_RESEARCH["c-yumm-club-del"];
  }
  return undefined;
}
