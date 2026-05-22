// Server-side Stripe SDK initialization. Imported from server actions
// (checkout session creation, customer portal link) and the webhook
// route handler — never from client components, because the secret
// key must not ship to the browser.

import Stripe from "stripe";

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) {
    throw new Error(
      `Missing required env var: ${key}. ` +
      `Set it in .env.local for development and in Vercel project ` +
      `settings for production. See lib/stripe-server.ts header for setup.`,
    );
  }
  return v;
}

/** The pinned Stripe API version. Tracks the LatestApiVersion shipped
 *  with the installed Stripe SDK so we don't fight the TS narrow type. */
const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2025-08-27.basil";

// Lazily-initialized singleton so test environments and edge runtimes
// that don't have the secret set at startup don't crash on import.
let _stripe: Stripe | null = null;

export function stripeClient(): Stripe {
  if (_stripe) return _stripe;
  _stripe = new Stripe(requireEnv("STRIPE_SECRET_KEY"), {
    apiVersion: STRIPE_API_VERSION,
    appInfo: {
      name: "Tidevisor",
      version: "1.0.0",
      url: "https://tidevisor.com",
    },
  });
  return _stripe;
}

/** Maps env Price IDs to our internal tier label. Returns null for prices
 *  we don't recognize — webhook handler treats that as a no-op. */
export function tierForPriceId(priceId: string): "monthly" | "annual" | "lifetime" | null {
  if (priceId === process.env.STRIPE_PRICE_MONTHLY) return "monthly";
  if (priceId === process.env.STRIPE_PRICE_ANNUAL) return "annual";
  if (priceId === process.env.STRIPE_PRICE_LIFETIME) return "lifetime";
  return null;
}

export interface PlanDef {
  tier: "monthly" | "annual" | "lifetime";
  priceId: string | undefined;
  label: string;
  displayPrice: string;
  cadence: string;
  isOneTime: boolean;
}

export const PLANS: PlanDef[] = [
  {
    tier: "monthly",
    priceId: process.env.STRIPE_PRICE_MONTHLY,
    label: "Monthly",
    displayPrice: "$2.99",
    cadence: "per month",
    isOneTime: false,
  },
  {
    tier: "annual",
    priceId: process.env.STRIPE_PRICE_ANNUAL,
    label: "Annual",
    displayPrice: "$19",
    cadence: "per year",
    isOneTime: false,
  },
  {
    tier: "lifetime",
    priceId: process.env.STRIPE_PRICE_LIFETIME,
    label: "Lifetime",
    displayPrice: "$59",
    cadence: "once, forever",
    isOneTime: true,
  },
];
