// Post-checkout landing page. Stripe redirects here with
// ?session_id=cs_test_... after a successful payment. The webhook is
// what actually grants premium — this page is just a friendly "thanks"
// surface that gives the webhook a moment to land before sending the
// user back to the dashboard.
//
// We don't trust the redirect alone to grant premium because Stripe
// docs are explicit: the success URL fires before the webhook in some
// cases, and a malicious user could craft the redirect URL with a fake
// session_id. The webhook (signed by Stripe) is the source of truth.

import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Welcome to Tidevisor Pro",
  description: "Thanks for upgrading.",
};

export default async function SuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  // We don't actually need the session_id for anything (webhook handles
  // the upgrade), but read it defensively so a malformed URL doesn't
  // crash the page.
  await searchParams;

  return (
    <div style={shell}>
      <main style={main}>
        <div style={emoji} aria-hidden>
          🎉
        </div>
        <h1 style={h1}>Welcome to Tidevisor Pro</h1>
        <p style={lede}>
          Your payment went through. It may take a few seconds for premium
          features to unlock — refresh the dashboard if you don&rsquo;t see
          them right away.
        </p>
        <div style={btnRow}>
          <Link href="/" style={primaryBtn}>
            Go to dashboard
          </Link>
        </div>
        <p style={small}>
          A receipt is on its way to your email from Stripe. Manage your
          subscription any time from the account menu.
        </p>
      </main>
    </div>
  );
}

const shell: React.CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  background: "var(--bg)",
  color: "var(--text)",
  padding: 20,
};

const main: React.CSSProperties = {
  maxWidth: 460,
  textAlign: "center",
};

const emoji: React.CSSProperties = {
  fontSize: 44,
  marginBottom: 8,
};

const h1: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  margin: "0 0 10px",
  letterSpacing: "-.3px",
};

const lede: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
  lineHeight: 1.6,
  margin: "0 0 22px",
};

const btnRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  gap: 12,
  marginBottom: 22,
};

const primaryBtn: React.CSSProperties = {
  padding: "12px 22px",
  background: "var(--accent)",
  color: "white",
  borderRadius: 10,
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 600,
  display: "inline-block",
};

const small: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-faint)",
  lineHeight: 1.6,
};

