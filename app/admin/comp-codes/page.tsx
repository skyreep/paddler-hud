// Admin tool for managing Tidevisor Pro comp codes. Gated server-side
// by checking ADMIN_USER_IDS env var.

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { listCodes, isCurrentUserAdmin } from "./actions";
import CompCodesClient from "./CompCodesClient";

export const metadata: Metadata = {
  title: "Comp codes · Tidevisor admin",
  robots: "noindex, nofollow",
};

export const dynamic = "force-dynamic";

export default async function CompCodesAdminPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/?signin=1");
  }

  const allowed = await isCurrentUserAdmin();
  if (!allowed) {
    redirect("/");
  }

  const result = await listCodes();
  const codes = result.ok ? result.codes ?? [] : [];

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
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: ".3px" }}>
            TIDEVISOR <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>· admin</span>
          </span>
        </Link>
        <Link href="/" style={backLink}>
          ← Back to dashboard
        </Link>
      </header>

      <main style={main}>
        <h1 style={h1}>Comp codes</h1>
        <p style={lede}>
          Generate codes that grant N days of Tidevisor Pro on redemption.
          Use for beta testers, paddle clubs, influencer outreach, or
          customer-service make-goods. Disabling a code stops new
          redemptions; existing redemptions keep their comp window.
        </p>

        {!result.ok && (
          <div style={errorBox}>Couldn&apos;t load codes: {result.error}</div>
        )}

        <CompCodesClient initialCodes={codes} />
      </main>
    </div>
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
  maxWidth: 960,
  width: "100%",
  margin: "0 auto",
  padding: "28px 20px 48px",
};

const h1: React.CSSProperties = {
  fontSize: 26,
  fontWeight: 800,
  margin: "0 0 8px",
  letterSpacing: "-.3px",
};

const lede: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
  margin: "0 0 24px",
  lineHeight: 1.6,
  maxWidth: 640,
};

const errorBox: React.CSSProperties = {
  padding: "10px 14px",
  background: "rgba(196,68,68,.08)",
  border: "1px solid #c44",
  borderRadius: 10,
  color: "#c44",
  fontSize: 13,
  marginBottom: 16,
};
