// Lat/lon → ResolvedLocationBundle. The hard part of the locations editor:
// given a coordinate the user picked, find the right NOAA/NDBC/NWS station
// IDs to power every tile on the HUD.
//
// Resolution order (run in parallel):
//   1. NWS /points/{lat},{lon}                   → forecast zone, observation station list
//   2. NWS /zones?type=marine&point=lat,lon      → marine zone if coordinates fall inside one;
//      fallback /zones?type=marine&area={state}  → all marine zones in your state for inland users
//   3. NOAA CO-OPS station metadata              → all tide stations sorted by distance
//   4. NDBC active stations table                → all buoys sorted by distance
//
// Each resolver returns a sorted list of candidates so the UI can let
// users override the auto-pick. Defaults are the top of each list with
// minor smart filtering (e.g. prefer ICAO airports for observations,
// prefer harmonic tide stations within 60 mi).
//
// Nothing here throws — partial bundles flow through with warnings so
// the user can decide whether the result is good enough.

import type { WindStationRef } from "@/lib/types";

const NWS_USER_AGENT = process.env.NWS_USER_AGENT ?? "Tidevisor/0.1 (contact@example.com)";

// ─── Output types ─────────────────────────────────────────────────────────

export interface ResolvedLocationBundle {
  lat: number;
  lon: number;
  displayName: string;
  tideStationId: string;
  tideStationNote: string | null;
  observationStationId: string | null;
  windStations: WindStationRef[];
  buoyId: string | null;
  nwsZone: string | null;
  marineZone: string | null;
}

export interface ResolverWarning {
  field: "nwsZone" | "marineZone" | "observation" | "tide" | "buoy";
  severity: "info" | "warning" | "error";
  message: string;
  distanceMi?: number;
}

// ─── Candidate shapes (what the UI shows in the per-field pickers) ────────

export interface TideCandidate {
  stationId: string;
  stationName: string;
  distanceMi: number;
  isHarmonic: boolean;
}
export interface ObservationCandidate {
  stationId: string;
  distanceMi: number;
  isIcao: boolean;
}
export interface BuoyCandidate {
  buoyId: string;
  name: string;
  distanceMi: number;
}
/** Wind source — either a NOAA CO-OPS met-equipped station or an NDBC
 *  buoy. The two are presented in a single combined dropdown sorted by
 *  distance so users don't have to know which kind they're looking at.
 *
 *  Liveness:
 *   - "live"    = latest observation is within the freshness window
 *                 (CO-OPS: 60 min, NDBC: 120 min).
 *   - "stale"   = the station has data but the latest sample is older
 *                 than the freshness window. Common cause: sensor went
 *                 offline mid-day, or a near-shore NDBC buoy that only
 *                 reports a few times a day.
 *   - "offline" = no observations at all in the last 6 h, or the
 *                 station returned no data / an error. Includes
 *                 sensor-stuck cases (speed=0 alongside gust>0).
 *   - "unknown" = we didn't probe this candidate (it was past the top-N
 *                 cutoff). Treated as "stale" for ranking purposes so
 *                 the closer unprobed ones don't get pushed past live
 *                 ones we know are good.
 *
 *  ageMin is set when a probe ran and returned data — used for the
 *  picker's "Live · 3 min ago" / "Stale · 6 hr ago" labels.
 */
export type WindLiveness = "live" | "stale" | "offline" | "unknown";
export interface WindCandidate {
  kind: "coops" | "ndbc";
  id: string;
  name: string;
  distanceMi: number;
  liveness: WindLiveness;
  ageMin?: number;
}
export interface MarineZoneCandidate {
  id: string;
  name: string;
  /** "containing" = user's coords are inside this zone (best case).
   *  "state"      = same state as the user's land zone (likely relevant).
   *  Used to label options in the picker and order them. */
  source: "containing" | "state";
}

export interface ResolverCandidates {
  tide: TideCandidate[];
  observation: ObservationCandidate[];
  buoy: BuoyCandidate[];
  /** Combined CO-OPS + NDBC wind sources sorted by distance. The CO-OPS
   *  list is filtered to stations with met sensors (so 8670681-style
   *  "tide station with no wind sensor" entries don't appear). */
  wind: WindCandidate[];
  marineZone: MarineZoneCandidate[];
}

/** Per-field metadata for the preview UI. Lets us render distance and
 *  station name next to the currently-selected value without depending on
 *  whether a warning happened to fire. */
export interface ResolvedFieldsMeta {
  tide?: { stationName: string; distanceMi: number; isHarmonic: boolean };
  observation?: { distanceMi: number };
  buoy?: { name: string; distanceMi: number };
  wind?: { name: string; distanceMi: number; kind: "coops" | "ndbc" };
  nwsZone?: { source: "containing" };
  marineZone?: { source: "containing" | "state" };
}

export interface ResolverResult {
  bundle: ResolvedLocationBundle;
  warnings: ResolverWarning[];
  fields: ResolvedFieldsMeta;
  candidates: ResolverCandidates;
}

// ─── Public entry point ───────────────────────────────────────────────────

