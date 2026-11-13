import type {
  Gender,
  InterestedIn,
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

export type CompatibilityTier = "compatible" | "potential_concern" | "incompatible" | "insufficient_info";

export interface PairwiseCompatibilityAssessment {
  score: number;
  factors: string[];
  tier: CompatibilityTier;
  tierLabel: string;
  summary: string;
  concerns: string[];
  insufficientInfo: boolean;
}

/** Check if a candidate's gender aligns with a user's interestedIn orientation. */
export function isGenderOriented(interestedIn: InterestedIn | undefined, gender: Gender | undefined): boolean {
  if (!interestedIn || interestedIn === "everyone") return true;
  if (!gender) return true; // missing info is not proof of incompatibility
  if (interestedIn === "women") return gender === "woman";
  if (interestedIn === "men") return gender === "man";
  return true;
}

/**
 * Assesses compatibility between two members for admin curated matchmaking.
 * Reuses Datevra's existing computeCompatibility engine while assessing
 * preference alignment, intent alignment, and information sufficiency.
 */
export function evaluatePairwiseCompatibility(
  userA: UserProfile,
  userB: UserProfile,
  prefsA?: MatchPreferences | null,
  prefsB?: MatchPreferences | null,
): PairwiseCompatibilityAssessment {
  // Use existing computeCompatibility engine
  const resultA = computeCompatibility(userA, userB, prefsA ?? null);
  const resultB = computeCompatibility(userB, userA, prefsB ?? null);
  const avgScore = Math.round((resultA.score + resultB.score) / 2);
  const mergedFactors = Array.from(new Set([...resultA.factors, ...resultB.factors]));

  const concerns: string[] = [];

  // Check orientation / gender preferences
  const aWantsB = isGenderOriented(userA.interestedIn, userB.gender);
  const bWantsA = isGenderOriented(userB.interestedIn, userA.gender);

  if (!aWantsB) {
    concerns.push(`${userA.firstName} is seeking ${userA.interestedIn}, but ${userB.firstName} is a ${userB.gender}.`);
  }
  if (!bWantsA) {
    concerns.push(`${userB.firstName} is seeking ${userB.interestedIn}, but ${userA.firstName} is a ${userA.gender}.`);
  }

  // Check relationship intent
  if (userA.relationshipIntent && userB.relationshipIntent) {
    if (userA.relationshipIntent.toLowerCase() !== userB.relationshipIntent.toLowerCase()) {
      concerns.push(`Different intentions: ${userA.firstName} seeks “${userA.relationshipIntent}”, ${userB.firstName} seeks “${userB.relationshipIntent}”.`);
    }
  }

  // Check age preferences if explicit prefs exist
  if (prefsA && (userB.age < prefsA.ageMin || userB.age > prefsA.ageMax)) {
    concerns.push(`${userB.firstName} (${userB.age}) is outside ${userA.firstName}'s preferred age (${prefsA.ageMin}–${prefsA.ageMax}).`);
  }
  if (prefsB && (userA.age < prefsB.ageMin || userA.age > prefsB.ageMax)) {
    concerns.push(`${userA.firstName} (${userA.age}) is outside ${userB.firstName}'s preferred age (${prefsB.ageMin}–${prefsB.ageMax}).`);
  }

  // Check city mismatch (note: this is a consideration, not a hard barrier)
  if (userA.city && userB.city && userA.city.toLowerCase() !== userB.city.toLowerCase()) {
    const aCityMatch = prefsA?.cities?.some((c) => c.toLowerCase() === userB.city.toLowerCase());
    const bCityMatch = prefsB?.cities?.some((c) => c.toLowerCase() === userA.city.toLowerCase());
    if (!aCityMatch && !bCityMatch) {
      concerns.push(`Different locations: ${userA.firstName} in ${userA.city}, ${userB.firstName} in ${userB.city}.`);
    }
  }

  // Check insufficient profile info (never treat missing profile info as incompatibility)
  const missingA = !userA.bio && (!userA.interests || userA.interests.length === 0);
  const missingB = !userB.bio && (!userB.interests || userB.interests.length === 0);
  const insufficientInfo = missingA || missingB || (userA.profileComplete < 30 && userB.profileComplete < 30);

  let tier: CompatibilityTier = "compatible";
  let tierLabel = "Compatible";
  let summary = "Both members show healthy synergy across interests and profile parameters.";

  const hasOrientationConflict = !aWantsB || !bWantsA;

  if (hasOrientationConflict) {
    tier = "incompatible";
    tierLabel = "Orientation Mismatch";
    summary = "Gender orientation preferences conflict. Introduction is not recommended.";
  } else if (insufficientInfo) {
    tier = "insufficient_info";
    tierLabel = "Limited Profile Data";
    summary = "One or both profiles have limited data. Compatibility score may not reflect full potential.";
  } else if (concerns.length > 0 || avgScore < 40) {
    tier = "potential_concern";
    tierLabel = "Potential Concern";
    summary = concerns.length > 0
      ? "Review highlighted preferences before sending."
      : "Lower overall overlap, though no direct preference barriers exist.";
  } else {
    tier = "compatible";
    tierLabel = "Strong Match";
    summary = "High compatibility with aligned preferences and shared interests.";
  }

  return {
    score: avgScore,
    factors: mergedFactors,
    tier,
    tierLabel,
    summary,
    concerns,
    insufficientInfo,
  };
}

export const BROAD_DEFAULT_PREFS: MatchPreferences = {
  ageMin: 18,
  ageMax: 99,
  interestedIn: "everyone",
  cities: [],
  maxDistanceKm: 100,
  relationshipIntents: [],
  minSharedInterests: 0,
};

/** Returns true when a candidate satisfies the member's active discovery filters. */
export function matchesPreferences(
  me: UserProfile,
  candidate: UserProfile,
  prefs: MatchPreferences | null,
): boolean {
  if (!prefs) return true;
  if (candidate.age < prefs.ageMin || candidate.age > prefs.ageMax) return false;
  if (!isGenderOriented(prefs.interestedIn, candidate.gender)) return false;

  if (prefs.cities.length > 0) {
    const candCity = candidate.city.trim().toLowerCase();
    const ok = prefs.cities.some((c) => c.trim().toLowerCase() === candCity);
    if (!ok) return false;
  }

  if (prefs.relationshipIntents.length > 0) {
    const candIntent = candidate.relationshipIntent.trim().toLowerCase();
    const ok =
      !!candIntent &&
      prefs.relationshipIntents.some((r) => r.trim().toLowerCase() === candIntent);
    if (!ok) return false;
  }

  if (prefs.minSharedInterests > 0) {
    const mine = new Set(
      [...me.interests, ...me.hobbies].map((s) => s.trim().toLowerCase()).filter(Boolean),
    );
    const sharedUnique = new Set(
      [...candidate.interests, ...candidate.hobbies]
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s && mine.has(s)),
    );
    if (sharedUnique.size < prefs.minSharedInterests) return false;
  }

  return true;
}

