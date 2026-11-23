import { getSupabase } from "./supabase";

interface CreateOrderResponse {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  reused?: boolean;
}

interface VerifyPaymentResponse {
  ok: true;
  already?: boolean;
  paymentId: string;
  subscriptionId: string;
  planId: string;
}

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpaySuccess) => void | Promise<void>;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", callback: (response: { error?: { description?: string } }) => void): void;
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayOptions) => RazorpayInstance;
  }
}

let razorpayScriptPromise: Promise<void> | null = null;

function loadRazorpayScript(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (razorpayScriptPromise) return razorpayScriptPromise;

  razorpayScriptPromise = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => window.Razorpay ? resolve() : reject(new Error("Razorpay checkout did not initialize."));
    script.onerror = () => reject(new Error("Could not load secure Razorpay checkout."));
    document.head.appendChild(script);
  }).catch((error) => {
    razorpayScriptPromise = null;
    throw error;
  });

  return razorpayScriptPromise;
}

/**
 * Creates an order through the authenticated Edge Function and verifies the
 * signed Razorpay callback server-side. The browser never writes payment status.
 */
export async function startRazorpayMembershipCheckout(
  planId: "connect" | "plus" | "elite",
  onVerified: (result: VerifyPaymentResponse) => void,
  onError: (message: string) => void,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Secure payment service is unavailable.");

  const { data: order, error: orderError } = await supabase.functions.invoke<CreateOrderResponse>(
    "create-order",
    { body: { planId } },
  );
  if (orderError) throw new Error(orderError.message || "Could not create Razorpay order.");
  if (!order?.paymentId || !order.orderId || !order.keyId || !order.amount) {
    throw new Error("Payment service returned an incomplete order.");
  }

  await loadRazorpayScript();
  if (!window.Razorpay) throw new Error("Razorpay checkout is unavailable.");

  const checkout = new window.Razorpay({
    key: order.keyId,
    amount: order.amount,
    currency: order.currency || "INR",
    name: "Datevra",
    description: "Monthly membership",
    order_id: order.orderId,
    theme: { color: "#C9A46A" },
    handler: async (response) => {
      const { data, error } = await supabase.functions.invoke<VerifyPaymentResponse>(
        "verify-payment",
        {
          body: {
            paymentId: order.paymentId,
            razorpayOrderId: response.razorpay_order_id,
            razorpayPaymentId: response.razorpay_payment_id,
            razorpaySignature: response.razorpay_signature,
          },
        },
      );

      if (error || !data?.ok) {
        onError(error?.message || "Payment received, but verification is still pending. Please refresh your membership shortly.");
        return;
      }
      onVerified(data);
    },
    modal: {
      ondismiss: () => undefined,
    },
  });

  checkout.on("payment.failed", (response) => {
    onError(response.error?.description || "Payment attempt failed. You can try again.");
  });
  checkout.open();
}
