import type { UserProfile } from "./types";

/**
 * Presence window threshold in milliseconds (15 minutes).
 * A member is considered actively online if they have opted into online visibility
 * (profile.online !== false) AND their verifiable activity timestamp (lastActive)
 * was recorded within this window.
 */
export const ONLINE_PRESENCE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Checks whether a user profile is currently considered online based on verifiable
 * recent activity timestamps and user privacy settings.
 */
export function isUserOnline(user: UserProfile, nowMs: number = Date.now()): boolean {
  // Respect user privacy choice: if they disabled online visibility, they are never shown online
  if (!user.online) return false;

  if (!user.lastActive) return false;

  const lastActiveMs = Date.parse(user.lastActive);
  if (Number.isNaN(lastActiveMs)) return false;

  // Stale presence expires: must have recorded verifiable activity within threshold
  return nowMs - lastActiveMs <= ONLINE_PRESENCE_THRESHOLD_MS;
}

/**
 * Calculates the count of verifiable recently active online members across an array of profiles.
 * Ensures Admin Overview and Admin Analytics share the identical presence evaluation logic.
 */
export function countActiveOnlineUsers(users: UserProfile[], nowMs: number = Date.now()): number {
  return users.filter((u) => isUserOnline(u, nowMs)).length;
}