export async function resolveLocationCandidate(
  lat: number,
  lon: number,
  suggestedName?: string,
): Promise<ResolverResult> {
  // Kick off each lookup in parallel. NWS happens first because the marine
  // zone fallback uses the land zone's state, but we can start tide + buoy
  // in parallel with it.
  const [nwsOutcome, tideCandidates, buoyCandidates, coopsMetCandidates] = await Promise.all([
    resolveNws(lat, lon).catch((e) => { console.error("[location-resolver] NWS failed:", e); return null; }),
    resolveAllTideStations(lat, lon).catch((e) => { console.error("[location-resolver] tide failed:", e); return []; }),
    resolveAllBuoys(lat, lon).catch((e) => { console.error("[location-resolver] buoy failed:", e); return []; }),
    resolveAllCoopsMet(lat, lon).catch((e) => { console.error("[location-resolver] met failed:", e); return []; }),
  ]);

  // Combined wind candidates: CO-OPS stations that report met data
  // (filtered server-side via `?type=met` — excludes 8670681-style
  // tide-only stations) plus NDBC buoys (which mostly carry wind).
  // First merged sorted by distance, then re-ranked below by liveness.
  const windByDistance: WindCandidate[] = [
    ...coopsMetCandidates.map((s): WindCandidate => ({
      kind: "coops", id: s.stationId, name: s.stationName, distanceMi: s.distanceMi,
      liveness: "unknown",
    })),
    ...buoyCandidates.map((b): WindCandidate => ({
      kind: "ndbc", id: b.buoyId, name: b.name, distanceMi: b.distanceMi,
      liveness: "unknown",
    })),
  ].sort((a, b) => a.distanceMi - b.distanceMi);

  // Probe the closest N wind candidates for fresh data. We do this here
  // — not at runtime — so the default auto-pick prefers stations that
  // are actually live right now, instead of just "closest". Probing all
  // would be wasteful (there can be 50+ NDBC buoys in range); 6 is
  // enough to catch the realistic "nearest live source" for any US
  // coastal location while keeping the resolver call under ~3 s.
  const probedTop = await probeWindCandidates(windByDistance.slice(0, 6));
  // Re-merge: probed candidates (with liveness set) followed by the
  // un-probed tail (still "unknown"). Then sort by liveness rank, then
  // distance within each bucket.
  const windCandidates: WindCandidate[] = [
    ...probedTop,
    ...windByDistance.slice(6),
  ].sort((a, b) => {
    const rank = (l: WindLiveness) => l === "live" ? 0 : l === "stale" || l === "unknown" ? 1 : 2;
    const da = rank(a.liveness);
    const db = rank(b.liveness);
    if (da !== db) return da - db;
    return a.distanceMi - b.distanceMi;
  });

  const warnings: ResolverWarning[] = [];
  const fields: ResolvedFieldsMeta = {};

  // ─── NWS zones + observation station
  const nwsZone = nwsOutcome?.landZone ?? null;
  const observationCandidates = nwsOutcome?.observationCandidates ?? [];
  const marineZoneCandidates = nwsOutcome?.marineZoneCandidates ?? [];
  const displayName = suggestedName?.trim()
    || nwsOutcome?.cityState
    || `${lat.toFixed(3)}°, ${lon.toFixed(3)}°`;

  if (nwsZone) fields.nwsZone = { source: "containing" };
  else {
    warnings.push({
      field: "nwsZone",
      severity: "warning",
      message: "Couldn't determine the NWS forecast zone — land alerts may not appear for this location.",
    });
  }

  // ─── Pick default tide station: prefer harmonic if within 60 mi.
  // Top of the candidate list (sorted by distance) is the auto-pick;
  // user can swap from the dropdown in the wizard.
  const defaultTide = pickDefaultTide(tideCandidates);
  let tideStationId: string;
  let tideStationNote: string | null = null;
  if (defaultTide) {
    tideStationId = defaultTide.stationId;
    fields.tide = {
      stationName: defaultTide.stationName,
      distanceMi: defaultTide.distanceMi,
      isHarmonic: defaultTide.isHarmonic,
    };
    if (defaultTide.distanceMi > 5) {
      tideStationNote = `Reference: ${defaultTide.stationName}. ~${defaultTide.distanceMi.toFixed(0)} mi from this location; tide times may run a few minutes off.`;
    }
    if (!defaultTide.isHarmonic) {
      warnings.push({
        field: "tide",
        severity: "warning",
        message: `Nearest tide station (${defaultTide.stationName}, ${defaultTide.distanceMi.toFixed(0)} mi) is subordinate, not harmonic. The 6-minute tide curve won't render — only the high/low extreme times. Use the dropdown to pick a harmonic station if there's one within tolerable distance.`,
        distanceMi: defaultTide.distanceMi,
      });
    } else if (defaultTide.distanceMi > 30) {
      warnings.push({
        field: "tide",
        severity: "warning",
        message: `Nearest harmonic tide station is ${defaultTide.distanceMi.toFixed(0)} mi away (${defaultTide.stationName}). Chart shape will be right but the timing won't be exact.`,
        distanceMi: defaultTide.distanceMi,
      });
    } else if (defaultTide.distanceMi > 10) {
      warnings.push({
        field: "tide",
        severity: "info",
        message: `Using ${defaultTide.stationName} (${defaultTide.distanceMi.toFixed(0)} mi away) as the tide reference.`,
        distanceMi: defaultTide.distanceMi,
      });
    }
  } else {
    tideStationId = "8670870"; // Fort Pulaski as last-resort placeholder
    tideStationNote = "No harmonic tide station could be resolved for this location.";
    warnings.push({
      field: "tide",
      severity: "error",
      message: "Couldn't find any tide station near this location. Tide tile will likely be empty.",
    });
  }

  // ─── Default observation station: nearest ICAO within 30 mi, else nearest of any kind.
  const defaultObs = pickDefaultObservation(observationCandidates);
  const observationStationId = defaultObs?.stationId ?? null;
  if (defaultObs) {
    fields.observation = { distanceMi: defaultObs.distanceMi };
    if (defaultObs.distanceMi > 25) {
      warnings.push({
        field: "observation",
        severity: "info",
        message: `Nearest weather station (${defaultObs.stationId}) is ${defaultObs.distanceMi.toFixed(0)} mi away — observations may not match local conditions.`,
        distanceMi: defaultObs.distanceMi,
      });
    }
  } else if (observationCandidates.length === 0) {
    warnings.push({
      field: "observation",
      severity: "warning",
      message: "Couldn't find a nearby weather station — Right Now tile will fall back to gridded forecast values.",
    });
  }

  // ─── Default buoy: nearest within 60 mi, otherwise null (Marine tile hides).
  const defaultBuoy = buoyCandidates[0] ?? null;
  const buoyId = defaultBuoy && defaultBuoy.distanceMi <= 60 ? defaultBuoy.buoyId : null;
  if (buoyId && defaultBuoy) {
    fields.buoy = { name: defaultBuoy.name, distanceMi: defaultBuoy.distanceMi };
  }
  if (!buoyId) {
    warnings.push({
      field: "buoy",
      severity: "info",
      message: defaultBuoy
        ? `Nearest NDBC buoy is ${defaultBuoy.distanceMi.toFixed(0)} mi away — using none by default (Marine tile will be hidden). Use the dropdown to pick one if you want wave data anyway.`
        : "No NDBC buoy available for this location. Marine tile will be hidden.",
    });
  }

  // ─── Default marine zone: containing > nearest in state > none.
  const defaultMarineZone = marineZoneCandidates[0] ?? null;
  const marineZone = defaultMarineZone?.id ?? null;
  if (defaultMarineZone) {
    fields.marineZone = { source: defaultMarineZone.source };
    if (defaultMarineZone.source === "state") {
      warnings.push({
        field: "marineZone",
        severity: "info",
        message: `Your coordinates are inland — defaulting to the first marine zone in your state (${defaultMarineZone.id}). Use the dropdown to pick a different one if you paddle in a specific area.`,
      });
    }
  } else {
    warnings.push({
      field: "marineZone",
      severity: "info",
      message: "No marine zone available — marine-specific alerts won't show.",
    });
  }

  // ─── Default wind source + fallback chain. Live-then-distance ranking
  // was applied above, so windCandidates[0] is the closest source we
  // actually verified is reporting fresh data (falling back to closest
  // if nothing in the top-6 was live). We save up to 4 stations in the
  // saved chain so the runtime can walk past a station that goes stale
  // later in the day without needing to re-run the resolver.
  const defaultWind = windCandidates[0] ?? null;
  const windStations: WindStationRef[] = windCandidates
    .slice(0, 4)
    .map((c): WindStationRef => ({ kind: c.kind, id: c.id }));
  if (defaultWind) {
    fields.wind = {
      name: defaultWind.name,
      distanceMi: defaultWind.distanceMi,
      kind: defaultWind.kind,
    };
    if (defaultWind.distanceMi > 30) {
      warnings.push({
        field: "buoy", // reuse for now — UI bucket; no separate "wind" field
        severity: "info",
        message: `Nearest live wind source is ${defaultWind.distanceMi.toFixed(0)} mi away (${defaultWind.name}). Use the Wind dropdown to pick a different source if a closer one becomes available.`,
        distanceMi: defaultWind.distanceMi,
      });
    }
    if (defaultWind.liveness !== "live") {
      warnings.push({
        field: "buoy",
        severity: "info",
        message: `No nearby wind station was reporting fresh data when this location was created. The picker is using the closest source as a placeholder; live data may resume later, or pick a different option from the dropdown.`,
      });
    }
  } else {
    warnings.push({
      field: "buoy",
      severity: "warning",
      message: "Couldn't find any wind source nearby — the real-time wind tile will be empty.",
    });
  }

  const bundle: ResolvedLocationBundle = {
    lat,
    lon,
    displayName,
    tideStationId,
    tideStationNote,
    observationStationId,
    windStations,
    buoyId,
    nwsZone,
    marineZone,
  };

  const candidates: ResolverCandidates = {
    tide: buildTideCandidates(tideCandidates),
    observation: observationCandidates.slice(0, 6),
    buoy: buoyCandidates.slice(0, 8),
    wind: windCandidates.slice(0, 10),
    marineZone: marineZoneCandidates,
  };

  return { bundle, warnings, fields, candidates };
}

