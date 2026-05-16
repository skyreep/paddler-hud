// Resolve the BEST AVAILABLE real-time wind for a location by walking a
// priority chain of data sources. Goal: never show "0 mph" on a coastal
// paddling app unless conditions are genuinely calm, and always surface the
// source so the user knows where the reading came from.
//
// Priority order (highest accuracy / freshest first):
//   1. NOAA CO-OPS wind product
//      - 6-minute sample cadence (most current)
//      - Coastal-mounted sensors on the water (what paddlers actually care about)
//      - Each location specifies an ordered fallback list of stations so we
//        get local-when-possible and Fort Pulaski as a regional safety net
//   2. METAR observation (NWS station)
//      - 5–15 minute updates from airport instruments
//      - Land-mounted but very close (KHXD on Hilton Head, KARW at Beaufort)
//      - Requires both speed > 0 and timestamp < 60 min old (rejects
//        iced-anemometer / sensor-stuck readings)
//   3. NWS forecast (already merged into WeatherNow)
//      - Hourly model output, always available
//      - parseWindMph in lib/nws.ts maps "Calm" → ~1 mph and
//        "Light and variable" → ~4 mph so it's never 0

import type { WeatherNow, WeatherObservation, WindResponse } from "./types";
import { beaufort, cardinal } from "./beaufort";

export interface ResolvedWind {
  speedKt: number;
  speedMph: number;
  gustKt?: number;
  dirDeg: number;
  dirCardinal: string;
  beaufortForce: number;
  beaufortName: string;
  source: string;       // e.g. "Fort Pulaski · NOAA CO-OPS · 4 min ago"
  ageMin: number;
}

const ageMin = (iso: string) => Math.max(0, (Date.now() - Date.parse(iso)) / 60000);
const ktToMph = (kt: number) => +(kt * 1.15078).toFixed(1);

function build(
  speedKt: number,
  gustKt: number | null | undefined,
  dirDeg: number,
  sourceShort: string,
  age: number,
): ResolvedWind {
  const bf = beaufort(speedKt);
  return {
    speedKt: +speedKt.toFixed(1),
    speedMph: ktToMph(speedKt),
    gustKt: gustKt != null && gustKt > 0 ? +gustKt.toFixed(1) : undefined,
    dirDeg,
    dirCardinal: cardinal(dirDeg),
    beaufortForce: bf.force,
    beaufortName: bf.name,
    source: `${sourceShort} · ${Math.round(age)} min ago`,
    ageMin: Math.round(age),
  };
}

export function resolveWind(
  weatherNow: WeatherNow,
  observation: WeatherObservation | null,
  windCoOps: WindResponse | null,
): ResolvedWind {

  // Priority 1: NOAA CO-OPS wind product — most accurate water-based source.
  // Accept calm (0 kt) readings too, but only if very fresh (< 15 min) so a
  // stuck sensor doesn't sneak through.
  if (windCoOps?.latest && windCoOps.observations.length > 0) {
    const age = ageMin(windCoOps.latest.time);
    const speed = windCoOps.latest.speedKt;
    const gust = windCoOps.latest.gustKt ?? 0;
    const fresh = age < 30;
    // Suspect: speed exactly 0 while gust > 0 → sensor stuck
    const suspect = speed === 0 && gust > 0;
    // Also suspect: speed 0 AND age > 15 min (stale calm reading)
    const calmStale = speed === 0 && age > 15;
    if (fresh && !suspect && !calmStale) {
      return build(speed, windCoOps.latest.gustKt, windCoOps.latest.dirDeg,
                   `${windCoOps.stationName} · NOAA CO-OPS`, age);
    }
  }

  // Priority 2: METAR observation. Require strictly positive speed and a
  // sample no older than 60 minutes — coastal-area METARs reporting 0 are
  // almost always sensor issues, not real calm.
  if (observation?.windSpeedKt != null && observation.windSpeedKt > 0) {
    const age = ageMin(observation.timestamp);
    if (age < 60 && observation.windDirDeg != null) {
      return build(observation.windSpeedKt, observation.windGustKt,
                   observation.windDirDeg,
                   `${observation.stationId} · METAR`, age);
    }
  }

  // Priority 3: NWS forecast — universal fallback. parseWindMph has already
  // mapped "Calm" / "Light and variable" / "Light wind" phrasings to non-zero
  // values, so this never returns 0.
  return {
    speedKt: weatherNow.windSpeedKt,
    speedMph: weatherNow.windSpeedMph,
    gustKt: weatherNow.windGustKt,
    dirDeg: weatherNow.windDirDeg,
    dirCardinal: weatherNow.windDirCardinal,
    beaufortForce: weatherNow.beaufortForce,
    beaufortName: weatherNow.beaufortName,
    source: "NWS forecast",
    ageMin: 0,
  };
}
