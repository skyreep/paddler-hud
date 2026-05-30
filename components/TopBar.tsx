"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import LocationPicker from "./LocationPicker";
import AccountMenu from "./auth/AccountMenu";
import PreferencesModal from "./preferences/PreferencesModal";
import WelcomeModal from "./onboarding/WelcomeModal";
import BetaBanner from "./onboarding/BetaBanner";
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
  // Premium state, resolved server-side from subscriptions table. Drives
  // the Upgrade/Manage menu items in AccountMenu and gates premium-only
  // UI surfaces in PreferencesModal (comp code redemption is gated on
  // signed-in; daily briefing save is gated on premium via the action).
  isPremium: boolean;
  // Whether the user has a Stripe customer (i.e. paid through Checkout
  // at some point). Used to decide whether to show "Manage subscription"
  // — comp-only premium users have no billing portal.
  hasStripeCustomer: boolean;
}

type ThemeMode = "light" | "dark" | "auto";

// Why a refresh fired — controls the toast (return only) and the overlap
// guard (everything except a manual tap).
type RefreshReason = "manual" | "return" | "poll";

// How old the on-screen data may be before we refresh it. Matches the
// server's 5-minute revalidate window — a refresh sooner than this would
// mostly hit cache anyway. Shared by the return-to-app listeners and the
// foreground poll.
const STALE_MS = 5 * 60 * 1000;
// How often the foreground poll wakes to check staleness. It only refreshes
// once STALE_MS has elapsed, so this just bounds how soon after crossing
// 5 min the refresh actually happens.
const POLL_CHECK_MS = 60 * 1000;

export default function TopBar({
  locationName, stationKey, currentUser, locations, primaryKey, userLocations,
  initialPreferences, isPremium, hasStripeCustomer,
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

  // Wall-clock time the on-screen data was last fetched. Seeded at mount
  // (the server render that produced this page) and reset after every
  // refresh. A ref, not state — reading it must not re-render or re-bind
  // the listeners below.
  const lastRefreshAt = useRef<number>(Date.now());
  // Mirror isRefreshing into a ref so the mount-once listener effect reads
  // the latest value without a stale closure or re-subscribing each render.
  const isRefreshingRef = useRef(false);
  useEffect(() => { isRefreshingRef.current = isRefreshing; }, [isRefreshing]);
  // Drives the "Updating…" toast — shown for AUTOMATIC refreshes only, so a
  // sudden value change has an explanation. Manual refreshes already have
  // the spinning button as their cue.
  const [autoUpdating, setAutoUpdating] = useState(false);

  const doRefresh = useCallback((reason: RefreshReason) => {
    // Guard automatic triggers (return/poll) against overlapping an in-flight
    // refresh; manual taps are already debounced by the button's disabled state.
    if (reason !== "manual" && isRefreshingRef.current) return;
    startRefreshTransition(async () => {
      // Toast only for the return case. A periodic foreground poll popping a
      // toast every few minutes would be noise; manual taps have the spinner.
      if (reason === "return") setAutoUpdating(true);
      // 1. Server action: invalidate Next.js's Full Route Cache + Data Cache
      //    for "/", so the next request actually re-fetches upstream APIs
      //    instead of returning the previously-cached UV/visibility/etc.
      await refreshHud();
      // 2. Client: re-fetch the page payload from the server, which now
      //    has nothing cached and will run the fetches fresh.
      router.refresh();
      lastRefreshAt.current = Date.now();
    });
  }, [router]);

  // Hide the "Updating…" toast shortly after an automatic refresh settles
  // (isRefreshing flips back to false when router.refresh() completes).
  useEffect(() => {
    if (!autoUpdating || isRefreshing) return;
    const t = setTimeout(() => setAutoUpdating(false), 1200);
    return () => clearTimeout(t);
  }, [autoUpdating, isRefreshing]);

  // Subscribe once to the "user came back" signals:
  //   visibilitychange — tab switch, PWA background/resume
  //   pageshow         — iOS Safari bfcache restore (back/forward, swipe
  //                      resume) where visibilitychange may not fire
  //   focus            — desktop window refocus
  // Each just re-checks staleness; the STALE_MS gate makes spurious focus
  // events harmless (no refresh unless the data is actually old).
  useEffect(() => {
    function maybeAutoRefresh() {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (isRefreshingRef.current) return;
      if (Date.now() - lastRefreshAt.current >= STALE_MS) doRefresh("return");
    }
    document.addEventListener("visibilitychange", maybeAutoRefresh);
    window.addEventListener("pageshow", maybeAutoRefresh);
    window.addEventListener("focus", maybeAutoRefresh);
    return () => {
      document.removeEventListener("visibilitychange", maybeAutoRefresh);
      window.removeEventListener("pageshow", maybeAutoRefresh);
      window.removeEventListener("focus", maybeAutoRefresh);
    };
  }, [doRefresh]);

  // Foreground poll. The listeners above only fire when the user leaves and
  // comes back; this keeps a continuously-open session current too. Wakes
  // every POLL_CHECK_MS but only refreshes once data crosses STALE_MS, so the
  // effective cadence is ~5 min and it self-coordinates with manual/return
  // refreshes (both reset lastRefreshAt). Skips ticks while hidden to spare
  // battery and upstream API calls.
  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === "undefined") return;
      if (document.visibilityState !== "visible") return;
      if (isRefreshingRef.current) return;
      if (Date.now() - lastRefreshAt.current >= STALE_MS) doRefresh("poll");
    }, POLL_CHECK_MS);
    return () => clearInterval(id);
  }, [doRefresh]);

  return (
    <>
      {/* Transient cue for AUTOMATIC refreshes (data was stale on return).
          Manual refreshes rely on the spinning button instead. */}
      {autoUpdating && (
        <div role="status" aria-live="polite" style={updatingToast}>
          <span style={updatingSpinner} />
          Updating…
        </div>
      )}

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
          onClick={() => doRefresh("manual")}
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
        <AccountMenu
          initialUser={currentUser}
          isPremium={isPremium}
          hasStripeCustomer={hasStripeCustomer}
        />
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
        isPremium={isPremium}
      />

      <WelcomeModal
        open={welcomeOpen}
        onClose={dismissWelcome}
        onSetupLocation={welcomeToLocation}
        onSetupBriefing={welcomeToBriefing}
        userName={currentUser?.name ?? null}
      />

      {/* First-visit beta banner. Self-gating via localStorage so we
          don't need to pipe any state through here — it just renders
          once per device on the first paint and dismisses itself
          afterwards. Lives at this level (vs. wrapped in something)
          so it lands at z-index 10000 above the topbar. */}
      <BetaBanner />
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

// "Updating…" toast for automatic, staleness-triggered refreshes. Fixed to
// the bottom-center, above the iOS home indicator, at a z-index under the
// beta banner (10000) but above page content.
const updatingToast: React.CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: "calc(20px + env(safe-area-inset-bottom))",
  transform: "translateX(-50%)",
  zIndex: 9000,
  display: "flex", alignItems: "center", gap: 8,
  padding: "8px 14px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 999,
  boxShadow: "0 6px 20px rgba(0,0,0,.25)",
  color: "var(--text)",
  fontSize: 13, fontWeight: 600,
  // Pointer-events off so the toast never intercepts a tap on the tile
  // beneath it during its brief on-screen life.
  pointerEvents: "none",
};
const updatingSpinner: React.CSSProperties = {
  width: 12, height: 12, borderRadius: "50%",
  border: "2px solid var(--border)",
  borderTopColor: "var(--accent)",
  animation: "phud-spin 0.9s linear infinite",
};

