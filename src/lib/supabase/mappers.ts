import type {
  ActivityLog,
  AppNotification,
  Block,
  Cafe,
  CmsPage,
  ComplimentaryPass,
  Conversation,
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

/* Row → domain mappers (snake_case Supabase rows → camelCase app types).
 * All mappers are defensive: missing/nullable columns fall back to sane
 * defaults so reads from the discovery functions (no email, no
 * plan_expires_at) and partial selects keep working.
 */

export type Row = Record<string, unknown>;

const str = (v: unknown, d = ""): string =>
  typeof v === "string" ? v : d;
const arr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);
const num = (v: unknown, d = 0): number =>
  typeof v === "number" ? v : d;
const bool = (v: unknown, d = false): boolean =>
  typeof v === "boolean" ? v : d;
const iso = (v: unknown): string =>
  typeof v === "string" ? v : new Date().toISOString();
const isoNull = (v: unknown): string | null =>
  typeof v === "string" ? v : null;

export function mapProfile(r: Row): UserProfile {
  return {
    id: str(r.id),
    email: str(r.email),
    firstName: str(r.first_name, "Member"),
    age: num(r.age, 18),
    gender: (str(r.gender, "woman") as UserProfile["gender"]),
    interestedIn: (str(r.interested_in, "everyone") as UserProfile["interestedIn"]),
    city: str(r.city, "Mumbai"),
    bio: str(r.bio),
    interests: arr(r.interests),
    hobbies: arr(r.hobbies),
    relationshipIntent: str(r.relationship_intent),
    lifestyle: arr(r.lifestyle),
    photos: arr(r.photos),
    verified: bool(r.verified),
    online: bool(r.online),
    lastActive: str(r.last_active, iso(r.created_at)),
    profileComplete: num(r.profile_complete),
    plan: (r.plan_id as PlanId | null) ?? null,
    planExpiresAt: (r.plan_expires_at as string | null) ?? null,
    createdAt: iso(r.created_at),
  };
}

/** App → DB for profile updates (only writable columns). */
export function unmapProfilePatch(patch: Partial<UserProfile>): Row {
  const out: Row = {};
  if (patch.firstName !== undefined) out.first_name = patch.firstName;
  if (patch.age !== undefined) out.age = patch.age;
  if (patch.gender !== undefined) out.gender = patch.gender;
  if (patch.interestedIn !== undefined) out.interested_in = patch.interestedIn;
  if (patch.city !== undefined) out.city = patch.city;
  if (patch.bio !== undefined) out.bio = patch.bio;
  if (patch.interests !== undefined) out.interests = patch.interests;
  if (patch.hobbies !== undefined) out.hobbies = patch.hobbies;
  if (patch.relationshipIntent !== undefined)
    out.relationship_intent = patch.relationshipIntent || null;
  if (patch.lifestyle !== undefined) out.lifestyle = patch.lifestyle;
  if (patch.photos !== undefined) out.photos = patch.photos;
  if (patch.verified !== undefined) out.verified = patch.verified;
  if (patch.online !== undefined) out.online = patch.online;
  if (patch.lastActive !== undefined) out.last_active = patch.lastActive;
  if (patch.profileComplete !== undefined)
    out.profile_complete = patch.profileComplete;
  if (patch.plan !== undefined) out.plan_id = patch.plan;
  if (patch.planExpiresAt !== undefined)
    out.plan_expires_at = patch.planExpiresAt;
  return out;
}

export function profileCompleteness(u: {
  bio: string;
  relationshipIntent: string;
  city: string;
  interests: string[];
  photos: string[];
}): number {
  const filled = [u.bio, u.relationshipIntent, u.city].filter(
    (f) => f && f.length > 0,
  ).length;
  return Math.min(
    100,
    25 + filled * 10 + Math.min(25, u.interests.length * 5) + Math.min(20, u.photos.length * 10),
  );
}

export function mapPrefs(r: Row): MatchPreferences {
  return {
    ageMin: num(r.age_min, 22),
    ageMax: num(r.age_max, 35),
    interestedIn: (str(r.interested_in, "everyone") as MatchPreferences["interestedIn"]),
    cities: arr(r.cities),
    maxDistanceKm: num(r.max_distance_km, 50),
    relationshipIntents: arr(r.relationship_intents),
    minSharedInterests: num(r.min_shared_interests, 1),
  };
}

export function unmapPrefs(p: MatchPreferences): Row {
  return {
    age_min: p.ageMin,
    age_max: p.ageMax,
    interested_in: p.interestedIn,
    cities: p.cities,
    max_distance_km: p.maxDistanceKm,
    relationship_intents: p.relationshipIntents,
    min_shared_interests: p.minSharedInterests,
  };
}

export function mapLike(r: Row): Like {
  return {
    id: str(r.id),
    fromUserId: str(r.from_user_id),
    toUserId: str(r.to_user_id),
    createdAt: iso(r.created_at),
  };
}

