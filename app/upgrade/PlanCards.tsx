"use client";

// Client island for the upgrade page. Handles:
//   - "Subscribe" / "Buy" button click → createCheckoutSession → redirect
//   - Per-card pending state while Stripe round-trips
//   - "Manage subscription" portal redirect for existing customers
//
// The static pricing copy is rendered server-side (in app/upgrade/page.tsx);
// this component only owns the interactive bits.

import { useState } from "react";
import { createCheckoutSession, createPortalSession } from "./actions";

type Tier = "monthly" | "annual" | "lifetime";

interface PlanProps {
  tier: Tier;
  label: string;
  displayPrice: string;
  cadence: string;
  /** Marketing bullets shown under the price. */
  bullets: string[];
  /** True when this card should be visually emphasized (Annual = recommended). */
  highlighted?: boolean;
  /** Disable the buttons entirely (signed-out users). */
  disabled?: boolean;
  /** Reason for disabling (e.g. "Sign in to upgrade") — shown in place of price. */
  disabledReason?: string;
}

interface Props {
  isSignedIn: boolean;
  isPremium: boolean;
  hasStripeCustomer: boolean;
  /** Active tier label for the "you're currently on …" banner. */
  currentTier: "free" | "monthly" | "annual" | "lifetime" | "comp";
  plans: PlanProps[];
}

export default function PlanCards({
  isSignedIn,
  isPremium,
  hasStripeCustomer,
  currentTier,
  plans,
}: Props) {
  // Per-tier loading state — only one checkout can be in flight at a time
  // but keying by tier gives nicer button copy ("Loading…" on the clicked
  // card only).
  const [loadingTier, setLoadingTier] = useState<Tier | "portal" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBuy(tier: Tier) {
    if (!isSignedIn) {
      // Bounce to home so AccountMenu can prompt sign-in. We keep the
      // intent in a query param so a future "auto-resume checkout after
      // sign-in" flow has the hook it needs.
      window.location.href = `/?signin=1&intent=upgrade&tier=${tier}`;
      return;
    }
    setLoadingTier(tier);
    setError(null);
    const res = await createCheckoutSession(tier);
    if (!res.ok || !res.url) {
      setError(res.error ?? "Couldn't start checkout.");
      setLoadingTier(null);
      return;
    }
    // Stripe-hosted checkout. Full navigation (not router.push) because
    // we're leaving Next.
    window.location.href = res.url;
  }

  async function handlePortal() {
    setLoadingTier("portal");
    setError(null);
    const res = await createPortalSession();
    if (!res.ok || !res.url) {
      setError(res.error ?? "Couldn't open billing portal.");
      setLoadingTier(null);
      return;
    }
    window.location.href = res.url;
  }

  return (
    <>
      {error && (
        <div style={errorBox} role="alert">
          {error}
        </div>
      )}

      {isPremium && (
        <div style={statusBanner}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            You&rsquo;re on Tidevisor Pro
            {currentTier !== "free" && currentTier !== "comp" && ` (${currentTier})`}
            {currentTier === "comp" && " (comp window)"}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            Thanks for supporting Tidevisor. You can change plans or update your
            payment method any time.
          </div>
          {hasStripeCustomer && (
            <button
              type="button"
              onClick={handlePortal}
              disabled={loadingTier !== null}
              style={{ ...portalBtn, marginTop: 10 }}
            >
              {loadingTier === "portal" ? "Opening…" : "Manage subscription"}
            </button>
          )}
        </div>
      )}

      <div style={grid}>
        {plans.map((p) => {
          const isCurrent = isPremium && currentTier === p.tier;
          const isLoading = loadingTier === p.tier;
          const anyLoading = loadingTier !== null;
          return (
            <div
              key={p.tier}
              style={{
                ...card,
                ...(p.highlighted ? cardHighlight : {}),
                ...(isCurrent ? cardCurrent : {}),
              }}
            >
              {p.highlighted && <div style={badge}>Most popular</div>}
              {isCurrent && <div style={{ ...badge, background: "var(--accent-2)" }}>Current plan</div>}

              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-muted)" }}>
                Tidevisor Pro · {p.label}
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
                <div style={{ fontSize: 32, fontWeight: 800 }}>{p.displayPrice}</div>
                <div style={{ fontSize: 13, color: "var(--text-muted)" }}>{p.cadence}</div>
              </div>

              <ul style={bulletList}>
                {p.bullets.map((b, i) => (
                  <li key={i} style={bulletItem}>
                    <span style={bulletDot} aria-hidden /> {b}
                  </li>
                ))}
              </ul>

              <button
                type="button"
                onClick={() => handleBuy(p.tier)}
                disabled={anyLoading || isCurrent || p.disabled}
                style={{
                  ...buyBtn,
                  ...(p.highlighted ? buyBtnHighlight : {}),
                  ...(isCurrent || p.disabled ? buyBtnDisabled : {}),
                }}
                aria-label={p.disabled ? p.disabledReason : `Subscribe ${p.label}`}
              >
                {isLoading
                  ? "Loading…"
                  : isCurrent
                    ? "Active"
                    : p.disabled
                      ? (p.disabledReason ?? "Unavailable")
                      : p.tier === "lifetime"
                        ? "Buy lifetime"
                        : "Subscribe"}
              </button>
            </div>
          );
        })}
      </div>

      {!isSignedIn && (
        <div style={signedOutNote}>
          You&rsquo;ll need to sign in first. Tap any plan above and we&rsquo;ll
          walk you through it.
        </div>
      )}
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const grid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
  gap: 14,
  margin: "20px 0",
};

