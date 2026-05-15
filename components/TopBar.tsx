"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import LocationPicker from "./LocationPicker";
import { refreshHud } from "@/app/actions";

interface Props {
  locationName: string;
  stationKey: string;
}

type ThemeMode = "light" | "dark" | "auto";

export default function TopBar({ locationName, stationKey }: Props) {
  const router = useRouter();
  // Single source of truth — theme mode. The pre-paint script in layout.tsx
  // sets data-theme on <html> BEFORE React hydrates, so both the server
  // markup and the first client render produce identical DOM. The CSS
  // .theme-sun / .theme-moon rules in globals.css hide whichever icon
  // doesn't match the current data-theme; no JSX branching, no hydration risk.
  const [theme, setTheme] = useState<ThemeMode>("auto");
  const [locOpen, setLocOpen] = useState(false);

  useEffect(() => {
    const saved = (localStorage.getItem("phud_theme") as ThemeMode | null) ?? "auto";
    setTheme(saved);
  }, []);

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
          paddingTop: "calc(10px + env(safe-area-inset-top))",
          display: "flex", alignItems: "center", gap: 10,
          backdropFilter: "saturate(180%) blur(12px)",
          WebkitBackdropFilter: "saturate(180%) blur(12px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 16 }}>
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
          Paddler HUD
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

        {/* Account avatar — hidden until user profiles ship. To restore:
              <button style={avatarBtn} aria-label="Account">SR</button>
            and re-enable the avatarBtn style block below. */}
      </header>

      <LocationPicker open={locOpen} onClose={() => setLocOpen(false)} activeKey={stationKey} />
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
  maxWidth: 200, cursor: "pointer",
  fontFamily: "inherit",
};
const iconBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: 10,
  background: "var(--bg-elev-2)", border: "1px solid var(--border-soft)",
  color: "var(--text)", display: "grid", placeItems: "center", flexShrink: 0,
  cursor: "pointer",
};
// Avatar style kept around for when user profiles ship — see commented JSX above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const avatarBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: "50%",
  background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
  color: "white", border: "none", fontWeight: 700, fontSize: 14,
  display: "grid", placeItems: "center", cursor: "pointer",
  flexShrink: 0,
  aspectRatio: "1",
  padding: 0,
};
