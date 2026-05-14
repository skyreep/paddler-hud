// Open-Meteo — free, no-key forecast API.
//   https://open-meteo.com/en/docs
//   https://open-meteo.com/en/docs/marine-weather-api
//
// We use Open-Meteo for two pieces NWS+NDBC don't reliably cover for the
// Lowcountry:
//   1. UV index — NWS gridpoint forecast doesn't always populate uvIndex
//      for our local forecast offices. Open-Meteo's UV is from CAMS and
//      is available everywhere.
//   2. Marine wave height / period / direction / SST — coastal NDBC buoys
//      frequently lack wave instruments or go offline. Open-Meteo Marine
//      is the modelled WaveWatch III + global ocean model, gridded
//      everywhere with consistent fields.
//
// Open-Meteo has no rate limit for non-commercial use and requires no key.

import type { BuoyResponse } from "./types";

const WX_BASE = "https://api.open-meteo.com/v1/forecast";
const MARINE_BASE = "https://marine-api.open-meteo.com/v1/marine";

// ---------- UV ----------

interface UvResponse {
  hourly?: {
    time?: string[];
    uv_index?: (number | null)[];
  };
}

/** Get the current UV index for a lat/lon. Returns null if Open-Meteo declines. */
export async function fetchUvIndex(lat: number, lon: number): Promise<number | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: "uv_index",
    forecast_days: "1",
    timezone: "auto",
  });
  try {
    const res = await fetch(`${WX_BASE}?${params}`, { next: { revalidate: 1800 } });
    if (!res.ok) return null;
    const json = (await res.json()) as UvResponse;
    const times = json.hourly?.time ?? [];
    const uvs = json.hourly?.uv_index ?? [];
    if (!times.length) return null;
    // Find the row whose ISO hour is closest to "now" (local time of point).
    const now = Date.now();
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < times.length; i++) {
      const t = Date.parse(times[i]);
      const d = Math.abs(t - now);
      if (d < bestDiff) { bestDiff = d; bestIdx = i; }
    }
    const v = uvs[bestIdx];
    if (v == null) return null;
    return +v.toFixed(1);
  } catch {
    return null;
  }
}

// ---------- Marine ----------

interface MarineResponse {
  hourly?: {
    time?: string[];
    wave_height?: (number | null)[];           // meters
    wave_period?: (number | null)[];           // seconds
    wave_direction?: (number | null)[];        // degrees
    swell_wave_height?: (number | null)[];
    swell_wave_period?: (number | null)[];
    swell_wave_direction?: (number | null)[];
    wind_wave_height?: (number | null)[];
    sea_surface_temperature?: (number | null)[]; // °C
  };
}

function mToFt(m: number) { return m * 3.28084; }
function cToF(c: number)  { return c * 9 / 5 + 32; }

/** Modelled marine conditions for a lat/lon. Always returns a BuoyResponse
 *  shape — keeps the consumer (MarineTile) untouched. Falls back to nulls. */
export async function fetchMarine(lat: number, lon: number, label = "Open-Meteo"): Promise<BuoyResponse> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: [
      "wave_height", "wave_period", "wave_direction",
      "swell_wave_height", "swell_wave_period", "swell_wave_direction",
      "wind_wave_height", "sea_surface_temperature",
    ].join(","),
    forecast_days: "1",
    timezone: "auto",
  });
  const url = `${MARINE_BASE}?${params}`;
  const empty: BuoyResponse = {
    buoyId: label,
    buoyName: "Open-Meteo Marine model",
    waveHeightFt: null, dominantPeriodSec: null, meanWaveDirDeg: null,
    seaTempF: null, windSpeedKt: null, windDirDeg: null, pressureInHg: null,
    observedAt: null, source: "Open-Meteo",
    fetchedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, { next: { revalidate: 1800 } });
    if (!res.ok) return empty;
    const json = (await res.json()) as MarineResponse;
    const h = json.hourly;
    if (!h?.time?.length) return empty;

    // Pick the row nearest "now".
    const now = Date.now();
    let bestIdx = 0, bestDiff = Infinity;
    for (let i = 0; i < h.time.length; i++) {
      const t = Date.parse(h.time[i]);
      const d = Math.abs(t - now);
      if (d < bestDiff) { bestDiff = d; bestIdx = i; }
    }

    const waveM    = h.wave_height?.[bestIdx];
    const periodS  = h.wave_period?.[bestIdx];
    const waveDir  = h.wave_direction?.[bestIdx];
    const sstC     = h.sea_surface_temperature?.[bestIdx];

    return {
      buoyId: label,
      buoyName: "Open-Meteo Marine model",
      waveHeightFt:      waveM   != null ? +mToFt(waveM).toFixed(1) : null,
      dominantPeriodSec: periodS != null ? Math.round(periodS) : null,
      meanWaveDirDeg:    waveDir != null ? Math.round(waveDir) : null,
      seaTempF:          sstC    != null ? +cToF(sstC).toFixed(1) : null,
      windSpeedKt: null, windDirDeg: null, pressureInHg: null,
      observedAt: h.time[bestIdx],
      source: "Open-Meteo",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return empty;
  }
}
