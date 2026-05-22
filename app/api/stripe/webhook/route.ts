// Stripe webhook handler. The ONLY trustworthy way to grant premium —
// the success-redirect URL on /upgrade/success is just UX, never used
// to mutate the subscriptions table.

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import Stripe from "stripe";
import { stripeClient, tierForPriceId } from "@/lib/stripe-server";
import { createAdminClient } from "@/lib/supabase/admin";

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
      default:
        break;
    }
  } catch (err) {
    console.error(`[stripe-webhook] handler crashed for ${event.type}:`, err);
    return NextResponse.json({ error: "Handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

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
    const sub = await stripe.subscriptions.retrieve(subId);
    await upsertFromSubscription(sub, customerId, admin);
  } else if (session.mode === "payment") {
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

async function handleSubscriptionUpdated(sub: Stripe.Subscription, admin: AdminClient) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  await upsertFromSubscription(sub, customerId, admin);
}

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

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  stripe: Stripe,
  admin: AdminClient,
) {
  const invoiceSubField = (invoice as unknown as { subscription?: string | Stripe.Subscription | null })
    .subscription;
  if (!invoiceSubField) return;
  const subId =
    typeof invoiceSubField === "string" ? invoiceSubField : invoiceSubField.id;
  const sub = await stripe.subscriptions.retrieve(subId);
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  await upsertFromSubscription(sub, customerId, admin);
}

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
  const priceId = sub.items.data[0]?.price?.id;
  const tier = priceId ? tierForPriceId(priceId) : null;
  if (!tier) {
    console.warn(`[stripe-webhook] sub ${sub.id} has unknown price ID ${priceId}`);
  }

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
        ...(tier ? { tier } : {}),
        current_period_end: periodEndIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
}