/** Combine the top-N nearest tide stations with the top-K nearest
 *  harmonic stations, deduped and re-sorted by distance.
 *
 *  The Savannah River system (and many tidal harbors) hosts dozens of
 *  subordinate stations clustered within a few miles — they're cheap to
 *  publish because they're just time/height offsets from a harmonic
 *  reference. A pure "top 8 by distance" cut can easily drop nearby
 *  harmonic stations off the list. Harmonic stations are the ones that
 *  actually power the 6-minute tide curve in TideTile, so we always
 *  surface the closest several in the dropdown — otherwise users get
 *  stuck picking subordinates that won't render.
 *
 *  The harmonicBoost is generous (6) because some areas have lots of
 *  harmonic stations clustered together (e.g. the Savannah Tidewater
 *  alone has Savannah, Skidaway Institute, Port Wentworth, AND Fort
 *  Pulaski all within 10 miles). A smaller boost would silently drop
 *  the further-out reference station — exactly what happened with
 *  Fort Pulaski before this number got bumped from 3 to 6. */
/**
 * Build the candidate list. Three sources, deduped:
 *   1. Top N nearest (any type)
 *   2. Top K nearest harmonic
 *   3. ALL stations from KNOWN_HARMONIC_STATIONS within `knownWithinMi`
 *
 * The third source matters: NOAA's `?type=harcon` endpoint returns ~1500
 * stations marked as "having harmonic constituent data," many of which
 * practically behave like subordinates. That means in a dense tidal
 * harbor (Savannah River, Charleston Harbor, NY Harbor) the top-6 by
 * "harmonic distance" can be filled with lesser-known stations and
 * push the well-known reference stations (Fort Pulaski, Charleston,
 * etc.) off the list. Always including KNOWN_HARMONIC_STATIONS within
 * a reasonable radius guarantees those anchor stations show up
 * regardless of how many false-positive "harmonics" cluster nearby.
 */
