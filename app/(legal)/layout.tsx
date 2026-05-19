// Shared layout for /privacy and /terms. The (legal) route group puts
// both pages under one minimal header/footer chrome that doesn't depend
// on any of the dashboard's auth or data-fetching machinery — these are
// public, static pages and should load instantly.
//
// Visual style: stays inside the same color tokens as the dashboard
// (via globals.css var(--…) definitions) so dark-mode users still see
// a coherent app. Typography is tightened up for long-form reading:
// max-width 720px, comfortable line-height, clear heading hierarchy.

import Link from "next/link";

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      background: "var(--bg)",
      color: "var(--text)",
    }}>
      <header style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "14px 16px",
        paddingTop: "calc(14px + env(safe-area-inset-top))",
        borderBottom: "1px solid var(--border-soft)",
      }}>
        <Link href="/" style={{
          display: "inline-flex", alignItems: "center", gap: 8,
          textDecoration: "none", color: "var(--text)",
        }}>
          <span style={{
            width: 28, height: 28,
            background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
            borderRadius: 8,
            display: "grid", placeItems: "center", color: "white",
            boxShadow: "0 2px 8px rgba(15,110,168,.35)",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4 2 6 0" stroke="white" strokeWidth="2.2" strokeLinecap="round" />
              <path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4 2 6 0" stroke="white" strokeWidth="2.2" strokeLinecap="round" opacity=".6" />
            </svg>
          </span>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: ".3px" }}>TIDEVISOR</span>
        </Link>
        <Link href="/" style={{
          marginLeft: "auto",
          fontSize: 13, fontWeight: 600,
          color: "var(--text-muted)", textDecoration: "none",
        }}>
          ← Back to dashboard
        </Link>
      </header>

      <main style={{
        flex: 1,
        maxWidth: 720, width: "100%",
        margin: "0 auto",
        padding: "32px 20px 48px",
        lineHeight: 1.65,
        fontSize: 15,
      }}>
        {children}
      </main>

      <footer style={{
        padding: "20px 16px",
        paddingBottom: "calc(20px + env(safe-area-inset-bottom))",
        borderTop: "1px solid var(--border-soft)",
        textAlign: "center",
        fontSize: 12,
        color: "var(--text-faint)",
      }}>
        <div style={{ marginBottom: 6 }}>
          <Link href="/privacy" style={{ color: "var(--text-muted)", textDecoration: "none", marginRight: 12 }}>
            Privacy Policy
          </Link>
          <Link href="/terms" style={{ color: "var(--text-muted)", textDecoration: "none" }}>
            Terms of Service
          </Link>
        </div>
        <div>Tidevisor is a product of the Georgia Coast.</div>
      </footer>
    </div>
  );
}
