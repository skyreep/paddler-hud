// Stripe webhook handler. This is the ONLY trustworthy way to grant
// premium — the success-redirect URL on /upgrade/success is just a
// friendly UX surface, never used to mutate the subscriptions table.
//
// Stripe signs every event with STRIPE_WEBHOOK_SECRET; we verify the
// signature before doing anything. Failed verification → 400 and we
// don't touch the DB. Successful verification → we use the service-role
// Supabase client (RLS-bypassing) to update subscriptions.
//
// Events we care about, ordered by importance:
//
//   checkout.session.completed
//     Fires after the user pays. For subscriptions, the session has
//     `subscription` pointing at the new sub object; for one-time
//     lifetime purchases, it has `payment_intent`. We use the
//     metadata.supabase_user_id we attached during session creation
//     to identify the user, and the line items' price ID to determine
//     the tier.
//
//   customer.subscription.updated
//   customer.subscription.deleted
//     Fires on renewals, plan changes, cancellations, dunning state
//     changes. Keeps the local status + tier + current_period_end in
//     sync with Stripe's source of truth. `.deleted` also fires when
//     a sub fully terminates (after grace period); we set status to
//     `canceled` and clear the tier back to free.
//
//   invoice.paid
//     Belt-and-suspenders renewal handler — `customer.subscription.updated`
//     usually carries the new current_period_end, but invoice.paid is
//     the most reliable signal that money actually changed hands. We
//     re-read the subscription from Stripe to refresh fields.
//
// Edge runtime is NOT used: the Supabase JS client and Stripe SDK both
// expect Node, and we need the raw request body for signature
// verification. Node runtime (default) it is.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { stripeClient, tierForPriceId } from "@/lib/stripe-server";
import { createAdminClient } from "@/lib/supabase/admin";

// Make sure Next doesn't try to body-parse for us. We need the raw bytes
// for signature verification — Stripe signs over the exact request body.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface WebhookConfig {
  stripe: Stripe;
  signingSecret: string;
}

function requireConfig(): WebhookConfig | null {
  const signingSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signingSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return null;
  }
  try {
    return { stripe: stripeClient(), signingSecret };
  } catch (err) {
    console.error("[stripe-webhook] stripeClient init failed:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  const config = requireConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Stripe not configured on server." },
      { status: 500 },
    );
  }

  // Verify the signature. We can't use req.json() — Stripe signs over
  // the raw body, and any reformatting (even insignificant whitespace
  // changes from JSON.parse + JSON.stringify) breaks verification.
  const sig = req.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header." }, { status: 400 });
  }
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = config.stripe.webhooks.constructEvent(body, sig, config.signingSecret);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Invalid signature.";
    console.error("[stripe-webhook] signature verification failed:", msg);
    return NextResponse.json({ error: `Webhook Error: ${msg}` }, { status: 400 });
  }

  // Service-role client. Required because subscriptions has no public
  // write policies (users can only read their own row, never write).
  const admin = createAdminClient();
  if (!admin) {
    console.error("[stripe-webhook] admin client not configured");
    return NextResponse.json({ error: "Server not configured." }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, config.stripe, admin);
        break;
      case "customer.subscription.updated":
      case "customer.subscription.created":
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription, admin);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, admin);
        break;
      case "invoice.paid":
        await handleInvoicePaid(event.data.object as Stripe.Invoice, config.stripe, admin);
        break;
      // Everything else is acknowledged but no-op'd. Stripe will retry
      // on 5xx, so always return 200 here.
      default:
        // Useful breadcrumb during early ops — comment out when noisy.
        // console.log("[stripe-webhook] ignoring", event.type);
        break;
    }
  } catch (err) {
    console.error(`[stripe-webhook] handler crashed for ${event.type}:`, err);
    // Return 500 so Stripe retries. Idempotent handlers below mean
    // retries are safe even if the failure was halfway through a write.
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ─── Handlers ──────────────────────────────────────────────────────────────

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

/**
 * checkout.session.completed → user just paid. For subscription plans,
 * the session payload references the new subscription, which we then
 * use to populate tier + period_end. For one-time lifetime purchases
 * (mode=payment), we set lifetime_purchased_at and tier='lifetime'.
 */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  stripe: Stripe,
  admin: AdminClient,
) {
  const userId = session.metadata?.supabase_user_id;
  if (!userId) {
    console.warn("[stripe-webhook] checkout.session.completed missing supabase_user_id metadata");
    return;
  }

  const customerId =
    typeof session.customer === "string" ? session.customer : session.customer?.id ?? null;

  if (session.mode === "subscription" && session.subscription) {
    const subId =
      typeof session.subscription === "string" ? session.subscription : session.subscription.id;
    // Pull the full sub to get the actual price ID + period end. The
    // session payload sometimes has these expanded, sometimes not —
    // re-fetching is the simple path.
    const sub = await stripe.subscriptions.retrieve(subId);
    await upsertFromSubscription(sub, customerId, admin);
  } else if (session.mode === "payment") {
    // Lifetime purchase. The session has line_items not always expanded,
    // so re-fetch with expansion to get the price.
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items.data.price"],
    });
    const priceId = fullSession.line_items?.data[0]?.price?.id;
    if (!priceId) {
      console.warn("[stripe-webhook] checkout.session.completed payment-mode missing price ID");
      return;
    }
    const tier = tierForPriceId(priceId);
    if (tier !== "lifetime") {
      console.warn(`[stripe-webhook] payment-mode session for unexpected tier: ${tier}`);
      return;
    }
    await admin
      .from("subscriptions")
      .upsert(
        {
          user_id: userId,
          stripe_customer_id: customerId,
          tier: "lifetime",
          lifetime_purchased_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
  }
}

