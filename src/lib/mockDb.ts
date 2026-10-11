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
  InvestorRecord,
  Like,
  Match,
  MatchPreferences,
  MatchProposal,
  Message,
  Payment,
  PlanId,
  PlatformSettings,
  Report,
  Subscription,
  UserProfile,
} from "./types";
import { DEMO_PROFILES, SEED_CAFES, SEED_EXPERIENCES } from "../data/seed";
import { computeCompatibility } from "./compat";

/* =====================================================================
 * Demo data adapter.
 *
 * When Supabase env vars are present, swap these call shapes for real
 * Supabase queries (same function names / return types). Until then the
 * app runs fully offline against this localStorage-backed store.
 * ===================================================================== */

const KEY = "datevra-db-v1";
const SESSION_KEY = "datevra-session-v1";

export interface Credential {
  password: string;
  userId: string;
  role: "user" | "admin";
}

interface DbShape {
  users: UserProfile[];
  credentials: Record<string, Credential>;
  prefs: Record<string, MatchPreferences>;
  likes: Like[];
  passes: { from: string; to: string }[];
  savedProfiles: { userId: string; profileId: string }[];
  blocks: Block[];
  reports: Report[];
  matches: Match[];
  conversations: Conversation[];
  messages: Message[];
  notifications: AppNotification[];
  applications: DateApplication[];
  bookings: DateBooking[];
  cafes: Cafe[];
  savedCafes: { userId: string; cafeId: string }[];
  payments: Payment[];
  subscriptions: Subscription[];
  investors: InvestorRecord[];
  activity: ActivityLog[];
  cms: CmsPage[];
  settings: PlatformSettings;
  dailyLimits: DailyLimitRow[];
  complimentaryPasses: ComplimentaryPass[];
  matchProposals: MatchProposal[];
}

export interface DailyLimitRow {
  userId: string;
  action: "like" | "interest";
  /** IST calendar date (YYYY-MM-DD) — server-side reset rule. */
  day: string;
  used: number;
}

export const DAILY_LIKE_LIMIT = 20;
export const DAILY_INTEREST_LIMIT = 20;

/** Today's date in IST (Asia/Kolkata), derived server-side — clients can't shift it. */
export function istToday(): string {
  return new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
}

/** Next IST midnight as an ISO string (for "resets at" messaging). */
export function nextIstMidnightIso(): string {
  const nowIst = Date.now() + 5.5 * 3600 * 1000;
  const d = new Date(nowIst);
  d.setUTCHours(24, 0, 0, 0);
  return new Date(d.getTime() - 5.5 * 3600 * 1000).toISOString();
}

function isPaidMember(userId: string): boolean {
  return activeSubscription(userId) !== undefined;
}

function dailyUsed(db: DbShape, userId: string, action: "like" | "interest"): number {
  const day = istToday();
  return db.dailyLimits.find((r) => r.userId === userId && r.action === action && r.day === day)?.used ?? 0;
}

/**
 * Atomically consume one unit of a daily action.
 * Paid members always pass and are never counted. Free users are capped.
 * (Single-threaded JS: the read-modify-write below is atomic here.)
 */
function consumeDailyAction(db: DbShape, userId: string, action: "like" | "interest"): boolean {
  if (isPaidMember(userId)) return true;
  const limit = action === "like" ? DAILY_LIKE_LIMIT : DAILY_INTEREST_LIMIT;
  const day = istToday();
  let row = db.dailyLimits.find((r) => r.userId === userId && r.action === action && r.day === day);
  if (!row) {
    row = { userId, action, day, used: 0 };
    db.dailyLimits.push(row);
  }
  if (row.used >= limit) return false;
  row.used += 1;
  return true;
}

export function getDailyUsage(userId: string): DailyUsage {
  const db = load();
  return {
    likesUsed: dailyUsed(db, userId, "like"),
    interestsUsed: dailyUsed(db, userId, "interest"),
    likeLimit: DAILY_LIKE_LIMIT,
    interestLimit: DAILY_INTEREST_LIMIT,
    isPaid: isPaidMember(userId),
    resetsAt: nextIstMidnightIso(),
  };
}

/**
 * Record one profile-interest view ("show interest" action).
 * Throws DAILY_INTEREST_LIMIT_REACHED when a free user is capped.
 */
export function recordProfileInterest(viewerId: string, viewedId: string): { used: number; limit: number } {
  const db = load();
  if (!viewerId || viewerId === viewedId) throw new Error("Invalid profile.");
  if (!db.users.some((u) => u.id === viewedId)) throw new Error("Profile not found.");
  if (!consumeDailyAction(db, viewerId, "interest")) {
    throw new Error("DAILY_INTEREST_LIMIT_REACHED");
  }
  save(db);
  return { used: dailyUsed(db, viewerId, "interest"), limit: DAILY_INTEREST_LIMIT };
}

