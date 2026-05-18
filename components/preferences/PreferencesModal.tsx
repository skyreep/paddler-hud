"use client";

// Preferences modal — bottom-sheet style, matches SignInModal /
// LocationPicker. Opens from the AccountMenu dropdown for both guests
// and signed-in users.
//
// Persistence:
//   - Signed-in users → updatePreferences server action upserts the
//     user_preferences row in Supabase, which then syncs across devices.
//   - Guests → localStorage only. A small note in the modal nudges them
//     toward sign-in for cross-device sync.
//
// All toggles are live: theme applies via the existing data-theme
// pipeline; time format and unit prefs propagate through every tile that
// renders unit-bearing values (RightNow, WindNowTile, TideTile, etc.).
// For signed-in users the values are server-loaded into TopBar on each
// page render, so changes show up on the next route transition.
//
// Portal'd to document.body for the same reason SignInModal is — the
// topbar's backdrop-filter would otherwise clip the fullscreen overlay.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { updatePreferences } from "@/app/preferences/actions";
import type {
  HeightUnits,
  TempUnits,
  ThemeMode,
  TimeFormatPref,
  UserPreferences,
  WindUnits,
} from "@/lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Server-resolved initial preferences. For guests this is
   *  DEFAULT_PREFERENCES; for signed-in users it's their stored row. */
  initialPreferences: UserPreferences;
  /** Whether the current visitor is signed in. Controls whether changes
   *  go through the server action (DB) or stay in localStorage. */
  isSignedIn: boolean;
}

// localStorage keys. Keep aligned with the keys the rest of the app
// reads/writes (theme already uses 'phud_theme' from TopBar.tsx).
const LS_THEME = "phud_theme";
const LS_WIND = "phud_units_wind";
const LS_TEMP = "phud_units_temp";
const LS_HEIGHT = "phud_units_height";
const LS_TIME = "phud_time_format";

export default function PreferencesModal({ open, onClose, initialPreferences, isSignedIn }: Props) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<UserPreferences>(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // When the modal opens, sync local state from the server prop. For
  // guests, prefer localStorage over the prop (server defaults aren't
  // their actual chosen values).
  useEffect(() => {
    if (!open) return;
    if (!isSignedIn && typeof window !== "undefined") {
      setPrefs((p) => ({
        ...p,
        theme: readLS<ThemeMode>(LS_THEME, ["light", "dark", "auto"]) ?? p.theme,
        unitsWind: readLS<WindUnits>(LS_WIND, ["kt", "mph", "all"]) ?? p.unitsWind,
        unitsTemp: readLS<TempUnits>(LS_TEMP, ["F", "C"]) ?? p.unitsTemp,
        unitsHeight: readLS<HeightUnits>(LS_HEIGHT, ["ft", "m"]) ?? p.unitsHeight,
        timeFormat: readLS<TimeFormatPref>(LS_TIME, ["12h", "24h"]) ?? p.timeFormat,
      }));
    } else {
      setPrefs(initialPreferences);
    }
    setErrorMsg(null);
  }, [open, isSignedIn, initialPreferences]);

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

  /** Apply a partial update locally, persist (DB + localStorage as
   *  appropriate), and apply any side effects (theme to <html>). */
  async function updateOne<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) {
    // Optimistic local state.
    setPrefs((p) => ({ ...p, [key]: value }));
    setErrorMsg(null);

    // localStorage shadow so the pre-paint script (theme) and any
    // guest-mode reads can see the choice immediately.
    try {
      if (key === "theme") localStorage.setItem(LS_THEME, value as string);
      if (key === "unitsWind") localStorage.setItem(LS_WIND, value as string);
      if (key === "unitsTemp") localStorage.setItem(LS_TEMP, value as string);
      if (key === "unitsHeight") localStorage.setItem(LS_HEIGHT, value as string);
      if (key === "timeFormat") localStorage.setItem(LS_TIME, value as string);
    } catch { /* private mode / quota — ignore */ }

    // Theme side effect: apply to <html data-theme> immediately so the
    // user sees the change without waiting for a save round-trip.
    if (key === "theme") {
      applyTheme(value as ThemeMode);
    }

    // Persist to DB if signed in.
    if (isSignedIn) {
      setSaving(true);
      const result = await updatePreferences({ [key]: value } as Partial<UserPreferences>);
      setSaving(false);
      if (!result.ok) {
        setErrorMsg(result.error ?? "Couldn't save preference.");
        return;
      }
      // Refresh server data so the next page render sees the new value
      // in places that read from the server (e.g. theme cookie sync — future).
      router.refresh();
    }
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prefs-title"
      style={overlay}
    >
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={dragHandle} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 id="prefs-title" style={{ margin: 0, fontSize: 18 }}>Preferences</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>✕</button>
        </div>

        {!isSignedIn && (
          <div style={notice}>
            You&apos;re browsing as a guest. Preferences are saved to this device only.
            <span style={{ color: "var(--text-muted)" }}>{" "}Sign in to sync across devices.</span>
          </div>
        )}

        {errorMsg && (
          <div style={{ ...notice, borderColor: "#c44", color: "#c44" }}>
            {errorMsg}
          </div>
        )}

        <Section label="Theme">
          <Segmented
            value={prefs.theme}
            options={[
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "auto", label: "Auto" },
            ]}
            onChange={(v) => updateOne("theme", v)}
            disabled={saving}
          />
        </Section>

        <Section label="Time format">
          <Segmented
            value={prefs.timeFormat}
            options={[
              { value: "12h", label: "12-hour" },
              { value: "24h", label: "24-hour" },
            ]}
            onChange={(v) => updateOne("timeFormat", v)}
            disabled={saving}
          />
        </Section>

        <Section label="Wind units">
          <Segmented
            value={prefs.unitsWind}
            options={[
              { value: "kt", label: "Knots" },
              { value: "mph", label: "MPH" },
              { value: "all", label: "Both" },
            ]}
            onChange={(v) => updateOne("unitsWind", v)}
            disabled={saving}
          />
        </Section>

        <Section label="Temperature">
          <Segmented
            value={prefs.unitsTemp}
            options={[
              { value: "F", label: "°F" },
              { value: "C", label: "°C" },
            ]}
            onChange={(v) => updateOne("unitsTemp", v)}
            disabled={saving}
          />
        </Section>

        <Section label="Tide / wave height">
          <Segmented
            value={prefs.unitsHeight}
            options={[
              { value: "ft", label: "Feet" },
              { value: "m", label: "Meters" },
            ]}
            onChange={(v) => updateOne("unitsHeight", v)}
            disabled={saving}
          />
        </Section>

        <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "16px 0 0", textAlign: "center" }}>
          Changes save automatically.
        </p>
      </div>
    </div>,
    document.body,
  );
}

