"use client";
// Reusable per-field source pickers, shared between AddLocationWizard
// (creating a new location) and EditLocationSourcesModal (changing the
// data sources on an existing one).
//
// Each picker is a `<select>` populated from the resolver's candidate
// list with rich labels (distance + station type). The "Save" handler
// lives in the parent — these components just render the controls and
// emit changes via onChange callbacks.

import type {
  BuoyCandidate,
  MarineZoneCandidate,
  ObservationCandidate,
  TideCandidate,
  WindCandidate,
} from "@/lib/location-resolver";
import type { WindStationRef } from "@/lib/types";

/** Wind-source picker uses a composite value like "coops:8670870" or
 *  "ndbc:41008" so a single <select> can carry both source kinds. The
 *  parent component splits it back into kind + id on save. */
export const WIND_VALUE_SEPARATOR = ":";
export function encodeWindValue(kind: "coops" | "ndbc", id: string): string {
  return `${kind}${WIND_VALUE_SEPARATOR}${id}`;
}
export function decodeWindValue(v: string): { kind: "coops" | "ndbc"; id: string } | null {
  if (!v) return null;
  const idx = v.indexOf(WIND_VALUE_SEPARATOR);
  if (idx < 0) return null;
  const kind = v.slice(0, idx);
  const id = v.slice(idx + 1);
  if ((kind !== "coops" && kind !== "ndbc") || !id) return null;
  return { kind, id };
}

// ─── Candidate option formatters

export function tideOption(c: TideCandidate): { value: string; label: string } {
  return {
    value: c.stationId,
    label: `${c.stationName} — ${c.distanceMi.toFixed(1)} mi ${c.isHarmonic ? "(harmonic)" : "(subordinate)"}`,
  };
}
export function obsOption(c: ObservationCandidate): { value: string; label: string } {
  return {
    value: c.stationId,
    label: `${c.stationId} — ${c.distanceMi.toFixed(1)} mi${c.isIcao ? " (airport)" : ""}`,
  };
}
export function buoyOption(c: BuoyCandidate): { value: string; label: string } {
  return {
    value: c.buoyId,
    label: `${c.name} (${c.buoyId}) — ${c.distanceMi.toFixed(1)} mi`,
  };
}
export function marineZoneOption(c: MarineZoneCandidate): { value: string; label: string } {
  return {
    value: c.id,
    label: `${c.id} — ${c.name}${c.source === "state" ? " (regional)" : ""}`,
  };
}
export function windOption(c: WindCandidate): { value: string; label: string } {
  // Prepend a liveness indicator so the user can see at a glance which
  // sources are actually reporting fresh data. "○" is a deliberate
  // visual placeholder for un-probed candidates (everything past the
  // top-N cutoff) — better than hiding the distinction.
  const tag =
    c.liveness === "live"    ? `🟢 Live${c.ageMin != null ? ` · ${formatAge(c.ageMin)}` : ""}` :
    c.liveness === "stale"   ? `🟡 Stale${c.ageMin != null ? ` · ${formatAge(c.ageMin)}` : ""}` :
    c.liveness === "offline" ? "⚪ Offline" :
                                "○";
  return {
    value: encodeWindValue(c.kind, c.id),
    label: `${tag} · ${c.name} (${c.id}) — ${c.distanceMi.toFixed(1)} mi · ${c.kind === "coops" ? "CO-OPS" : "NDBC buoy"}`,
  };
}

function formatAge(min: number): string {
  if (min < 60) return `${Math.round(min)} min ago`;
  const hr = min / 60;
  if (hr < 24) return `${hr.toFixed(hr < 10 ? 1 : 0)} hr ago`;
  return `${Math.round(hr / 24)} d ago`;
}

/** Build a wind fallback chain from a user-picked primary plus the next
 *  3 unique candidates from the resolver's ranked list. Used by both
 *  AddLocationWizard and EditLocationSourcesModal on save so existing
 *  locations benefit from the same fallback behavior new ones get.
 *
 *  The candidates list is already ranked live-then-distance by the
 *  resolver, so we just take the head of that list (excluding the
 *  primary, since it goes first) for the tail of the chain. */
export function buildWindChain(
  primary: { kind: "coops" | "ndbc"; id: string },
  candidates: WindCandidate[],
  maxChain = 4,
): WindStationRef[] {
  const out: WindStationRef[] = [{ kind: primary.kind, id: primary.id }];
  for (const c of candidates) {
    if (out.length >= maxChain) break;
    if (c.kind === primary.kind && c.id === primary.id) continue;
    out.push({ kind: c.kind, id: c.id });
  }
  return out;
}

// ─── Generic single-select with help text + empty fallback

export function FieldSelector({
  label, value, onChange, options, helpText, emptyText, required, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  helpText?: string | null;
  emptyText?: string | null;
  required?: boolean;
  disabled?: boolean;
}) {
  if (emptyText) {
    return (
      <div style={{ marginBottom: 12 }}>
        <label style={fieldLabel}>{label}</label>
        <div style={{
          padding: "10px 12px",
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          borderRadius: 10,
          fontSize: 12, color: "var(--text-muted)",
        }}>
          {emptyText}
        </div>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={fieldLabel}>
        {label}
        {required && <span style={{ color: "var(--accent)", marginLeft: 4 }}>*</span>}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        style={selectStyle}
      >
        {options.map((o) => (
          <option key={o.value || "empty"} value={o.value}>{o.label}</option>
        ))}
      </select>
      {helpText && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.4 }}>
          {helpText}
        </div>
      )}
    </div>
  );
}

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: ".4px",
  fontWeight: 600,
  marginBottom: 6,
};
const selectStyle: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 12px",
  background: "var(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontFamily: "inherit",
  boxSizing: "border-box",
  cursor: "pointer",
};
