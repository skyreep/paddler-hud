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
