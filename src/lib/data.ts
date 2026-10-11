import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as mock from "./mockDb";
import { supabaseBackend } from "./supabase/db";
import { isSupabaseConfigured } from "./supabase";
import { PLANS } from "../data/seed";
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
} from "./types";

/* =====================================================================
 * Unified data layer.
 *
 * Every screen talks to `Backend` — never to mockDb or Supabase directly.
 * - Demo mode (no env vars):   async wrappers around the local mockDb.
 * - Supabase mode (env vars):   the real Supabase backend (RLS-enforced).
 *
 * useBackend() picks the implementation; useAsync() is the standard
 * read pattern: const { data, loading, error, refresh } =
 *   useAsync((b) => b.notificationsFor(user.id), [user?.id], []).
 * ===================================================================== */

export interface Session {
  userId: string;
  role: "user" | "admin";
}

export type BackendEvent =
  | "profiles" | "likes" | "matches" | "notifications" | "applications"
  | "bookings" | "cafes" | "payments" | "subscriptions" | "reports"
  | "blocks" | "conversations" | "settings" | "cms" | "investors" | "activity"
  | "passes" | "proposals";

export interface Backend {
  readonly mode: "demo" | "supabase";
  getUser(id: string): Promise<UserProfile | undefined>;
  listProfiles(): Promise<UserProfile[]>;
  updateUser(id: string, patch: Partial<UserProfile>): Promise<UserProfile | undefined>;
  /**
   * Upload a profile photo. Returns the displayable photo URL to store on
   * the profile. `onProgress` receives 0–100 during upload (Supabase mode
   * reports real progress; demo mode simulates it).
   */
  uploadPhoto(userId: string, file: File, onProgress?: (pct: number) => void): Promise<string>;
  /** Remove a profile photo from storage (profile array update is the caller's job). */
  deletePhoto(userId: string, photoUrl: string): Promise<void>;
  /**
   * Permanently delete the member's own account and personal data
   * (profile, photos, likes, matches, messages, notifications,
   * applications, bookings, blocks, reports).
   * Payment and subscription rows are RETAINED with the user link
   * anonymized, for accounting/audit purposes (disclosed in the UI).
   * Must only ever be called for the signed-in user's own id.
   */
  deleteAccount(userId: string): Promise<void>;
  getPrefs(userId: string): Promise<MatchPreferences>;
  savePrefs(userId: string, prefs: MatchPreferences): Promise<void>;
  hasLiked(from: string, to: string): Promise<boolean>;
  hasPassed(from: string, to: string): Promise<boolean>;
  sendLike(from: string, to: string): Promise<{ match: Match | null }>;
  sendPass(from: string, to: string): Promise<void>;
  /** Today's like/interest usage for the free-tier daily caps. */
  getDailyUsage(userId: string): Promise<DailyUsage>;
  /** Record one profile-interest view; throws DAILY_INTEREST_LIMIT_REACHED when capped. */
  recordProfileInterest(viewerId: string, viewedId: string): Promise<{ used: number; limit: number }>;
  likesReceived(userId: string): Promise<Like[]>;
  likesSent(userId: string): Promise<Like[]>;
  matchesFor(userId: string): Promise<Match[]>;
  unmatch(matchId: string, byUserId: string): Promise<void>;
  saveProfile(userId: string, profileId: string): Promise<void>;
  unsaveProfile(userId: string, profileId: string): Promise<void>;
  savedProfiles(userId: string): Promise<string[]>;
  blockUser(blockerId: string, blockedId: string): Promise<void>;
  unblockUser(blockerId: string, blockedId: string): Promise<void>;
  blockedBy(userId: string): Promise<Block[]>;
  isBlocked(a: string, b: string): Promise<boolean>;
  fileReport(r: Omit<Report, "id" | "status" | "createdAt">): Promise<Report>;
  listReports(): Promise<Report[]>;
  setReportStatus(id: string, status: Report["status"]): Promise<void>;
  conversationsFor(userId: string): Promise<Conversation[]>;
  messagesFor(conversationId: string): Promise<Message[]>;
  sendMessage(conversationId: string, senderId: string, text: string): Promise<Message | null>;
  markConversationRead(conversationId: string, userId: string): Promise<void>;
  setTyping(conversationId: string, userId: string, isTyping: boolean): void;
  subscribeMessages(conversationId: string, cb: (m: Message) => void): () => void;
  subscribeTyping(conversationId: string, cb: (userId: string, isTyping: boolean) => void): () => void;
  notificationsFor(userId: string): Promise<AppNotification[]>;
  unreadCount(userId: string): Promise<number>;
  markNotificationRead(id: string): Promise<void>;
  markAllNotificationsRead(userId: string): Promise<void>;
  pushNotification(n: Omit<AppNotification, "id" | "createdAt" | "read">): Promise<void>;
  listExperiences(): Promise<DateExperience[]>;
  getExperience(id: string): Promise<DateExperience | undefined>;
  experienceById(id: string): Promise<DateExperience | undefined>;
  applyForExperience(input: {
    userId: string; experienceId: string; slotDate: string; slotTime: string; note: string;
  }): Promise<DateApplication>;
  applicationsFor(userId: string): Promise<DateApplication[]>;
  allApplications(): Promise<DateApplication[]>;
  setApplicationStatus(id: string, status: DateApplication["status"], adminNote: string | null, actorId: string): Promise<void>;
  cancelApplication(id: string, userId: string): Promise<void>;
  bookingsFor(userId: string): Promise<DateBooking[]>;
  allBookings(): Promise<DateBooking[]>;
  createBooking(input: Omit<DateBooking, "id" | "createdAt">, actorId: string): Promise<DateBooking>;
  setBookingStatus(id: string, status: DateBooking["status"], actorId: string): Promise<void>;
  listCafes(): Promise<Cafe[]>;
  getCafe(id: string): Promise<Cafe | undefined>;
  upsertCafe(cafe: Cafe, actorId: string): Promise<void>;
  saveCafe(userId: string, cafeId: string): Promise<void>;
  unsaveCafe(userId: string, cafeId: string): Promise<void>;
  savedCafeIds(userId: string): Promise<string[]>;
  isCafeSaved(userId: string, cafeId: string): Promise<boolean>;
  listPlans(): Promise<MembershipPlan[]>;
  activeSubscription(userId: string): Promise<Subscription | undefined>;
  subscriptionsFor(userId: string): Promise<Subscription[]>;
  purchaseMembership(userId: string, planId: PlanId, amount: number): Promise<Payment>;
  verifyPayment(paymentId: string, actorId: string): Promise<Payment | undefined>;
  recordCashPayment(userId: string, amount: number, note: string, actorId: string): Promise<Payment>;
  refundPayment(paymentId: string, actorId: string): Promise<void>;
  paymentsFor(userId: string): Promise<Payment[]>;
  allPayments(): Promise<Payment[]>;
  listInvestors(): Promise<InvestorRecord[]>;
  upsertInvestor(rec: InvestorRecord, actorId: string): Promise<void>;
  recordInvestorPayout(id: string, amount: number, actorId: string): Promise<void>;
  listActivity(): Promise<ActivityLog[]>;
  getCmsPage(slug: string): Promise<CmsPage | undefined>;
  saveCmsPage(page: CmsPage, actorId: string): Promise<void>;
  getSettings(): Promise<PlatformSettings>;
  saveSettings(s: PlatformSettings, actorId: string): Promise<void>;
  allUsers(): Promise<UserProfile[]>;
  setUserVerified(id: string, verified: boolean, actorId: string): Promise<void>;
  revenueSummary(): Promise<{
    membership: number; experience: number; cash: number; refunded: number;
    cafeCommissions: number; total: number; payments: number;
    activeSubscriptions: number; totalUsers: number; totalMatches: number;
    pendingApplications: number;
  }>;
  /* ---------------- complimentary passes ---------------- */
  listComplimentaryPasses(): Promise<ComplimentaryPass[]>;
  createComplimentaryPass(input: {
    cafeId: string; issuedToUserId?: string | null; note?: string | null;
    expiresAt?: string | null;
  }, adminId: string): Promise<ComplimentaryPass>;
  redeemComplimentaryPass(code: string, userId: string): Promise<ComplimentaryPass>;
  revokeComplimentaryPass(id: string, adminId: string): Promise<void>;
  myComplimentaryPasses(userId: string): Promise<ComplimentaryPass[]>;
  /* ---------------- curated match proposals ---------------- */
  listMatchProposals(): Promise<MatchProposal[]>;
  createMatchProposal(userAId: string, userBId: string, message: string | null, adminId: string): Promise<MatchProposal>;
  respondToMatchProposal(proposalId: string, userId: string, accept: boolean): Promise<MatchProposal>;
  myMatchProposals(userId: string): Promise<MatchProposal[]>;
  /** Coarse invalidation subscription (realtime in Supabase mode). */
  subscribe(evt: BackendEvent, cb: () => void): () => void;
  /** Demo-mode only: wipes local data. No-op in Supabase mode. */
  resetDemo?(): void;
}

