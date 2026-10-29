import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { getSupabase, SUPABASE_URL, SUPABASE_ANON_KEY } from "../supabase";
import { computeCompatibility } from "../compat";
import { validatePhotoFile, extensionFor, storagePathFromUrl } from "../photos";
import type {
  ActivityLog,
  AppNotification,
  Block,
  Cafe,
  CmsPage,
  ComplimentaryPass,
  Conversation,
  DailyUsage,
  DateApplication,
  DateBooking,
  DateExperience,
  InvestorRecord,
  Like,
  Match,
  MatchPreferences,
  MatchProposal,
  MembershipPlan,
  Message,
  Payment,
  PlanId,
  PlatformSettings,
  Report,
  Subscription,
  UserProfile,
} from "../types";
import {
  mapActivity,
  mapApplication,
  mapBlock,
  mapBooking,
  mapCafe,
  mapCms,
  mapComplimentaryPass,
  mapConversation,
  mapExperience,
  mapInvestor,
  mapLike,
  mapMatch,
  mapMatchProposal,
  mapMessage,
  mapNotification,
  mapPayment,
  mapPlan,
  mapPrefs,
  mapProfile,
  mapReport,
  mapSettings,
  mapSubscription,
  profileCompleteness,
  type Row,
  unmapCafe,
  unmapInvestor,
  unmapPrefs,
  unmapProfilePatch,
  unmapSettings,
} from "./mappers";
import type { Backend, BackendEvent } from "../data";

/* =====================================================================
 * SupabaseBackend — the real backend. Async, RLS-enforced, realtime.
 * Implements the same Backend interface as the demo backend so the UI
 * layer never branches on mode.
 * ===================================================================== */

function sb(): SupabaseClient {
  const c = getSupabase();
  if (!c)
    throw new Error(
      "Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart.",
    );
  return c;
}

async function me(): Promise<string> {
  const { data } = await sb().auth.getSession();
  const id = data.session?.user.id;
  if (!id) throw new Error("Not signed in.");
  return id;
}

