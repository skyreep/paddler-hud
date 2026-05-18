// Unit conversion + formatter helpers. Every tile that displays a
// unit-bearing value (temperature, wind speed, water height) calls into
// here so users can flip preferences once in the settings modal and have
// the change propagate everywhere without each tile reimplementing the
// conversion.
//
// Source-of-truth units (what comes off the API responses):
//   - Temperatures:    Fahrenheit
//   - Wind speeds:     knots (kt) — mph also pre-computed by lib/wind-resolver
//   - Heights:         feet (above MLLW for tides, above the trough for waves)
//
// We convert from these on demand at render time rather than storing
// converted values, which keeps the data layer simple and means a user
// changing preferences sees the update on the next paint, not the next
// refresh.

import type { HeightUnits, TempUnits, WindUnits } from "@/lib/types";

// ─── Raw conversions

/** Fahrenheit → Celsius. Round to a sensible precision at the format
 *  layer; this returns the raw float. */
export function fToC(f: number): number {
  return (f - 32) * 5 / 9;
}
/** Feet → meters. Same precision convention as fToC. */
export function ftToM(ft: number): number {
  return ft * 0.3048;
}
/** Knots → miles per hour. Same precision convention. */
export function ktToMph(kt: number): number {
  return kt * 1.150779;
}

// ─── Display helpers — each takes the raw source-unit value and a user
// preference, returns the string to render. All handle null/NaN by
// returning "—" so tiles don't have to repeat the "if missing show dash"
// pattern at every callsite.

const DASH = "—";

/** "73°F" or "23°C". Rounds to whole degrees (the precision NOAA / NWS
 *  actually publishes their forecast data at). */
export function fmtTemp(f: number | null | undefined, pref: TempUnits = "F"): string {
  if (f === null || f === undefined || Number.isNaN(f)) return DASH;
  if (pref === "C") return `${Math.round(fToC(f))}°C`;
  return `${Math.round(f)}°F`;
}

/** Temp with a custom precision (e.g. water temp to 1 decimal). */
export function fmtTempPrecise(
  f: number | null | undefined,
  pref: TempUnits = "F",
  decimals = 1,
): string {
  if (f === null || f === undefined || Number.isNaN(f)) return DASH;
  if (pref === "C") return `${fToC(f).toFixed(decimals)}°C`;
  return `${f.toFixed(decimals)}°F`;
}

/** "2.3 ft" or "0.7 m". Tide heights, wave heights. */
export function fmtHeight(
  ft: number | null | undefined,
  pref: HeightUnits = "ft",
  decimals = 1,
): string {
  if (ft === null || ft === undefined || Number.isNaN(ft)) return DASH;
  if (pref === "m") return `${ftToM(ft).toFixed(decimals)} m`;
  return `${ft.toFixed(decimals)} ft`;
}

/** Just the unit suffix (no value), useful for axis labels and headers. */
export function heightUnitLabel(pref: HeightUnits = "ft"): string {
  return pref === "m" ? "m" : "ft";
}

/**
 * Wind speed formatter. The source-of-truth unit is knots; an mph value
 * may be passed alongside if the upstream already computed one (saves a
 * multiplication and keeps the displayed mph in sync with what
 * lib/wind-resolver decided).
 *
 *   pref "kt"  → "12 kt"
 *   pref "mph" → "14 mph"
 *   pref "all" → "12 kt / 14 mph"
 */
export function fmtWind(
  kt: number | null | undefined,
  pref: WindUnits = "kt",
  opts?: { mph?: number | null | undefined },
): string {
  if (kt === null || kt === undefined || Number.isNaN(kt)) return DASH;
  const mph = opts?.mph ?? ktToMph(kt);
  if (pref === "mph") return `${Math.round(mph)} mph`;
  if (pref === "all") return `${Math.round(kt)} kt / ${Math.round(mph)} mph`;
  return `${Math.round(kt)} kt`;
}

/** Just the unit suffix (no value), useful for axis labels and headers.
 *  For "all" we render "kt" since that's the primary unit. */
export function windUnitLabel(pref: WindUnits = "kt"): string {
  return pref === "mph" ? "mph" : "kt";
}

/** Numeric-only wind speed (no unit suffix). Useful for chart bars and
 *  any context where the unit is rendered separately in a label.
 *  Returns 0 for null/NaN so chart math doesn't blow up. */
export function windSpeedNumber(
  kt: number | null | undefined,
  pref: WindUnits = "kt",
  opts?: { mph?: number | null | undefined },
): number {
  if (kt === null || kt === undefined || Number.isNaN(kt)) return 0;
  if (pref === "mph") return opts?.mph ?? ktToMph(kt);
  // "all" defaults to kt for the numeric value (the dual label is rendered
  // separately by fmtWind when context allows).
  return kt;
}