// ─── Apply a ThemeMode to <html data-theme>. Mirrors the logic in
// TopBar.tsx's cycleTheme so we keep one single source of truth even when
// the theme is changed from two different places.
function applyTheme(theme: ThemeMode) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const dark =
    theme === "dark" ||
    (theme === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

function readLS<T extends string>(key: string, allowed: readonly T[]): T | null {
  try {
    const v = localStorage.getItem(key);
    return v !== null && (allowed as readonly string[]).includes(v) ? (v as T) : null;
  } catch {
    return null;
  }
}

// ─── Subcomponents

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: ".4px" }}>
        {label}
      </div>
      {children}
    </div>
  );
}

interface SegmentedOption<T extends string> { value: T; label: string }
interface SegmentedProps<T extends string> {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (v: T) => void;
  disabled?: boolean;
  /** Subtle one-line caption shown under the segmented control — used to
   *  flag "saves but doesn't render anything yet" toggles. */
  preview?: string;
}
function Segmented<T extends string>({ value, options, onChange, disabled, preview }: SegmentedProps<T>) {
  return (
    <>
      <div style={{
        display: "grid",
        gridTemplateColumns: `repeat(${options.length}, 1fr)`,
        gap: 0,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
        borderRadius: 10,
        padding: 2,
      }}>
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => onChange(opt.value)}
              style={{
                padding: "8px 6px",
                background: selected ? "var(--accent)" : "transparent",
                color: selected ? "white" : "var(--text)",
                border: "none",
                borderRadius: 8,
                fontSize: 13,
                fontWeight: selected ? 600 : 500,
                fontFamily: "inherit",
                cursor: disabled ? "not-allowed" : "pointer",
                transition: "background .15s ease",
              }}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {preview && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
          {preview}
        </div>
      )}
    </>
  );
}

// ─── Styles

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
const notice: React.CSSProperties = {
  padding: "10px 12px", marginBottom: 12,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 13, color: "var(--text)",
};
