"use client";

// First-sign-in welcome modal. Briefly explains where the two main
// pieces of setup live and lets the user start either flow with one
// tap, or skip and explore on their own.
//
// Triggering policy (lives in TopBar): show once per device. We use
// a localStorage flag rather than a DB column so:
//   - no migration needed
//   - signing in on a new device re-shows it (useful for setting up
//     briefings on that device's preferred hour)
//   - clearing browser data resets the flag (fine — they get a
//     refresher next time)
//
// Portal'd to document.body for the same containing-block reason as
// the other modals — the topbar's backdrop-filter would otherwise
// clip a fixed overlay.

import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Callback to launch the location-add flow (closes welcome,
   *  opens LocationPicker). The user finishes setup there. */
  onSetupLocation: () => void;
  /** Callback to launch the preferences modal (closes welcome,
   *  opens PreferencesModal at the briefing section). */
  onSetupBriefing: () => void;
  /** Display name from auth metadata. Greeting personalizes when
   *  present, falls back to a generic "Welcome aboard" otherwise. */
  userName: string | null;
}

export default function WelcomeModal({
  open, onClose, onSetupLocation, onSetupBriefing, userName,
}: Props) {
  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const firstName = userName?.split(/\s+/)[0] ?? null;
  const heading = firstName
    ? `Welcome to Tidevisor, ${firstName}.`
    : "Welcome to Tidevisor.";

  return createPortal(
    <div onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="welcome-title" style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={dragHandle} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 id="welcome-title" style={{ margin: 0, fontSize: 18 }}>{heading}</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>✕</button>
        </div>

        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 16px", lineHeight: 1.5 }}>
          Your account&apos;s set up with Tybee Island as a starter
          location and a handful of regional river gauges. Two quick
          things will make this yours:
        </p>

        <button type="button" onClick={onSetupLocation} style={methodBtn}>
          <span style={methodIcon}>📍</span>
          <span style={{ flex: 1, textAlign: "left" }}>
            <div style={methodTitle}>Add your paddling spot</div>
            <div style={methodSub}>
              Search by town or zip, drop a pin on a map, or use your current location.
            </div>
          </span>
          <span style={chev}>→</span>
        </button>

        <button type="button" onClick={onSetupBriefing} style={methodBtn}>
          <span style={methodIcon}>📬</span>
          <span style={{ flex: 1, textAlign: "left" }}>
            <div style={methodTitle}>Set up the daily briefing email</div>
            <div style={methodSub}>
              A one-screen summary of tides, wind, forecast, and alerts at the
              hour you choose. Off by default.
            </div>
          </span>
          <span style={chev}>→</span>
        </button>

        <button type="button" onClick={onClose} style={skipBtn}>
          I&apos;ll explore on my own
        </button>

        <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "14px 0 0", textAlign: "center", lineHeight: 1.5 }}>
          You can change everything later — tap the gear icon up top for
          preferences, or the location pill to manage your spots.
        </p>
      </div>
    </div>,
    document.body,
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

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
const methodBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  width: "100%", padding: "14px",
  marginBottom: 10,
  background: "var(--bg-elev-2)",
  color: "var(--text)",
  border: "1px solid var(--border-soft)",
  borderRadius: 12,
  fontFamily: "inherit", cursor: "pointer",
};
const methodIcon: React.CSSProperties = {
  fontSize: 24, flexShrink: 0,
  width: 32, textAlign: "center",
};
const methodTitle: React.CSSProperties = {
  fontWeight: 600, fontSize: 14,
};
const methodSub: React.CSSProperties = {
  fontSize: 12, color: "var(--text-muted)",
  marginTop: 3, lineHeight: 1.4,
};
const chev: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 16, color: "var(--text-faint)",
  fontWeight: 700,
};
const skipBtn: React.CSSProperties = {
  display: "block", width: "100%",
  marginTop: 6,
  padding: "10px 14px",
  background: "transparent",
  color: "var(--text-muted)",
  border: "none",
  fontSize: 13, fontWeight: 500,
  fontFamily: "inherit", cursor: "pointer",
  textDecoration: "underline",
};
