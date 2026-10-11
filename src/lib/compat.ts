import type {
  MatchPreferences,
  UserProfile,
} from "./types";

/**
 * Transparent compatibility scoring.
 * Score is derived ONLY from real, visible factors — never fabricated.
 * Returns a 0–100 score plus human-readable reasons shown in the UI.
 */
export interface CompatibilityResult {
  score: number;
  factors: string[];
}

export function computeCompatibility(
  me: UserProfile,
  them: UserProfile,
  prefs: MatchPreferences | null,
): CompatibilityResult {
  let score = 0;
  const factors: string[] = [];

  // 1. Shared interests + hobbies (max 35)
  const mine = new Set(
    [...me.interests, ...me.hobbies].map((s) => s.toLowerCase()),
  );
  const shared = [...them.interests, ...them.hobbies].filter((s) =>
    mine.has(s.toLowerCase()),
  );
  const uniqueShared = Array.from(new Set(shared));
  const interestPts = Math.min(35, uniqueShared.length * 9);
  score += interestPts;
  if (uniqueShared.length >= 2) {
    factors.push(
      `${uniqueShared.length} shared interests (${uniqueShared.slice(0, 3).join(", ")})`,
    );
  } else if (uniqueShared.length === 1) {
    factors.push(`You both love ${uniqueShared[0]}`);
  }

  // 2. Relationship intent alignment (max 25)
  if (
    me.relationshipIntent &&
    them.relationshipIntent &&
    me.relationshipIntent === them.relationshipIntent
  ) {
    score += 25;
    factors.push(`Both seeking “${me.relationshipIntent}”`);
  } else if (me.relationshipIntent && them.relationshipIntent) {
    score += 8;
    factors.push("Different but compatible intentions");
  }

  // 3. Age preference fit (max 15)
  if (prefs) {
    if (them.age >= prefs.ageMin && them.age <= prefs.ageMax) {
      score += 15;
      factors.push("Within your preferred age range");
    }
  } else {
    const gap = Math.abs(me.age - them.age);
    score += Math.max(0, 15 - gap * 2);
    if (gap <= 3) factors.push("Close in age");
  }

  // 4. City / location (max 10)
  if (me.city === them.city) {
    score += 10;
    factors.push(`Both in ${me.city}`);
  } else if (prefs && prefs.cities.includes(them.city)) {
    score += 6;
    factors.push(`In ${them.city}, one of your chosen cities`);
  }

  // 5. Lifestyle overlap (max 10)
  const myLife = new Set(me.lifestyle.map((s) => s.toLowerCase()));
  const sharedLife = them.lifestyle.filter((s) => myLife.has(s.toLowerCase()));
  if (sharedLife.length > 0) {
    const pts = Math.min(10, sharedLife.length * 4);
    score += pts;
    factors.push(`Shared lifestyle: ${sharedLife.slice(0, 2).join(", ")}`);
  }

  // 6. Profile completeness of the other person (max 5)
  score += Math.round((them.profileComplete / 100) * 5);
  if (them.verified) factors.push("Verified profile");

  return { score: Math.min(100, Math.round(score)), factors };
}

/** Rank candidates by compatibility, filtering out blocked/self/liked. */
export function rankCandidates(
  me: UserProfile,
  candidates: UserProfile[],
  prefs: MatchPreferences | null,
  excludedIds: Set<string>,
): { profile: UserProfile; score: number; factors: string[] }[] {
  return candidates
    .filter((c) => c.id !== me.id && !excludedIds.has(c.id))
    .map((c) => {
      const r = computeCompatibility(me, c, prefs);
      return { profile: c, score: r.score, factors: r.factors };
    })
    .sort((a, b) => b.score - a.score);
}
