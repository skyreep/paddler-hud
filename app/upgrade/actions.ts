"use server";

// Server actions for the upgrade flow: createCheckoutSession + createPortalSession.
// User-context client for auth identification, admin client for subscriptions writes.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient, PLANS } from "@/lib/stripe-server";
import type { SubscriptionTier } from "@/lib/subscriptions";
import type Stripe from "stripe";

export interface CheckoutSessionResult {
  ok: boolean;
  url?: string;
  error?: string;
}

export interface PortalSessionResult {
  ok: boolean;
  url?: string;
  error?: string;
}

type Tier = Exclude<SubscriptionTier, "free">;

/**
 * Create a Stripe Checkout Session for the requested plan. Returns the
 * hosted-checkout URL; the client redirects to it. The webhook (NOT this
 * action) is what actually grants premium.
 */
export async function createCheckoutSession(tier: Tier): Promise<CheckoutSessionResult> {
  const userClient = await createClient();
  if (!userClient) return { ok: false, error: "Auth is not configured." };
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Sign in to upgrade." };
  }
  const user = userData.user;
  const userId = user.id;
  const email = user.email ?? undefined;

  const plan = PLANS.find((p) => p.tier === tier);
  if (!plan) return { ok: false, error: "Unknown plan." };
  if (!plan.priceId) {
    return {
      ok: false,
      error: "This plan isn't configured yet. Check STRIPE_PRICE_* env vars.",
    };
  }

  const admin = createAdminClient();
  if (!admin) {
    console.error("[checkout] admin client not configured");
    return { ok: false, error: "Server isn't configured to process payments yet." };
  }

  const { data: subRow } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  let stripe: Stripe;
  try {
    stripe = stripeClient();
  } catch (err) {
    console.error("[checkout] stripeClient init failed:", err);
    return { ok: false, error: "Payment provider not configured." };
  }

  let customerId = subRow?.stripe_customer_id ?? null;
  if (!customerId) {
    try {
      const customer = await stripe.customers.create({
        email,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      await admin
        .from("subscriptions")
        .upsert(
          {
            user_id: userId,
            stripe_customer_id: customerId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id" },
        );
    } catch (err) {
      console.error("[checkout] customers.create failed:", err);
      return { ok: false, error: "Couldn't start checkout. Please try again." };
    }
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    "https://tidevisor.com";

  try {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: plan.isOneTime ? "payment" : "subscription",
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${baseUrl}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/upgrade?canceled=1`,
      metadata: {
        supabase_user_id: userId,
        tier: plan.tier,
      },
      ...(plan.isOneTime
        ? {
            payment_intent_data: {
              metadata: {
                supabase_user_id: userId,
                tier: plan.tier,
              },
            },
          }
        : {
            subscription_data: {
              metadata: {
                supabase_user_id: userId,
                tier: plan.tier,
              },
            },
          }),
      allow_promotion_codes: true,
    };

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) {
      return { ok: false, error: "Stripe didn't return a checkout URL." };
    }
    return { ok: true, url: session.url };
  } catch (err) {
    console.error("[checkout] sessions.create failed:", err);
    const msg = err instanceof Error ? err.message : "Couldn't start checkout.";
    return { ok: false, error: msg };
  }
}

/**
 * Create a Stripe Billing Portal session for the current user. Returns the
 * portal URL; the client redirects to it. Requires the user to already have
 * a stripe_customer_id on file (i.e. they've gone through Checkout once).
 */
export async function createPortalSession(): Promise<PortalSessionResult> {
  const userClient = await createClient();
  if (!userClient) return { ok: false, error: "Auth is not configured." };
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Sign in first." };
  }
  const userId = userData.user.id;

  const admin = createAdminClient();
  if (!admin) {
    return { ok: false, error: "Server isn't configured to manage billing yet." };
  }

  const { data: subRow } = await admin
    .from("subscriptions")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  const customerId = subRow?.stripe_customer_id;
  if (!customerId) {
    return {
      ok: false,
      error: "No billing history yet. Make a purchase first.",
    };
  }

  let stripe: Stripe;
  try {
    stripe = stripeClient();
  } catch (err) {
    console.error("[portal] stripeClient init failed:", err);
    return { ok: false, error: "Payment provider not configured." };
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    "https://tidevisor.com";

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${baseUrl}/`,
    });
    return { ok: true, url: portal.url };
  } catch (err) {
    console.error("[portal] sessions.create failed:", err);
    const msg = err instanceof Error ? err.message : "Couldn't open billing portal.";
    return { ok: false, error: msg };
  }
}
