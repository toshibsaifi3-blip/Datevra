/**
 * Outside-Delhi Voucher Eligibility Policy (Requirement 8)
 *
 * Explicit city rule (mirrors Migration 032 SQL `normalize_city_name` and
 * `is_outside_delhi_city` 1:1):
 * - Normalizes whitespace and case: trim, lowercase, collapse internal spaces.
 * - Default excluded cities represent NCT of Delhi: ['delhi', 'new delhi'].
 * - Delhi-NCR cities (Noida, Gurugram, Faridabad, Ghaziabad) are NOT silently
 *   conflated with Delhi; they remain outside-Delhi unless an administrator
 *   explicitly adds them to `voucher_settings.excluded_cities`.
 * - Anti-spoofing rule: eligibility checks BOTH the member's original
 *   `registeredCity` and current `city` so temporarily changing `city` cannot
 *   unlock vouchers for Delhi-registered accounts.
 */

export const DEFAULT_EXCLUDED_VOUCHER_CITIES: readonly string[] = [
  "delhi",
  "new delhi",
];

export function normalizeCityName(city: string | null | undefined): string {
  return (city ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function isOutsideDelhiCity(
  city: string | null | undefined,
  excludedCities: readonly string[] = DEFAULT_EXCLUDED_VOUCHER_CITIES,
): boolean {
  const norm = normalizeCityName(city);
  if (!norm) return false;
  const excludedSet = new Set(
    (excludedCities.length > 0 ? excludedCities : DEFAULT_EXCLUDED_VOUCHER_CITIES)
      .map(normalizeCityName)
      .filter(Boolean),
  );
  return !excludedSet.has(norm);
}

export function isMemberEligibleForOutsideDelhiVoucher(
  currentCity: string | null | undefined,
  registeredCity: string | null | undefined,
  excludedCities: readonly string[] = DEFAULT_EXCLUDED_VOUCHER_CITIES,
): { eligible: boolean; reason?: string } {
  const effectiveRegistered = registeredCity?.trim() || currentCity?.trim() || "";
  if (!effectiveRegistered || !currentCity?.trim()) {
    return { eligible: false, reason: "A valid registered city is required." };
  }
  if (!isOutsideDelhiCity(effectiveRegistered, excludedCities)) {
    return {
      eligible: false,
      reason: "Vouchers are reserved for members registered outside Delhi.",
    };
  }
  if (!isOutsideDelhiCity(currentCity, excludedCities)) {
    return {
      eligible: false,
      reason: "Current profile city is in the excluded Delhi list.",
    };
  }
  return { eligible: true };
}

/**
 * Unbiased CSPRNG code generator using rejection sampling (31-char unambiguous alphabet).
 * Matches Migration 011 (`MEM-XXXX-XXXX-XXXX`) and Migration 032 (`DVR-VCH-XXXX-XXXX`).
 */
const PASS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // length 31; 248 = 31 * 8

export function generateUnbiasedCode(prefix: string, groups: number[]): string {
  const totalChars = groups.reduce((acc, n) => acc + n, 0);
  const out: string[] = [];
  const buf = new Uint8Array(32);

  while (out.length < totalChars) {
    crypto.getRandomValues(buf);
    for (let i = 0; i < buf.length && out.length < totalChars; i++) {
      if (buf[i] < 248) {
        out.push(PASS_ALPHABET[buf[i] % PASS_ALPHABET.length]);
      }
    }
  }

  let offset = 0;
  const parts = groups.map((len) => {
    const seg = out.slice(offset, offset + len).join("");
    offset += len;
    return seg;
  });
  return `${prefix}-${parts.join("-")}`;
}
