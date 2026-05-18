"use client";

// Sign-in modal — bottom-sheet style, matches LocationPicker. Offers two
// paths to a session:
//   1. Google OAuth      → signInWithOAuth({ provider: 'google' })
//   2. Email magic link  → signInWithOtp({ email })
//
// Apple Sign In is intentionally not wired up — it requires an Apple
// Developer Program membership ($99/yr). The provider handler below
// stays generic so re-adding it is a one-line button later (and the
// setup docs are still in supabase/AUTH_PROVIDERS.md).
//
// Both paths redirect (or, for magic link, eventually arrive) at
// /auth/callback, which exchanges the code for a session and bounces back
// to wherever the user started.
//
// Guest mode stays available — the modal opens on demand from AccountMenu;
// nothing here forces sign-in.
//
// IMPORTANT: this component is mounted inside <TopBar>'s <header>, which
// has `backdrop-filter: blur(...)`. Any element with backdrop-filter
// becomes the containing block for `position: fixed` descendants, which
// would clip our "fullscreen" overlay to the header's bounding box. To
// avoid that, we portal the modal out to document.body.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "submitting"; provider: "google" | "email" }
  | { kind: "magic-sent"; email: string }
  | { kind: "error"; message: string };

export default function SignInModal({ open, onClose }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

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

  // Reset transient UI state on close so re-opening starts fresh.
  useEffect(() => {
    if (open) return;
    setStatus({ kind: "idle" });
    setEmail("");
  }, [open]);

  // Generic OAuth handler — kept narrowed to providers we actually expose
  // in the UI, but easy to widen (e.g. add "apple") if we re-enable a
  // provider button later.
  async function signInWithProvider(provider: "google") {
    const supabase = createClient();
    if (!supabase) {
      setStatus({ kind: "error", message: "Sign-in is not configured yet. Try again later." });
      return;
    }
    setStatus({ kind: "submitting", provider });
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        // Where Supabase tells the provider to send the user back. The
        // callback route below exchanges the `?code=` for a session.
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      },
    });
    if (error) {
      setStatus({ kind: "error", message: error.message });
    }
    // On success the browser is redirected away; no further state needed.
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;
    const supabase = createClient();
    if (!supabase) {
      setStatus({ kind: "error", message: "Sign-in is not configured yet. Try again later." });
      return;
    }
    setStatus({ kind: "submitting", provider: "email" });
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(window.location.pathname + window.location.search)}`,
      },
    });
    if (error) {
      setStatus({ kind: "error", message: error.message });
    } else {
      setStatus({ kind: "magic-sent", email: trimmed });
    }
  }

  if (!open) return null;
  // Safety: portal target only exists in the browser. Since this branch
  // only runs when `open` is true (which requires user interaction post-
  // hydration), `document` is always available — but the guard keeps SSR
  // happy if someone ever forces `open=true` server-side.
  if (typeof document === "undefined") return null;

  const submitting = status.kind === "submitting";

  return createPortal(
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="signin-title"
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(7,17,26,.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-elev)",
          width: "100%", maxWidth: 420, maxHeight: "88vh",
          borderRadius: "22px 22px 0 0",
          padding: 18,
          paddingBottom: "calc(18px + env(safe-area-inset-bottom))",
          overflowY: "auto",
          animation: "phud-slideup .25s ease",
          color: "var(--text)",
        }}
      >
        {/* Drag handle visual (same as LocationPicker for consistency). */}
        <div style={{
          width: 40, height: 4, background: "var(--border)",
          borderRadius: 2, margin: "0 auto 14px",
        }} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 id="signin-title" style={{ margin: 0, fontSize: 18 }}>Sign in</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: "auto",
              width: 32, height: 32,
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: "50%",
              display: "grid", placeItems: "center",
              color: "var(--text)", cursor: "pointer", fontSize: 14,
            }}
          >✕</button>
        </div>

        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 16px" }}>
          Sign in to sync your saved locations, river gauges, and preferences across devices.
        </p>

        {!isSupabaseConfigured && (
          <div style={notice}>
            Sign-in is not enabled in this build. Configuration pending.
          </div>
        )}

        {status.kind === "error" && (
          <div style={{ ...notice, borderColor: "#c44", color: "#c44" }}>
            {status.message}
          </div>
        )}

        {status.kind === "magic-sent" ? (
          <div style={notice}>
            <strong>Check your inbox.</strong>
            <div style={{ marginTop: 4, color: "var(--text-muted)", fontSize: 12 }}>
              We sent a sign-in link to <strong>{status.email}</strong>. Click the link in the email
              to finish signing in.
            </div>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => signInWithProvider("google")}
              disabled={submitting || !isSupabaseConfigured}
              style={providerBtn}
            >
              <GoogleIcon />
              {status.kind === "submitting" && status.provider === "google"
                ? "Redirecting…"
                : "Continue with Google"}
            </button>

            <div style={divider}>
              <span>or email me a sign-in link</span>
            </div>

            <form onSubmit={sendMagicLink}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
                disabled={submitting || !isSupabaseConfigured}
                style={input}
              />
              <button
                type="submit"
                disabled={submitting || !email.trim() || !isSupabaseConfigured}
                style={primaryBtn}
              >
                {status.kind === "submitting" && status.provider === "email"
                  ? "Sending…"
                  : "Send magic link"}
              </button>
            </form>

            <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "14px 0 0", textAlign: "center" }}>
              No password to remember — we&apos;ll email you a one-time sign-in link.
            </p>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Small inline Google glyph so we don't pull a whole icon set for one icon.
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.99.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"/>
      <path fill="#FBBC05" d="M5.84 14.1c-.22-.66-.35-1.36-.35-2.1s.13-1.44.35-2.1V7.07H2.18A10.97 10.97 0 0 0 1 12c0 1.78.43 3.47 1.18 4.93l3.66-2.83Z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.2 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.83C6.71 7.31 9.14 5.38 12 5.38Z"/>
    </svg>
  );
}

// ─── Styles
const providerBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
  width: "100%", padding: "11px 14px", marginBottom: 8,
  background: "var(--bg-elev)",
  color: "var(--text)",
  border: "1px solid var(--border)",
  borderRadius: 10, fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
const primaryBtn: React.CSSProperties = {
  display: "block", width: "100%", padding: "11px 14px", marginTop: 8,
  background: "var(--accent)", color: "white",
  border: "none", borderRadius: 10, fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
const input: React.CSSProperties = {
  display: "block", width: "100%", padding: "11px 12px",
  background: "var(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontFamily: "inherit",
  // Avoid the iOS auto-zoom on input focus (kicks in for inputs < 16px).
  boxSizing: "border-box",
};
const divider: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 10,
  margin: "14px 0",
  fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase",
  letterSpacing: ".5px",
};
const notice: React.CSSProperties = {
  padding: "10px 12px", marginBottom: 12,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 13, color: "var(--text)",
};