const card: React.CSSProperties = {
  position: "relative",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 14,
  padding: 18,
  display: "flex",
  flexDirection: "column",
};

const cardHighlight: React.CSSProperties = {
  border: "2px solid var(--accent)",
  background: "var(--bg-elev)",
  boxShadow: "0 4px 16px rgba(15,110,168,.12)",
};

const cardCurrent: React.CSSProperties = {
  border: "2px solid var(--accent-2)",
};

const badge: React.CSSProperties = {
  position: "absolute",
  top: -10,
  right: 14,
  padding: "3px 9px",
  fontSize: 10,
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: ".5px",
  background: "var(--accent)",
  color: "white",
  borderRadius: 999,
};

const bulletList: React.CSSProperties = {
  listStyle: "none",
  padding: 0,
  margin: "14px 0 18px",
  flex: 1,
};

const bulletItem: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text)",
  padding: "4px 0",
};

const bulletDot: React.CSSProperties = {
  display: "inline-block",
  width: 6,
  height: 6,
  borderRadius: "50%",
  background: "var(--accent)",
  marginTop: 7,
  flexShrink: 0,
};

const buyBtn: React.CSSProperties = {
  padding: "12px 14px",
  background: "var(--bg-elev-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 14,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  transition: "background .15s ease",
};

const buyBtnHighlight: React.CSSProperties = {
  background: "var(--accent)",
  color: "white",
  border: "1px solid var(--accent)",
};

const buyBtnDisabled: React.CSSProperties = {
  opacity: 0.6,
  cursor: "not-allowed",
};

const portalBtn: React.CSSProperties = {
  padding: "10px 14px",
  background: "var(--bg-elev-2)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

const statusBanner: React.CSSProperties = {
  padding: "14px 16px",
  background: "var(--bg-elev)",
  border: "1px solid var(--accent-2)",
  borderLeft: "4px solid var(--accent-2)",
  borderRadius: 10,
  marginBottom: 18,
};

const errorBox: React.CSSProperties = {
  padding: "10px 14px",
  marginBottom: 12,
  background: "rgba(196,68,68,.08)",
  border: "1px solid #c44",
  borderRadius: 10,
  color: "#c44",
  fontSize: 13,
};

const signedOutNote: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  textAlign: "center",
  marginTop: 8,
};
