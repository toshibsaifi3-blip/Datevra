import { profileCompleteness } from "./supabase/mappers";
import type { Gender, InterestedIn, UserProfile } from "./types";

export const GENDERS: { id: Gender; label: string }[] = [
  { id: "woman", label: "Woman" },
  { id: "man", label: "Man" },
  { id: "nonbinary", label: "Non-binary" },
];

export const INTERESTED_OPTIONS: { id: InterestedIn; label: string }[] = [
  { id: "women", label: "Women" },
  { id: "men", label: "Men" },
  { id: "everyone", label: "Everyone" },
];

export interface BasicIdentityErrors {
  firstName?: string;
  age?: string;
}

export function validateBasicIdentity(firstName: string, age: number): BasicIdentityErrors {
  const errors: BasicIdentityErrors = {};
  if (!firstName.trim()) {
    errors.firstName = "Please enter your first name.";
  }
  if (!Number.isFinite(age) || age < 18 || age > 100) {
    errors.age = "You must be 18 or older (18–100) to join Datevra.";
  }
  return errors;
}

export function toggleTag(list: string[], item: string): string[] {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

export function addCustomTagItem(list: string[], raw: string, maxLength = 40): string[] {
  const clean = raw.trim().slice(0, maxLength);
  if (!clean) return list;
  if (list.some((x) => x.toLowerCase() === clean.toLowerCase())) return list;
  return [...list, clean];
}

export function isProfileSetupComplete(user: Pick<UserProfile, "bio" | "relationshipIntent" | "city" | "interests" | "photos">): boolean {
  return profileCompleteness({
    bio: user.bio || "",
    relationshipIntent: user.relationshipIntent || "",
    city: user.city || "",
    interests: user.interests || [],
    photos: user.photos || [],
  }) >= 100;
}

export function determineInitialOnboardingStep(user: UserProfile): number {
  const name = user.firstName?.trim() ?? "";
  if (!name || name === "Member" || !user.age || user.age < 18 || !user.city?.trim() || !user.gender) {
    return 1;
  }
  if (!user.bio?.trim()) return 2;
  if (!user.relationshipIntent?.trim()) return 3;
  if (!user.interests || user.interests.length === 0) return 4;
  if (!user.photos || user.photos.length === 0) return 5;
  return 6;
}