function buildTideCandidates(
  all: TideCandidate[],
  nearestN = 8,
  harmonicBoost = 6,
  knownWithinMi = 100,
): TideCandidate[] {
  const nearest = all.slice(0, nearestN);
  const harmonic = all.filter((c) => c.isHarmonic).slice(0, harmonicBoost);
  const knownNearby = all.filter(
    (c) => c.stationId in KNOWN_HARMONIC_STATIONS && c.distanceMi <= knownWithinMi,
  );
  const seen = new Set<string>();
  const out: TideCandidate[] = [];
  for (const c of [...nearest, ...harmonic, ...knownNearby]) {
    if (seen.has(c.stationId)) continue;
    seen.add(c.stationId);
    out.push(c);
  }
  return out.sort((a, b) => a.distanceMi - b.distanceMi);
}

// ─── Default-pick helpers ──────────────────────────────────────────────────

function pickDefaultTide(candidates: TideCandidate[]): TideCandidate | null {
  if (candidates.length === 0) return null;
  // Prefer harmonic within 60 mi; otherwise just the nearest of any type.
  const nearestHarmonic = candidates.find((c) => c.isHarmonic && c.distanceMi <= 60);
  return nearestHarmonic ?? candidates[0];
}

function pickDefaultObservation(candidates: ObservationCandidate[]): ObservationCandidate | null {
  if (candidates.length === 0) return null;
  // Prefer ICAO airports within 30 mi (ASOS = reliable 5-min reporting).
  const nearestIcao = candidates.find((c) => c.isIcao && c.distanceMi <= 30);
  return nearestIcao ?? candidates[0];
}

// ─── NWS resolution ──────────────────────────────────────────────────────

interface NwsOutcome {
  landZone: string | null;
  observationCandidates: ObservationCandidate[];
  marineZoneCandidates: MarineZoneCandidate[];
  cityState: string | null;
}

async function resolveNws(lat: number, lon: number): Promise<NwsOutcome> {
  const pointsUrl = `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`;
  const pointsRes = await fetch(pointsUrl, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
    next: { revalidate: 86400 },
  });
  if (!pointsRes.ok) {
    return { landZone: null, observationCandidates: [], marineZoneCandidates: [], cityState: null };
  }
  const points = await pointsRes.json() as {
    properties?: {
      cwa?: string;
      gridId?: string;
      forecastZone?: string;
      observationStations?: string;
      relativeLocation?: { properties?: { city?: string; state?: string } };
    };
  };
  const p = points.properties ?? {};
  const landZone = extractZoneId(p.forecastZone);
  const cityState = p.relativeLocation?.properties?.city && p.relativeLocation.properties.state
    ? `${p.relativeLocation.properties.city}, ${p.relativeLocation.properties.state}`
    : null;
  // cwa = the NWS forecast office (e.g. "CHS" for Charleston SC, which
  // covers the GA/SC coast). The office manages a set of marine zones,
  // and this is the cleanest way to find marine zones near a user
  // (especially inland users where the containing-point query returns
  // nothing). `gridId` is the same value with a different name on the
  // response — read both for resilience.
  const cwa = p.cwa ?? p.gridId ?? null;

  const [marineZoneCandidates, observationCandidates] = await Promise.all([
    resolveMarineZoneCandidates(lat, lon, cwa),
    p.observationStations
      ? resolveAllObservationStations(p.observationStations, lat, lon)
      : Promise.resolve([] as ObservationCandidate[]),
  ]);

  return { landZone, observationCandidates, marineZoneCandidates, cityState };
}

function extractZoneId(url: string | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/([A-Z]{3}\d{3})$/);
  return m ? m[1] : null;
}

/**
 * Build a candidate list of marine zones.
 *
 *   1. Containing-point query (works for coastal users whose coordinates
 *      actually fall inside a marine zone).
 *   2. Office-based fallback (for inland users): fetch all marine zones
 *      and filter to those managed by the user's CWA (e.g. CHS = Charleston).
 *      The user's local forecast office owns a small, geographically
 *      relevant set of marine zones — exactly what an inland paddler
 *      who launches at the coast would want.
 *
 *  NWS's `?area=` parameter takes marine BASIN codes (AM, GM, PZ, etc),
 *  not state codes, which is why a `?area=GA` filter returned empty
 *  before. Filtering post-fetch on the `cwa`/`forecastOffices` properties
 *  is reliable and well-documented.
 */