/**
 * customer.subscription.{created,updated} → keep tier/status/period in
 * sync. Fires on renewals, plan changes, dunning state changes, and
 * cancellation (status flips to "canceled" while the period_end is
 * still in the future = user keeps premium until end of paid period).
 */
async function handleSubscriptionUpdated(sub: Stripe.Subscription, admin: AdminClient) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  await upsertFromSubscription(sub, customerId, admin);
}

/**
 * customer.subscription.deleted → sub fully terminated (after grace
 * period). Drop back to free tier. We leave stripe_customer_id and
 * stripe_subscription_id in place for history; tier and status are
 * the gating fields.
 */
async function handleSubscriptionDeleted(sub: Stripe.Subscription, admin: AdminClient) {
  const userId = await userIdFromSubscription(sub, admin);
  if (!userId) return;
  await admin
    .from("subscriptions")
    .update({
      status: "canceled",
      tier: "free",
      current_period_end: null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);
}

/**
 * invoice.paid → a renewal or initial charge cleared. Refresh the
 * subscription row in case current_period_end advanced. Idempotent
 * with .subscription.updated; we run both because invoice.paid is the
 * canonical "money moved" signal and sometimes precedes the sub
 * update event by a beat.
 */
async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  stripe: Stripe,
  admin: AdminClient,
) {
  // Older Stripe SDK types had `subscription` on the Invoice. The 18.x
  // typings define it on Invoice in some contexts but not others, so
  // we read defensively via an unknown cast rather than relying on it.
  const invoiceSubField = (invoice as unknown as { subscription?: string | Stripe.Subscription | null })
    .subscription;
  if (!invoiceSubField) return; // one-off invoice (lifetime); nothing to refresh
  const subId =
    typeof invoiceSubField === "string" ? invoiceSubField : invoiceSubField.id;
  const sub = await stripe.subscriptions.retrieve(subId);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  await upsertFromSubscription(sub, customerId, admin);
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Look up our user_id from a Stripe subscription. Prefers the metadata
 * we set on session creation; falls back to a lookup by stripe_customer_id
 * for older subs created before metadata was set.
 */
async function userIdFromSubscription(sub: Stripe.Subscription, admin: AdminClient): Promise<string | null> {
  const fromMeta = sub.metadata?.supabase_user_id;
  if (fromMeta) return fromMeta;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const { data } = await admin
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return data?.user_id ?? null;
}

/** Core subscription-state writer. Used by every event that carries a
 *  Stripe.Subscription object. Sets tier, status, period_end, and the
 *  Stripe IDs for future webhook routing. */
async function upsertFromSubscription(
  sub: Stripe.Subscription,
  customerId: string | null,
  admin: AdminClient,
) {
  const userId = await userIdFromSubscription(sub, admin);
  if (!userId) {
    console.warn("[stripe-webhook] no user_id mappable for sub", sub.id);
    return;
  }
  // First line item is our one-and-only — we don't sell multi-item
  // subscriptions.
  const priceId = sub.items.data[0]?.price?.id;
  const tier = priceId ? tierForPriceId(priceId) : null;
  if (!tier) {
    console.warn(`[stripe-webhook] sub ${sub.id} has unknown price ID ${priceId}`);
  }

  // current_period_end is in seconds since epoch (Stripe convention).
  // The 18.x types moved this onto `items.data[].current_period_end` in
  // some contexts but it's still present on the subscription too.
  const periodEndUnix =
    (sub as unknown as { current_period_end?: number }).current_period_end ??
    sub.items.data[0]?.current_period_end ??
    null;
  const periodEndIso = periodEndUnix
    ? new Date(periodEndUnix * 1000).toISOString()
    : null;

  await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        stripe_subscription_id: sub.id,
        status: sub.status,
        // Don't overwrite tier with "free" — if Stripe sends us an
        // unrecognized price ID for some reason, we keep whatever
        // tier we had before rather than silently downgrading the
        // user mid-renewal.
        ...(tier ? { tier } : {}),
        current_period_end: periodEndIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}
