"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import LocationPicker from "./LocationPicker";
import AccountMenu from "./auth/AccountMenu";
import PreferencesModal from "./preferences/PreferencesModal";
import WelcomeModal from "./onboarding/WelcomeModal";
import { refreshHud } from "@/app/actions";
import type { CurrentUser } from "@/lib/auth";
import type { ResolvedLocation, UserLocation, UserPreferences } from "@/lib/types";

interface Props {
  locationName: string;
  stationKey: string;
  // Server-resolved auth state. Null = guest. Threaded through here so
  // AccountMenu's first paint matches the server render and there's no
  // "Sign in" flash for already-signed-in users.
  currentUser: CurrentUser | null;
  // Locations the user can switch between (STATIONS for guests, their
  // user_locations rows when signed in). primaryKey tells the picker
  // which one to treat as the URL default so `?station=` is omitted.
  locations: ResolvedLocation[];
  primaryKey: string;
  // Raw user_locations rows for the editor — null for guests so the
  // editor renders read-only with a sign-in CTA.
  userLocations: UserLocation[] | null;
  // Server-resolved user preferences. DEFAULT_PREFERENCES for guests,
  // the user_preferences row for signed-in users. Passed to the
  // preferences modal as its starting state.
  initialPreferences: UserPreferences;
}

type ThemeMode = "light" | "dark" | "auto";

