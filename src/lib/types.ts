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

export type VerificationStatus = "pending" | "verified" | "declined";

export interface UserProfile {
  id: string;
  email: string;
  firstName: string;
  age: number;
  gender: Gender;
  interestedIn: InterestedIn;
  city: string;
  registeredCity?: string | null;
  bio: string;
  interests: string[];
  hobbies: string[];
  relationshipIntent: string;
  lifestyle: string[];
  photos: string[];
  verified: boolean;
  verificationStatus?: VerificationStatus;
  verificationReviewedAt?: string | null;
  verificationReviewedBy?: string | null;
  verificationNote?: string | null;
  online: boolean;
  lastActive: string; // ISO
  profileComplete: number; // 0-100
  plan: PlanId | null;
  planExpiresAt: string | null;
  isAdmin?: boolean;
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

export interface SendLikeResult {
  match: Match | null;
  compatibilityBlocked?: boolean;
  compatibility?: number | null;
  minCompatibility?: number;
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
  | "pass"
  | "date_offer"
  | "date_invitation"
  | "voucher";

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
  images?: string[];
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
  googleRating?: number | null;
  googleReviewCount?: number | null;
  ratingVerified?: boolean;
  ratingStatusLabel?: string;
  weeklyHours?: Readonly<Record<string, string>> | null;
  hoursVerified?: boolean;
  priceVerified?: boolean;
  priceStatusLabel?: string;
  infoSource?: string;
  infoCheckedAt?: string;
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
  verifiedAt?: string | null;
  celebrationShownAt?: string | null;
  createdAt: string;
}

export type SubscriptionStatus = "pending" | "active" | "expired" | "cancelled";

export interface Subscription {
  id: string;
  userId: string;
  planId: PlanId;
  paymentId?: string | null;
  status: SubscriptionStatus;
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

export interface RevokeComplimentaryPassResult {
  success: boolean;
  code?: string;
  warning?: string;
}

/* ---------------- Membership passes ---------------- */

export type MembershipPassStatus = "active" | "redeemed" | "expired" | "revoked";

export interface MembershipPass {
  id: string;
  code: string;
  planId: PlanId;
  durationDays: number;
  issuedToUserId: string | null;
  issuedToName?: string | null;
  issuedToEmail?: string | null;
  issuedByAdminId: string | null;
  status: MembershipPassStatus;
  note: string | null;
  expiresAt: string | null;
  redeemedAt: string | null;
  revokedAt?: string | null;
  revocationReason?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface CreateMembershipPassInput {
  planId: PlanId;
  durationDays: number;
  expiresAt?: string | null;
  issuedToUserId?: string | null;
  note?: string | null;
}

export type MembershipPassErrorCode =
  | "UNAUTHORIZED"
  | "MISSING_CODE"
  | "RATE_LIMITED"
  | "INVALID_CODE"
  | "ALREADY_REDEEMED"
  | "PASS_REVOKED"
  | "PASS_EXPIRED"
  | "NOT_ASSIGNED_TO_CALLER"
  | "LIFETIME_ACTIVE"
  | "DOWNGRADE_NOT_PERMITTED"
  | "INVALID_RPC_RESPONSE"
  | "UNEXPECTED_ERROR"
  | "UNSUPPORTED_BACKEND";

export interface RedeemMembershipPassSuccess {
  success: true;
  code: string;
  planId: PlanId;
  durationDays: number;
  expiresAt: string;
  paymentId: string;
  subscriptionId: string;
}

export interface RedeemMembershipPassFailure {
  success: false;
  error: MembershipPassErrorCode | string;
  message: string;
}

export type RedeemMembershipPassResult =
  | RedeemMembershipPassSuccess
  | RedeemMembershipPassFailure;

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

/* ---------------- Automatic Date Offers (Requirement 3) ---------------- */

export type DateOfferStatus = "pending" | "accepted" | "declined" | "expired" | "cancelled";

export interface AutoDateOfferSummary {
  thresholdTarget: number;
  targetOfferCount: number;
  totalEligibleMatches: number;
  remainingEligiblePairs: number;
  batchStatus: "not_triggered" | "processing" | "completed" | "failed";
  batchId: string | null;
  batchCompletedAt: string | null;
  shortfallCount: number;
  offersCreated: number;
  offersPending: number;
  offersAccepted: number;
  offersDeclined: number;
  offersExpired: number;
}

export interface AutomaticDateOffer {
  id: string;
  batchId: string;
  matchId: string;
  userA: string;
  userB: string;
  userAName?: string | null;
  userBName?: string | null;
  experienceId: string;
  cafeId: string | null;
  suggestedDate: string;
  suggestedTime: string;
  venue: string;
  message: string | null;
  status: DateOfferStatus;
  userAResponse: boolean | null;
  userBResponse: boolean | null;
  userARespondedAt?: string | null;
  userBRespondedAt?: string | null;
  expiresAt: string;
  bookingId: string | null;
  createdAt: string;
}

/* ---------------- Manual Date Offers (Requirement 4) ---------------- */

export interface ManualDateOffer {
  id: string;
  userA: string;
  userB: string;
  userAName?: string | null;
  userBName?: string | null;
  matchId: string | null;
  experienceId: string;
  cafeId: string | null;
  suggestedDate: string;
  suggestedTime: string;
  venue: string;
  message: string | null;
  status: DateOfferStatus;
  userAResponse: boolean | null;
  userBResponse: boolean | null;
  userARespondedAt?: string | null;
  userBRespondedAt?: string | null;
  expiresAt: string;
  bookingId: string | null;
  createdByAdminId: string;
  cancelledByAdminId?: string | null;
  cancelReason?: string | null;
  createdAt: string;
}

export interface CreateManualDateOfferInput {
  userAId: string;
  userBId: string;
  experienceId: string;
  cafeId?: string | null;
  date: string;
  time: string;
  venue: string;
  message?: string | null;
  expiresAt?: string | null;
}

export interface DateOfferEvent {
  id: string;
  offerSource: "automatic" | "manual";
  offerId: string;
  actorId: string | null;
  actorRole: "system" | "admin" | "user";
  eventType: string;
  detail: string;
  createdAt: string;
}

/* ---------------- Invitation Dates (Requirement 5) ---------------- */

export type DateInvitationMode = "individual" | "group" | "pair";
export type DateInvitationStatus = "active" | "cancelled" | "expired" | "completed";
export type DateInvitationResponse = "pending" | "accepted" | "declined" | "expired";

export interface DateInvitationRecipient {
  id: string;
  invitationId: string;
  userId: string;
  userName?: string | null;
  userCity?: string | null;
  partnerUserId: string | null;
  response: DateInvitationResponse;
  respondedAt: string | null;
  bookingId: string | null;
  createdAt: string;
}

export interface DateInvitation {
  id: string;
  invitationMode: DateInvitationMode;
  title: string;
  experienceId: string | null;
  cafeId: string | null;
  date: string;
  time: string;
  venue: string;
  message: string | null;
  expiresAt: string;
  status: DateInvitationStatus;
  createdByAdminId: string;
  cancelledAt?: string | null;
  createdAt: string;
  /** Admin view includes per-recipient rows; member view includes ONLY the member's own row. */
  recipients: DateInvitationRecipient[];
}

export interface CreateDateInvitationInput {
  title: string;
  invitationMode: DateInvitationMode;
  userIds: string[];
  experienceId?: string | null;
  cafeId?: string | null;
  date: string;
  time: string;
  venue: string;
  message?: string | null;
  expiresAt?: string | null;
}

/* ---------------- Outside-Delhi Money Vouchers & OTP (Requirement 8) ---------------- */

export type VoucherStatus = "issued" | "redeemed" | "expired" | "revoked";

export interface VoucherSettings {
  enabled: boolean;
  voucherValueInr: number | null;
  maxClaimsPerUser: number;
  maxTotalVouchers: number | null;
  expiryDays: number;
  excludedCities: string[];
  ncrPolicyNote: string;
  usageRules: string;
  updatedByAdminId?: string | null;
  updatedAt?: string;
}

export interface UserVoucher {
  id: string;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  code: string;
  valueInr: number;
  nonCashWithdrawable: boolean;
  status: VoucherStatus;
  cityAtClaim: string;
  registeredCityAtClaim: string;
  otpChallengeId: string | null;
  otpVerifiedAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redemptionRef: string | null;
  revokedAt: string | null;
  revokedByAdminId?: string | null;
  revocationReason: string | null;
  createdAt: string;
}

export interface VoucherOtpStatusRecord {
  id: string;
  userId: string;
  channel: "email" | "sms";
  destinationMasked: string;
  status: "pending" | "verified" | "expired" | "locked" | "consumed";
  attemptCount: number;
  maxAttempts: number;
  expiresAt: string;
  verifiedAt: string | null;
  consumedAt: string | null;
  createdAt: string;
}

export interface VoucherOtpChallengeResponse {
  challengeId: string;
  channel: "email" | "sms";
  destinationMasked: string;
  expiresAt: string;
  /** Demo-mode only helper when running offline without an external OTP provider. Never set in Supabase mode. */
  demoHint?: string;
}

