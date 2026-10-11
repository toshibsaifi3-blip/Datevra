/**
 * Shared photo-upload validation for Datevra profile photos.
 *
 * Used by the PhotoManager UI *and* both backends (demo + Supabase), so
 * the rules are identical everywhere. The database/storage RLS policies
 * are the final authority server-side; this is the client-side guard
 * that produces friendly error messages.
 */

export const MAX_PHOTOS = 6;
export const MAX_PHOTO_SIZE = 5 * 1024 * 1024; // 5 MB

export const ACCEPTED_PHOTO_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Returns a human-readable error, or null when the file is acceptable. */
export function validatePhotoFile(file: File): string | null {
  if (!file || typeof file.size !== "number") {
    return "Please choose a photo file.";
  }
  if (!(ACCEPTED_PHOTO_TYPES as readonly string[]).includes(file.type)) {
    return "Please use a JPG, PNG, or WebP photo.";
  }
  if (file.size === 0) {
    return "That file looks empty — please choose another photo.";
  }
  if (file.size > MAX_PHOTO_SIZE) {
    return `Photos must be under 5 MB (this one is ${(file.size / 1024 / 1024).toFixed(1)} MB).`;
  }
  return null;
}

/** File extension for a validated photo file (defaults to jpg). */
export function extensionFor(file: File): string {
  return EXT_BY_TYPE[file.type] ?? "jpg";
}

/**
 * Extract the storage object path from a profile-photos public URL.
 * Returns null when the URL is not a profile-photos URL (e.g. legacy
 * seed URLs or blob: URLs in demo mode).
 */
export function storagePathFromUrl(photoUrl: string, bucket = "profile-photos"): string | null {
  try {
    const marker = `/${bucket}/`;
    const idx = photoUrl.indexOf(marker);
    if (idx === -1) return null;
    const path = photoUrl.slice(idx + marker.length).split("?")[0];
    return path || null;
  } catch {
    return null;
  }
}
