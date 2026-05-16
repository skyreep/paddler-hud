// National Hurricane Center — Tropical Cyclone & Outlook data.
// Source feeds:
//   https://www.nhc.noaa.gov/CurrentStorms.json   (active systems, ATCF metadata)
//   https://www.nhc.noaa.gov/index-at.xml          (Atlantic RSS, used as fallback)
//   https://www.nhc.noaa.gov/gtwo.xml              (Tropical Weather Outlook RSS)
//
// We're intentionally tolerant: NHC payload shapes change between products and
// the structure is loosely documented. Always wrap consumers in try/catch.

import type { TropicalResponse, TropicalSystem, TropicalDisturbance } from "./types";

const CURRENT_STORMS = "https://www.nhc.noaa.gov/CurrentStorms.json";

// Hurricane season: June 1 — November 30 (NHC standard)
function inAtlanticSeason(d = new Date()): boolean {
  const m = d.getUTCMonth();  // 0-indexed
  return m >= 5 && m <= 10;
}

// Great-circle distance in miles (haversine).
export function distanceMi(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 3958.8;
  const toRad = (n: number) => (n * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Crude classification → category (Saffir-Simpson) parser.
function parseCategory(classification: string): number | null {
  const m = classification.match(/category\s*(\d)/i) ?? classification.match(/cat\s*(\d)/i);
  return m ? Number(m[1]) : null;
}

interface NhcStorm {
  id: string;
  binNumber?: string;
  name: string;
  classification?: string;
  intensity?: string;        // wind in kt
  pressure?: string;
  latitudeNumeric?: number;
  longitudeNumeric?: number;
  movementDir?: number;
  movementSpeed?: number;    // mph
  lastUpdate?: string;
}

interface NhcStormsPayload {
  activeStorms?: NhcStorm[];
}

/** Fetch active tropical systems in the Atlantic, plus a TWO summary. */
export async function fetchTropical(userLat?: number, userLon?: number): Promise<TropicalResponse> {
  const inSeason = inAtlanticSeason();

  // CurrentStorms.json works year-round but is empty out of season.
  let stormsRes: Response;
  try {
    stormsRes = await fetch(CURRENT_STORMS, {
      headers: { "User-Agent": "LoCoWX (contact: hello@example.com)" },
      next: { revalidate: 600 },
    });
  } catch (err) {
    return {
      inSeason,
      activeSystems: [],
      disturbances: [],
      basin: "Atlantic",
      source: "NHC",
      fetchedAt: new Date().toISOString(),
    };
  }

  let payload: NhcStormsPayload = {};
  try { payload = (await stormsRes.json()) as NhcStormsPayload; } catch {}

  const atlantic = (payload.activeStorms ?? []).filter(s =>
    (s.id ?? "").toUpperCase().startsWith("AL") || (s.id ?? "").toUpperCase().startsWith("EP") === false
  );

  const activeSystems: TropicalSystem[] = atlantic
    .filter(s => (s.id ?? "").toUpperCase().startsWith("AL"))
    .map(s => {
      const lat = s.latitudeNumeric ?? null;
      const lon = s.longitudeNumeric ?? null;
      const pos = lat != null && lon != null ? { lat, lon } : null;
      const movement =
        s.movementDir != null && s.movementSpeed != null
          ? `${cardinalFromDeg(s.movementDir)} at ${s.movementSpeed} mph`
          : null;
      const winds = s.intensity ? Math.round(Number(s.intensity) * 1.15078) : null;
      const dist = pos && userLat != null && userLon != null
        ? Math.round(distanceMi(userLat, userLon, pos.lat, pos.lon))
        : undefined;
      return {
        id: s.id,
        name: s.name,
        classification: s.classification ?? "Tropical Cyclone",
        category: parseCategory(s.classification ?? ""),
        maxWindMph: winds,
        minPressureMb: s.pressure ? Number(s.pressure) : null,
        position: pos,
        movement,
        distanceMi: dist,
        // Crude threat heuristic: within 600 mi AND moving toward NW quadrant.
        threatToUser:
          dist != null && dist < 600 &&
          (s.movementDir != null && s.movementDir >= 270 && s.movementDir <= 360),
      };
    });

  // Disturbances — TWO has a JSON-ish endpoint but it's not officially documented.
  // We're returning an empty list here as a placeholder; consumers can render
  // "no disturbances" gracefully. The XML feed lives at /gtwo.xml — production
  // build can parse it server-side.
  const disturbances: TropicalDisturbance[] = [];

  return {
    inSeason,
    activeSystems,
    disturbances,
    basin: "Atlantic",
    source: "NHC",
    fetchedAt: new Date().toISOString(),
  };
}

function cardinalFromDeg(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}