async function resolveMarineZoneCandidates(
  lat: number,
  lon: number,
  cwa: string | null,
): Promise<MarineZoneCandidate[]> {
  const out: MarineZoneCandidate[] = [];

  // 1. Containing zones via point query (best case for coastal users).
  try {
    const url = `https://api.weather.gov/zones?type=marine&point=${lat.toFixed(4)},${lon.toFixed(4)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
      next: { revalidate: 86400 },
    });
    if (res.ok) {
      const data = await res.json() as {
        features?: Array<{ properties?: { id?: string; name?: string } }>;
      };
      for (const f of data.features ?? []) {
        const id = f.properties?.id;
        const name = f.properties?.name;
        if (id) out.push({ id, name: name ?? id, source: "containing" });
      }
    }
  } catch {
    // Swallow — try the fallback.
  }

  // 2. Office-based fallback. Fetch all marine zones once (cached a week,
  // and the response only includes properties, not geometry, so it's
  // small enough — ~200KB) and filter to those managed by the user's
  // forecast office. The list response carries both `cwa` and
  // `forecastOffices` for each zone; check whichever is populated.
  if (out.length === 0 && cwa) {
    try {
      const url = "https://api.weather.gov/zones?type=marine";
      const res = await fetch(url, {
        headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
        next: { revalidate: 604800 },
      });
      if (res.ok) {
        const data = await res.json() as {
          features?: Array<{
            properties?: {
              id?: string;
              name?: string;
              cwa?: string[] | string;
              forecastOffices?: string[];
            };
          }>;
        };
        for (const f of data.features ?? []) {
          const p = f.properties;
          if (!p?.id) continue;

          // Marine zones list cwa as either a string or array of strings.
          // forecastOffices is always an array. Check all variants so
          // we don't miss matches because of an API quirk.
          const matchesByCwa = Array.isArray(p.cwa)
            ? p.cwa.includes(cwa)
            : p.cwa === cwa;
          const matchesByOffices = Array.isArray(p.forecastOffices)
            && p.forecastOffices.some((o) => o === cwa || o.endsWith(`/${cwa}`));

          if (matchesByCwa || matchesByOffices) {
            out.push({ id: p.id, name: p.name ?? p.id, source: "state" });
          }
        }
      }
    } catch {
      // Bundle without marine zone is acceptable.
    }
  }

  return out;
}

/** Sorted list of nearby observation stations from NWS's per-gridpoint
 *  endpoint. ICAO airport codes (K-prefix mainland US, P-prefix Pacific) are
 *  flagged so the default-picker can prefer them — those are ASOS sites
 *  with reliable 5-minute reporting. */
async function resolveAllObservationStations(
  stationsUrl: string,
  lat: number,
  lon: number,
): Promise<ObservationCandidate[]> {
  const res = await fetch(stationsUrl, {
    headers: { "User-Agent": NWS_USER_AGENT, Accept: "application/geo+json" },
    next: { revalidate: 86400 },
  });
  if (!res.ok) return [];
  const data = await res.json() as {
    features?: Array<{
      properties?: { stationIdentifier?: string };
      geometry?: { coordinates?: [number, number] };
    }>;
  };
  return (data.features ?? [])
    .map((f): ObservationCandidate | null => {
      const id = f.properties?.stationIdentifier;
      const coords = f.geometry?.coordinates;
      if (!id || !coords) return null;
      return {
        stationId: id,
        distanceMi: haversineMi(lat, lon, coords[1], coords[0]),
        isIcao: /^[KP][A-Z]{3}$/.test(id),
      };
    })
    .filter((s): s is ObservationCandidate => s !== null)
    .sort((a, b) => a.distanceMi - b.distanceMi);
}

// ─── NOAA CO-OPS tide station resolution ──────────────────────────────────

/**
 * Known harmonic tide stations on the US Atlantic + Gulf coasts, with
 * coordinates baked in so we can inject them as candidates directly
 * even when NOAA's API skips them.
 *
 * Why we need coordinates and not just IDs: NOAA's
 * `?type=tidepredictions` endpoint somehow does NOT return Fort Pulaski
 * (8670870), one of the most-used harmonic reference stations on the
 * East Coast — possibly because NOAA classifies it primarily under met
 * (it appears in `?type=met`). Without hardcoded coordinates we can't
 * compute a distance to inject it as a candidate. So this map is the
 * truth-source for "stations we want in the dropdown no matter what."
 *
 * The runtime `?type=harmonic` query may also surface these, but we
 * don't rely on it — it's been inconsistent in practice.
 *
 * If you expand outside this coverage area (Pacific, Great Lakes, etc.),
 * add entries here. Don't trust NOAA to surface them.
 */
const KNOWN_HARMONIC_STATIONS: Record<string, { name: string; lat: number; lng: number }> = {
  // Maine
  "8410140": { name: "Eastport", lat: 44.9043, lng: -66.9852 },
  "8418150": { name: "Portland", lat: 43.6567, lng: -70.2467 },
  // Massachusetts / Rhode Island / Connecticut
  "8443970": { name: "Boston", lat: 42.3540, lng: -71.0507 },
  "8447386": { name: "Fall River", lat: 41.7042, lng: -71.1641 },
  "8447930": { name: "Woods Hole", lat: 41.5235, lng: -70.6710 },
  "8449130": { name: "Nantucket Island", lat: 41.2853, lng: -70.0967 },
  "8452660": { name: "Newport", lat: 41.5054, lng: -71.3263 },
  "8454000": { name: "Providence", lat: 41.8071, lng: -71.4012 },
  "8461490": { name: "New London", lat: 41.3617, lng: -72.0901 },
  "8467150": { name: "Bridgeport", lat: 41.1733, lng: -73.1817 },
  // New York
  "8510560": { name: "Montauk", lat: 41.0483, lng: -71.9591 },
  "8516945": { name: "Kings Point", lat: 40.8103, lng: -73.7651 },
  "8518750": { name: "The Battery", lat: 40.7006, lng: -74.0142 },
  "8519483": { name: "Bergen Point West Reach", lat: 40.6367, lng: -74.1417 },
  // New Jersey / Delaware Bay / Pennsylvania
  "8531680": { name: "Sandy Hook", lat: 40.4669, lng: -74.0094 },
  "8534720": { name: "Atlantic City", lat: 39.3550, lng: -74.4181 },
  "8536110": { name: "Cape May", lat: 38.9683, lng: -74.9603 },
  "8545240": { name: "Philadelphia", lat: 39.9333, lng: -75.1417 },
  "8551762": { name: "Delaware City", lat: 39.5824, lng: -75.5887 },
  "8551910": { name: "Reedy Point", lat: 39.5583, lng: -75.5750 },
  "8557380": { name: "Lewes", lat: 38.7822, lng: -75.1190 },
  // Maryland / DC
  "8570283": { name: "Ocean City Inlet", lat: 38.3286, lng: -75.0917 },
  "8574680": { name: "Baltimore", lat: 39.2667, lng: -76.5783 },
  "8575512": { name: "Annapolis", lat: 38.9833, lng: -76.4814 },
  "8577330": { name: "Solomons Island", lat: 38.3170, lng: -76.4514 },
  "8594900": { name: "Washington", lat: 38.8728, lng: -77.0217 },
  // Virginia
  "8632200": { name: "Kiptopeke", lat: 37.1650, lng: -75.9883 },
  "8635750": { name: "Wachapreague", lat: 37.6083, lng: -75.6867 },
  "8637689": { name: "Yorktown USCG Training Center", lat: 37.2267, lng: -76.4790 },
  "8638610": { name: "Sewells Point", lat: 36.9467, lng: -76.3300 },
  "8638901": { name: "CBBT, Chesapeake Channel", lat: 36.9667, lng: -76.1133 },
  // North Carolina
  "8651370": { name: "Duck", lat: 36.1833, lng: -75.7467 },
  "8652587": { name: "Oregon Inlet Marina", lat: 35.7950, lng: -75.5483 },
  "8654467": { name: "USCG Station Hatteras", lat: 35.2086, lng: -75.7042 },
  "8656483": { name: "Beaufort, NC", lat: 34.7200, lng: -76.6700 },
  "8658120": { name: "Wilmington", lat: 34.2275, lng: -77.9536 },
  "8658163": { name: "Wrightsville Beach", lat: 34.2133, lng: -77.7867 },
  // South Carolina
  "8661070": { name: "Springmaid Pier", lat: 33.6550, lng: -78.9183 },
  "8665530": { name: "Charleston, Cooper River Entrance", lat: 32.7800, lng: -79.9233 },
  // Georgia
  "8670870": { name: "Fort Pulaski", lat: 32.0367, lng: -80.9019 }, // the one Thunderbolt paddlers want
  // Florida (Atlantic)
  "8720030": { name: "Fernandina Beach", lat: 30.6708, lng: -81.4650 },
  "8720218": { name: "Mayport (Bar Pilots Dock)", lat: 30.3950, lng: -81.4317 },
  "8721604": { name: "Trident Pier, Port Canaveral", lat: 28.4156, lng: -80.5928 },
  "8722670": { name: "Lake Worth Pier, Atlantic Ocean", lat: 26.6128, lng: -80.0339 },
  "8723214": { name: "Virginia Key, Biscayne Bay", lat: 25.7317, lng: -80.1617 },
  "8724580": { name: "Key West", lat: 24.5550, lng: -81.8083 },
  // Florida (Gulf)
  "8725110": { name: "Naples, Gulf of Mexico", lat: 26.1317, lng: -81.8083 },
  "8726430": { name: "St. Petersburg, Tampa Bay", lat: 27.7600, lng: -82.6263 },
  "8728690": { name: "Apalachicola", lat: 29.7267, lng: -84.9817 },
  "8729108": { name: "Panama City", lat: 30.1517, lng: -85.6667 },
  "8729840": { name: "Pensacola", lat: 30.4044, lng: -87.2117 },
  // Alabama / Mississippi / Louisiana / Texas
  "8735180": { name: "Dauphin Island", lat: 30.2500, lng: -88.0750 },
  "8741533": { name: "Pascagoula NOAA Lab", lat: 30.3675, lng: -88.5631 },
  "8747437": { name: "Bay Waveland Yacht Club", lat: 30.3261, lng: -89.3258 },
  "8761305": { name: "Shell Beach, Lake Borgne", lat: 29.8683, lng: -89.6733 },
  "8767816": { name: "Lake Charles", lat: 30.2233, lng: -93.2217 },
  "8770475": { name: "Port Arthur", lat: 29.8667, lng: -93.9300 },
  "8771013": { name: "Eagle Point, Galveston Bay", lat: 29.4783, lng: -94.9483 },
  "8779770": { name: "Port Isabel, Laguna Madre", lat: 26.0617, lng: -97.2200 },
};

/** Fetch NOAA's authoritative list of stations with harmonic
 *  constituents — these are the stations that publish 6-min predictions.
 *  We try `?type=harmonic` first; if NOAA renames the type code at some
 *  point we fall back to a couple of historical variants before giving
 *  up. An empty set is fine because KNOWN_HARMONIC_STATIONS picks up
 *  the slack for the regions we actually serve. */
async function fetchHarmonicStationIds(): Promise<Set<string>> {
  const typeVariants = ["harmonic", "harcon", "harmonicconstituents"];
  for (const t of typeVariants) {
    try {
      const url = `https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=${t}`;
      const res = await fetch(url, { next: { revalidate: 604800 } });
      if (!res.ok) continue;
      const data = await res.json() as { stations?: Array<{ id?: string }> };
      if (Array.isArray(data.stations) && data.stations.length > 0) {
        const ids = new Set<string>();
        for (const s of data.stations) {
          if (s.id) ids.add(String(s.id));
        }
        return ids;
      }
    } catch {
      // Try next variant.
    }
  }
  return new Set();
}

async function resolveAllTideStations(lat: number, lon: number): Promise<TideCandidate[]> {
  // Parallel: full station list + the authoritative harmonic set.
  const baseUrl = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json";
  const [predRes, harmonicIds] = await Promise.all([
    fetch(`${baseUrl}?type=tidepredictions`, { next: { revalidate: 604800 } }),
    fetchHarmonicStationIds(),
  ]);

  // Collect candidates into a map keyed by station ID so we can dedupe
  // and inject missing harmonic stations at the end.
  const byId = new Map<string, TideCandidate>();

  if (predRes.ok) {
    const data = await predRes.json() as {
      stations?: Array<{
        id?: string;
        name?: string;
        lat?: number;
        lng?: number;
        tidetype?: string;
        tideType?: string;
        tidalconstdate?: string;
        type?: string;
      }>;
    };

    for (const s of data.stations ?? []) {
      // Defensive parsing: NOAA usually returns numbers but I've seen
      // string-typed lat/lng in some endpoints, so coerce.
      const rawLat = typeof s.lat === "string" ? parseFloat(s.lat) : s.lat;
      const rawLng = typeof s.lng === "string" ? parseFloat(s.lng) : s.lng;
      if (!s.id || !s.name) continue;
      if (typeof rawLat !== "number" || typeof rawLng !== "number") continue;
      if (Number.isNaN(rawLat) || Number.isNaN(rawLng)) continue;
      const idStr = String(s.id);
      // Multiple harmonic signals — any one triggers harmonic. The
      // runtime endpoint is authoritative; the hardcoded record is a
      // backstop; per-station fields are a defensive third layer.
      const isHarmonic =
        harmonicIds.has(idStr) ||
        idStr in KNOWN_HARMONIC_STATIONS ||
        isHarmonicLike(s.tidetype) ||
        isHarmonicLike(s.tideType) ||
        isHarmonicLike(s.type) ||
        !!s.tidalconstdate;
      byId.set(idStr, {
        stationId: idStr,
        stationName: String(s.name),
        distanceMi: haversineMi(lat, lon, rawLat, rawLng),
        isHarmonic,
      });
    }
  }

  // Inject any KNOWN_HARMONIC_STATIONS that NOAA didn't return. Acts
  // as a backstop when NOAA's `?type=tidepredictions` omits a known
  // reference station — rare, but observed during testing. With the
  // coordinates baked in we can compute distance and surface it.
  for (const [id, meta] of Object.entries(KNOWN_HARMONIC_STATIONS)) {
    if (byId.has(id)) continue;
    byId.set(id, {
      stationId: id,
      stationName: meta.name,
      distanceMi: haversineMi(lat, lon, meta.lat, meta.lng),
      isHarmonic: true,
    });
  }

  return Array.from(byId.values()).sort((a, b) => a.distanceMi - b.distanceMi);
}

/** NOAA uses several string values across endpoints to indicate
 *  harmonic-ness: "Harmonic", "R" (Reference), "H", "reference". Treat
 *  any of them as a match. */
function isHarmonicLike(field: string | undefined): boolean {
  if (!field) return false;
  const v = field.toLowerCase();
  return v === "harmonic" || v === "r" || v === "h" || v === "reference";
}

// ─── NOAA CO-OPS met (wind) station resolution ───────────────────────────

interface CoopsMetCandidate {
  stationId: string;
  stationName: string;
  distanceMi: number;
}

/** Pulls CO-OPS stations that report meteorological data (wind, air temp,
 *  pressure). Crucially this filters out tide-only stations like 8670681
 *  that have predictions but no wind sensor — the exact bug that bit when
 *  the wind chain was implicitly derived from `tide_station_id`. */
async function resolveAllCoopsMet(lat: number, lon: number): Promise<CoopsMetCandidate[]> {
  const url = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=met";
  const res = await fetch(url, { next: { revalidate: 604800 } });
  if (!res.ok) return [];
  const data = await res.json() as {
    stations?: Array<{
      id?: string;
      name?: string;
      lat?: number;
      lng?: number;
    }>;
  };
  return (data.stations ?? [])
    .filter((s) => s.id && s.name && typeof s.lat === "number" && typeof s.lng === "number")
    .map((s): CoopsMetCandidate => ({
      stationId: s.id!,
      stationName: s.name!,
      distanceMi: haversineMi(lat, lon, s.lat!, s.lng!),
    }))
    .sort((a, b) => a.distanceMi - b.distanceMi);
}

// ─── NDBC buoy resolution ────────────────────────────────────────────────

async function resolveAllBuoys(lat: number, lon: number): Promise<BuoyCandidate[]> {
  // NDBC's pipe-delimited active stations table — small (~80KB).
  const url = "https://www.ndbc.noaa.gov/data/stations/station_table.txt";
  const res = await fetch(url, { next: { revalidate: 604800 } });
  if (!res.ok) return [];
  const text = await res.text();

  const candidates: BuoyCandidate[] = [];
  // Columns: StationID|Owner|TType|Hull|Name|Payload|Location|TimeZone|Forecast|Note
  // The Location field looks like "32.501 N 80.902 W (32°30'4" N 80°54'7" W)".
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || line.startsWith("StationID")) continue;
    const cols = line.split("|");
    if (cols.length < 7) continue;
    const id = cols[0]?.trim();
    const name = cols[4]?.trim();
    const location = cols[6]?.trim();
    if (!id || !location) continue;
    const coords = parseNdbcLocation(location);
    if (!coords) continue;
    candidates.push({
      buoyId: id,
      name: name || id,
      distanceMi: haversineMi(lat, lon, coords.lat, coords.lon),
    });
  }
  return candidates.sort((a, b) => a.distanceMi - b.distanceMi);
}

function parseNdbcLocation(loc: string): { lat: number; lon: number } | null {
  const m = loc.match(/^\s*(-?\d+(?:\.\d+)?)\s*([NS])\s+(-?\d+(?:\.\d+)?)\s*([EW])/);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2] === "S") lat = -lat;
  if (m[4] === "W") lon = -lon;
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return { lat, lon };
}

// ─── Wind liveness probe ──────────────────────────────────────────────────
//
// At location-creation time we hit each top-N candidate to find out
// whether it's actually reporting fresh data right now. The picker
// ranks live sources ahead of stale/offline ones so the default works
// without trial-and-error.
//
// Freshness thresholds match lib/wind-resolver.ts (so a candidate
// marked "live" here is one that resolveWind() will accept at render
// time): 60 min for CO-OPS (6-min cadence), 120 min for NDBC (which
// can sample every 30-60 min, especially nearshore moored buoys).

/** Per-source freshness threshold in minutes. */
const COOPS_FRESH_MIN = 60;
const NDBC_FRESH_MIN = 120;
/** "Stale" cutoff — past this we treat the station as effectively offline. */
const STALE_MAX_MIN = 24 * 60;
/** Per-probe network timeout. Keeps the resolver bounded even if a
 *  station's API is hanging. The candidate just gets marked "offline"
 *  in that case — we never throw. */
const PROBE_TIMEOUT_MS = 4000;

async function probeWindCandidates(top: WindCandidate[]): Promise<WindCandidate[]> {
  return Promise.all(top.map(probeOne));
}

async function probeOne(c: WindCandidate): Promise<WindCandidate> {
  try {
    const probe = c.kind === "coops" ? probeCoops(c.id) : probeNdbc(c.id);
    const result = await withTimeout(probe, PROBE_TIMEOUT_MS);
    if (!result) return { ...c, liveness: "offline" };
    const freshMin = c.kind === "coops" ? COOPS_FRESH_MIN : NDBC_FRESH_MIN;
    const ageMin = result.ageMin;
    if (result.sensorStuck) return { ...c, liveness: "offline", ageMin };
    if (ageMin <= freshMin) return { ...c, liveness: "live", ageMin };
    if (ageMin <= STALE_MAX_MIN) return { ...c, liveness: "stale", ageMin };
    return { ...c, liveness: "offline", ageMin };
  } catch {
    return { ...c, liveness: "offline" };
  }
}

interface ProbeResult { ageMin: number; sensorStuck: boolean }

/** CO-OPS wind probe — fetch the last 1 hour's samples (cheap, ~0-10
 *  rows), look at the most recent. */
async function probeCoops(stationId: string): Promise<ProbeResult | null> {
  const url = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?" + new URLSearchParams({
    product: "wind", station: stationId, range: "1",
    units: "english", time_zone: "lst_ldt", format: "json", application: "Tidevisor-probe",
  }).toString();
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  const json = await res.json() as {
    data?: { t: string; s: string; g: string; d: string }[];
    error?: { message: string };
  };
  if (json.error || !json.data?.length) return null;
  const last = json.data[json.data.length - 1];
  const ts = coopsTimeToISO(last.t);
  const age = (Date.now() - Date.parse(ts)) / 60000;
  const speed = Number(last.s);
  const gust = last.g === "" ? 0 : Number(last.g);
  return {
    ageMin: Math.max(0, age),
    sensorStuck: speed === 0 && gust > 0,
  };
}

/** NDBC wind probe — fetch realtime2 text, take the top row. */
async function probeNdbc(buoyId: string): Promise<ProbeResult | null> {
  const url = `https://www.ndbc.noaa.gov/data/realtime2/${buoyId}.txt`;
  const res = await fetch(url, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  const text = await res.text();
  const lines = text.split("\n").filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) return null;
  const cols = lines[0].trim().split(/\s+/);
  // YY MM DD hh mm WDIR WSPD GST ...
  if (cols.length < 8) return null;
  const y = Number(cols[0]), mo = Number(cols[1]) - 1, d = Number(cols[2]);
  const hh = Number(cols[3]), mm = Number(cols[4]);
  if ([y, mo, d, hh, mm].some((n) => Number.isNaN(n))) return null;
  const ts = Date.UTC(y, mo, d, hh, mm);
  const age = (Date.now() - ts) / 60000;
  // NDBC publishes "MM" for missing.
  if (cols[6] === "MM" || cols[5] === "MM") return { ageMin: age, sensorStuck: true };
  const speedMs = Number(cols[6]);
  const gustMs = cols[7] === "MM" ? 0 : Number(cols[7]);
  if (Number.isNaN(speedMs)) return null;
  return {
    ageMin: Math.max(0, age),
    sensorStuck: speedMs === 0 && gustMs > 0,
  };
}

/** Convert CO-OPS "yyyy-MM-dd HH:mm" Eastern-local string to an ISO
 *  string with the correct DST offset. Duplicated here (small) to keep
 *  this file's import surface tight; the canonical copy lives in
 *  lib/noaa-coops.ts. */
function coopsTimeToISO(t: string): string {
  const dateStr = t.slice(0, 10);
  const [y, m, d] = dateStr.split("-").map(Number);
  let isDst = false;
  if (m >= 3 && m <= 11) {
    if (m > 3 && m < 11) isDst = true;
    else {
      const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
      const firstSunday = 1 + ((7 - firstOfMonth.getUTCDay()) % 7);
      if (m === 3) isDst = d >= firstSunday + 7;
      else if (m === 11) isDst = d < firstSunday;
    }
  }
  const offset = isDst ? "-04:00" : "-05:00";
  return `${t.replace(" ", "T")}:00${offset}`;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    p.then((v) => { clearTimeout(t); resolve(v); })
     .catch(() => { clearTimeout(t); resolve(null); });
  });
}

// ─── Distance helper ──────────────────────────────────────────────────────

function haversineMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.7613;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
