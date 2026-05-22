// Server-side helpers for subscription state. Mirrors the pattern of
// lib/preferences.ts and lib/gauges.ts — never throws, falls back to a
// safe "free tier" assumption on any error so the dashboard always
// renders for the user.
//
// `is_premium` lives as a SQL function on the database (see migration
// 004) so it can be reused by both the server and any future RLS
// policies. The TS helpers below just wrap the same logic at the
// application layer for convenient JS access.
//
// Writes to `subscriptions` are NEVER initiated from this file — they
// only happen via:
//   - Stripe webhook handler at /api/stripe/webhook (uses service role)
//   - Comp-code redemption server action (uses service role)
// Direct client-side writes are blocked by RLS for safety.

import { createClient } from "@/lib/supabase/server";

/** Public-facing tier labels. Matches the check constraint on
 *  subscriptions.tier. */
export type SubscriptionTier = "free" | "monthly" | "annual" | "lifetime";

/** Mirrors Stripe's subscription.status values plus `null` for users
 *  who've never subscribed. Used mostly for surfacing state in the UI
 *  ("renews on X" / "past due — update payment method"). */
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused"
  | null;

export interface Subscription {
  userId: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  status: SubscriptionStatus;
  tier: SubscriptionTier;
  /** Renewal/expiration date for subscription users. Null for
   *  lifetime + free tier. */
  currentPeriodEnd: string | null;
  /** Set once on lifetime purchase; never clears unless we
   *  explicitly revoke (e.g. for refund). */
  lifetimePurchasedAt: string | null;
  /** Active comp / beta-tester window. Null = no comp. is_premium
   *  treats this user as premium when this is in the future. */
  compUntil: string | null;
  updatedAt: string;
}

/** Default subscription state for guests and users with no row yet
 *  (shouldn't happen after the on_profile_created_subscription
 *  trigger lands, but defensive). */
export const FREE_SUBSCRIPTION: Subscription = {
  userId: "",
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  status: null,
  tier: "free",
  currentPeriodEnd: null,
  lifetimePurchasedAt: null,
  compUntil: null,
  updatedAt: new Date(0).toISOString(),
};

export interface LoadedSubscription {
  subscription: Subscription;
  /** Convenience flag — single source of truth for "is this user
   *  premium right now?". Derived from the same logic as the SQL
   *  is_premium() function so the two stay in lockstep. */
  isPremium: boolean;
  /** Where the result came from. "guest" = unauthenticated request,
   *  "default" = signed in but no row (shouldn't happen post-trigger,
   *  but useful diagnostic), "user" = real DB row. */
  source: "guest" | "default" | "user";
}

/**
 * Load the current request's subscription state. Always returns a
 * complete LoadedSubscription; never throws. Premium gating logic in
 * server actions and route handlers should branch on the `isPremium`
 * flag rather than re-deriving from raw fields.
 */
export async function loadSubscription(): Promise<LoadedSubscription> {
  const supabase = await createClient();
  if (!supabase) return guestDefaults();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return guestDefaults();

  const { data: row, error } = await supabase
    .from("subscriptions")
    .select(
      "user_id, stripe_customer_id, stripe_subscription_id, status, tier, " +
        "current_period_end, lifetime_purchased_at, comp_until, updated_at",
    )
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    console.error("[subscriptions] query failed:", error.message);
    return { subscription: { ...FREE_SUBSCRIPTION, userId: userData.user.id }, isPremium: false, source: "default" };
  }
  if (!row) {
    // No row — pre-trigger account, or the trigger failed. Return
    // free defaults; the next save (when one happens) will upsert.
    return { subscription: { ...FREE_SUBSCRIPTION, userId: userData.user.id }, isPremium: false, source: "default" };
  }

  const subscription: Subscription = {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    status: coerceStatus(row.status),
    tier: coerceTier(row.tier),
    currentPeriodEnd: row.current_period_end ?? null,
    lifetimePurchasedAt: row.lifetime_purchased_at ?? null,
    compUntil: row.comp_until ?? null,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };

  return {
    subscription,
    isPremium: computeIsPremium(subscription),
    source: "user",
  };
}

/**
 * Direct lookup for a specific user — used by webhook handlers and
 * the comp-code redemption action, which know the user_id but aren't
 * running in an authenticated request context. Goes through the
 * authenticated client (NOT service role); callers that need to
 * bypass RLS should use the admin client from lib/supabase/admin.ts.
 */
export async function getSubscription(userId: string): Promise<Subscription | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data: row, error } = await supabase
    .from("subscriptions")
    .select(
      "user_id, stripe_customer_id, stripe_subscription_id, status, tier, " +
        "current_period_end, lifetime_purchased_at, comp_until, updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !row) return null;
  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id ?? null,
    stripeSubscriptionId: row.stripe_subscription_id ?? null,
    status: coerceStatus(row.status),
    tier: coerceTier(row.tier),
    currentPeriodEnd: row.current_period_end ?? null,
    lifetimePurchasedAt: row.lifetime_purchased_at ?? null,
    compUntil: row.comp_until ?? null,
    updatedAt: String(row.updated_at ?? new Date().toISOString()),
  };
}

/**
 * Boolean premium check for the current request. Returns false for
 * guests and any error path. Use this as the simple gate when you
 * don't need the full subscription object — `if (await isPremium())`.
 */
export async function isPremium(): Promise<boolean> {
  const result = await loadSubscription();
  return result.isPremium;
}

/** JS mirror of the SQL is_premium() function. Kept in sync with
 *  migration 004 — if the SQL definition changes, update this too. */
export function computeIsPremium(s: Subscription): boolean {
  // Active or trialing subscription
  if (s.status === "active" || s.status === "trialing") return true;
  // Lifetime purchase — never expires (unless we wipe the field on refund)
  if (s.lifetimePurchasedAt) return true;
  // Active comp window
  if (s.compUntil && Date.parse(s.compUntil) > Date.now()) return true;
  return false;
}

function guestDefaults(): LoadedSubscription {
  return { subscription: FREE_SUBSCRIPTION, isPremium: false, source: "guest" };
}

// ─── Coercers — defensive against bad DB values ─────────────────────

function coerceStatus(v: unknown): SubscriptionStatus {
  if (v == null) return null;
  const allowed: SubscriptionStatus[] = [
    "active", "trialing", "past_due", "canceled",
    "unpaid", "incomplete", "incomplete_expired", "paused",
  ];
  return (allowed as string[]).includes(v as string) ? (v as SubscriptionStatus) : null;
}

function coerceTier(v: unknown): SubscriptionTier {
  if (v === "monthly" || v === "annual" || v === "lifetime") return v;
  return "free";
}
