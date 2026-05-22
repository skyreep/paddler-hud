// Tidevisor Pro upgrade page. Server component that loads user +
// subscription state, renders the three pricing cards, and surfaces
// an "already on Pro" banner with portal link for active users.

import Link from "next/link";
import type { Metadata } from "next";
import { PLANS } from "@/lib/stripe-server";
import { loadSubscription } from "@/lib/subscriptions";
import { getCurrentUser } from "@/lib/auth";
import PlanCards from "./PlanCards";

export const metadata: Metadata = {
  title: "Upgrade to Tidevisor Pro",
  description:
    "Unlock unlimited locations, daily briefing emails, GPS tracking, " +
    "and the Pro Weather tile. $2.99/mo, $19/year, or $59 lifetime.",
};

const SHARED_BULLETS = [
  "Unlimited saved locations",
  "Daily briefing email",
  "GPS heading + follow mode on the map",
  "Custom per-location data source picker",
  "Pro Weather tile (forecast radar, layers, streamlines — when available)",
];

const PLAN_NOTES: Record<"monthly" | "annual" | "lifetime", string[]> = {
  monthly: [...SHARED_BULLETS, "Cancel any time"],
  annual: [...SHARED_BULLETS, "Save ~47% vs monthly"],
  lifetime: [...SHARED_BULLETS, "One-time payment — never renews"],
};

function deriveCurrentTierLabel(
  isPremium: boolean,
  tier: "free" | "monthly" | "annual" | "lifetime",
  compUntil: string | null,
): "free" | "monthly" | "annual" | "lifetime" | "comp" {
  if (!isPremium) return "free";
  if (tier !== "free") return tier;
  if (compUntil && Date.parse(compUntil) > Date.now()) return "comp";
  return "free";
}

export default async function UpgradePage() {
  const [currentUser, sub] = await Promise.all([
    getCurrentUser().catch(() => null),
    loadSubscription(),
  ]);

  const isSignedIn = !!currentUser;
  const isPremium = sub.isPremium;
  const hasStripeCustomer = !!sub.subscription.stripeCustomerId;
  const currentTier = deriveCurrentTierLabel(
    isPremium,
    sub.subscription.tier,
    sub.subscription.compUntil,
  );

  const plans = PLANS.map((p) => ({
    tier: p.tier,
    label: p.label,
    displayPrice: p.displayPrice,
    cadence: p.cadence,
    bullets: PLAN_NOTES[p.tier],
    highlighted: p.tier === "annual",
    disabled: !isSignedIn,
    disabledReason: !isSignedIn ? "Sign in to subscribe" : undefined,
  }));

  return (
    <div style={shell}>
      <header style={header}>
        <Link href="/" style={brandLink}>
          <span style={brandMark}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4 2 6 0" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4 2 6 0" stroke="white" strokeWidth="2.2" strokeLinecap="round" opacity=".6" />
            </svg>
          </span>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: ".3px" }}>TIDEVISOR</span>
        </Link>
        <Link href="/" style={backLink}>
          ← Back to dashboard
        </Link>
      </header>

      <main style={main}>
        <h1 style={h1}>Tidevisor Pro</h1>
        <p style={lede}>
          The free dashboard is genuinely useful. Pro gives active paddlers a
          few power-user conveniences and pays for the small ops costs that
          come with running a useful tool.
        </p>

        <PlanCards
          isSignedIn={isSignedIn}
          isPremium={isPremium}
          hasStripeCustomer={hasStripeCustomer}
          currentTier={currentTier}
          plans={plans}
        />

        <div style={faq}>
          <FaqItem
            q="What's included in the free tier?"
            a="Three saved locations with full data resolution, every dashboard tile, satellite map with one-shot center-on-me, layout customization, and unit/theme/time preferences."
          />
          <FaqItem
            q="Can I switch plans later?"
            a="Yes. Open the billing portal (via Manage subscription) to upgrade, downgrade, or cancel."
          />
          <FaqItem
            q="What happens if I cancel?"
            a="You keep Pro access through the end of the period you already paid for. After that you drop back to the free tier; saved locations and preferences stay intact."
          />
          <FaqItem
            q="Do you support refunds?"
            a="Yes, within 7 days of purchase, no questions asked. Email contact@tidevisor.com."
          />
          <FaqItem
            q="Got a beta-tester code?"
            a="Sign in, open Preferences from the account menu, and paste it into the Redeem code field for 30 days of Pro."
          />
        </div>

        <p style={legal}>
          Payments are processed by Stripe. We never see your card details.{" "}
          See our <Link href="/privacy" style={inlineLink}>Privacy Policy</Link>
          {" "}and{" "}
          <Link href="/terms" style={inlineLink}>Terms of Service</Link>.
        </p>
      </main>

      <footer style={footer}>
        <div>Tidevisor is a product of the Georgia Coast.</div>
      </footer>
    </div>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  return (
    <details style={faqRow}>
      <summary style={faqQ}>{q}</summary>
      <div style={faqA}>{a}</div>
    </details>
  );
}

const shell: React.CSSProperties = {
  minHeight: "100vh",
  display: "flex",
  flexDirection: "column",
  background: "var(--bg)",
  color: "var(--text)",
};

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 16px",
  paddingTop: "calc(14px + env(safe-area-inset-top))",
  borderBottom: "1px solid var(--border-soft)",
};

const brandLink: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  textDecoration: "none",
  color: "var(--text)",
};

const brandMark: React.CSSProperties = {
  width: 28,
  height: 28,
  background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
  borderRadius: 8,
  display: "grid",
  placeItems: "center",
  color: "white",
  boxShadow: "0 2px 8px rgba(15,110,168,.35)",
};

const backLink: React.CSSProperties = {
  marginLeft: "auto",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-muted)",
  textDecoration: "none",
};

const main: React.CSSProperties = {
  flex: 1,
  maxWidth: 880,
  width: "100%",
  margin: "0 auto",
  padding: "28px 20px 48px",
};

const h1: React.CSSProperties = {
  fontSize: 30,
  fontWeight: 800,
  margin: "0 0 8px",
  letterSpacing: "-.5px",
};

const lede: React.CSSProperties = {
  fontSize: 15,
  color: "var(--text-muted)",
  margin: "0 0 24px",
  lineHeight: 1.6,
  maxWidth: 620,
};

const faq: React.CSSProperties = {
  marginTop: 32,
  borderTop: "1px solid var(--border-soft)",
  paddingTop: 20,
};

const faqRow: React.CSSProperties = {
  padding: "10px 0",
  borderBottom: "1px solid var(--border-soft)",
};

const faqQ: React.CSSProperties = {
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  padding: "6px 0",
  listStyle: "none",
};

const faqA: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.6,
  color: "var(--text-muted)",
  padding: "8px 0 4px",
};

const inlineLink: React.CSSProperties = {
  color: "var(--accent)",
  textDecoration: "underline",
};

const legal: React.CSSProperties = {
  marginTop: 28,
  fontSize: 12,
  color: "var(--text-faint)",
  textAlign: "center",
  lineHeight: 1.6,
};

const footer: React.CSSProperties = {
  padding: "20px 16px",
  paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
  borderTop: "1px solid var(--border-soft)",
  textAlign: "center",
  fontSize: 12,
  color: "var(--text-faint)",
};
