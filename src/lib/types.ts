/* Datevra domain types.
 * NOTE (TS strictness): this project uses verbatimModuleSyntax + erasableSyntaxOnly.
 * - Always `import type { ... } from "./types"` for type-only imports.
 * - No enums: use string union types.
 */

export type PlanId = "connect" | "plus" | "elite";

export interface MembershipPlan {
  id: PlanId;
  name: string;
  price: number; // INR
  tagline: string;
  features: string[];
  priority: number; // matchmaking priority weight
  badge: string;
}

export type Gender = "woman" | "man" | "nonbinary";
export type InterestedIn = "women" | "men" | "everyone";

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  age: number;
  gender: Gender;
  interestedIn: InterestedIn;
  city: string;
  bio: string;
  interests: string[];
  hobbies: string[];
  relationshipIntent: string;
  lifestyle: string[];
  photos: string[];
  verified: boolean;
  online: boolean;
  lastActive: string; // ISO
  profileComplete: number; // 0-100
  plan: PlanId | null;
  planExpiresAt: string | null;
  createdAt: string;
}

export interface MatchPreferences {
  ageMin: number;
  ageMax: number;
  interestedIn: InterestedIn;
  cities: string[];
  maxDistanceKm: number;
  relationshipIntents: string[];
  minSharedInterests: number;
}

export interface Like {
  id: string;
  fromUserId: string;
  toUserId: string;
  createdAt: string;
}

/** Free-tier daily caps (20 likes/day, 20 profile interests/day, IST reset). */
export interface DailyUsage {
  likesUsed: number;
  interestsUsed: number;
  likeLimit: number;
  interestLimit: number;
  isPaid: boolean;
  resetsAt: string;
}

export interface Match {
  id: string;
  userA: string;
  userB: string;
  compatibility: number; // 0-100, computed from real factors
  factors: string[]; // human-readable reasons
  createdAt: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  text: string;
  createdAt: string;
  delivered: boolean;
  read: boolean;
}

export interface Conversation {
  id: string;
  matchId: string;
  participantIds: [string, string];
  lastMessageAt: string;
  unread: Record<string, number>;
}

export type NotificationKind =
  | "match"
  | "like"
  | "message"
  | "membership"
  | "payment"
  | "experience"
  | "booking"
  | "safety"
  | "system"
  | "match_proposal"
  | "pass";

export interface AppNotification {
  id: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  link?: string;
  read: boolean;
  createdAt: string;
}

export type ApplicationStatus =
  | "submitted"
  | "under_review"
  | "eligible"
  | "selected"
  | "confirmed"
  | "completed"
  | "declined"
  | "cancelled";

export interface DateExperience {
  id: string;
  title: string;
  kind: string; // "Romantic Café", "Coffee Date", "Premium Dining", "Casual First Date" ...
  city: string;
  description: string;
  image: string;
  priceFrom: number;
  durationMins: number;
  eligibility: string[];
  slots: { date: string; time: string; seats: number }[];
  eliteOnly: boolean;
}

export interface DateApplication {
  id: string;
  userId: string;
  experienceId: string;
  slotDate: string;
  slotTime: string;
  note: string;
  status: ApplicationStatus;
  createdAt: string;
  decidedAt: string | null;
  adminNote: string | null;
}

export type BookingStatus = "upcoming" | "completed" | "cancelled";

export interface DateBooking {
  id: string;
  userId: string;
  partnerId: string | null;
  experienceId: string;
  cafeId: string | null;
  date: string;
  time: string;
  venue: string;
  status: BookingStatus;
  amount: number;
  paymentStatus: "pending" | "paid" | "refunded";
  createdAt: string;
}

export interface Cafe {
  id: string;
  name: string;
  city: string;
  address: string;
  description: string;
  image: string;
  priceRange: "₹" | "₹₹" | "₹₹₹";
  openingHours: string;
  experiences: string[];
  bookingInfo: string;
  rating: number;
  partner: boolean;
  commissionPct: number;
  agreementRef: string | null;
  totalBookings: number;
  revenue: number;
  menu: string;
}

export type PaymentStatus = "pending" | "verified" | "failed" | "refunded";
export type PaymentKind = "membership" | "experience" | "cash";

export interface Payment {
  id: string;
  userId: string;
  kind: PaymentKind;
  amount: number;
  planId: PlanId | null;
  status: PaymentStatus;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  method: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  userId: string;
  planId: PlanId;
  status: "active" | "expired" | "cancelled";
  startedAt: string;
  /** Null = lifetime / no expiry — always treated as an active membership. */
  expiresAt: string | null;
  autoRenew: boolean;
}

export interface Report {
  id: string;
  reporterId: string;
  reportedId: string;
  reason: string;
  details: string;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  createdAt: string;
}

export interface Block {
  blockerId: string;
  blockedId: string;
  createdAt: string;
}

export interface InvestorRecord {
  id: string;
  name: string;
  agreementRef: string;
  sharePct: number;
  schedule: string;
  paidOut: number;
  pending: number;
  notes: string;
}

export interface ActivityLog {
  id: string;
  actorId: string;
  actorRole: "admin" | "system";
  action: string;
  detail: string;
  createdAt: string;
}

export interface CmsPage {
  slug: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface PlatformSettings {
  maintenanceMode: boolean;
  minAge: number;
  razorpayTestMode: boolean;
  supportEmail: string;
  announcements: string;
}

/* ---------------- Complimentary passes ---------------- */

export type ComplimentaryPassStatus = "active" | "redeemed" | "expired" | "revoked";

export interface ComplimentaryPass {
  id: string;
  code: string;
  cafeId: string;
  cafeName: string;
  issuedToUserId: string | null;
  issuedToName: string | null;
  issuedByAdminId: string;
  status: ComplimentaryPassStatus;
  note: string | null;
  expiresAt: string | null;
  redeemedAt: string | null;
  createdAt: string;
}

/* ---------------- Curated match proposals ---------------- */

export type MatchProposalStatus = "pending" | "accepted" | "declined" | "expired";

export interface MatchProposal {
  id: string;
  userAId: string;
  userBId: string;
  userAName: string | null;
  userBName: string | null;
  proposedByAdminId: string;
  message: string | null;
  status: MatchProposalStatus;
  userAResponse: boolean | null;
  userBResponse: boolean | null;
  createdAt: string;
  respondedAt: string | null;
}