/** Human-readable list of active non-broad discovery filters for synchronized UI feedback. */
export function activeFilterLabels(prefs: MatchPreferences | null): string[] {
  if (!prefs) return [];
  const labels: string[] = [];
  if (prefs.ageMin > 18 || prefs.ageMax < 99) {
    labels.push(`Ages ${prefs.ageMin}–${prefs.ageMax}`);
  }
  if (prefs.interestedIn !== "everyone") {
    labels.push(prefs.interestedIn === "women" ? "Women" : "Men");
  }
  if (prefs.cities.length > 0) {
    labels.push(prefs.cities.join(", "));
  }
  if (prefs.relationshipIntents.length > 0) {
    labels.push(prefs.relationshipIntents.join(" / "));
  }
  if (prefs.minSharedInterests > 0) {
    labels.push(`${prefs.minSharedInterests}+ shared interests`);
  }
  return labels;
}

/** Rank candidates by compatibility, filtering out blocked/self/liked and applying active preferences. */
export function rankCandidates(
  me: UserProfile,
  candidates: UserProfile[],
  prefs: MatchPreferences | null,
  excludedIds: Set<string>,
): { profile: UserProfile; score: number; factors: string[] }[] {
  return candidates
    .filter(
      (c) =>
        c.id !== me.id &&
        !excludedIds.has(c.id) &&
        matchesPreferences(me, c, prefs),
    )
    .map((c) => {
      const r = computeCompatibility(me, c, prefs);
      return { profile: c, score: r.score, factors: r.factors };
    })
    .sort((a, b) => b.score - a.score);
}

