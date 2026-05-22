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
import { redeemCompCode } from "@/app/account/actions";
import TileLayoutEditor from "./TileLayoutEditor";
import type {
  HeightUnits,
  TempUnits,
  ThemeMode,
  TileConfig,
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
  /** Whether this user is currently on Pro (paid, lifetime, or comp).
   *  Used to nudge free users toward /upgrade in the daily-briefing
   *  section ("Daily briefing is a Pro feature"). Optional — defaults
   *  to false so older callers that haven't updated still compile. */
  isPremium?: boolean;
}

// localStorage keys. Keep aligned with the keys the rest of the app
// reads/writes (theme already uses 'phud_theme' from TopBar.tsx).
const LS_THEME = "phud_theme";
const LS_WIND = "phud_units_wind";
const LS_TEMP = "phud_units_temp";
const LS_HEIGHT = "phud_units_height";
const LS_TIME = "phud_time_format";

export default function PreferencesModal({ open, onClose, initialPreferences, isSignedIn, isPremium = false }: Props) {
  const router = useRouter();
  const [prefs, setPrefs] = useState<UserPreferences>(initialPreferences);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Layout editor has its own save flow (batched up/down/hide changes
  // committed via an explicit Save button), so it gets its own
  // saving/error state to avoid stepping on the single-toggle path.
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  // Comp code redemption: free-text input, async submit, separate
  // success / error states. Reset on modal close so re-opening doesn't
  // show a stale "Code applied" message.
  const [codeInput, setCodeInput] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeSuccess, setCodeSuccess] = useState<string | null>(null);

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

  /** Reset comp-code state when the modal closes so users don't see a
   *  stale "Code applied" toast next time they open it. */
  useEffect(() => {
    if (open) return;
    setCodeInput("");
    setCodeBusy(false);
    setCodeError(null);
    setCodeSuccess(null);
  }, [open]);

  /** Submit the entered code. On success, router.refresh() so the
   *  Pro state in the topbar / dashboard updates immediately. */
  async function handleRedeem(e?: React.FormEvent) {
    e?.preventDefault();
    if (codeBusy) return;
    const code = codeInput.trim();
    if (!code) {
      setCodeError("Enter a code to redeem.");
      return;
    }
    setCodeBusy(true);
    setCodeError(null);
    setCodeSuccess(null);
    const result = await redeemCompCode(code);
    setCodeBusy(false);
    if (!result.ok) {
      setCodeError(result.error ?? "Couldn't redeem that code.");
      return;
    }
    const compUntilDate = result.compUntil
      ? new Date(result.compUntil).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : null;
    setCodeSuccess(
      result.daysGranted
        ? `Got ${result.daysGranted} days of Tidevisor Pro${compUntilDate ? ` (until ${compUntilDate})` : ""}.`
        : "Code applied.",
    );
    setCodeInput("");
    // Pull fresh server data so the topbar's Pro badge and any
    // premium-gated UI light up without a manual reload.
    router.refresh();
  }

  /** Persist a new tile layout. Signed-in only — for guests we hide
   *  the layout editor since the page is server-rendered and can't
   *  read localStorage at SSR time, so any guest-saved layout
   *  wouldn't apply until they signed in anyway. */
  async function saveTileConfig(next: TileConfig) {
    setPrefs((p) => ({ ...p, tileConfig: next }));
    setLayoutError(null);
    setLayoutSaving(true);
    const result = await updatePreferences({ tileConfig: next });
    setLayoutSaving(false);
    if (!result.ok) {
      setLayoutError(result.error ?? "Couldn't save layout.");
      return;
    }
    // Refresh server data so the page re-renders with the new order.
    router.refresh();
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

        {/* Daily briefing email is signed-in only — there's nowhere to
            send mail for a guest. Hide the section entirely rather than
            showing a disabled control. */}
        {isSignedIn && (
          <Section label="Daily briefing email">
            <Segmented
              value={prefs.dailyBriefingEnabled ? "on" : "off"}
              options={[
                { value: "off", label: "Off" },
                { value: "on", label: "On" },
              ]}
              onChange={(v) => updateOne("dailyBriefingEnabled", v === "on")}
              disabled={saving}
            />
            {prefs.dailyBriefingEnabled && (
              <>
                <div style={{ marginTop: 10 }}>
                  <select
                    value={prefs.dailyBriefingHour}
                    onChange={(e) => updateOne("dailyBriefingHour", Number(e.target.value))}
                    disabled={saving}
                    style={briefingHourSelect}
                    aria-label="Send time"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        Send at {formatHourLabel(h, prefs.timeFormat)} Eastern
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
                  Short daily summary of your primary location: tides, wind,
                  weather, alerts. Sent to your account email.
                </div>
              </>
            )}
          </Section>
        )}

        {/* Tile layout — signed-in only. Guests can't customize because
            the dashboard is server-rendered and SSR can't read
            localStorage, so a guest's saved layout wouldn't apply
            until they signed in anyway. */}
        {isSignedIn && (
          <Section label="Tile layout">
            <TileLayoutEditor
              value={prefs.tileConfig}
              onSave={saveTileConfig}
              saving={layoutSaving}
              saveError={layoutError}
            />
          </Section>
        )}

        {/* Tidevisor Pro section — signed-in only. Free users get a
            short upsell + a redeem field for beta codes. Paid/comp
            users still see the redeem field (stacking comp codes is
            allowed) but with a different framing line. */}
        {isSignedIn && (
          <Section label="Tidevisor Pro">
            {!isPremium && (
              <div style={proPromptBox}>
                <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                  Unlock unlimited locations, daily briefing emails, GPS
                  tracking, and more.
                </div>
                <a href="/upgrade" style={proLink} onClick={onClose}>
                  See plans →
                </a>
              </div>
            )}
            <form onSubmit={handleRedeem} style={{ marginTop: 10 }}>
              <label
                htmlFor="comp-code-input"
                style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}
              >
                Got a code? Redeem it for free Pro access.
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  id="comp-code-input"
                  type="text"
                  value={codeInput}
                  onChange={(e) => {
                    setCodeInput(e.target.value);
                    setCodeError(null);
                    setCodeSuccess(null);
                  }}
                  placeholder="e.g. BETA-2026"
                  disabled={codeBusy}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  style={codeInputStyle}
                />
                <button
                  type="submit"
                  disabled={codeBusy || !codeInput.trim()}
                  style={codeBtnStyle}
                >
                  {codeBusy ? "…" : "Redeem"}
                </button>
              </div>
              {codeError && (
                <div style={{ fontSize: 12, color: "#c44", marginTop: 6 }}>
                  {codeError}
                </div>
              )}
              {codeSuccess && (
                <div style={{ fontSize: 12, color: "var(--accent-2)", marginTop: 6 }}>
                  {codeSuccess}
                </div>
              )}
            </form>
          </Section>
        )}

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
const proPromptBox: React.CSSProperties = {
  padding: "10px 12px",
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  display: "flex", alignItems: "center", justifyContent: "space-between",
  gap: 10,
};
const proLink: React.CSSProperties = {
  fontSize: 12, fontWeight: 600,
  color: "var(--accent)",
  textDecoration: "none",
  whiteSpace: "nowrap",
  flexShrink: 0,
};
const codeInputStyle: React.CSSProperties = {
  flex: 1, minWidth: 0,
  padding: "10px 12px",
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  color: "var(--text)",
  fontSize: 14, fontFamily: "inherit",
  letterSpacing: ".5px",
  textTransform: "uppercase",
};
const codeBtnStyle: React.CSSProperties = {
  padding: "10px 16px",
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 10,
  fontSize: 13, fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
  flexShrink: 0,
};
const briefingHourSelect: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 12px",
  background: "var(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontFamily: "inherit",
  boxSizing: "border-box",
  cursor: "pointer",
};

/** Hour-of-day formatter that respects the user's 12h/24h preference.
 *  Used by the daily-briefing send-time dropdown. */
function formatHourLabel(hour: number, format: TimeFormatPref): string {
  if (format === "24h") return `${String(hour).padStart(2, "0")}:00`;
  if (hour === 0) return "12:00 AM";
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return "12:00 PM";
  return `${hour - 12}:00 PM`;
}
(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontFamily: "inherit",
  boxSizing: "border-box",
  cursor: "pointer",
};

/** Hour-of-day formatter that respects the user's 12h/24h preference.
 *  Used by the daily-briefing send-time dropdown. */
function formatHourLabel(hour: number, format: TimeFormatPref): string {
  if (format === "24h") return `${String(hour).padStart(2, "0")}:00`;
  if (hour === 0) return "12:00 AM";
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return "12:00 PM";
  return `${hour - 12}:00 PM`;
}
12}:00 PM`;
}