const uid = (p: string) =>
  `${p}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

function defaultPrefs(city: string): MatchPreferences {
  return {
    ageMin: 22,
    ageMax: 35,
    interestedIn: "everyone",
    cities: [city],
    maxDistanceKm: 50,
    relationshipIntents: [],
    minSharedInterests: 1,
  };
}

function seed(): DbShape {
  const demoUser: UserProfile = {
    id: "you-1",
    email: "demo@datevra.in",
    firstName: "Ishaan",
    age: 27,
    gender: "man",
    interestedIn: "women",
    city: "Mumbai",
    bio: "Product manager who plans trips around food. Equally happy at a dive bar or a candlelit table — it's the company that matters.",
    interests: ["Travel", "Live music", "Old cinema", "Filter coffee"],
    hobbies: ["Weekend cycling", "Photography", "Cooking"],
    relationshipIntent: "A serious relationship",
    lifestyle: ["Non-smoker", "Social drinker", "Early riser"],
    photos: [],
    verified: true,
    online: true,
    lastActive: new Date().toISOString(),
    profileComplete: 92,
    plan: null,
    planExpiresAt: null,
    createdAt: new Date(Date.now() - 86400000 * 12).toISOString(),
  };
  const adminUser: UserProfile = {
    ...demoUser,
    id: "admin-1",
    email: "admin@datevra.in",
    firstName: "Datevra",
    bio: "Platform administrator",
    photos: [],
  };

  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const meera = DEMO_PROFILES.find((p) => p.id === "u-meera")!;
  const compat = computeCompatibility(demoUser, meera, defaultPrefs("Mumbai"));

  const match: Match = {
    id: "m-seed-1",
    userA: "you-1",
    userB: "u-meera",
    compatibility: compat.score,
    factors: compat.factors,
    createdAt: iso(now - 86400000 * 2),
  };
  const convo: Conversation = {
    id: "c-seed-1",
    matchId: match.id,
    participantIds: ["you-1", "u-meera"],
    lastMessageAt: iso(now - 3600000 * 5),
    unread: { "you-1": 1, "u-meera": 0 },
  };
  const messages: Message[] = [
    {
      id: "msg-1",
      conversationId: convo.id,
      senderId: "u-meera",
      text: "Okay, your bio won me over at “plans trips around food”. What's the best meal you've had in Mumbai?",
      createdAt: iso(now - 86400000 * 2 + 3600000),
      delivered: true,
      read: true,
    },
    {
      id: "msg-2",
      conversationId: convo.id,
      senderId: "you-1",
      text: "There's this tiny Goan place in Bandra — the vindaloo rewired my brain. Your turn: ocean person, best sunrise spot?",
      createdAt: iso(now - 86400000 * 2 + 7200000),
      delivered: true,
      read: true,
    },
    {
      id: "msg-3",
      conversationId: convo.id,
      senderId: "u-meera",
      text: "Marine Drive at 6am, filter coffee in hand. We should test the theory that it's better with company.",
      createdAt: iso(now - 3600000 * 5),
      delivered: true,
      read: false,
    },
  ];

  return {
    users: [demoUser, adminUser, ...DEMO_PROFILES],
    credentials: {
      "demo@datevra.in": { password: "demo1234", userId: "you-1", role: "user" },
      "admin@datevra.in": { password: "admin1234", userId: "admin-1", role: "admin" },
    },
    prefs: { "you-1": defaultPrefs("Mumbai") },
    likes: [
      { id: "lk-seed-1", fromUserId: "u-kabir", toUserId: "you-1", createdAt: iso(now - 86400000 * 1) },
      { id: "lk-seed-2", fromUserId: "u-aditya", toUserId: "you-1", createdAt: iso(now - 3600000 * 9) },
      { id: "lk-seed-3", fromUserId: "you-1", toUserId: "u-meera", createdAt: iso(now - 86400000 * 3) },
      { id: "lk-seed-4", fromUserId: "u-meera", toUserId: "you-1", createdAt: iso(now - 86400000 * 2) },
    ],
    passes: [],
    savedProfiles: [{ userId: "you-1", profileId: "u-anaya" }],
    blocks: [],
    reports: [],
    matches: [match],
    conversations: [convo],
    messages,
    notifications: [
      {
        id: "n-1",
        userId: "you-1",
        kind: "system",
        title: "Welcome to Datevra",
        body: "Your profile is 92% complete. Add a finishing touch to shine in discovery.",
        link: "/profile",
        read: false,
        createdAt: iso(now - 86400000 * 2),
      },
      {
        id: "n-2",
        userId: "you-1",
        kind: "match",
        title: "It's a match with Meera",
        body: "You both liked each other. Say hello — great conversations start here.",
        link: "/chat",
        read: false,
        createdAt: iso(now - 86400000 * 2),
      },
      {
        id: "n-3",
        userId: "you-1",
        kind: "like",
        title: "Kabir liked your profile",
        body: "Someone new is interested. Take a look at their profile.",
        link: "/likes",
        read: false,
        createdAt: iso(now - 86400000 * 1),
      },
    ],
    applications: [
      {
        id: "ap-seed-1",
        userId: "you-1",
        experienceId: "e-golden-hour",
        slotDate: "2026-10-10",
        slotTime: "5:00 PM",
        note: "Would love the window table if possible.",
        status: "under_review",
        createdAt: iso(now - 86400000 * 1),
        decidedAt: null,
        adminNote: null,
      },
    ],
    bookings: [],
    cafes: SEED_CAFES,
    savedCafes: [{ userId: "you-1", cafeId: "c-suzette-pune" }],
    complimentaryPasses: [],
    matchProposals: [],
    payments: [],
    subscriptions: [],
    investors: [
      {
        id: "inv-1",
        name: "Meridian Angel Collective",
        agreementRef: "DVR-INV-2025-001",
        sharePct: 8,
        schedule: "Quarterly",
        paidOut: 240000,
        pending: 62000,
        notes: "Revenue-share agreement. Tracking record only — not a promise of returns.",
      },
    ],
    activity: [
      {
        id: "al-1",
        actorId: "admin-1",
        actorRole: "admin",
        action: "cafe.partner.approved",
        detail: "Approved partnership for Kala Ghoda Roastery (12% commission)",
        createdAt: iso(now - 86400000 * 4),
      },
    ],
    cms: [
      { slug: "about", title: "About Datevra", body: "Datevra is a premium dating and curated date-experience platform...", updatedAt: iso(now - 86400000 * 30) },
      { slug: "safety", title: "Safety Centre", body: "Your safety comes first...", updatedAt: iso(now - 86400000 * 30) },
    ],
    dailyLimits: [],
    settings: {
      maintenanceMode: false,
      minAge: 18,
      razorpayTestMode: true,
      supportEmail: "care@datevra.in",
      announcements: "Privé-only Chef's Table evenings now open in Hyderabad.",
    },
  };
}

function load(): DbShape {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as DbShape;
      if (parsed && Array.isArray(parsed.users)) return parsed;
    }
  } catch {
    /* fall through to seed */
  }
  const s = seed();
  save(s);
  return s;
}

function save(db: DbShape) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* storage full — demo continues in memory */
  }
}

/* ---------------- tiny event bus (demo "realtime") ---------------- */

type Handler = (payload?: unknown) => void;
const bus = new Map<string, Set<Handler>>();

export function onEvent(name: string, fn: Handler): () => void {
  if (!bus.has(name)) bus.set(name, new Set());
  bus.get(name)!.add(fn);
  return () => bus.get(name)?.delete(fn);
}

function emit(name: string, payload?: unknown) {
  bus.get(name)?.forEach((fn) => fn(payload));
}

/* ---------------- auth ---------------- */

export interface Session {
  userId: string;
  role: "user" | "admin";
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function login(
  email: string,
  password: string,
): { ok: true; session: Session } | { ok: false; error: string } {
  const db = load();
  const cred = db.credentials[email.trim().toLowerCase()];
  if (!cred || cred.password !== password) {
    return { ok: false, error: "Invalid email or password." };
  }
  const session = { userId: cred.userId, role: cred.role };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  return { ok: true, session };
}

export function register(input: {
  firstName: string;
  email: string;
  password: string;
  age: number;
  gender: UserProfile["gender"];
  interestedIn: UserProfile["interestedIn"];
  city: string;
}): { ok: true; session: Session } | { ok: false; error: string } {
  const db = load();
  const email = input.email.trim().toLowerCase();
  if (db.credentials[email]) return { ok: false, error: "An account with this email already exists." };
  if (input.age < db.settings.minAge)
    return { ok: false, error: `You must be at least ${db.settings.minAge} to join Datevra.` };

  const user: UserProfile = {
    id: uid("u"),
    email,
    firstName: input.firstName,
    age: input.age,
    gender: input.gender,
    interestedIn: input.interestedIn,
    city: input.city,
    bio: "",
    interests: [],
    hobbies: [],
    relationshipIntent: "",
    lifestyle: [],
    photos: [],
    verified: false,
    online: true,
    lastActive: new Date().toISOString(),
    profileComplete: 35,
    plan: null,
    planExpiresAt: null,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  db.credentials[email] = { password: input.password, userId: user.id, role: "user" };
  db.prefs[user.id] = defaultPrefs(input.city);
  db.notifications.push({
    id: uid("n"),
    userId: user.id,
    kind: "system",
    title: "Welcome to Datevra",
    body: "Complete your profile to start appearing in discovery.",
    link: "/profile",
    read: false,
    createdAt: new Date().toISOString(),
  });
  save(db);
  const session = { userId: user.id, role: "user" as const };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  emit("auth", session);
  return { ok: true, session };
}

export function logout() {
  localStorage.removeItem(SESSION_KEY);
  emit("auth", null);
}

export function resetDemo() {
  localStorage.removeItem(KEY);
  localStorage.removeItem(SESSION_KEY);
}

/* ---------------- profiles ---------------- */

export function getUser(id: string): UserProfile | undefined {
  return load().users.find((u) => u.id === id);
}

export function listProfiles(): UserProfile[] {
  return load().users.filter((u) => u.id !== "admin-1");
}

export function updateUser(id: string, patch: Partial<UserProfile>): UserProfile | undefined {
  const db = load();
  const u = db.users.find((x) => x.id === id);
  if (!u) return undefined;
  Object.assign(u, patch);
  // recompute completeness
  const fields = [u.bio, u.relationshipIntent, u.city];
  const filled = fields.filter((f) => f && f.length > 0).length;
  u.profileComplete = Math.min(
    100,
    25 + filled * 10 + Math.min(25, u.interests.length * 5) + Math.min(20, u.photos.length * 10),
  );
  save(db);
  emit("profile", u);
  return u;
}

/**
 * Demo-mode photo upload. Validates the file, simulates upload progress,
 * and returns a blob: URL usable for the session. (Blob URLs do not
 * survive a page reload — demo mode only. Supabase mode persists to
 * Storage.)
 */
export async function uploadPhoto(
  _userId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<string> {
  const { validatePhotoFile } = await import("./photos");
  const err = validatePhotoFile(file);
  if (err) throw new Error(err);
  // Simulate a short upload so the progress UI can be exercised.
  const steps = 8;
  for (let i = 1; i <= steps; i++) {
    await new Promise((r) => setTimeout(r, 60));
    onProgress?.(Math.round((i / steps) * 100));
  }
  return URL.createObjectURL(file);
}

/** Demo-mode photo delete: revokes the blob URL when applicable. */
export function deletePhoto(_userId: string, photoUrl: string): void {
  if (photoUrl.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(photoUrl);
    } catch {
      /* already revoked */
    }
  }
}

/**
 * Demo-mode account deletion. Removes the profile and every personal
 * record tied to the user: photos, preferences, likes, passes, matches
 * (+ conversations/messages), notifications, applications, bookings,
 * saved items, blocks, reports, subscriptions, payments, credentials.
 * Shared/global records (cafés, experiences, plans, CMS) are untouched.
 */
export function deleteAccount(userId: string): void {
  const db = load();
  const user = db.users.find((u) => u.id === userId);
  // Revoke any blob photo URLs before dropping the profile.
  for (const p of user?.photos ?? []) deletePhoto(userId, p);

  const matchIds = new Set(db.matches.filter((m) => m.userA === userId || m.userB === userId).map((m) => m.id));
  const convIds = new Set(
    db.conversations.filter((c) => matchIds.has(c.matchId) || c.participantIds.includes(userId)).map((c) => c.id),
  );

  db.users = db.users.filter((u) => u.id !== userId);
  delete db.credentials[userId];
  delete db.prefs[userId];
  db.likes = db.likes.filter((l) => l.fromUserId !== userId && l.toUserId !== userId);
  db.passes = db.passes.filter((p) => p.from !== userId && p.to !== userId);
  db.savedProfiles = db.savedProfiles.filter((s) => s.userId !== userId);
  db.blocks = db.blocks.filter((b) => b.blockerId !== userId && b.blockedId !== userId);
  db.reports = db.reports.filter((r) => r.reporterId !== userId && r.reportedId !== userId);
  db.matches = db.matches.filter((m) => !matchIds.has(m.id));
  db.conversations = db.conversations.filter((c) => !convIds.has(c.id));
  db.messages = db.messages.filter((m) => !convIds.has(m.conversationId));
  db.notifications = db.notifications.filter((n) => n.userId !== userId);
  db.applications = db.applications.filter((a) => a.userId !== userId);
  db.bookings = db.bookings.filter((b) => b.userId !== userId);
  for (const b of db.bookings) {
    if (b.partnerId === userId) b.partnerId = null; // keep the other member's booking
  }
  db.savedCafes = db.savedCafes.filter((s) => s.userId !== userId);
  // Financial records are RETAINED but anonymized (mirrors migration 008):
  // the rows survive for accounting with no link back to the person.
  for (const p of db.payments) if (p.userId === userId) p.userId = "";
  for (const s of db.subscriptions) if (s.userId === userId) s.userId = "";
  save(db);
  emit("profile", undefined);
}

export function getPrefs(userId: string): MatchPreferences {
  const db = load();
  if (!db.prefs[userId]) {
    const u = db.users.find((x) => x.id === userId);
    db.prefs[userId] = defaultPrefs(u?.city ?? "Mumbai");
    save(db);
  }
  return db.prefs[userId];
}

export function savePrefs(userId: string, prefs: MatchPreferences) {
  const db = load();
  db.prefs[userId] = prefs;
  save(db);
}

/* ---------------- likes / passes / matches ---------------- */

export function hasLiked(from: string, to: string): boolean {
  return load().likes.some((l) => l.fromUserId === from && l.toUserId === to);
}

export function hasPassed(from: string, to: string): boolean {
  return load().passes.some((p) => p.from === from && p.to === to);
}

export function sendLike(fromUserId: string, toUserId: string): { match: Match | null } {
  const db = load();
  if (fromUserId === toUserId) return { match: null };
  if (db.blocks.some((b) => (b.blockerId === fromUserId && b.blockedId === toUserId) || (b.blockerId === toUserId && b.blockedId === fromUserId)))
    return { match: null };
  if (hasLiked(fromUserId, toUserId)) {
    const existing = db.matches.find(
      (m) =>
        (m.userA === fromUserId && m.userB === toUserId) ||
        (m.userA === toUserId && m.userB === fromUserId),
    );
    return { match: existing ?? null };
  }
  // Free-user daily like cap (20/day, IST reset). Paid members bypass.
  // Duplicate/self/blocked likes above return before consuming any allowance.
  if (!consumeDailyAction(db, fromUserId, "like")) {
    throw new Error("DAILY_LIKE_LIMIT_REACHED");
  }
  db.likes.push({ id: uid("lk"), fromUserId, toUserId, createdAt: new Date().toISOString() });

  // notify the liked user
  const from = db.users.find((u) => u.id === fromUserId);
  db.notifications.push({
    id: uid("n"),
    userId: toUserId,
    kind: "like",
    title: `${from?.firstName ?? "Someone"} liked your profile`,
    body: "Take a look — maybe it's mutual.",
    link: "/likes",
    read: false,
    createdAt: new Date().toISOString(),
  });

  // mutual?
  const reciprocal = db.likes.some((l) => l.fromUserId === toUserId && l.toUserId === fromUserId);
  let match: Match | null = null;
  if (reciprocal) {
    const me = db.users.find((u) => u.id === fromUserId)!;
    const them = db.users.find((u) => u.id === toUserId)!;
    const prefs = db.prefs[fromUserId];
    const c = computeCompatibility(me, them, prefs ?? null);
    match = {
      id: uid("m"),
      userA: fromUserId,
      userB: toUserId,
      compatibility: c.score,
      factors: c.factors,
      createdAt: new Date().toISOString(),
    };
    db.matches.push(match);
    const convo: Conversation = {
      id: uid("c"),
      matchId: match.id,
      participantIds: [fromUserId, toUserId],
      lastMessageAt: new Date().toISOString(),
      unread: { [fromUserId]: 0, [toUserId]: 0 },
    };
    db.conversations.push(convo);
    for (const uidX of [fromUserId, toUserId]) {
      const other = uidX === fromUserId ? them : me;
      db.notifications.push({
        id: uid("n"),
        userId: uidX,
        kind: "match",
        title: `It's a match with ${other.firstName}`,
        body: "You both liked each other. Start the conversation.",
        link: "/chat",
        read: false,
        createdAt: new Date().toISOString(),
      });
    }
  }
  save(db);
  emit("likes", { fromUserId, toUserId, match });
  return { match };
}