function throwIf<T>(res: { data: T | null; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  if (res.data === null || res.data === undefined)
    throw new Error(`${what}: no data returned.`);
  return res.data as NonNullable<T>;
}

/* Ordered pair helper — matches the order_match_pair trigger (uuid order
 * == lexicographic order of the canonical text form). */
function ordered(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/* ---------------- profiles & prefs ---------------- */

async function getUser(id: string): Promise<UserProfile | undefined> {
  const uid = await me().catch(() => null);
  if (uid && uid === id) {
    const res = await sb().from("profiles").select("*").eq("id", id).maybeSingle();
    if (res.error || !res.data) return undefined;
    return mapProfile(res.data as Record<string, unknown>);
  }
  // Member-safe lookup via SECURITY DEFINER function (migration 003).
  // The old profiles_public view cannot be used: views run with the
  // caller's privileges, so its underlying own-row RLS would hide everyone.
  const res = await sb().rpc("discovery_profile", { p_id: id });
  if (res.error) throw new Error(`Could not load profile: ${res.error.message}`);
  const row = (res.data as Record<string, unknown>[] | null)?.[0];
  return row ? mapProfile(row) : undefined;
}

async function listProfiles(): Promise<UserProfile[]> {
  // Member-safe discovery set via SECURITY DEFINER function (migration 003).
  const res = await sb().rpc("discovery_profiles");
  const rows = throwIf(res, "Could not load profiles") as Record<string, unknown>[];
  return rows
    .map((r) => mapProfile(r))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);
}

async function updateUser(id: string, patch: Partial<UserProfile>): Promise<UserProfile | undefined> {
  const patchWithCompleteness = { ...patch };
  if (
    patch.bio !== undefined ||
    patch.relationshipIntent !== undefined ||
    patch.city !== undefined ||
    patch.interests !== undefined ||
    patch.photos !== undefined
  ) {
    const current = await getUser(id);
    if (current) {
      const merged = { ...current, ...patch };
      patchWithCompleteness.profileComplete = profileCompleteness(merged);
    }
  }
  const res = await sb()
    .from("profiles")
    .update({ ...unmapProfilePatch(patchWithCompleteness), last_active: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .maybeSingle();
  if (res.error || !res.data) return undefined;
  return mapProfile(res.data as Record<string, unknown>);
}

/* ---------------- profile photos (Supabase Storage) ---------------- */

const PHOTO_BUCKET = "profile-photos";

/**
 * Upload a profile photo to the member's own Storage folder
 * (`<user-id>/<uuid>.<ext>`). Uses XMLHttpRequest against the Storage
 * REST endpoint so the UI gets real upload progress; the RLS policy
 * "Users upload own profile photos" enforces the folder ownership
 * server-side. Returns the public URL to store on the profile.
 */
async function uploadPhoto(
  userId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const err = validatePhotoFile(file);
  if (err) throw new Error(err);
  const uid = await me().catch(() => null);
  if (!uid || uid !== userId) throw new Error("You can only upload photos to your own profile.");

  const { data: sessionData } = await sb().auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("You're signed out. Please sign in again to upload photos.");

  const path = `${userId}/${crypto.randomUUID()}.${extensionFor(file)}`;
  const endpoint = `${SUPABASE_URL}/storage/v1/object/${PHOTO_BUCKET}/${path}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.setRequestHeader("apikey", SUPABASE_ANON_KEY);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", file.type);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(uploadErrorMessage(xhr.status)));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new Error("Upload was cancelled."));
    xhr.send(file);
  });

  const { data } = sb().storage.from(PHOTO_BUCKET).getPublicUrl(path);
  if (!data.publicUrl) throw new Error("Upload succeeded but the photo URL is unavailable.");
  return data.publicUrl;
}

function uploadErrorMessage(status: number): string {
  if (status === 400) return "That photo couldn't be uploaded. Try a different file.";
  if (status === 401 || status === 403)
    return "You don't have permission to upload photos. Please sign in again.";
  if (status === 409) return "That photo already exists. Please try again.";
  if (status === 413) return "That photo is too large. Photos must be under 5 MB.";
  return "Upload failed. Please try again.";
}

/** Delete a profile photo from Storage. No-ops for non-storage URLs (legacy seeds). */
async function deletePhoto(userId: string, photoUrl: string): Promise<void> {
  const path = storagePathFromUrl(photoUrl, PHOTO_BUCKET);
  if (!path) return; // nothing stored server-side (demo blob: or legacy URL)
  // Safety: never delete outside the caller's own folder, even if asked.
  if (!path.startsWith(`${userId}/`)) {
    throw new Error("You can only delete your own photos.");
  }
  const res = await sb().storage.from(PHOTO_BUCKET).remove([path]);
  if (res.error) throw new Error(`Couldn't delete the photo: ${res.error.message}`);
}

/**
 * Permanently delete the caller's own account via the
 * delete_own_account() SECURITY DEFINER function (migration 005).
 * The userId argument must match the signed-in user — defense in depth
 * on top of the function's own auth.uid() check.
 */
async function deleteAccount(userId: string): Promise<void> {
  const uid = await me().catch(() => null);
  if (!uid || uid !== userId) {
    throw new Error("You can only delete your own account.");
  }
  const res = await sb().rpc("delete_own_account");
  if (res.error) throw new Error(`Couldn't delete your account: ${res.error.message}`);
}

async function getPrefs(userId: string): Promise<MatchPreferences> {
  const res = await sb().from("match_preferences").select("*").eq("user_id", userId).maybeSingle();
  if (res.error) throw new Error(`Could not load preferences: ${res.error.message}`);
  if (!res.data) {
    const meId = await me();
    const row = { user_id: meId, ...unmapPrefs({
      ageMin: 22, ageMax: 35, interestedIn: "everyone", cities: [],
      maxDistanceKm: 50, relationshipIntents: [], minSharedInterests: 1,
    }) };
    const ins = await sb().from("match_preferences").insert(row).select("*").single();
    return mapPrefs(throwIf(ins, "Could not create preferences") as Record<string, unknown>);
  }
  return mapPrefs(res.data as Record<string, unknown>);
}

async function savePrefs(userId: string, prefs: MatchPreferences): Promise<void> {
  const res = await sb()
    .from("match_preferences")
    .upsert({ user_id: userId, ...unmapPrefs(prefs) }, { onConflict: "user_id" });
  if (res.error) throw new Error(`Could not save preferences: ${res.error.message}`);
}

/* ---------------- likes / passes / matches ---------------- */

async function hasLiked(from: string, to: string): Promise<boolean> {
  const res = await sb().from("likes").select("id").eq("from_user_id", from).eq("to_user_id", to).maybeSingle();
  if (res.error) throw new Error(`Like check failed: ${res.error.message}`);
  return !!res.data;
}

async function hasPassed(from: string, to: string): Promise<boolean> {
  const res = await sb().from("passes").select("id").eq("from_user_id", from).eq("to_user_id", to).maybeSingle();
  if (res.error) throw new Error(`Pass check failed: ${res.error.message}`);
  return !!res.data;
}

async function findMatch(a: string, b: string): Promise<Match | null> {
  const [x, y] = ordered(a, b);
  const res = await sb().from("matches").select("*").eq("user_a", x).eq("user_b", y).maybeSingle();
  if (res.error) throw new Error(`Match lookup failed: ${res.error.message}`);
  return res.data ? mapMatch(res.data as Record<string, unknown>) : null;
}

async function sendLike(fromUserId: string, toUserId: string): Promise<{ match: Match | null }> {
  if (fromUserId === toUserId) return { match: null };
  const existing = await findMatch(fromUserId, toUserId);
  if (existing) return { match: existing };

  const ins = await sb().from("likes").insert({ from_user_id: fromUserId, to_user_id: toUserId });
  if (ins.error) {
    // Free-tier daily cap enforced by the trg_enforce_like_limit trigger.
    if (ins.error.message.includes("DAILY_LIKE_LIMIT_REACHED")) {
      throw new Error("DAILY_LIKE_LIMIT_REACHED");
    }
    // Already liked (unique conflict) — check for a match anyway.
    if (ins.error.message.includes("duplicate") || ins.error.code === "23505") {
      return { match: await findMatch(fromUserId, toUserId) };
    }
    throw new Error(`Could not send like: ${ins.error.message}`);
  }

  // The handle_mutual_like trigger creates the match + conversation server-side.
  const match = await findMatch(fromUserId, toUserId);
  if (match && match.compatibility === 0) {
    try {
      const [meP, themP] = await Promise.all([getUser(fromUserId), getUser(toUserId)]);
      const prefs = await getPrefs(fromUserId);
      if (meP && themP) {
        const c = computeCompatibility(meP, themP, prefs);
        await sb().from("matches").update({ compatibility: c.score, factors: c.factors }).eq("id", match.id);
        match.compatibility = c.score;
        match.factors = c.factors;
      }
    } catch {
      /* compatibility write-back is best-effort; the match itself stands */
    }
  }
  return { match };
}

async function sendPass(from: string, to: string): Promise<void> {
  const res = await sb().from("passes").insert({ from_user_id: from, to_user_id: to });
  if (res.error && res.error.code !== "23505")
    throw new Error(`Could not pass: ${res.error.message}`);
}

async function likesReceived(userId: string): Promise<Like[]> {
  const res = await sb().from("likes").select("*").eq("to_user_id", userId).order("created_at", { ascending: false });
  return throwIf(res, "Could not load likes").map((r) => mapLike(r as Record<string, unknown>));
}

async function likesSent(userId: string): Promise<Like[]> {
  const res = await sb().from("likes").select("*").eq("from_user_id", userId).order("created_at", { ascending: false });
  return throwIf(res, "Could not load likes").map((r) => mapLike(r as Record<string, unknown>));
}

async function matchesFor(userId: string): Promise<Match[]> {
  const res = await sb()
    .from("matches")
    .select("*")
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order("created_at", { ascending: false });
  return throwIf(res, "Could not load matches").map((r) => mapMatch(r as Record<string, unknown>));
}

async function unmatch(matchId: string, byUserId: string): Promise<void> {
  const mRes = await sb().from("matches").select("*").eq("id", matchId).maybeSingle();
  const mrow = throwIf(mRes, "Match not found");
  const m = mapMatch(mrow as Record<string, unknown>);
  const other = m.userA === byUserId ? m.userB : m.userA;
  const del = await sb().from("matches").delete().eq("id", matchId);
  if (del.error) throw new Error(`Could not unmatch: ${del.error.message}`);
  // Remove my like; the reciprocal like is left as-is (harmless without a match).
  await sb().from("likes").delete().eq("from_user_id", byUserId).eq("to_user_id", other);
}

/* ---------------- saved / blocks / reports ---------------- */

async function saveProfile(userId: string, profileId: string): Promise<void> {
  const res = await sb().from("saved_profiles").insert({ user_id: userId, profile_id: profileId });
  if (res.error && res.error.code !== "23505")
    throw new Error(`Could not save profile: ${res.error.message}`);
}

async function unsaveProfile(userId: string, profileId: string): Promise<void> {
  const res = await sb().from("saved_profiles").delete().eq("user_id", userId).eq("profile_id", profileId);
  if (res.error) throw new Error(`Could not unsave: ${res.error.message}`);
}

async function savedProfiles(userId: string): Promise<string[]> {
  const res = await sb().from("saved_profiles").select("profile_id").eq("user_id", userId);
  return throwIf(res, "Could not load saved profiles").map((r) => (r as { profile_id: string }).profile_id);
}

async function blockUser(blockerId: string, blockedId: string): Promise<void> {
  const res = await sb().from("blocks").insert({ blocker_id: blockerId, blocked_id: blockedId });
  if (res.error && res.error.code !== "23505")
    throw new Error(`Could not block: ${res.error.message}`);
  const match = await findMatch(blockerId, blockedId);
  if (match) await unmatch(match.id, blockerId);
}

async function unblockUser(blockerId: string, blockedId: string): Promise<void> {
  const res = await sb().from("blocks").delete().eq("blocker_id", blockerId).eq("blocked_id", blockedId);
  if (res.error) throw new Error(`Could not unblock: ${res.error.message}`);
}

async function blockedBy(userId: string): Promise<Block[]> {
  const res = await sb().from("blocks").select("*").eq("blocker_id", userId).order("created_at", { ascending: false });
  return throwIf(res, "Could not load blocked users").map((r) => mapBlock(r as Record<string, unknown>));
}

async function isBlocked(a: string, b: string): Promise<boolean> {
  // RLS only exposes blocks the caller created; the profiles_public view
  // already hides blocked pairs in both directions for discovery.
  const res = await sb()
    .from("blocks")
    .select("id")
    .eq("blocker_id", a)
    .eq("blocked_id", b)
    .maybeSingle();
  if (res.error) throw new Error(`Block check failed: ${res.error.message}`);
  return !!res.data;
}

async function fileReport(report: Omit<Report, "id" | "status" | "createdAt">): Promise<Report> {
  const res = await sb()
    .from("reports")
    .insert({ reporter_id: report.reporterId, reported_id: report.reportedId, reason: report.reason, details: report.details })
    .select("*")
    .single();
  return mapReport(throwIf(res, "Could not file report") as Record<string, unknown>);
}

async function listReports(): Promise<Report[]> {
  const res = await sb().from("reports").select("*").order("created_at", { ascending: false });
  return throwIf(res, "Could not load reports").map((r) => mapReport(r as Record<string, unknown>));
}

async function setReportStatus(id: string, status: Report["status"]): Promise<void> {
  const res = await sb().from("reports").update({ status }).eq("id", id);
  if (res.error) throw new Error(`Could not update report: ${res.error.message}`);
}

/* ---------------- chat ---------------- */

async function conversationsFor(userId: string): Promise<Conversation[]> {
  const cRes = await sb()
    .from("conversations")
    .select("*")
    .contains("participant_ids", [userId])
    .order("last_message_at", { ascending: false, nullsFirst: false });
  const rows = throwIf(cRes, "Could not load conversations");
  const ids = rows.map((r) => (r as { id: string }).id);
  let unread: Record<string, number> = {};
  if (ids.length > 0) {
    const mRes = await sb()
      .from("messages")
      .select("conversation_id")
      .in("conversation_id", ids)
      .eq("read", false)
      .neq("sender_id", userId);
    if (!mRes.error && mRes.data) {
      for (const m of mRes.data as { conversation_id: string }[]) {
        unread[m.conversation_id] = (unread[m.conversation_id] ?? 0) + 1;
      }
    }
  }
  return rows.map((r) => mapConversation(r as Record<string, unknown>, unread));
}

async function messagesFor(conversationId: string): Promise<Message[]> {
  const res = await sb()
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(500);
  return throwIf(res, "Could not load messages").map((r) => mapMessage(r as Record<string, unknown>));
}

async function sendMessage(conversationId: string, senderId: string, text: string): Promise<Message | null> {
  const clean = text.trim().slice(0, 2000);
  if (!clean) return null;
  const res = await sb()
    .from("messages")
    .insert({ conversation_id: conversationId, sender_id: senderId, text: clean, delivered: true })
    .select("*")
    .single();
  if (res.error) throw new Error(`Could not send message: ${res.error.message}`);
  return mapMessage(res.data as Record<string, unknown>);
}

async function markConversationRead(conversationId: string, userId: string): Promise<void> {
  const res = await sb()
    .from("messages")
    .update({ read: true })
    .eq("conversation_id", conversationId)
    .neq("sender_id", userId)
    .eq("read", false);
  if (res.error) throw new Error(`Could not mark read: ${res.error.message}`);
}

/* typing indicators via realtime broadcast (no table) */
const typingChannels = new Map<string, RealtimeChannel>();
const typingCbs = new Map<string, Set<(userId: string, isTyping: boolean) => void>>();

function typingChannel(conversationId: string): RealtimeChannel {
  let ch = typingChannels.get(conversationId);
  if (!ch) {
    ch = sb().channel(`typing:${conversationId}`);
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      const p = payload as { userId: string; isTyping: boolean };
      typingCbs.get(conversationId)?.forEach((cb) => cb(p.userId, p.isTyping));
    });
    ch.subscribe();
    typingChannels.set(conversationId, ch);
  }
  return ch;
}

function setTyping(conversationId: string, userId: string, isTyping: boolean): void {
  void typingChannel(conversationId)
    .send({ type: "broadcast", event: "typing", payload: { userId, isTyping } })
    .catch(() => undefined);
}

function subscribeTyping(
  conversationId: string,
  cb: (userId: string, isTyping: boolean) => void,
): () => void {
  typingChannel(conversationId);
  if (!typingCbs.has(conversationId)) typingCbs.set(conversationId, new Set());
  typingCbs.get(conversationId)!.add(cb);
  return () => typingCbs.get(conversationId)?.delete(cb);
}

function subscribeMessages(conversationId: string, cb: (m: Message) => void): () => void {
  const ch = sb()
    .channel(`messages:${conversationId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
      (payload) => cb(mapMessage(payload.new as Record<string, unknown>)),
    )
    .subscribe();
  return () => void sb().removeChannel(ch);
}

/* Part 2 continues — all shared imports live in the header above. */
import { PLANS } from "../../data/seed";

async function logActivity(actorId: string, action: string, detail: string): Promise<void> {
  await sb().from("activity_logs").insert({ actor_id: actorId, actor_role: "admin", action, detail });
}

/* ---------------- notifications ---------------- */

async function notificationsFor(userId: string): Promise<AppNotification[]> {
  const res = await sb().from("notifications").select("*").eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
  return throwIf(res, "Could not load notifications").map((r) => mapNotification(r as Record<string, unknown>));
}

async function getDailyUsage(): Promise<DailyUsage> {
  const res = await sb().rpc("get_daily_usage");
  if (res.error) throw new Error(`Could not load daily usage: ${res.error.message}`);
  const d = res.data as Record<string, unknown>;
  return {
    likesUsed: Number(d.likes_used ?? 0),
    interestsUsed: Number(d.interests_used ?? 0),
    likeLimit: Number(d.like_limit ?? 20),
    interestLimit: Number(d.interest_limit ?? 20),
    isPaid: Boolean(d.is_paid),
    resetsAt: String(d.resets_at ?? ""),
  };
}

async function recordProfileInterest(viewedUserId: string): Promise<{ used: number; limit: number }> {
  const res = await sb().rpc("record_profile_interest", { p_viewed_user_id: viewedUserId });
  if (res.error) {
    if (res.error.message.includes("DAILY_INTEREST_LIMIT_REACHED")) {
      throw new Error("DAILY_INTEREST_LIMIT_REACHED");
    }
    throw new Error(`Could not record interest: ${res.error.message}`);
  }
  const d = res.data as Record<string, unknown>;
  if (!d.allowed) throw new Error("DAILY_INTEREST_LIMIT_REACHED");
  return { used: Number(d.used ?? 0), limit: Number(d.limit ?? 20) };
}

async function unreadCount(userId: string): Promise<number> {
  const res = await sb().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("read", false);
  if (res.error) throw new Error(`Unread count failed: ${res.error.message}`);
  return res.count ?? 0;
}

async function markNotificationRead(id: string): Promise<void> {
  const res = await sb().from("notifications").update({ read: true }).eq("id", id);
  if (res.error) throw new Error(`Could not mark notification read: ${res.error.message}`);
}

async function markAllNotificationsRead(userId: string): Promise<void> {
  const res = await sb().from("notifications").update({ read: true }).eq("user_id", userId).eq("read", false);
  if (res.error) throw new Error(`Could not mark all read: ${res.error.message}`);
}

async function pushNotification(n: Omit<AppNotification, "id" | "createdAt" | "read">): Promise<void> {
  const res = await sb().from("notifications").insert({
    user_id: n.userId, kind: n.kind, title: n.title, body: n.body, link: n.link ?? "",
  });
  if (res.error) throw new Error(`Could not send notification: ${res.error.message}`);
}

/* ---------------- experiences & applications ---------------- */

async function listExperiences(): Promise<DateExperience[]> {
  const res = await sb().from("experiences").select("*").order("title");
  return throwIf(res, "Could not load experiences").map((r) => mapExperience(r as Record<string, unknown>));
}

async function getExperience(id: string): Promise<DateExperience | undefined> {
  const res = await sb().from("experiences").select("*").eq("id", id).maybeSingle();
  if (res.error || !res.data) return undefined;
  return mapExperience(res.data as Record<string, unknown>);
}

async function experienceById(id: string): Promise<DateExperience | undefined> {
  return getExperience(id);
}

async function applyForExperience(input: {
  userId: string;
  experienceId: string;
  slotDate: string;
  slotTime: string;
  note: string;
}): Promise<DateApplication> {
  const res = await sb()
    .from("date_applications")
    .insert({
      user_id: input.userId,
      experience_id: input.experienceId,
      slot_date: input.slotDate,
      slot_time: input.slotTime,
      note: input.note.slice(0, 500),
    })
    .select("*")
    .single();
  return mapApplication(throwIf(res, "Could not submit application") as Record<string, unknown>);
}

async function applicationsFor(userId: string): Promise<DateApplication[]> {
  const res = await sb().from("date_applications").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  return throwIf(res, "Could not load applications").map((r) => mapApplication(r as Record<string, unknown>));
}

async function allApplications(): Promise<DateApplication[]> {
  const res = await sb().from("date_applications").select("*").order("created_at", { ascending: false });
  return throwIf(res, "Could not load applications").map((r) => mapApplication(r as Record<string, unknown>));
}

async function setApplicationStatus(
  id: string,
  status: DateApplication["status"],
  adminNote: string | null,
  actorId: string,
): Promise<void> {
  const res = await sb()
    .from("date_applications")
    .update({ status, admin_note: adminNote, decided_at: new Date().toISOString() })
    .eq("id", id);
  if (res.error) throw new Error(`Could not update application: ${res.error.message}`);
  await logActivity(actorId, "application.status", `Application ${id} → ${status}`);
}

async function cancelApplication(id: string, userId: string): Promise<void> {
  const res = await sb().from("date_applications").update({ status: "cancelled" }).eq("id", id).eq("user_id", userId);
  if (res.error) throw new Error(`Could not cancel application: ${res.error.message}`);
}

/* ---------------- bookings ---------------- */

async function bookingsFor(userId: string): Promise<DateBooking[]> {
  const res = await sb()
    .from("date_bookings")
    .select("*")
    .or(`user_id.eq.${userId},partner_id.eq.${userId}`)
    .order("date", { ascending: false });
  return throwIf(res, "Could not load bookings").map((r) => mapBooking(r as Record<string, unknown>));
}

async function allBookings(): Promise<DateBooking[]> {
  const res = await sb().from("date_bookings").select("*").order("date", { ascending: false });
  return throwIf(res, "Could not load bookings").map((r) => mapBooking(r as Record<string, unknown>));
}

async function createBooking(
  input: Omit<DateBooking, "id" | "createdAt">,
  actorId: string,
): Promise<DateBooking> {
  const res = await sb()
    .from("date_bookings")
    .insert({
      user_id: input.userId,
      partner_id: input.partnerId,
      experience_id: input.experienceId,
      cafe_id: input.cafeId,
      date: input.date,
      time: input.time,
      venue: input.venue,
      status: input.status === "upcoming" ? "confirmed" : input.status,
      amount: input.amount,
      payment_status: input.paymentStatus,
    })
    .select("*")
    .single();
  const booking = mapBooking(throwIf(res, "Could not create booking") as Record<string, unknown>);
  await logActivity(actorId, "booking.create", `Booking ${booking.id} at ${booking.venue} on ${booking.date}`);
  return booking;
}

async function setBookingStatus(id: string, status: DateBooking["status"], actorId: string): Promise<void> {
  const res = await sb().from("date_bookings").update({ status }).eq("id", id);
  if (res.error) throw new Error(`Could not update booking: ${res.error.message}`);
  await logActivity(actorId, "booking.status", `Booking ${id} → ${status}`);
}

/* ---------------- cafes ---------------- */

async function listCafes(): Promise<Cafe[]> {
  const res = await sb().from("cafes").select("*").order("name");
  return throwIf(res, "Could not load cafés").map((r) => mapCafe(r as Record<string, unknown>));
}

async function getCafe(id: string): Promise<Cafe | undefined> {
  const res = await sb().from("cafes").select("*").eq("id", id).maybeSingle();
  if (res.error || !res.data) return undefined;
  return mapCafe(res.data as Record<string, unknown>);
}

async function upsertCafe(cafe: Cafe, actorId: string): Promise<void> {
  const res = await sb().from("cafes").upsert(unmapCafe(cafe), { onConflict: "id" });
  if (res.error) throw new Error(`Could not save café: ${res.error.message}`);
  await logActivity(actorId, "cafe.upsert", `Café ${cafe.name} saved`);
}

async function saveCafe(userId: string, cafeId: string): Promise<void> {
  const res = await sb().from("saved_cafes").insert({ user_id: userId, cafe_id: cafeId });
  if (res.error && res.error.code !== "23505")
    throw new Error(`Could not save café: ${res.error.message}`);
}

async function unsaveCafe(userId: string, cafeId: string): Promise<void> {
  const res = await sb().from("saved_cafes").delete().eq("user_id", userId).eq("cafe_id", cafeId);
  if (res.error) throw new Error(`Could not unsave café: ${res.error.message}`);
}

async function savedCafeIds(userId: string): Promise<string[]> {
  const res = await sb().from("saved_cafes").select("cafe_id").eq("user_id", userId);
  return throwIf(res, "Could not load saved cafés").map((r) => (r as { cafe_id: string }).cafe_id);
}

async function isCafeSaved(userId: string, cafeId: string): Promise<boolean> {
  return (await savedCafeIds(userId)).includes(cafeId);
}

/* ---------------- memberships & payments ---------------- */

async function listPlans(): Promise<MembershipPlan[]> {
  try {
    const res = await sb().from("membership_plans").select("*").order("price");
    if (res.error) throw res.error;
    const plans = (res.data as Record<string, unknown>[]).map(mapPlan);
    return plans.length > 0 ? plans : PLANS;
  } catch {
    return PLANS;
  }
}

async function activeSubscription(userId: string): Promise<Subscription | undefined> {
  // NULL expires_at = lifetime membership → always active.
  const res = await sb()
    .from("subscriptions")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) throw new Error(`Could not load subscription: ${res.error.message}`);
  return res.data ? mapSubscription(res.data as Record<string, unknown>) : undefined;
}

async function subscriptionsFor(userId: string): Promise<Subscription[]> {
  const res = await sb().from("subscriptions").select("*").eq("user_id", userId).order("started_at", { ascending: false });
  return throwIf(res, "Could not load subscriptions").map((r) => mapSubscription(r as Record<string, unknown>));
}

/**
 * Creates a PENDING payment intent. Real capture/verification happens
 * server-side (Razorpay order + webhook → Edge Function). The client must
 * never mark a payment verified on its own.
 */
async function purchaseMembership(userId: string, planId: PlanId, amount: number): Promise<Payment> {
  const res = await sb()
    .from("payments")
    .insert({
      user_id: userId,
      kind: "membership",
      amount,
      plan_id: planId,
      status: "pending",
      razorpay_order_id: `order_pending_${Date.now().toString(36)}`,
      method: "razorpay",
    })
    .select("*")
    .single();
  if (res.error)
    throw new Error(
      `Could not start checkout: ${res.error.message}. The payments Edge Function may not be configured yet.`,
    );
  return mapPayment(res.data as Record<string, unknown>);
}

/** Admin/server-side verification. Members cannot call this (RLS).
 *  TEST MODE ONLY: the production path is the verify-payment Edge
 *  Function. The status guard on the update makes double-verification
 *  a no-op even if two admins click at once. */
async function verifyPayment(paymentId: string, actorId: string): Promise<Payment | undefined> {
  const cur = await sb().from("payments").select("*").eq("id", paymentId).maybeSingle();
  const row = throwIf(cur, "Payment not found");
  const payment = mapPayment(row as Record<string, unknown>);
  if (payment.status !== "pending") return payment;

  // Optimistic guard: only a still-pending row flips to verified, so a
  // concurrent verification cannot double-activate the membership.
  const upd = await sb()
    .from("payments")
    .update({ status: "verified", razorpay_payment_id: `pay_${Date.now().toString(36)}` })
    .eq("id", paymentId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (upd.error) throw new Error(`Could not verify payment: ${upd.error.message}`);
  if (!upd.data) {
    // Lost the race — the other verification won; return current state.
    const again = await sb().from("payments").select("*").eq("id", paymentId).maybeSingle();
    return again.data ? mapPayment(again.data as Record<string, unknown>) : payment;
  }
  const verified = mapPayment(upd.data as Record<string, unknown>);

  if (verified.kind === "membership" && verified.planId) {
    await sb().from("subscriptions").update({ status: "expired" }).eq("user_id", verified.userId).eq("status", "active");
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    await sb().from("subscriptions").insert({
      user_id: verified.userId,
      plan_id: verified.planId,
      status: "active",
      started_at: start.toISOString(),
      expires_at: end.toISOString(),
      auto_renew: true,
    });
    await sb()
      .from("profiles")
      .update({ plan_id: verified.planId, plan_expires_at: end.toISOString() })
      .eq("id", verified.userId);
    await pushNotification({
      userId: verified.userId,
      kind: "membership",
      title: "Membership activated",
      body: `Your ${verified.planId} plan is now active. Enjoy priority matchmaking.`,
      link: "/membership",
    });
  }
  await logActivity(actorId, "payment.verify", `Verified payment ${paymentId} (₹${verified.amount})`);
  return verified;
}

async function recordCashPayment(
  userId: string,
  amount: number,
  note: string,
  actorId: string,
): Promise<Payment> {
  const res = await sb()
    .from("payments")
    .insert({ user_id: userId, kind: "cash", amount, status: "verified", method: `cash — ${note}`.slice(0, 120) })
    .select("*")
    .single();
  const payment = mapPayment(throwIf(res, "Could not record cash payment") as Record<string, unknown>);
  await logActivity(actorId, "payment.cash", `Recorded cash payment ₹${amount} for ${userId}: ${note}`);
  return payment;
}

async function refundPayment(paymentId: string, actorId: string): Promise<void> {
  const cur = await sb().from("payments").select("amount,status").eq("id", paymentId).maybeSingle();
  const row = throwIf(cur, "Payment not found") as Record<string, unknown>;
  if (row.status !== "verified") throw new Error("Only verified payments can be refunded.");
  const res = await sb().from("payments").update({ status: "refunded" }).eq("id", paymentId);
  if (res.error) throw new Error(`Could not refund: ${res.error.message}`);
  await logActivity(actorId, "payment.refund", `Refunded payment ${paymentId} (₹${row.amount})`);
}

async function paymentsFor(userId: string): Promise<Payment[]> {
  const res = await sb().from("payments").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  return throwIf(res, "Could not load payments").map((r) => mapPayment(r as Record<string, unknown>));
}

async function allPayments(): Promise<Payment[]> {
  const res = await sb().from("payments").select("*").order("created_at", { ascending: false }).limit(500);
  return throwIf(res, "Could not load payments").map((r) => mapPayment(r as Record<string, unknown>));
}

/* ---------------- investors / activity / cms / settings ---------------- */

async function listInvestors(): Promise<InvestorRecord[]> {
  const res = await sb().from("investors").select("*").order("name");
  return throwIf(res, "Could not load investors").map((r) => mapInvestor(r as Record<string, unknown>));
}

async function upsertInvestor(rec: InvestorRecord, actorId: string): Promise<void> {
  const res = await sb().from("investors").upsert(unmapInvestor(rec), { onConflict: "id" });
  if (res.error) throw new Error(`Could not save investor: ${res.error.message}`);
  await logActivity(actorId, "investor.upsert", `Investor record ${rec.name} updated`);
}

async function recordInvestorPayout(id: string, amount: number, actorId: string): Promise<void> {
  const cur = await sb().from("investors").select("*").eq("id", id).maybeSingle();
  const row = throwIf(cur, "Investor not found") as Record<string, unknown>;
  const paidOut = Number(row.paid_out ?? 0) + amount;
  const pending = Math.max(0, Number(row.pending ?? 0) - amount);
  const res = await sb().from("investors").update({ paid_out: paidOut, pending }).eq("id", id);
  if (res.error) throw new Error(`Could not record payout: ${res.error.message}`);
  await logActivity(actorId, "investor.payout", `Payout ₹${amount} recorded for ${row.name}`);
}

async function listActivity(): Promise<ActivityLog[]> {
  const res = await sb().from("activity_logs").select("*").order("created_at", { ascending: false }).limit(500);
  return throwIf(res, "Could not load activity").map((r) => mapActivity(r as Record<string, unknown>));
}

async function getCmsPage(slug: string): Promise<CmsPage | undefined> {
  const res = await sb().from("cms_pages").select("*").eq("slug", slug).maybeSingle();
  if (res.error || !res.data) return undefined;
  return mapCms(res.data as Record<string, unknown>);
}

async function saveCmsPage(page: CmsPage, actorId: string): Promise<void> {
  const res = await sb()
    .from("cms_pages")
    .upsert({ slug: page.slug, title: page.title, body: page.body, updated_at: new Date().toISOString() }, { onConflict: "slug" });
  if (res.error) throw new Error(`Could not save page: ${res.error.message}`);
  await logActivity(actorId, "cms.update", `CMS page "${page.slug}" updated`);
}

async function getSettings(): Promise<PlatformSettings> {
  const res = await sb().from("platform_settings").select("*").eq("id", 1).maybeSingle();
  if (res.error) throw new Error(`Could not load settings: ${res.error.message}`);
  if (!res.data) {
    return { maintenanceMode: false, minAge: 18, razorpayTestMode: true, supportEmail: "care@datevra.in", announcements: "" };
  }
  return mapSettings(res.data as Record<string, unknown>);
}

async function saveSettings(s: PlatformSettings, actorId: string): Promise<void> {
  const res = await sb().from("platform_settings").upsert({ id: 1, ...unmapSettings(s) }, { onConflict: "id" });
  if (res.error) throw new Error(`Could not save settings: ${res.error.message}`);
  await logActivity(actorId, "settings.update", "Platform settings updated");
}

/* ---------------- admin: users & analytics ---------------- */

async function allUsers(): Promise<UserProfile[]> {
  const res = await sb().from("profiles").select("*").order("created_at", { ascending: false }).limit(500);
  return throwIf(res, "Could not load users").map((r) => mapProfile(r as Record<string, unknown>));
}

async function setUserVerified(id: string, verified: boolean, actorId: string): Promise<void> {
  const res = await sb().from("profiles").update({ verified }).eq("id", id);
  if (res.error) throw new Error(`Could not update verification: ${res.error.message}`);
  await logActivity(actorId, "user.verify", `User ${id} verification → ${verified}`);
}

/* ---------------- complimentary passes (Supabase) ---------------- */

function genPassCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "DVR-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function listComplimentaryPasses(): Promise<ComplimentaryPass[]> {
  const res = await sb().from("complimentary_passes").select("*").order("created_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Row[]).map(mapComplimentaryPass);
}

async function myComplimentaryPasses(userId: string): Promise<ComplimentaryPass[]> {
  const res = await sb().from("complimentary_passes").select("*").eq("issued_to_user_id", userId).order("created_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Row[]).map(mapComplimentaryPass);
}

async function createComplimentaryPass(
  input: { cafeId: string; issuedToUserId?: string | null; note?: string | null; expiresAt?: string | null },
  adminId: string
): Promise<ComplimentaryPass> {
  const res = await sb().from("complimentary_passes").insert({
    code: genPassCode(),
    cafe_id: input.cafeId,
    issued_to_user_id: input.issuedToUserId ?? null,
    issued_by_admin_id: adminId,
    note: input.note ?? null,
    expires_at: input.expiresAt ?? null,
  }).select("*").single();
  if (res.error) throw new Error(res.error.message);
  await logActivity(adminId, "pass.create", `Complimentary pass ${(res.data as Row).code} created`);
  return mapComplimentaryPass(res.data as Row);
}

async function redeemComplimentaryPass(code: string, _userId: string): Promise<ComplimentaryPass> {
  // Server-side redemption via the SECURITY DEFINER redeem_pass() RPC:
  // atomic row-locked update enforcing eligibility, expiry and single-use.
  // Direct table SELECT/UPDATE is blocked by RLS for non-admins (unassigned
  // codes are invisible, no UPDATE policy), so the RPC is the only path.
  // The acting user is derived from auth.uid() server-side, not the param.
  const normalized = code.toUpperCase().trim();
  const res = await sb().rpc("redeem_pass", { p_code: normalized });
  if (res.error) throw new Error(res.error.message);
  return mapComplimentaryPass(res.data as Row);
}

async function revokeComplimentaryPass(id: string, adminId: string): Promise<void> {
  const res = await sb().from("complimentary_passes").update({ status: "revoked" }).eq("id", id);
  if (res.error) throw new Error(res.error.message);
  await logActivity(adminId, "pass.revoke", `Complimentary pass ${id} revoked`);
}

/* ---------------- match proposals (Supabase) ---------------- */

async function listMatchProposals(): Promise<MatchProposal[]> {
  const res = await sb().from("match_proposals").select("*").order("created_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Row[]).map(mapMatchProposal);
}

async function myMatchProposals(userId: string): Promise<MatchProposal[]> {
  const res = await sb().from("match_proposals").select("*")
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .order("created_at", { ascending: false });
  if (res.error) throw new Error(res.error.message);
  return (res.data as Row[]).map(mapMatchProposal);
}

async function createMatchProposal(userAId: string, userBId: string, message: string | null, adminId: string): Promise<MatchProposal> {
  if (userAId === userBId) throw new Error("Cannot propose a match with the same person.");
  const res = await sb().from("match_proposals").insert({
    user_a_id: userAId, user_b_id: userBId,
    proposed_by_admin_id: adminId, message,
  }).select("*").single();
  if (res.error) throw new Error(res.error.message);
  await logActivity(adminId, "proposal.create", `Match proposal ${userAId} ↔ ${userBId}`);
  return mapMatchProposal(res.data as Row);
}

async function respondToMatchProposal(proposalId: string, _userId: string, accept: boolean): Promise<MatchProposal> {
  // Server-side response via the SECURITY DEFINER respond_to_proposal() RPC:
  // validates the caller is a participant, records the response, and on dual
  // accept atomically creates the match, conversation and notifications.
  // Direct table UPDATE is blocked by RLS for non-admins, so the RPC is the
  // only path. The acting user is derived from auth.uid() server-side.
  const res = await sb().rpc("respond_to_proposal", { p_proposal_id: proposalId, p_accept: accept });
  if (res.error) throw new Error(res.error.message);
  return mapMatchProposal(res.data as Row);
}

async function revenueSummary(): Promise<{
  membership: number; experience: number; cash: number; refunded: number;
  cafeCommissions: number; total: number; payments: number;
  activeSubscriptions: number; totalUsers: number; totalMatches: number;
  pendingApplications: number;
}> {
  const pays = await sb().from("payments").select("kind,amount,status");
  const rows = throwIf(pays, "Could not load payments") as { kind: string; amount: number; status: string }[];
  const sum = (k: string) => rows.filter((p) => p.status === "verified" && p.kind === k).reduce((s, p) => s + p.amount, 0);
  const membership = sum("membership");
  const experience = sum("experience");
  const cash = sum("cash");
  const refunded = rows.filter((p) => p.status === "refunded").reduce((s, p) => s + p.amount, 0);

  const cafes = await sb().from("cafes").select("revenue,commission_pct,partner");
  const cafeRows = throwIf(cafes, "Could not load cafés") as { revenue: number; commission_pct: number; partner: boolean }[];
  const cafeCommissions = cafeRows
    .filter((c) => c.partner)
    .reduce((s, c) => s + Math.round((c.revenue * Number(c.commission_pct)) / 100), 0);

  const [subs, users, matches, apps] = await Promise.all([
    sb().from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active"),
    sb().from("profiles").select("id", { count: "exact", head: true }).eq("is_admin", false),
    sb().from("matches").select("id", { count: "exact", head: true }),
    sb().from("date_applications").select("id", { count: "exact", head: true }).in("status", ["submitted", "under_review", "eligible"]),
  ]);

  return {
    membership, experience, cash, refunded, cafeCommissions,
    total: membership + experience + cash,
    payments: rows.length,
    activeSubscriptions: subs.count ?? 0,
    totalUsers: users.count ?? 0,
    totalMatches: matches.count ?? 0,
    pendingApplications: apps.count ?? 0,
  };
}

/* ---------------- realtime fan-out ---------------- */

const EVENT_TABLES: Record<BackendEvent, string[]> = {
  profiles: ["profiles"],
  likes: ["likes"],
  matches: ["matches"],
  notifications: ["notifications"],
  applications: ["date_applications"],
  bookings: ["date_bookings"],
  cafes: ["cafes"],
  payments: ["payments"],
  subscriptions: ["subscriptions"],
  reports: ["reports"],
  blocks: ["blocks"],
  conversations: ["conversations", "messages"],
  settings: ["platform_settings"],
  cms: ["cms_pages"],
  investors: ["investors"],
  activity: ["activity_logs"],
  passes: ["complimentary_passes"],
  proposals: ["match_proposals"],
};

const eventSubs = new Map<BackendEvent, Set<() => void>>();
let dbChannel: RealtimeChannel | null = null;

function ensureDbChannel(): void {
  if (dbChannel) return;
  const tables = Array.from(new Set(Object.values(EVENT_TABLES).flat()));
  const ch = sb().channel("datevra-db-events");
  for (const table of tables) {
    ch.on("postgres_changes", { event: "*", schema: "public", table }, (payload) => {
      for (const [evt, ts] of Object.entries(EVENT_TABLES) as [BackendEvent, string[]][]) {
        if (ts.includes(payload.table)) eventSubs.get(evt)?.forEach((cb) => cb());
      }
    });
  }
  ch.subscribe();
  dbChannel = ch;
}

function subscribe(evt: BackendEvent, cb: () => void): () => void {
  ensureDbChannel();
  if (!eventSubs.has(evt)) eventSubs.set(evt, new Set());
  eventSubs.get(evt)!.add(cb);
  return () => eventSubs.get(evt)?.delete(cb);
}

/* ---------------- backend object ---------------- */

export const supabaseBackend = {
  mode: "supabase",
  getUser,
  listProfiles,
  updateUser,
  uploadPhoto,
  deletePhoto,
  deleteAccount,
  getPrefs,
  savePrefs,
  hasLiked,
  hasPassed,
  sendLike,
  sendPass,
  getDailyUsage,
  recordProfileInterest,
  likesReceived,
  likesSent,
  matchesFor,
  unmatch,
  saveProfile,
  unsaveProfile,
  savedProfiles,
  blockUser,
  unblockUser,
  blockedBy,
  isBlocked,
  fileReport,
  listReports,
  setReportStatus,
  conversationsFor,
  messagesFor,
  sendMessage,
  markConversationRead,
  setTyping,
  subscribeMessages,
  subscribeTyping,
  notificationsFor,
  unreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  pushNotification,
  listExperiences,
  getExperience,
  experienceById,
  applyForExperience,
  applicationsFor,
  allApplications,
  setApplicationStatus,
  cancelApplication,
  bookingsFor,
  allBookings,
  createBooking,
  setBookingStatus,
  listCafes,
  getCafe,
  upsertCafe,
  saveCafe,
  unsaveCafe,
  savedCafeIds,
  isCafeSaved,
  listPlans,
  activeSubscription,
  subscriptionsFor,
  purchaseMembership,
  verifyPayment,
  recordCashPayment,
  refundPayment,
  paymentsFor,
  allPayments,
  listInvestors,
  upsertInvestor,
  recordInvestorPayout,
  listActivity,
  getCmsPage,
  saveCmsPage,
  getSettings,
  saveSettings,
  allUsers,
  setUserVerified,
  revenueSummary,
  listComplimentaryPasses,
  createComplimentaryPass,
  redeemComplimentaryPass,
  revokeComplimentaryPass,
  myComplimentaryPasses,
  listMatchProposals,
  createMatchProposal,
  respondToMatchProposal,
  myMatchProposals,
  subscribe,
} satisfies Backend;

export type { UserProfile };