export function mapMatch(r: Row): Match {
  return {
    id: str(r.id),
    userA: str(r.user_a),
    userB: str(r.user_b),
    compatibility: num(r.compatibility, 0),
    factors: arr(r.factors),
    createdAt: iso(r.created_at),
  };
}

export function mapConversation(r: Row, unread: Record<string, number>): Conversation {
  const parts = arr(r.participant_ids);
  return {
    id: str(r.id),
    matchId: str(r.match_id),
    participantIds: [parts[0] ?? "", parts[1] ?? ""],
    lastMessageAt: str(r.last_message_at, iso(r.created_at)),
    unread,
  };
}

export function mapMessage(r: Row): Message {
  return {
    id: str(r.id),
    conversationId: str(r.conversation_id),
    senderId: str(r.sender_id),
    text: str(r.text),
    createdAt: iso(r.created_at),
    delivered: bool(r.delivered, true),
    read: bool(r.read),
  };
}

export function mapNotification(r: Row): AppNotification {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    kind: str(r.kind, "system") as AppNotification["kind"],
    title: str(r.title),
    body: str(r.body),
    link: str(r.link) || undefined,
    read: bool(r.read),
    createdAt: iso(r.created_at),
  };
}

export function mapExperience(r: Row): DateExperience {
  return {
    id: str(r.id),
    title: str(r.title),
    kind: str(r.kind),
    city: str(r.city),
    description: str(r.description),
    image: str(r.image),
    priceFrom: num(r.price_from),
    durationMins: num(r.duration_mins, 60),
    eligibility: arr(r.eligibility),
    slots: Array.isArray(r.slots) ? (r.slots as DateExperience["slots"]) : [],
    eliteOnly: bool(r.elite_only),
  };
}

export function mapApplication(r: Row): DateApplication {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    experienceId: str(r.experience_id),
    slotDate: str(r.slot_date),
    slotTime: str(r.slot_time),
    note: str(r.note),
    status: str(r.status, "submitted") as DateApplication["status"],
    createdAt: iso(r.created_at),
    decidedAt: (r.decided_at as string | null) ?? null,
    adminNote: (r.admin_note as string | null) ?? null,
  };
}

const BOOKING_STATUS: Record<string, DateBooking["status"]> = {
  upcoming: "upcoming",
  completed: "completed",
  cancelled: "cancelled",
  confirmed: "upcoming",
  pending: "upcoming",
};

export function mapBooking(r: Row): DateBooking {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    partnerId: (r.partner_id as string | null) ?? null,
    experienceId: str(r.experience_id),
    cafeId: (r.cafe_id as string | null) ?? null,
    date: str(r.date),
    time: str(r.time),
    venue: str(r.venue),
    status: BOOKING_STATUS[str(r.status)] ?? "upcoming",
    amount: num(r.amount),
    paymentStatus: (str(r.payment_status, "pending") as DateBooking["paymentStatus"]),
    createdAt: iso(r.created_at),
  };
}

export function mapCafe(r: Row): Cafe {
  return {
    id: str(r.id),
    name: str(r.name),
    city: str(r.city),
    address: str(r.address),
    description: str(r.description),
    image: str(r.image),
    priceRange: (str(r.price_range, "₹₹") as Cafe["priceRange"]),
    openingHours: str(r.opening_hours),
    experiences: arr(r.experiences),
    bookingInfo: str(r.booking_info),
    rating: typeof r.rating === "number" ? r.rating : Number(r.rating ?? 0),
    partner: bool(r.partner),
    commissionPct: typeof r.commission_pct === "number" ? r.commission_pct : Number(r.commission_pct ?? 0),
    agreementRef: (r.agreement_ref as string | null) ?? null,
    totalBookings: num(r.total_bookings),
    revenue: num(r.revenue),
    menu: str(r.menu),
  };
}

export function unmapCafe(c: Cafe): Row {
  return {
    id: c.id,
    name: c.name,
    city: c.city,
    address: c.address,
    description: c.description,
    image: c.image,
    price_range: c.priceRange,
    opening_hours: c.openingHours,
    experiences: c.experiences,
    booking_info: c.bookingInfo,
    rating: c.rating,
    partner: c.partner,
    commission_pct: c.commissionPct,
    agreement_ref: c.agreementRef,
    total_bookings: c.totalBookings,
    revenue: c.revenue,
    menu: c.menu,
  };
}

export function mapPayment(r: Row): Payment {
  return {
    id: str(r.id),
    // user_id is NULL for payments whose owner deleted their account
    // (anonymized retention, migration 008) → maps to "" and the admin UI
    // shows "—" via its existing fallback.
    userId: str(r.user_id),
    kind: str(r.kind, "membership") as Payment["kind"],
    amount: num(r.amount),
    planId: (r.plan_id as PlanId | null) ?? null,
    status: str(r.status, "pending") as Payment["status"],
    razorpayOrderId: (r.razorpay_order_id as string | null) ?? null,
    razorpayPaymentId: (r.razorpay_payment_id as string | null) ?? null,
    method: str(r.method),
    createdAt: iso(r.created_at),
  };
}