export function sendPass(from: string, to: string) {
  const db = load();
  if (!db.passes.some((p) => p.from === from && p.to === to)) {
    db.passes.push({ from, to });
    save(db);
  }
}

export function likesReceived(userId: string): Like[] {
  return load().likes.filter((l) => l.toUserId === userId);
}

export function likesSent(userId: string): Like[] {
  return load().likes.filter((l) => l.fromUserId === userId);
}

export function matchesFor(userId: string): Match[] {
  return load().matches.filter((m) => m.userA === userId || m.userB === userId);
}

export function unmatch(matchId: string, byUserId: string) {
  const db = load();
  const m = db.matches.find((x) => x.id === matchId);
  if (!m) return;
  db.matches = db.matches.filter((x) => x.id !== matchId);
  const convoIds = db.conversations.filter((c) => c.matchId === matchId).map((c) => c.id);
  db.conversations = db.conversations.filter((c) => c.matchId !== matchId);
  db.messages = db.messages.filter((msg) => !convoIds.includes(msg.conversationId));
  db.likes = db.likes.filter(
    (l) =>
      !(
        (l.fromUserId === m.userA && l.toUserId === m.userB) ||
        (l.fromUserId === m.userB && l.toUserId === m.userA)
      ),
  );
  const other = m.userA === byUserId ? m.userB : m.userA;
  db.notifications.push({
    id: uid("n"),
    userId: other,
    kind: "system",
    title: "A match ended",
    body: "A conversation was closed. Wishing you better connections ahead.",
    read: false,
    createdAt: new Date().toISOString(),
  });
  save(db);
  emit("matches", { matchId });
}

