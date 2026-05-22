"use client";

// First-visit beta banner. Shown once per device to every new visitor
// (signed in or not) so beta testers see the comp-code path before
// they ever bump into a paywall. The existing WelcomeModal still fires
// post-sign-in to walk through location + briefing setup; this is the
// pre-sign-in companion that introduces the beta.
//
// Triggering policy:
//   - localStorage key `tidevisor_beta_banner_seen` (separate from the
//     post-sign-in welcome key) gates display. Once set, never re-shown
//     on this device.
//   - Mounts on the client only (no SSR) so private-mode localStorage
//     throws are harmless — worst case the modal opens once per session
//     instead of once per device.
//
// Portal'd to body for the same containing-block reason as the other
// modals.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const LS_KEY = "tidevisor_beta_banner_seen";

export default function BetaBanner() {
  const [open, setOpen] = useState(false);

  // Check localStorage on mount. We can't use SSR here — the server
  // doesn't know whether this user has seen it before. Showing
  // briefly-then-hiding on hydration is jarring, so we mount closed
  // and only open after the localStorage check passes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem(LS_KEY)) return;
    } catch {
      // Private mode — fall through and show. They'll see it again
      // next session, no harm.
    }
    setOpen(true);
  }, []);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") dismiss(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  function dismiss() {
    setOpen(false);
    try { localStorage.setItem(LS_KEY, "1"); } catch { /* private mode */ }
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={dismiss}
      role="dialog"
      aria-modal="true"
      aria-labelledby="beta-banner-title"
      style={overlay}
    >
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={dragHandle} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <h2 id="beta-banner-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            Welcome to the Tidevisor beta
          </h2>
          <button onClick={dismiss} aria-label="Close" style={closeBtn}>✕</button>
        </div>

        <p style={lede}>
          Tidevisor is a marine dashboard for paddlers — tides, wind,
          forecasts, radar, all in one screen. We&rsquo;re in beta and
          offering free Pro access to anyone willing to kick the tires.
        </p>

        <div style={codeBox}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600, letterSpacing: ".4px", textTransform: "uppercase" }}>
            Beta access code
          </div>
          <div style={codeText}>BETA-2026</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
            Sign in, open Preferences from the account menu, and paste
            this into the Redeem code field. Good for 30 days of
            Tidevisor Pro on the house.
          </div>
        </div>

        <button type="button" onClick={dismiss} style={dismissBtn}>
          Got it — let me explore
        </button>
      </div>
    </div>,
    document.body,
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 10000,
  background: "rgba(7,17,26,.55)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const sheet: React.CSSProperties = {
  background: "var(--bg-elev)",
  width: "100%", maxWidth: 460, maxHeight: "88vh",
  borderRadius: "22px 22px 0 0",
  padding: 18,
  paddingBottom: "calc(18px + env(safe-area-inset-bottom))",
  overflowY: "auto",
  animation: "phud-slideup .25s ease",
  color: "var(--text)",
};
const dragHandle: React.CSSProperties = {
  width: 40, height: 4, background: "var(--border)",
  borderRadius: 2, margin: "0 auto 14px",
};
const closeBtn: React.CSSProperties = {
  marginLeft: "auto",
  width: 32, height: 32,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: "50%",
  display: "grid", placeItems: "center",
  color: "var(--text)", cursor: "pointer", fontSize: 14,
};
const lede: React.CSSProperties = {
  fontSize: 14, lineHeight: 1.55,
  color: "var(--text)",
  margin: "0 0 14px",
};
const codeBox: React.CSSProperties = {
  padding: "12px 14px",
  background: "linear-gradient(135deg, rgba(15,110,168,.12), rgba(63,166,217,.08))",
  border: "1px solid var(--accent)",
  borderRadius: 12,
  marginBottom: 16,
};
const codeText: React.CSSProperties = {
  fontFamily: "var(--font-mono, monospace)",
  fontSize: 22,
  fontWeight: 800,
  letterSpacing: "2px",
  color: "var(--accent)",
  userSelect: "all",
};
const dismissBtn: React.CSSProperties = {
  display: "block", width: "100%",
  padding: "12px 14px",
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 10,
  fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