export default function TopBar({
  locationName, stationKey, currentUser, locations, primaryKey, userLocations, initialPreferences,
}: Props) {
  const router = useRouter();
  // Single source of truth — theme mode. The pre-paint script in layout.tsx
  // sets data-theme on <html> BEFORE React hydrates, so both the server
  // markup and the first client render produce identical DOM. The CSS
  // .theme-sun / .theme-moon rules in globals.css hide whichever icon
  // doesn't match the current data-theme; no JSX branching, no hydration risk.
  const [theme, setTheme] = useState<ThemeMode>("auto");
  const [locOpen, setLocOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const isSignedIn = !!currentUser;

  // Show the welcome modal once per device on first sign-in. localStorage
  // gates the trigger — keeps the experience non-intrusive on subsequent
  // sessions but still helpful when someone signs in on a new browser.
  useEffect(() => {
    if (!isSignedIn) return;
    if (typeof window === "undefined") return;
    try {
      if (localStorage.getItem("tidevisor_welcome_seen")) return;
    } catch {
      // Private-mode localStorage throws; skip the welcome rather than
      // re-prompting on every reload.
      return;
    }
    setWelcomeOpen(true);
  }, [isSignedIn]);

  function dismissWelcome() {
    setWelcomeOpen(false);
    try { localStorage.setItem("tidevisor_welcome_seen", "1"); } catch {}
  }
  function welcomeToLocation() {
    dismissWelcome();
    setLocOpen(true);
  }
  function welcomeToBriefing() {
    dismissWelcome();
    setPrefsOpen(true);
  }

  // For signed-in users, sync the DB-stored theme preference into
  // localStorage so the pre-paint script picks it up on the next load.
  // This is the "cross-device theme follows me" payoff of preferences.
  useEffect(() => {
    if (!isSignedIn) return;
    try { localStorage.setItem("phud_theme", initialPreferences.theme); } catch {}
  }, [isSignedIn, initialPreferences.theme]);

  useEffect(() => {
    // For signed-in users, prefer the server-loaded theme over whatever
    // localStorage might have (might be stale from a different device).
    // For guests, localStorage is authoritative.
    if (isSignedIn) {
      setTheme(initialPreferences.theme);
      return;
    }
    const saved = (localStorage.getItem("phud_theme") as ThemeMode | null) ?? "auto";
    setTheme(saved);
  }, [isSignedIn, initialPreferences.theme]);

  useEffect(() => {
    const apply = (t: ThemeMode) => {
      const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    };
    apply(theme);
    try { localStorage.setItem("phud_theme", theme); } catch {}
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => apply("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  function cycleTheme() {
    // Toggle based on what's *visually* showing right now (covers the "auto"
    // case where state is "auto" but visual is dark or light depending on OS).
    const currentlyDark = document.documentElement.getAttribute("data-theme") === "dark";
    setTheme(currentlyDark ? "light" : "dark");
  }

  const [isRefreshing, startRefreshTransition] = useTransition();
  function refresh() {
    startRefreshTransition(async () => {
      // 1. Server action: invalidate Next.js's Full Route Cache + Data Cache
      //    for "/", so the next request actually re-fetches upstream APIs
      //    instead of returning the previously-cached UV/visibility/etc.
      await refreshHud();
      // 2. Client: re-fetch the page payload from the server, which now
      //    has nothing cached and will run the fetches fresh.
      router.refresh();
    });
  }

  return (
    <>
      <header
        style={{
          position: "sticky", top: 0, zIndex: 5000,
          background: "var(--bg-elev)",
          borderBottom: "1px solid var(--border-soft)",
          padding: "10px 14px",
          // Pad for iOS safe-area on the top (notch / dynamic island) AND
          // the right (landscape orientation pushes content under the
          // notch otherwise). Without the right inset the sign-in pill
          // hangs off the edge on iPhone landscape.
          paddingTop: "calc(10px + env(safe-area-inset-top))",
          paddingRight: "calc(14px + env(safe-area-inset-right))",
          paddingLeft: "calc(14px + env(safe-area-inset-left))",
          display: "flex", alignItems: "center", gap: 10,
          backdropFilter: "saturate(180%) blur(12px)",
          WebkitBackdropFilter: "saturate(180%) blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 16, flexShrink: 0 }}>
          <div style={{
            width: 28, height: 28,
            background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
            borderRadius: 8, display: "grid", placeItems: "center", color: "white",
            boxShadow: "0 2px 8px rgba(15,110,168,.35)",
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M2 14c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4 2 6 0" stroke="white" strokeWidth="2.2" strokeLinecap="round"/>
              <path d="M2 19c2-2 4-2 6 0s4 2 6 0 4-2 6 0 4 2 6 0" stroke="white" strokeWidth="2.2" strokeLinecap="round" opacity=".6"/>
            </svg>
          </div>
          {/* Wordmark hidden on narrow screens (see .phud-wordmark in globals.css)
              so the logo + location pill + buttons all fit on iPhone widths. */}
          <span className="phud-wordmark">TIDEVISOR</span>
        </div>

        <button onClick={() => setLocOpen(true)} style={pillBtn} aria-label="Change location">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="var(--accent)">
            <path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z" />
          </svg>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{locationName}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: .6, flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        <button
          onClick={refresh}
          style={iconBtn}
          aria-label="Refresh"
          disabled={isRefreshing}
          title={isRefreshing ? "Refreshing…" : "Refresh"}
        >
          <svg
            width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
            style={{
              animation: isRefreshing ? "phud-spin 0.9s linear infinite" : "none",
              color: isRefreshing ? "var(--accent)" : undefined,
            }}
          >
            <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
          </svg>
        </button>

        <button
          onClick={cycleTheme}
          style={iconBtn}
          aria-label="Toggle theme"
          title={`Theme: ${theme}`}
        >
          {/* Both icons live in the DOM; CSS hides the wrong one based on
              <html data-theme=...> set by the pre-paint script. No hydration risk. */}
          <svg className="theme-sun" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
          <svg className="theme-moon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        </button>

        {/* Preferences gear — opens the full settings modal (theme, time
            format, units). Available to guests too; guests' choices
            persist to localStorage instead of the DB. */}
        <button
          onClick={() => setPrefsOpen(true)}
          style={iconBtn}
          aria-label="Preferences"
          title="Preferences"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>

        {/* Account button — pill "Sign in" for guests, avatar + dropdown
            for signed-in users. Renders nothing if Supabase isn't configured. */}
        <AccountMenu initialUser={currentUser} />
      </header>

      <LocationPicker
        open={locOpen}
        onClose={() => setLocOpen(false)}
        activeKey={stationKey}
        locations={locations}
        primaryKey={primaryKey}
        userLocations={userLocations}
      />

      <PreferencesModal
        open={prefsOpen}
        onClose={() => setPrefsOpen(false)}
        initialPreferences={initialPreferences}
        isSignedIn={isSignedIn}
      />

      <WelcomeModal
        open={welcomeOpen}
        onClose={dismissWelcome}
        onSetupLocation={welcomeToLocation}
        onSetupBriefing={welcomeToBriefing}
        userName={currentUser?.name ?? null}
      />
    </>
  );
}

const pillBtn: React.CSSProperties = {
  marginLeft: "auto",
  display: "flex", alignItems: "center", gap: 6,
  padding: "6px 10px",
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 999, color: "var(--text)",
  fontWeight: 600, fontSize: 13,
  // min-width: 0 lets the pill shrink below its content width on narrow
  // viewports (the text span already truncates with ellipsis). Without
  // this, the pill stays at its intrinsic width and pushes everything
  // after it (icon buttons + sign-in pill) off the right edge of the
  // viewport on iPhone-sized screens.
  minWidth: 0,
  maxWidth: 200, cursor: "pointer",
  fontFamily: "inherit",
};
const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)",
  color: "var(--text)", display: "grid", placeItems: "center", flexShrink: 0,
  cursor: "pointer",
};