/* ---------------- saved / blocks / reports ---------------- */

export function saveProfile(userId: string, profileId: string) {
  const db = load();
  if (!db.savedProfiles.some((s) => s.userId === userId && s.profileId === profileId)) {
    db.savedProfiles.push({ userId, profileId });
    save(db);
  }
}
export function unsaveProfile(userId: string, profileId: string) {
  const db = load();
  db.savedProfiles = db.savedProfiles.filter((s) => !(s.userId === userId && s.profileId === profileId));
  save(db);
}
export function savedProfiles(userId: string): string[] {
  return load().savedProfiles.filter((s) => s.userId === userId).map((s) => s.profileId);
}

export function blockUser(blockerId: string, blockedId: string) {
  const db = load();
  if (!db.blocks.some((b) => b.blockerId === blockerId && b.blockedId === blockedId)) {
    db.blocks.push({ blockerId, blockedId, createdAt: new Date().toISOString() });
  }
  // remove any match between them
  const m = db.matches.find(
    (x) =>
      (x.userA === blockerId && x.userB === blockedId) ||
      (x.userA === blockedId && x.userB === blockerId),
  );
  save(db);
  if (m) unmatch(m.id, blockerId);
  else emit("blocks", { blockerId, blockedId });
}
export function unblockUser(blockerId: string, blockedId: string) {
  const db = load();
  db.blocks = db.blocks.filter((b) => !(b.blockerId === blockerId && b.blockedId === blockedId));
  save(db);
}
export function blockedBy(userId: string): Block[] {
  return load().blocks.filter((b) => b.blockerId === userId);
}
export function isBlocked(a: string, b: string): boolean {
  const db = load();
  return db.blocks.some(
    (x) => (x.blockerId === a && x.blockedId === b) || (x.blockerId === b && x.blockedId === a),
  );
}

