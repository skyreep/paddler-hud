// EPA AirNow. Requires an API key (free).
// If the key is missing, return a "not available" payload so the UI can hide the tile gracefully.

import type { AirQualityResponse } from "./types";

interface AirNowObservation {
  AQI: number;
  Category: { Name: string };
  ParameterName: string;
}

export async function fetchAirQuality(lat: number, lon: number): Promise<AirQualityResponse> {
  const key = process.env.AIRNOW_API_KEY;
  if (!key) {
    return {
      aqi: null, category: null, dominantPollutant: null,
      source: "EPA AirNow", fetchedAt: new Date().toISOString(), available: false,
    };
  }
  const url = `https://www.airnowapi.org/aq/observation/latLong/current/?format=application/json&latitude=${lat}&longitude=${lon}&distance=25&API_KEY=${key}`;
  const res = await fetch(url, { next: { revalidate: 1800 } });

  // AirNow returns 5xx fairly often when their backend is overloaded
  // (502 Bad Gateway is common). Those are transient and there's
  // nothing we can do about them — degrade silently to "no data"
  // rather than throwing and littering the dev console with noise.
  // 4xx errors stay loud because they signal a real config problem
  // (bad API key, malformed request) we'd want to know about.
  if (res.status >= 500) {
    return {
      aqi: null, category: null, dominantPollutant: null,
      source: "EPA AirNow", fetchedAt: new Date().toISOString(), available: false,
    };
  }
  if (!res.ok) throw new Error(`AirNow → ${res.status}`);
  const obs = (await res.json()) as AirNowObservation[];
  if (!obs.length) {
    return { aqi: null, category: null, dominantPollutant: null,
      source: "EPA AirNow", fetchedAt: new Date().toISOString(), available: true };
  }
  const dom = obs.reduce((a, b) => (a.AQI > b.AQI ? a : b));
  return {
    aqi: dom.AQI,
    category: dom.Category.Name,
    dominantPollutant: dom.ParameterName,
    source: "EPA AirNow",
    fetchedAt: new Date().toISOString(),
    available: true,
  };
}
