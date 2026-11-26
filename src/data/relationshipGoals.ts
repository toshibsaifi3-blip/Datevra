/**
 * Canonical Relationship Goals — Datevra & Tinder-aligned single-select options.
 * Labels are exact English strings used across Onboarding, Profile, and Discovery filters.
 */

export const RELATIONSHIP_GOALS = [
  "Long-term partner",
  "Long-term, open to short",
  "Short-term, open to long",
  "Short-term fun",
  "New friends",
  "Still figuring it out",
] as const;

export type RelationshipGoal = (typeof RELATIONSHIP_GOALS)[number];

/**
 * Legacy Datevra relationship intent labels that existing members may have saved
 * before this upgrade. Never deleted or silently overwritten on existing profiles.
 */
export const LEGACY_RELATIONSHIP_GOAL_MAP: Readonly<Record<string, RelationshipGoal>> = {
  "Dating with intention": "Long-term partner",
  "Open to something meaningful": "Long-term, open to short",
  "A serious relationship": "Long-term partner",
  "Marriage-minded": "Long-term partner",
};

const CANONICAL_SET = new Set<string>(RELATIONSHIP_GOALS);

export function isCanonicalRelationshipGoal(value: string | null | undefined): value is RelationshipGoal {
  return typeof value === "string" && CANONICAL_SET.has(value.trim());
}

/**
 * Returns the canonical list of 6 goals, plus the member's existing saved legacy
 * value (if any) so existing profiles never lose their saved selection in UI pickers.
 */
export function relationshipGoalOptionsWithLegacy(currentValue?: string | null): string[] {
  const trimmed = (currentValue ?? "").trim();
  if (!trimmed || CANONICAL_SET.has(trimmed)) {
    return [...RELATIONSHIP_GOALS];
  }
  return [trimmed, ...RELATIONSHIP_GOALS];
}

/**
 * Optional advisory helper mapping a legacy label to its closest canonical goal
 * (used only when normalizing for analytics/hints — never mutates saved member data).
 */
export function mapLegacyRelationshipGoal(value: string | null | undefined): RelationshipGoal | null {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return null;
  if (isCanonicalRelationshipGoal(trimmed)) return trimmed;
  return LEGACY_RELATIONSHIP_GOAL_MAP[trimmed] ?? null;
}