export function fileReport(report: Omit<Report, "id" | "status" | "createdAt">) {
  const db = load();
  const r: Report = { ...report, id: uid("r"), status: "open", createdAt: new Date().toISOString() };
  db.reports.push(r);
  db.notifications.push({
    id: uid("n"),
    userId: "admin-1",
    kind: "safety",
    title: "New report filed",
    body: `${report.reason} — review needed.`,
    link: "/admin/reports",
    read: false,
    createdAt: new Date().toISOString(),
  });
  save(db);
  return r;
}
export function listReports(): Report[] {
  return load().reports;
}
export function setReportStatus(id: string, status: Report["status"]) {
  const db = load();
  const r = db.reports.find((x) => x.id === id);
  if (r) {
    r.status = status;
    save(db);
  }
}

/* ---------------- chat ---------------- */

export function conversationsFor(userId: string): Conversation[] {
  return load()
    .conversations.filter((c) => c.participantIds.includes(userId))
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export function messagesFor(conversationId: string): Message[] {
  return load()
    .messages.filter((m) => m.conversationId === conversationId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function sendMessage(conversationId: string, senderId: string, text: string): Message | null {
  const clean = text.trim();
  if (!clean) return null;
  const db = load();
  const convo = db.conversations.find((c) => c.id === conversationId);
  if (!convo || !convo.participantIds.includes(senderId)) return null;
  const other = convo.participantIds.find((p) => p !== senderId)!;
  if (isBlocked(senderId, other)) return null;
  const msg: Message = {
    id: uid("msg"),
    conversationId,
    senderId,
    text: clean.slice(0, 2000),
    createdAt: new Date().toISOString(),
    delivered: true,
    read: false,
  };
  db.messages.push(msg);
  convo.lastMessageAt = msg.createdAt;
  convo.unread[other] = (convo.unread[other] ?? 0) + 1;
  const sender = db.users.find((u) => u.id === senderId);
  db.notifications.push({
    id: uid("n"),
    userId: other,
    kind: "message",
    title: `New message from ${sender?.firstName ?? "your match"}`,
    body: clean.slice(0, 80),
    link: "/chat",
    read: false,
    createdAt: new Date().toISOString(),
  });
  save(db);
  emit(`msg:${conversationId}`, msg);
  emit("conversations", { conversationId });
  return msg;
}

export function markConversationRead(conversationId: string, userId: string) {
  const db = load();
  const convo = db.conversations.find((c) => c.id === conversationId);
  if (!convo) return;
  convo.unread[userId] = 0;
  db.messages.forEach((m) => {
    if (m.conversationId === conversationId && m.senderId !== userId) m.read = true;
  });
  save(db);
  emit(`msg:${conversationId}`, { __read: true, userId });
}

/* typing indicators (demo realtime) */
const typingState = new Map<string, Set<string>>();
export function setTyping(conversationId: string, userId: string, isTyping: boolean) {
  if (!typingState.has(conversationId)) typingState.set(conversationId, new Set());
  const s = typingState.get(conversationId)!;
  if (isTyping) s.add(userId);
  else s.delete(userId);
  emit(`typing:${conversationId}`, { userId, isTyping });
}
export function onTyping(conversationId: string, fn: (userId: string, isTyping: boolean) => void) {
  return onEvent(`typing:${conversationId}`, (p) => {
    const x = p as { userId: string; isTyping: boolean };
    fn(x.userId, x.isTyping);
  });
}
export function onMessage(conversationId: string, fn: (m: Message) => void) {
  return onEvent(`msg:${conversationId}`, (p) => {
    const m = p as Message;
    if (m && m.id && !("__read" in (p as object))) fn(m);
  });
}

/* ---------------- notifications ---------------- */

export function notificationsFor(userId: string): AppNotification[] {
  return load()
    .notifications.filter((n) => n.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function unreadCount(userId: string): number {
  return notificationsFor(userId).filter((n) => !n.read).length;
}
export function markNotificationRead(id: string) {
  const db = load();
  const n = db.notifications.find((x) => x.id === id);
  if (n) {
    n.read = true;
    save(db);
    emit("notifications", { id });
  }
}
export function markAllNotificationsRead(userId: string) {
  const db = load();
  db.notifications.forEach((n) => {
    if (n.userId === userId) n.read = true;
  });
  save(db);
  emit("notifications", { userId });
}
export function pushNotification(n: Omit<AppNotification, "id" | "createdAt" | "read">) {
  const db = load();
  db.notifications.push({ ...n, id: uid("n"), read: false, createdAt: new Date().toISOString() });
  save(db);
  emit("notifications", n);
}

/* ---------------- experiences & applications ---------------- */

export function listExperiences() {
  return SEED_EXPERIENCES;
}
export function getExperience(id: string) {
  return SEED_EXPERIENCES.find((e) => e.id === id);
}

export function applyForExperience(input: {
  userId: string;
  experienceId: string;
  slotDate: string;
  slotTime: string;
  note: string;
}): DateApplication {
  const db = load();
  const app: DateApplication = {
    id: uid("ap"),
    userId: input.userId,
    experienceId: input.experienceId,
    slotDate: input.slotDate,
    slotTime: input.slotTime,
    note: input.note.slice(0, 500),
    status: "submitted",
    createdAt: new Date().toISOString(),
    decidedAt: null,
    adminNote: null,
  };
  db.applications.push(app);
  db.notifications.push({
    id: uid("n"),
    userId: "admin-1",
    kind: "experience",
    title: "New experience application",
    body: "An application needs review.",
    link: "/admin/applications",
    read: false,
    createdAt: new Date().toISOString(),
  });
  save(db);
  return app;
}

export function applicationsFor(userId: string): DateApplication[] {
  return load()
    .applications.filter((a) => a.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function allApplications(): DateApplication[] {
  return load().applications.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function setApplicationStatus(
  id: string,
  status: DateApplication["status"],
  adminNote: string | null,
  actorId: string,
) {
  const db = load();
  const a = db.applications.find((x) => x.id === id);
  if (!a) return;
  a.status = status;
  a.decidedAt = new Date().toISOString();
  a.adminNote = adminNote;
  const exp = SEED_EXPERIENCES.find((e) => e.id === a.experienceId);
  db.notifications.push({
    id: uid("n"),
    userId: a.userId,
    kind: "experience",
    title: `Application ${status.replace("_", " ")}`,
    body: exp ? `${exp.title} — ${a.slotDate} at ${a.slotTime}` : "Your curated experience application was updated.",
    link: "/experiences",
    read: false,
    createdAt: new Date().toISOString(),
  });
  logActivity(actorId, "application.status", `Application ${id} → ${status}`);
  save(db);
}
export function cancelApplication(id: string, userId: string) {
  const db = load();
  const a = db.applications.find((x) => x.id === id && x.userId === userId);
  if (a && ["submitted", "under_review", "eligible"].includes(a.status)) {
    a.status = "cancelled";
    save(db);
  }
}

/* ---------------- bookings ---------------- */

export function bookingsFor(userId: string): DateBooking[] {
  return load()
    .bookings.filter((b) => b.userId === userId || b.partnerId === userId)
    .sort((a, b) => b.date.localeCompare(a.date));
}
export function allBookings(): DateBooking[] {
  return load().bookings.sort((a, b) => b.date.localeCompare(a.date));
}
export function createBooking(input: Omit<DateBooking, "id" | "createdAt">, actorId: string): DateBooking {
  const db = load();
  const b: DateBooking = { ...input, id: uid("bk"), createdAt: new Date().toISOString() };
  db.bookings.push(b);
  for (const uidX of [b.userId, b.partnerId].filter(Boolean) as string[]) {
    db.notifications.push({
      id: uid("n"),
      userId: uidX,
      kind: "booking",
      title: "Your date is confirmed",
      body: `${b.venue} — ${b.date} at ${b.time}`,
      link: "/experiences",
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  logActivity(actorId, "booking.create", `Booking ${b.id} at ${b.venue} on ${b.date}`);
  save(db);
  return b;
}
export function setBookingStatus(id: string, status: DateBooking["status"], actorId: string) {
  const db = load();
  const b = db.bookings.find((x) => x.id === id);
  if (!b) return;
  b.status = status;
  logActivity(actorId, "booking.status", `Booking ${id} → ${status}`);
  save(db);
}

/* ---------------- cafes ---------------- */

export function listCafes(): Cafe[] {
  return load().cafes;
}
export function getCafe(id: string): Cafe | undefined {
  return load().cafes.find((c) => c.id === id);
}
export function upsertCafe(cafe: Cafe, actorId: string) {
  const db = load();
  const i = db.cafes.findIndex((c) => c.id === cafe.id);
  if (i >= 0) {
    db.cafes[i] = cafe;
    logActivity(actorId, "cafe.update", `Updated café ${cafe.name}`);
  } else {
    db.cafes.push(cafe);
    logActivity(actorId, "cafe.create", `Added café ${cafe.name}`);
  }
  save(db);
}
export function saveCafe(userId: string, cafeId: string) {
  const db = load();
  if (!db.savedCafes.some((s) => s.userId === userId && s.cafeId === cafeId)) {
    db.savedCafes.push({ userId, cafeId });
    save(db);
  }
}
export function unsaveCafe(userId: string, cafeId: string) {
  const db = load();
  db.savedCafes = db.savedCafes.filter((s) => !(s.userId === userId && s.cafeId === cafeId));
  save(db);
}
export function savedCafeIds(userId: string): string[] {
  return load().savedCafes.filter((s) => s.userId === userId).map((s) => s.cafeId);
}
export function isCafeSaved(userId: string, cafeId: string): boolean {
  return savedCafeIds(userId).includes(cafeId);
}

/* ---------------- complimentary passes ---------------- */

function passCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "DVR-";
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function listComplimentaryPasses(): ComplimentaryPass[] {
  return load().complimentaryPasses;
}

export function myComplimentaryPasses(userId: string): ComplimentaryPass[] {
  return load().complimentaryPasses.filter((p) => p.issuedToUserId === userId);
}

export function createComplimentaryPass(
  input: { cafeId: string; issuedToUserId?: string | null; note?: string | null; expiresAt?: string | null },
  adminId: string
): ComplimentaryPass {
  const db = load();
  const cafe = db.cafes.find((c) => c.id === input.cafeId);
  const user = input.issuedToUserId ? db.users.find((p) => p.id === input.issuedToUserId) : null;
  const pass: ComplimentaryPass = {
    id: `cp-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    code: passCode(),
    cafeId: input.cafeId,
    cafeName: cafe?.name ?? "Unknown cafe",
    issuedToUserId: input.issuedToUserId ?? null,
    issuedToName: user?.firstName ?? null,
    issuedByAdminId: adminId,
    status: "active",
    note: input.note ?? null,
    expiresAt: input.expiresAt ?? null,
    redeemedAt: null,
    createdAt: new Date().toISOString(),
  };
  db.complimentaryPasses.unshift(pass);
  save(db);
  emit("passes");
  return pass;
}

export function redeemComplimentaryPass(code: string, userId: string): ComplimentaryPass {
  const db = load();
  const pass = db.complimentaryPasses.find((p) => p.code === code.toUpperCase().trim());
  if (!pass) throw new Error("Invalid pass code.");
  if (pass.status !== "active") throw new Error(`This pass is ${pass.status}.`);
  if (pass.issuedToUserId && pass.issuedToUserId !== userId) throw new Error("This pass was issued to another member.");
  if (pass.expiresAt && new Date(pass.expiresAt) < new Date()) {
    pass.status = "expired";
    save(db);
    throw new Error("This pass has expired.");
  }
  pass.status = "redeemed";
  pass.redeemedAt = new Date().toISOString();
  if (!pass.issuedToUserId) {
    pass.issuedToUserId = userId;
    const user = db.users.find((p) => p.id === userId);
    pass.issuedToName = user?.firstName ?? null;
  }
  save(db);
  emit("passes");
  return pass;
}

export function revokeComplimentaryPass(id: string, _adminId: string) {
  const db = load();
  const pass = db.complimentaryPasses.find((p) => p.id === id);
  if (!pass) return;
  pass.status = "revoked";
  save(db);
  emit("passes");
}

/* ---------------- curated match proposals ---------------- */

export function listMatchProposals(): MatchProposal[] {
  return load().matchProposals;
}

export function myMatchProposals(userId: string): MatchProposal[] {
  return load().matchProposals.filter((p) => p.userAId === userId || p.userBId === userId);
}

export function createMatchProposal(
  userAId: string, userBId: string, message: string | null, adminId: string
): MatchProposal {
  const db = load();
  if (userAId === userBId) throw new Error("Cannot propose a match with the same person.");
  const userA = db.users.find((p) => p.id === userAId);
  const userB = db.users.find((p) => p.id === userBId);
  if (!userA || !userB) throw new Error("One or both members not found.");
  const proposal: MatchProposal = {
    id: `mp-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
    userAId, userBId,
    userAName: userA.firstName, userBName: userB.firstName,
    proposedByAdminId: adminId,
    message,
    status: "pending",
    userAResponse: null, userBResponse: null,
    createdAt: new Date().toISOString(),
    respondedAt: null,
  };
  db.matchProposals.unshift(proposal);
  // Notify both users
  for (const uid of [userAId, userBId]) {
    db.notifications.unshift({
      id: `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      userId: uid,
      kind: "match_proposal",
      title: "A curated match awaits",
      body: `Datevra's curators think you'd be wonderful together. Review and respond when ready.`,
      createdAt: new Date().toISOString(),
      read: false,
    });
  }
  save(db);
  emit("proposals");
  return proposal;
}

export function respondToMatchProposal(proposalId: string, userId: string, accept: boolean): MatchProposal {
  const db = load();
  const proposal = db.matchProposals.find((p) => p.id === proposalId);
  if (!proposal) throw new Error("Proposal not found.");
  if (proposal.status !== "pending") throw new Error("This proposal is no longer pending.");
  if (userId === proposal.userAId) proposal.userAResponse = accept;
  else if (userId === proposal.userBId) proposal.userBResponse = accept;
  else throw new Error("You are not part of this proposal.");

  if (!accept) {
    proposal.status = "declined";
    proposal.respondedAt = new Date().toISOString();
  } else if (proposal.userAResponse === true && proposal.userBResponse === true) {
    // Both accepted — create a mutual match
    proposal.status = "accepted";
    proposal.respondedAt = new Date().toISOString();
    const [a, b] = [proposal.userAId, proposal.userBId].sort();
    const exists = db.matches.some(
      (m) => (m.userA === a && m.userB === b) || (m.userA === b && m.userB === a)
    );
    if (!exists) {
      db.matches.unshift({
        id: `m-${Date.now().toString(36)}`,
        userA: a, userB: b,
        createdAt: new Date().toISOString(),
      } as never);
    }
  }
  save(db);
  emit("proposals");
  return proposal;
}

/* ---------------- memberships & payments ---------------- */

export function activeSubscription(userId: string): Subscription | undefined {
  const db = load();
  const now = new Date().toISOString();
  // NULL expiresAt = lifetime membership → always active.
  return db.subscriptions.find(
    (s) => s.userId === userId && s.status === "active" && (s.expiresAt == null || s.expiresAt > now),
  );
}

export function subscriptionsFor(userId: string): Subscription[] {
  return load()
    .subscriptions.filter((s) => s.userId === userId)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * Records a membership purchase. In demo/test mode the payment is created
 * as "pending" and must be verified — never reported as successful without
 * verification (mirrors the Razorpay verify step in production).
 */
export function purchaseMembership(
  userId: string,
  planId: PlanId,
  amount: number,
): Payment {
  const db = load();
  const payment: Payment = {
    id: uid("pay"),
    userId,
    kind: "membership",
    amount,
    planId,
    status: "pending",
    razorpayOrderId: `order_demo_${Date.now().toString(36)}`,
    razorpayPaymentId: null,
    method: "razorpay_test",
    createdAt: new Date().toISOString(),
  };
  db.payments.push(payment);
  save(db);
  return payment;
}

/** Simulates verified payment capture (stands in for Razorpay webhook verify). */
export function verifyPayment(paymentId: string, actorId: string): Payment | undefined {
  const db = load();
  const p = db.payments.find((x) => x.id === paymentId);
  if (!p || p.status !== "pending") return p;
  p.status = "verified";
  p.razorpayPaymentId = `pay_demo_${Date.now().toString(36)}`;
  if (p.kind === "membership" && p.planId) {
    // expire old, activate new
    db.subscriptions.forEach((s) => {
      if (s.userId === p.userId && s.status === "active") s.status = "expired";
    });
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    db.subscriptions.push({
      id: uid("sub"),
      userId: p.userId,
      planId: p.planId,
      status: "active",
      startedAt: start.toISOString(),
      expiresAt: end.toISOString(),
      autoRenew: true,
    });
    const u = db.users.find((x) => x.id === p.userId);
    if (u) {
      u.plan = p.planId;
      u.planExpiresAt = end.toISOString();
    }
    db.notifications.push({
      id: uid("n"),
      userId: p.userId,
      kind: "membership",
      title: "Membership activated",
      body: `Your ${p.planId} plan is now active. Enjoy priority matchmaking.`,
      link: "/membership",
      read: false,
      createdAt: new Date().toISOString(),
    });
  }
  logActivity(actorId, "payment.verify", `Verified payment ${paymentId} (₹${p.amount})`);
  save(db);
  emit("payments", p);
  return p;
}

export function recordCashPayment(
  userId: string,
  amount: number,
  note: string,
  actorId: string,
): Payment {
  const db = load();
  const p: Payment = {
    id: uid("pay"),
    userId,
    kind: "cash",
    amount,
    planId: null,
    status: "verified",
    razorpayOrderId: null,
    razorpayPaymentId: null,
    method: `cash — ${note}`.slice(0, 120),
    createdAt: new Date().toISOString(),
  };
  db.payments.push(p);
  logActivity(actorId, "payment.cash", `Recorded cash payment ₹${amount} for ${userId}: ${note}`);
  save(db);
  return p;
}

export function refundPayment(paymentId: string, actorId: string) {
  const db = load();
  const p = db.payments.find((x) => x.id === paymentId);
  if (!p || p.status !== "verified") return;
  p.status = "refunded";
  logActivity(actorId, "payment.refund", `Refunded payment ${paymentId} (₹${p.amount})`);
  save(db);
}

export function paymentsFor(userId: string): Payment[] {
  return load()
    .payments.filter((p) => p.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function allPayments(): Payment[] {
  return load().payments.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/* ---------------- investors / activity / cms / settings ---------------- */

export function listInvestors(): InvestorRecord[] {
  return load().investors;
}
export function upsertInvestor(rec: InvestorRecord, actorId: string) {
  const db = load();
  const i = db.investors.findIndex((x) => x.id === rec.id);
  if (i >= 0) db.investors[i] = rec;
  else db.investors.push(rec);
  logActivity(actorId, "investor.upsert", `Investor record ${rec.name} updated`);
  save(db);
}
export function recordInvestorPayout(id: string, amount: number, actorId: string) {
  const db = load();
  const r = db.investors.find((x) => x.id === id);
  if (!r) return;
  r.paidOut += amount;
  r.pending = Math.max(0, r.pending - amount);
  logActivity(actorId, "investor.payout", `Payout ₹${amount} recorded for ${r.name}`);
  save(db);
}

export function logActivity(actorId: string, action: string, detail: string) {
  const db = load();
  db.activity.unshift({
    id: uid("al"),
    actorId,
    actorRole: "admin",
    action,
    detail,
    createdAt: new Date().toISOString(),
  });
  db.activity = db.activity.slice(0, 500);
  // note: save() is called by the caller to avoid double writes
}

export function listActivity(): ActivityLog[] {
  return load().activity;
}

export function getCmsPage(slug: string): CmsPage | undefined {
  return load().cms.find((c) => c.slug === slug);
}
export function saveCmsPage(page: CmsPage, actorId: string) {
  const db = load();
  const i = db.cms.findIndex((c) => c.slug === page.slug);
  const withTime = { ...page, updatedAt: new Date().toISOString() };
  if (i >= 0) db.cms[i] = withTime;
  else db.cms.push(withTime);
  logActivity(actorId, "cms.update", `CMS page “${page.slug}” updated`);
  save(db);
}

export function getSettings(): PlatformSettings {
  return load().settings;
}
export function saveSettings(s: PlatformSettings, actorId: string) {
  const db = load();
  db.settings = s;
  logActivity(actorId, "settings.update", "Platform settings updated");
  save(db);
}

/* ---------------- admin: users ---------------- */

export function allUsers(): UserProfile[] {
  return load().users;
}
export function setUserVerified(id: string, verified: boolean, actorId: string) {
  const db = load();
  const u = db.users.find((x) => x.id === id);
  if (u) {
    u.verified = verified;
    logActivity(actorId, "user.verify", `${u.firstName} verification → ${verified}`);
    save(db);
  }
}

/* ---------------- analytics helpers ---------------- */

export function revenueSummary() {
  const db = load();
  const verified = db.payments.filter((p) => p.status === "verified");
  const membership = verified.filter((p) => p.kind === "membership").reduce((s, p) => s + p.amount, 0);
  const cash = verified.filter((p) => p.kind === "cash").reduce((s, p) => s + p.amount, 0);
  const experience = verified.filter((p) => p.kind === "experience").reduce((s, p) => s + p.amount, 0);
  const refunded = db.payments.filter((p) => p.status === "refunded").reduce((s, p) => s + p.amount, 0);
  const cafeCommissions = db.cafes
    .filter((c) => c.partner)
    .reduce((s, c) => s + Math.round((c.revenue * c.commissionPct) / 100), 0);
  return {
    membership,
    experience,
    cash,
    refunded,
    cafeCommissions,
    total: membership + experience + cash,
    payments: db.payments.length,
    activeSubscriptions: db.subscriptions.filter((s) => s.status === "active").length,
    totalUsers: db.users.filter((u) => u.id !== "admin-1").length,
    totalMatches: db.matches.length,
    pendingApplications: db.applications.filter((a) =>
      ["submitted", "under_review", "eligible"].includes(a.status),
    ).length,
  };
}

export function experienceById(id: string) {
  return SEED_EXPERIENCES.find((e) => e.id === id);
}