/* ---------------- demo backend: async wrappers around mockDb ---------------- */

const DEMO_EVENT_MAP: Record<BackendEvent, string | null> = {
  profiles: "profile",
  likes: "likes",
  matches: "matches",
  notifications: "notifications",
  applications: null,
  bookings: null,
  cafes: null,
  payments: "payments",
  subscriptions: "payments",
  reports: null,
  blocks: "blocks",
  conversations: "conversations",
  settings: null,
  cms: null,
  investors: null,
  activity: null,
  passes: "passes",
  proposals: "proposals",
};

export const demoBackend: Backend = {
  mode: "demo",
  getUser: (id) => Promise.resolve(mock.getUser(id)),
  listProfiles: () => Promise.resolve(mock.listProfiles()),
  updateUser: (id, patch) => Promise.resolve(mock.updateUser(id, patch)),
  uploadPhoto: (userId, file, onProgress) => mock.uploadPhoto(userId, file, onProgress),
  deletePhoto: (userId, photoUrl) => Promise.resolve(mock.deletePhoto(userId, photoUrl)),
  deleteAccount: (userId) => Promise.resolve(mock.deleteAccount(userId)),
  getPrefs: (u) => Promise.resolve(mock.getPrefs(u)),
  savePrefs: (u, p) => Promise.resolve(mock.savePrefs(u, p)),
  hasLiked: (a, b) => Promise.resolve(mock.hasLiked(a, b)),
  hasPassed: (a, b) => Promise.resolve(mock.hasPassed(a, b)),
  sendLike: (a, b) => Promise.resolve(mock.sendLike(a, b)),
  sendPass: (a, b) => Promise.resolve(mock.sendPass(a, b)),
  getDailyUsage: (u) => Promise.resolve(mock.getDailyUsage(u)),
  recordProfileInterest: (a, b) => Promise.resolve(mock.recordProfileInterest(a, b)),
  likesReceived: (u) => Promise.resolve(mock.likesReceived(u)),
  likesSent: (u) => Promise.resolve(mock.likesSent(u)),
  matchesFor: (u) => Promise.resolve(mock.matchesFor(u)),
  unmatch: (m, b) => Promise.resolve(mock.unmatch(m, b)),
  saveProfile: (u, p) => Promise.resolve(mock.saveProfile(u, p)),
  unsaveProfile: (u, p) => Promise.resolve(mock.unsaveProfile(u, p)),
  savedProfiles: (u) => Promise.resolve(mock.savedProfiles(u)),
  blockUser: (a, b) => Promise.resolve(mock.blockUser(a, b)),
  unblockUser: (a, b) => Promise.resolve(mock.unblockUser(a, b)),
  blockedBy: (u) => Promise.resolve(mock.blockedBy(u)),
  isBlocked: (a, b) => Promise.resolve(mock.isBlocked(a, b)),
  fileReport: (r) => Promise.resolve(mock.fileReport(r)),
  listReports: () => Promise.resolve(mock.listReports()),
  setReportStatus: (id, s) => Promise.resolve(mock.setReportStatus(id, s)),
  conversationsFor: (u) => Promise.resolve(mock.conversationsFor(u)),
  messagesFor: (c) => Promise.resolve(mock.messagesFor(c)),
  sendMessage: (c, s, t) => Promise.resolve(mock.sendMessage(c, s, t)),
  markConversationRead: (c, u) => Promise.resolve(mock.markConversationRead(c, u)),
  setTyping: (c, u, t) => mock.setTyping(c, u, t),
  subscribeMessages: (c, cb) => mock.onMessage(c, cb),
  subscribeTyping: (c, cb) => mock.onTyping(c, cb),
  notificationsFor: (u) => Promise.resolve(mock.notificationsFor(u)),
  unreadCount: (u) => Promise.resolve(mock.unreadCount(u)),
  markNotificationRead: (id) => Promise.resolve(mock.markNotificationRead(id)),
  markAllNotificationsRead: (u) => Promise.resolve(mock.markAllNotificationsRead(u)),
  pushNotification: (n) => Promise.resolve(mock.pushNotification(n)),
  listExperiences: () => Promise.resolve(mock.listExperiences()),
  getExperience: (id) => Promise.resolve(mock.getExperience(id)),
  experienceById: (id) => Promise.resolve(mock.experienceById(id)),
  applyForExperience: (i) => Promise.resolve(mock.applyForExperience(i)),
  applicationsFor: (u) => Promise.resolve(mock.applicationsFor(u)),
  allApplications: () => Promise.resolve(mock.allApplications()),
  setApplicationStatus: (id, s, n, a) => Promise.resolve(mock.setApplicationStatus(id, s, n, a)),
  cancelApplication: (id, u) => Promise.resolve(mock.cancelApplication(id, u)),
  bookingsFor: (u) => Promise.resolve(mock.bookingsFor(u)),
  allBookings: () => Promise.resolve(mock.allBookings()),
  createBooking: (i, a) => Promise.resolve(mock.createBooking(i, a)),
  setBookingStatus: (id, s, a) => Promise.resolve(mock.setBookingStatus(id, s, a)),
  listCafes: () => Promise.resolve(mock.listCafes()),
  getCafe: (id) => Promise.resolve(mock.getCafe(id)),
  upsertCafe: (c, a) => Promise.resolve(mock.upsertCafe(c, a)),
  saveCafe: (u, c) => Promise.resolve(mock.saveCafe(u, c)),
  unsaveCafe: (u, c) => Promise.resolve(mock.unsaveCafe(u, c)),
  savedCafeIds: (u) => Promise.resolve(mock.savedCafeIds(u)),
  isCafeSaved: (u, c) => Promise.resolve(mock.isCafeSaved(u, c)),
  listPlans: () => Promise.resolve(PLANS),
  activeSubscription: (u) => Promise.resolve(mock.activeSubscription(u)),
  subscriptionsFor: (u) => Promise.resolve(mock.subscriptionsFor(u)),
  purchaseMembership: (u, p, a) => Promise.resolve(mock.purchaseMembership(u, p, a)),
  verifyPayment: (id, a) => Promise.resolve(mock.verifyPayment(id, a)),
  recordCashPayment: (u, a, n, ac) => Promise.resolve(mock.recordCashPayment(u, a, n, ac)),
  refundPayment: (id, a) => Promise.resolve(mock.refundPayment(id, a)),
  paymentsFor: (u) => Promise.resolve(mock.paymentsFor(u)),
  allPayments: () => Promise.resolve(mock.allPayments()),
  listInvestors: () => Promise.resolve(mock.listInvestors()),
  upsertInvestor: (r, a) => Promise.resolve(mock.upsertInvestor(r, a)),
  recordInvestorPayout: (id, a, ac) => Promise.resolve(mock.recordInvestorPayout(id, a, ac)),
  listActivity: () => Promise.resolve(mock.listActivity()),
  getCmsPage: (s) => Promise.resolve(mock.getCmsPage(s)),
  saveCmsPage: (p, a) => Promise.resolve(mock.saveCmsPage(p, a)),
  getSettings: () => Promise.resolve(mock.getSettings()),
  saveSettings: (s, a) => Promise.resolve(mock.saveSettings(s, a)),
  allUsers: () => Promise.resolve(mock.allUsers()),
  setUserVerified: (id, v, a) => Promise.resolve(mock.setUserVerified(id, v, a)),
  revenueSummary: () => Promise.resolve(mock.revenueSummary()),
  listComplimentaryPasses: () => Promise.resolve(mock.listComplimentaryPasses()),
  createComplimentaryPass: (input, a) => Promise.resolve(mock.createComplimentaryPass(input, a)),
  redeemComplimentaryPass: (code, u) => Promise.resolve(mock.redeemComplimentaryPass(code, u)),
  revokeComplimentaryPass: (id, a) => Promise.resolve(mock.revokeComplimentaryPass(id, a)),
  myComplimentaryPasses: (u) => Promise.resolve(mock.myComplimentaryPasses(u)),
  listMatchProposals: () => Promise.resolve(mock.listMatchProposals()),
  createMatchProposal: (a, b, m, ad) => Promise.resolve(mock.createMatchProposal(a, b, m, ad)),
  respondToMatchProposal: (id, u, ac) => Promise.resolve(mock.respondToMatchProposal(id, u, ac)),
  myMatchProposals: (u) => Promise.resolve(mock.myMatchProposals(u)),
  subscribe: (evt, cb) => {
    const name = DEMO_EVENT_MAP[evt];
    return name ? mock.onEvent(name, () => cb()) : () => undefined;
  },
  resetDemo: () => mock.resetDemo(),
};

