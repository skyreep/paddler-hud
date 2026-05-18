"use client";

// Account button + dropdown for the topbar. Two states:
//   - Guest:     "Sign in" pill button → opens <SignInModal />
//   - Signed in: Avatar (image or initials) → dropdown with email + Sign out
//
// `initialUser` is rendered from the server (see lib/auth.getCurrentUser)
// so the first paint matches the user's actual state — no "Sign in" flash
// while hydrating for a logged-in user. After hydration the component
// subscribes to onAuthStateChange to react to sign-in/out from other tabs
// or from the modal itself.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { signOut } from "@/app/auth/actions";
import SignInModal from "./SignInModal";
import type { CurrentUser } from "@/lib/auth";

interface Props {
  initialUser: CurrentUser | null;
}

export default function AccountMenu({ initialUser }: Props) {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(initialUser);
  const [modalOpen, setModalOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Listen for cross-tab auth changes (sign-in in tab A should reflect
  // in tab B without a hard reload). Also catches the moment the OAuth
  // callback completes and the redirect lands back on this page.
  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        const meta = (session.user.user_metadata ?? {}) as Record<string, unknown>;
        setUser({
          id: session.user.id,
          email: session.user.email ?? null,
          name:
            (typeof meta.full_name === "string" && meta.full_name) ||
            (typeof meta.name === "string" && meta.name) ||
            null,
          avatarUrl:
            (typeof meta.avatar_url === "string" && meta.avatar_url) ||
            (typeof meta.picture === "string" && meta.picture) ||
            null,
        });
        // Refresh server data so any user-scoped fetches re-run.
        router.refresh();
      } else {
        setUser(null);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router]);

  // Close menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    // setTimeout so the same click that opened the menu doesn't immediately close it.
    const id = setTimeout(() => window.addEventListener("click", handler), 0);
    return () => {
      clearTimeout(id);
      window.removeEventListener("click", handler);
    };
  }, [menuOpen]);

  // Close menu on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [menuOpen]);

  // Surface auth_error from the callback once, then strip it from the URL.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth_error")) {
      // Open the modal so the user can retry; the modal will show its own
      // error message after the next attempt, but at minimum we acknowledge.
      setModalOpen(true);
      params.delete("auth_error");
      const qs = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (qs ? `?${qs}` : ""),
      );
    }
  }, []);

  async function handleSignOut() {
    setSigningOut(true);
    setMenuOpen(false);
    try {
      // Server action clears cookies + revalidates server data.
      await signOut();
      // Local UI: clear the optimistic user state and re-fetch the page so
      // any user-scoped server data (saved locations, prefs) disappears.
      setUser(null);
      router.refresh();
    } catch (err) {
      console.error("Sign out failed:", err);
      setSigningOut(false);
    }
  }

  // If Supabase isn't configured at all, render nothing (don't even tease
  // a sign-in button that won't work).
  if (!isSupabaseConfigured) return null;

  if (!user) {
    return (
      <>
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          aria-label="Sign in"
          style={signInBtn}
        >
          Sign in
        </button>
        <SignInModal open={modalOpen} onClose={() => setModalOpen(false)} />
      </>
    );
  }

  // Signed in.
  const initials = getInitials(user);
  return (
    <div ref={menuRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        style={avatarBtn}
      >
        {user.avatarUrl ? (
          // OAuth provider avatar. <img> instead of next/image to skip the
          // loader for tiny 36px circles (and to avoid configuring remote
          // patterns in next.config for every provider's CDN).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={user.avatarUrl}
            alt=""
            width={36}
            height={36}
            style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "50%" }}
          />
        ) : (
          initials
        )}
      </button>

      {menuOpen && (
        <div
          role="menu"
          style={{
            position: "absolute", top: "calc(100% + 6px)", right: 0,
            minWidth: 220,
            background: "var(--bg-elev)",
            border: "1px solid var(--border-soft)",
            borderRadius: 12,
            boxShadow: "0 8px 24px rgba(0,0,0,.18)",
            padding: 8, zIndex: 5100,
          }}
        >
          <div style={{ padding: "8px 10px 10px", borderBottom: "1px solid var(--border-soft)", marginBottom: 6 }}>
            {user.name && (
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
                {user.name}
              </div>
            )}
            {user.email && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, wordBreak: "break-all" }}>
                {user.email}
              </div>
            )}
          </div>

          {/* Preferences live in the topbar's gear button (visible to both
              guests and signed-in users). We could also expose it here as
              a redundant entry, but keeping the dropdown focused on
              account-state actions reads cleaner. */}
          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            disabled={signingOut}
            style={{ ...menuItem, color: "#c44" }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}

function getInitials(u: CurrentUser): string {
  if (u.name) {
    const parts = u.name.trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
  }
  if (u.email) return u.email[0]?.toUpperCase() ?? "?";
  return "?";
}

// ─── Styles
const signInBtn: React.CSSProperties = {
  padding: "6px 12px",
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 999,
  fontSize: 13, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
  flexShrink: 0,
};
const avatarBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: "50%",
  background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
  color: "white", border: "none", fontWeight: 700, fontSize: 13,
  display: "grid", placeItems: "center", cursor: "pointer",
  flexShrink: 0,
  aspectRatio: "1",
  padding: 0,
  overflow: "hidden",
};
const menuItem: React.CSSProperties = {
  display: "block", width: "100%",
  padding: "9px 10px", textAlign: "left",
  background: "transparent", border: "none",
  color: "var(--text)", fontSize: 13,
  fontFamily: "inherit", cursor: "pointer",
  borderRadius: 8,
};