export function mapSubscription(r: Row): Subscription {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    planId: str(r.plan_id, "connect") as PlanId,
    status: (str(r.status, "active") as Subscription["status"]),
    startedAt: iso(r.started_at),
    expiresAt: isoNull(r.expires_at),
    autoRenew: bool(r.auto_renew),
  };
}

export function mapPlan(r: Row): MembershipPlan {
  return {
    id: str(r.id, "connect") as PlanId,
    name: str(r.name),
    price: num(r.price),
    tagline: str(r.tagline),
    features: arr(r.features),
    priority: num(r.priority, 1),
    badge: str(r.badge),
  };
}

export function mapReport(r: Row): Report {
  return {
    id: str(r.id),
    reporterId: str(r.reporter_id),
    reportedId: str(r.reported_id),
    reason: str(r.reason),
    details: str(r.details),
    status: str(r.status, "open") as Report["status"],
    createdAt: iso(r.created_at),
  };
}

export function mapBlock(r: Row): Block {
  return {
    blockerId: str(r.blocker_id),
    blockedId: str(r.blocked_id),
    createdAt: iso(r.created_at),
  };
}

export function mapInvestor(r: Row): InvestorRecord {
  return {
    id: str(r.id),
    name: str(r.name),
    agreementRef: str(r.agreement_ref),
    sharePct: typeof r.share_pct === "number" ? r.share_pct : Number(r.share_pct ?? 0),
    schedule: str(r.schedule),
    paidOut: num(r.paid_out),
    pending: num(r.pending),
    notes: str(r.notes),
  };
}

export function unmapInvestor(v: InvestorRecord): Row {
  return {
    id: v.id,
    name: v.name,
    agreement_ref: v.agreementRef || null,
    share_pct: v.sharePct,
    schedule: v.schedule,
    paid_out: v.paidOut,
    pending: v.pending,
    notes: v.notes,
  };
}

export function mapActivity(r: Row): ActivityLog {
  return {
    id: str(r.id),
    actorId: str(r.actor_id),
    actorRole: (str(r.actor_role, "system") as ActivityLog["actorRole"]),
    action: str(r.action),
    detail: str(r.detail),
    createdAt: iso(r.created_at),
  };
}

export function mapCms(r: Row): CmsPage {
  return {
    slug: str(r.slug),
    title: str(r.title),
    body: str(r.body),
    updatedAt: iso(r.updated_at),
  };
}

export function mapSettings(r: Row): PlatformSettings {
  let announcements = "";
  const a = r.announcements;
  if (Array.isArray(a)) announcements = (a as string[]).join("\n");
  else if (typeof a === "string") announcements = a;
  return {
    maintenanceMode: bool(r.maintenance_mode),
    minAge: num(r.min_age, 18),
    razorpayTestMode: bool(r.razorpay_test_mode, true),
    supportEmail: str(r.support_email, "care@datevra.in"),
    announcements,
  };
}

export function unmapSettings(s: PlatformSettings): Row {
  return {
    maintenance_mode: s.maintenanceMode,
    min_age: s.minAge,
    razorpay_test_mode: s.razorpayTestMode,
    support_email: s.supportEmail,
    announcements: s.announcements
      ? s.announcements.split("\n").map((x) => x.trim()).filter(Boolean)
      : [],
  };
}

export function mapComplimentaryPass(r: Row): ComplimentaryPass {
  return {
    id: str(r.id),
    code: str(r.code),
    cafeId: str(r.cafe_id),
    cafeName: str(r.cafe_name ?? ""),
    issuedToUserId: (r.issued_to_user_id as string | null) ?? null,
    issuedToName: (r.issued_to_name as string | null) ?? null,
    issuedByAdminId: str(r.issued_by_admin_id),
    status: str(r.status, "active") as ComplimentaryPass["status"],
    note: (r.note as string | null) ?? null,
    expiresAt: (r.expires_at as string | null) ?? null,
    redeemedAt: (r.redeemed_at as string | null) ?? null,
    createdAt: str(r.created_at),
  };
}

export function mapMatchProposal(r: Row): MatchProposal {
  return {
    id: str(r.id),
    userAId: str(r.user_a_id),
    userBId: str(r.user_b_id),
    userAName: (r.user_a_name as string | null) ?? null,
    userBName: (r.user_b_name as string | null) ?? null,
    proposedByAdminId: str(r.proposed_by_admin_id),
    message: (r.message as string | null) ?? null,
    status: str(r.status, "pending") as MatchProposal["status"],
    userAResponse: (r.user_a_response as boolean | null) ?? null,
    userBResponse: (r.user_b_response as boolean | null) ?? null,
    createdAt: str(r.created_at),
    respondedAt: (r.responded_at as string | null) ?? null,
  };
}