/* ---------------- selection + hooks ---------------- */

export function getBackend(): Backend {
  return isSupabaseConfigured ? supabaseBackend : demoBackend;
}

export function backendMode(): "demo" | "supabase" {
  return isSupabaseConfigured ? "supabase" : "demo";
}

export function useBackend(): Backend {
  return useMemo(() => getBackend(), []);
}

interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Standard read pattern. `initial` avoids null checks at call sites.
 * Automatically re-runs when deps change; call refresh() after mutations.
 *
 * Pass `cacheKey` + `cacheTtlMs` to serve repeat reads from a short-lived
 * in-memory cache (avoids redundant Supabase round-trips when navigating
 * between pages). refresh() always bypasses the cache.
 */
const asyncCache = new Map<string, { at: number; value: unknown }>();

export function useAsync<T>(
  fn: (db: Backend) => Promise<T>,
  deps: unknown[],
  initial: T,
  opts?: { cacheKey?: string; cacheTtlMs?: number },
): AsyncState<T> {
  const db = useBackend();
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const cacheKey = opts?.cacheKey;
  const cacheTtlMs = opts?.cacheTtlMs ?? 30_000;

  const refresh = useCallback(() => {
    if (cacheKey) asyncCache.delete(cacheKey);
    setTick((t) => t + 1);
  }, [cacheKey]);

  useEffect(() => {
    let cancelled = false;
    // Serve from cache when fresh (skip on manual refresh ticks).
    if (cacheKey && tick === 0) {
      const hit = asyncCache.get(cacheKey);
      if (hit && Date.now() - hit.at < cacheTtlMs) {
        setData(hit.value as T);
        setLoading(false);
        return;
      }
    }
    setLoading(true);
    setError(null);
    fnRef
      .current(db)
      .then((d) => {
        if (!cancelled) {
          if (cacheKey) asyncCache.set(cacheKey, { at: Date.now(), value: d });
          setData(d);
          setLoading(false);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Something went wrong.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, tick, ...deps]);

  return { data, loading, error, refresh };
}
