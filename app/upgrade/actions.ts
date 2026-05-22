"use server";

// Server actions for the upgrade flow:
//   - createCheckoutSession: kick off a Stripe Checkout for a chosen plan
//   - createPortalSession:   send an existing customer to their billing portal
//
// Both actions identify the user via the user-context Supabase client, then
// use the admin (service-role) client to read/write the subscriptions row.
// We never trust client-supplied identifiers (price IDs come from server
// env, customer IDs from our DB) so the checkout surface is always Stripe-
// configured by us, never by query string.
//
// Pattern mirrors app/account/actions.ts (redeemCompCode): user-context
// client for auth identification, admin client for everything that touches
// the subscriptions table.

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { stripeClient, PLANS } from "@/lib/stripe-server";
import type { SubscriptionTier } from "@/lib/subscriptions";
import type Stripe from "stripe";

export interface CheckoutSessionResult {
  ok: boolean;
  /** Hosted-checkout URL the client should redirect to (window.location.href = url). */
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
 * hosted-checkout URL; the client redirects to it. Stripe handles the
 * payment UI, then sends the user back to {APP_URL}/upgrade/success or
 * /upgrade/cancel based on outcome. The webhook (NOT this action) is what
 * actually grants premium — we never trust the success redirect alone.
 */
export async function createCheckoutSession(tier: Tier): Promise<CheckoutSessionResult> {
  // ─── 1. Identify the user ──────────────────────────────────────────
  const userClient = await createClient();
  if (!userClient) return { ok: false, error: "Auth is not configured." };
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Sign in to upgrade." };
  }
  const user = userData.user;
  const userId = user.id;
  const email = user.email ?? undefined;

  // ─── 2. Look up the plan ───────────────────────────────────────────
  const plan = PLANS.find((p) => p.tier === tier);
  if (!plan) return { ok: false, error: "Unknown plan." };
  if (!plan.priceId) {
    return {
      ok: false,
      error: "This plan isn't configured yet. Check STRIPE_PRICE_* env vars.",
    };
  }

  // ─── 3. Find or create the Stripe customer ─────────────────────────
  // We persist stripe_customer_id on the subscriptions row so repeat
  // purchases (e.g. lifetime after monthly) reuse the same customer
  // and keep all history under one record in the Stripe dashboard.
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
      // Persist immediately so a retry doesn't create a duplicate.
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

  // ─── 4. Build the Checkout Session ─────────────────────────────────
  // Lifetime is a one-time payment; monthly/annual are subscriptions.
  // Stripe encodes that via `mode`. The metadata on session + on the
  // subscription/payment_intent gives the webhook everything it needs
  // to map the result back to our user without trusting the redirect.
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_BASE_URL?.trim() ||
    "https://tidevisor.com";

  try {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      // Don't ask for email again if we already have it — but if the
      // Supabase user somehow has no email, let Stripe collect it so
      // the receipt has somewhere to go.
      ...(email ? {} : { customer_email: undefined }),
      mode: plan.isOneTime ? "payment" : "subscription",
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${baseUrl}/upgrade/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/upgrade?canceled=1`,
      // Surface to the user that they're on Tidevisor's checkout.
      // (Stripe shows this in the hosted page header.)
      // Metadata propagates to the resulting subscription/payment for
      // the webhook to read.
      metadata: {
        supabase_user_id: userId,
        tier: plan.tier,
      },
      // Subscription-mode metadata is set separately so it sticks on
      // the subscription object (not just the session).
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
      // Allow promotion codes (separate from our comp codes — these
      // are Stripe-managed discount codes if we ever run a sale).
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
 * Create a Stripe Billing Portal session for the current user. The portal
 * lets them update payment methods, switch plans, view invoices, and
 * cancel — all without us building those screens. Returns the portal URL;
 * the client redirects to it.
 *
 * Requires the user to already have a stripe_customer_id on file (i.e.
 * they've gone through Checkout at least once). Lifetime customers also
 * have one because Checkout creates it on the way through.
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
