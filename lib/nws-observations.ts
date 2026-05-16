// NWS METAR/ASOS observation stations — REAL measured weather, not forecast.
// Stations report every 5–15 min from airport instruments. This is the closest
// thing to ground truth available for the Right Now tile.
//
// Endpoints:
//   /stations/{id}/observations/latest      — most recent sample
//   /stations/{id}/observations?start=…     — history

import type { WeatherObservation } from "./types";

const UA = () => process.env.NWS_USER_AGENT ?? "LoCoWX/0.1 (contact@example.com)";

interface NwsValue { value: number | null; unitCode?: string }
interface ObservationProps {
  timestamp: string;
  textDescription: string | null;
  temperature: NwsValue;
  dewpoint: NwsValue;
  windDirection: NwsValue;
  windSpeed: NwsValue;            // m/s
  windGust: NwsValue;             // m/s
  barometricPressure: NwsValue;   // Pa
  seaLevelPressure: NwsValue;     // Pa
  visibility: NwsValue;           // m
  relativeHumidity: NwsValue;
  windChill: NwsValue;            // C
  heatIndex: NwsValue;            // C
  precipitationLastHour: NwsValue; // mm
}

const cToF   = (c: number | null): number | null => c == null ? null : +(c * 9 / 5 + 32).toFixed(1);
const msToKt = (ms: number | null): number | null => ms == null ? null : +(ms * 1.94384).toFixed(1);
const paToInHg = (pa: number | null): number | null => pa == null ? null : +(pa * 0.0002953).toFixed(2);

function parseObservation(stationId: string, p: ObservationProps): WeatherObservation {
  return {
    stationId,
    timestamp: p.timestamp,
    tempF:        cToF(p.temperature?.value ?? null),
    dewPointF:    cToF(p.dewpoint?.value ?? null),
    humidity:     p.relativeHumidity?.value != null ? Math.round(p.relativeHumidity.value) : null,
    windSpeedKt:  msToKt(p.windSpeed?.value ?? null),
    windSpeedMph: p.windSpeed?.value != null ? +(p.windSpeed.value * 2.23694).toFixed(1) : null,
    windDirDeg:   p.windDirection?.value != null ? Math.round(p.windDirection.value) : null,
    windGustKt:   msToKt(p.windGust?.value ?? null),
    pressureInHg: paToInHg(p.seaLevelPressure?.value ?? p.barometricPressure?.value ?? null),
    visibilityMi: p.visibility?.value != null ? +(p.visibility.value / 1609.34).toFixed(1) : null,
    precipLastHourIn: p.precipitationLastHour?.value != null ? +(p.precipitationLastHour.value / 25.4).toFixed(2) : null,
    textDescription: p.textDescription,
    heatIndexF:   cToF(p.heatIndex?.value ?? null),
    windChillF:   cToF(p.windChill?.value ?? null),
  };
}

/** Latest observation from a METAR station. */
export async function fetchLatestObservation(stationId: string): Promise<WeatherObservation | null> {
  const url = `https://api.weather.gov/stations/${stationId}/observations/latest`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA(), Accept: "application/geo+json" },
      // 60s revalidate — METAR pushes every 5-15 min from the source, but we
      // want refresh-button responsiveness, and NWS handles the upstream poll.
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { properties: ObservationProps };
    return parseObservation(stationId, data.properties);
  } catch {
    return null;
  }
}

/** Recent observations (default 6h history) from a METAR station. */
export async function fetchRecentObservations(stationId: string, hours = 6): Promise<WeatherObservation[]> {
  const start = new Date(Date.now() - hours * 3600_000).toISOString();
  const url = `https://api.weather.gov/stations/${stationId}/observations?start=${encodeURIComponent(start)}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA(), Accept: "application/geo+json" },
      next: { revalidate: 60 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { features: { properties: ObservationProps }[] };
    return data.features
      .map(f => parseObservation(stationId, f.properties))
      .filter(o => o.timestamp)
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  } catch {
    return [];
  }
}
