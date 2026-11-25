/**
 * Membership Purchase Celebration eligibility, RPC validation, and in-memory
 * session coordination helpers (Requirement 7).
 *
 * Design invariants:
 * - Server-side `payments.celebration_shown_at` is the sole durable idempotency
 *   marker (never `localStorage`).
 * - A failed acknowledgement never permanently suppresses a future retry.
 * - Missing acknowledgement RPC errors (`PGRST202`, `42883`) and invalid/empty
 *   timestamps are thrown rather than silently treated as success.
 * - Within a single mounted session, duplicate overlays and overlapping RPCs
 *   for the same payment are prevented via in-memory sets.
 */

import type { Payment, Subscription } from "./types";

export interface CelebrationRpcResponse {
  data: unknown;
  error: { code?: string; message?: string } | null;
}

/**
 * Unwraps the response from `public.acknowledge_membership_celebration`.
 * Never treats missing RPC errors (`PGRST202` / `42883`) or empty responses as success.
 */
export function unwrapCelebrationAckRpcResult(res: CelebrationRpcResponse): string {
  if (res.error) {
    if (res.error.code === "PGRST202" || res.error.code === "42883") {
      throw new Error(
        "MIGRATION_REQUIRED: acknowledge_membership_celebration RPC is unavailable in Supabase.",
      );
    }
    throw new Error(res.error.message || "Could not acknowledge membership celebration.");
  }

  if (typeof res.data !== "string" || !res.data.trim()) {
    throw new Error(
      "INVALID_ACK_RESPONSE: Server did not return a valid celebration_shown_at timestamp.",
    );
  }

  return res.data;
}

/**
 * Returns the first payment eligible to trigger the membership celebration for `userId`.
 * Requires:
 *  - active subscription for the signed-in member
 *  - payment owned by `userId`
 *  - `kind === "membership"` and `status === "verified"`
 *  - server-side `celebrationShownAt` is unset
 *  - not already confirmed acknowledged in the current in-memory session
 */
export function findEligibleCelebrationPayment(
  userId: string | null | undefined,
  sub: Subscription | null | undefined,
  payments: readonly Payment[],
  acknowledgedIds?: ReadonlySet<string>,
): Payment | undefined {
  if (!userId || !sub || sub.userId !== userId || sub.status !== "active") return undefined;
  return payments.find(
    (p) =>
      p.userId === userId &&
      p.status === "verified" &&
      p.kind === "membership" &&
      !p.celebrationShownAt &&
      !acknowledgedIds?.has(p.id),
  );
}

export interface EvaluateCelebrationParams {
  userId: string;
  sub: Subscription | null | undefined;
  payments: readonly Payment[];
  acknowledge: (paymentId: string, userId: string) => Promise<string>;
  onShow: (payment: Payment) => void;
  onAcknowledged?: (paymentId: string, shownAt: string) => void;
  onError?: (paymentId: string, error: unknown) => void;
}

export interface EvaluateCelebrationOutcome {
  paymentId: string | null;
  shownOverlay: boolean;
  acknowledged: boolean;
  inFlightSkipped: boolean;
}

export interface CelebrationSessionController {
  hasShownInSession(paymentId: string): boolean;
  isAcknowledgedInSession(paymentId: string): boolean;
  isAckInFlight(paymentId: string): boolean;
  reset(): void;
  evaluateAndAcknowledge(params: EvaluateCelebrationParams): Promise<EvaluateCelebrationOutcome>;
  retryAcknowledgeIfPending(params: {
    paymentId: string;
    userId: string;
    acknowledge: (paymentId: string, userId: string) => Promise<string>;
    onAcknowledged?: (paymentId: string, shownAt: string) => void;
    onError?: (paymentId: string, error: unknown) => void;
  }): Promise<boolean>;
}

/**
 * Creates an in-memory coordinator scoped to a single mounted Membership view.
 * Uses no persistent browser storage so failed acknowledgements always remain
 * retryable until server-side `celebration_shown_at` is durably persisted.
 */
export function createCelebrationSessionController(): CelebrationSessionController {
  const shownIds = new Set<string>();
  const inFlightIds = new Set<string>();
  const acknowledgedIds = new Set<string>();

  async function runAck(
    paymentId: string,
    userId: string,
    acknowledge: (paymentId: string, userId: string) => Promise<string>,
    onAcknowledged?: (paymentId: string, shownAt: string) => void,
    onError?: (paymentId: string, error: unknown) => void,
  ): Promise<boolean> {
    inFlightIds.add(paymentId);
    try {
      const shownAt = await acknowledge(paymentId, userId);
      if (typeof shownAt !== "string" || !shownAt.trim()) {
        throw new Error(
          "INVALID_ACK_RESPONSE: Server did not return a valid celebration_shown_at timestamp.",
        );
      }
      acknowledgedIds.add(paymentId);
      onAcknowledged?.(paymentId, shownAt);
      return true;
    } catch (err) {
      onError?.(paymentId, err);
      return false;
    } finally {
      inFlightIds.delete(paymentId);
    }
  }

  return {
    hasShownInSession: (paymentId) => shownIds.has(paymentId),
    isAcknowledgedInSession: (paymentId) => acknowledgedIds.has(paymentId),
    isAckInFlight: (paymentId) => inFlightIds.has(paymentId),
    reset: () => {
      shownIds.clear();
      inFlightIds.clear();
      acknowledgedIds.clear();
    },

    async evaluateAndAcknowledge({
      userId,
      sub,
      payments,
      acknowledge,
      onShow,
      onAcknowledged,
      onError,
    }): Promise<EvaluateCelebrationOutcome> {
      const eligible = findEligibleCelebrationPayment(userId, sub, payments, acknowledgedIds);
      if (!eligible) {
        return {
          paymentId: null,
          shownOverlay: false,
          acknowledged: false,
          inFlightSkipped: false,
        };
      }

      let shownOverlay = false;
      if (!shownIds.has(eligible.id)) {
        shownIds.add(eligible.id);
        onShow(eligible);
        shownOverlay = true;
      }

      if (inFlightIds.has(eligible.id)) {
        return {
          paymentId: eligible.id,
          shownOverlay,
          acknowledged: false,
          inFlightSkipped: true,
        };
      }

      const acknowledged = await runAck(
        eligible.id,
        userId,
        acknowledge,
        onAcknowledged,
        onError,
      );

      return {
        paymentId: eligible.id,
        shownOverlay,
        acknowledged,
        inFlightSkipped: false,
      };
    },

    async retryAcknowledgeIfPending({
      paymentId,
      userId,
      acknowledge,
      onAcknowledged,
      onError,
    }): Promise<boolean> {
      if (!paymentId || !userId || acknowledgedIds.has(paymentId) || inFlightIds.has(paymentId)) {
        return false;
      }
      return runAck(paymentId, userId, acknowledge, onAcknowledged, onError);
    },
  };
}
