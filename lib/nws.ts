// NWS (api.weather.gov) — forecasts and active alerts.
// Requires a User-Agent header (set NWS_USER_AGENT env var).

import type {
  Alert, AlertsResponse, WeatherDay, WeatherHour, WeatherNow, WeatherResponse,
} from "./types";
import { beaufort, cardinal, mphToKt } from "./beaufort";
import { fetchUvIndex } from "./open-meteo";

const UA = () => process.env.NWS_USER_AGENT ?? "PaddlerHUD/0.1 (contact@example.com)";

async function nws<T = unknown>(url: string, revalidate = 900): Promise<T> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA(), Accept: "application/geo+json" },
    next: { revalidate },
  });
  if (!res.ok) throw new Error(`NWS ${url} → ${res.status}`);
  return res.json() as Promise<T>;
}

interface PointResp {
  properties: {
    cwa?: string;          // forecast office code, e.g. "CHS"
    gridId?: string;
    gridX?: number;
    gridY?: number;
    forecast: string;
    forecastHourly: string;
    forecastGridData: string;
    forecastZone: string;
    forecastOffice?: string;  // URL ending with /offices/{cwa}
    relativeLocation?: { properties?: { city?: string; state?: string } };
  };
}
// Forecast office code → human name. Covers the Lowcountry + nearby.
const OFFICE_NAMES: Record<string, string> = {
  CHS: "Charleston, SC",
  JAX: "Jacksonville, FL",
  MLB: "Melbourne, FL",
  ILM: "Wilmington, NC",
  MHX: "Newport/Morehead City, NC",
  GSP: "Greenville-Spartanburg, SC",
  CAE: "Columbia, SC",
  FFC: "Atlanta/Peachtree City, GA",
  TAE: "Tallahassee, FL",
};
interface ForecastResp {
  properties: { periods: ForecastPeriod[] };
}
interface GridValue { validTime: string; value: number | null }
interface GridSeries { values: GridValue[] }
interface GridpointResp {
  properties: {
    uvIndex?: GridSeries;
    quantitativePrecipitation?: GridSeries;
    skyCover?: GridSeries;
    pressure?: GridSeries;
    visibility?: GridSeries;
  };
}

// Pull a gridpoint value valid at a given ISO time. validTime looks like "2026-05-13T18:00:00+00:00/PT3H"
function gridValueAt(series: GridSeries | undefined, iso: string): number | null {
  if (!series?.values?.length) return null;
  const target = Date.parse(iso);
  for (const v of series.values) {
    const [start, dur] = v.validTime.split("/");
    const startMs = Date.parse(start);
    const hours = parseInt(dur?.match(/PT(\d+)H/)?.[1] ?? "1", 10);
    const endMs = startMs + hours * 3600_000;
    if (target >= startMs && target < endMs) return v.value;
  }
  return null;
}
// Sum gridpoint values across a window (e.g. 24h precip total).
function gridSumWindow(series: GridSeries | undefined, fromIso: string, toIso: string): number | null {
  if (!series?.values?.length) return null;
  const from = Date.parse(fromIso), to = Date.parse(toIso);
  let total = 0; let touched = false;
  for (const v of series.values) {
    const [start, dur] = v.validTime.split("/");
    const startMs = Date.parse(start);
    const hours = parseInt(dur?.match(/PT(\d+)H/)?.[1] ?? "1", 10);
    const endMs = startMs + hours * 3600_000;
    if (endMs <= from || startMs >= to) continue;
    if (v.value != null) { total += v.value; touched = true; }
  }
  return touched ? total : null;
}
// NWS reports precip in mm. 1 in = 25.4 mm.
const mmToIn = (mm: number | null) => (mm == null ? null : +(mm / 25.4).toFixed(2));
interface ForecastPeriod {
  number: number;
  startTime: string;
  endTime: string;
  isDaytime: boolean;
  temperature: number;
  windSpeed: string;        // "10 to 15 mph"
  windDirection: string;    // "NW"
  shortForecast: string;
  detailedForecast?: string;
  icon: string;
  probabilityOfPrecipitation?: { value: number | null };
  dewpoint?: { value: number | null };
  relativeHumidity?: { value: number | null };
}

function parseWindMph(s?: string): { min: number; max: number; mid: number } {
  if (!s) return { min: 0, max: 0, mid: 0 };
  const m = s.match(/(\d+)(?:\s+to\s+(\d+))?/);
  if (!m) return { min: 0, max: 0, mid: 0 };
  const min = Number(m[1]); const max = m[2] ? Number(m[2]) : min;
  return { min, max, mid: (min + max) / 2 };
}
function dirToDeg(card: string): number {
  const map: Record<string, number> = {
    N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
    S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5,
  };
  return map[card] ?? 0;
}
function cToF(c: number | null | undefined) { return c == null ? undefined : (c * 9/5) + 32; }

/** Get a normalized weather payload for a lat/lon: now, hourly 24h, daily 7d. */
export async function fetchWeather(lat: number, lon: number): Promise<WeatherResponse> {
  const point = await nws<PointResp>(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 86400);
  const [forecast, hourly, gridRaw, openMeteoUv] = await Promise.all([
    nws<ForecastResp>(point.properties.forecast, 1800),
    nws<ForecastResp>(point.properties.forecastHourly, 900),
    // Gridpoint endpoint carries quantitative precip, sky cover, pressure, visibility.
    // (UV is NOT consistently populated by all NWS forecast offices — we use
    //  Open-Meteo for UV instead; see below.)
    nws<GridpointResp>(point.properties.forecastGridData, 1800).catch(() => null),
    // UV index from Open-Meteo (CAMS) — globally available, no key.
    fetchUvIndex(lat, lon),
  ]);

  const h = hourly.properties.periods[0];
  const windMph = parseWindMph(h?.windSpeed);
  const windKt = mphToKt(windMph.mid);
  const dirDeg = dirToDeg(h?.windDirection ?? "N");
  const bf = beaufort(windKt);

  const nowIso = new Date().toISOString();
  const sixHrIso = new Date(Date.now() + 6 * 3600_000).toISOString();
  const grid = gridRaw?.properties;

  // Prefer Open-Meteo UV (consistently populated); fall back to NWS gridpoint if present.
  const uvNow         = openMeteoUv ?? (grid?.uvIndex ? gridValueAt(grid.uvIndex, nowIso) : null);
  const precipNext6mm = grid?.quantitativePrecipitation
    ? gridSumWindow(grid.quantitativePrecipitation, nowIso, sixHrIso) : null;
  const cloudNow      = grid?.skyCover ? gridValueAt(grid.skyCover, nowIso) : null;
  const pressureNow   = grid?.pressure ? gridValueAt(grid.pressure, nowIso) : null;     // Pa
  const visNow        = grid?.visibility ? gridValueAt(grid.visibility, nowIso) : null; // meters

  const now: WeatherNow = {
    tempF: h?.temperature ?? 0,
    feelsLikeF: h?.temperature ?? 0,
    shortForecast: h?.shortForecast ?? "",
    windSpeedKt: +windKt.toFixed(1),
    windSpeedMph: +windMph.mid.toFixed(1),
    windGustKt: windMph.max ? +mphToKt(windMph.max).toFixed(1) : undefined,
    windDirDeg: dirDeg,
    windDirCardinal: h?.windDirection ?? cardinal(dirDeg),
    beaufortForce: bf.force,
    beaufortName: bf.name,
    humidity: h?.relativeHumidity?.value ?? undefined,
    dewPointF: cToF(h?.dewpoint?.value),
    precipChancePct: h?.probabilityOfPrecipitation?.value ?? undefined,
    precipAmountIn: mmToIn(precipNext6mm) ?? undefined,
    uvIndex: uvNow ?? undefined,
    cloudCoverPct: cloudNow ?? undefined,
    pressureInHg: pressureNow != null ? +(pressureNow * 0.0002953).toFixed(2) : undefined,
    visibilityMi: visNow != null ? +(visNow / 1609.34).toFixed(1) : undefined,
  };

  const hourlyOut: WeatherHour[] = hourly.properties.periods.slice(0, 24).map(p => {
    const w = parseWindMph(p.windSpeed);
    const dir = dirToDeg(p.windDirection ?? "N");
    const hourIso = p.startTime;
    const hourEndIso = p.endTime ?? new Date(Date.parse(p.startTime) + 3600_000).toISOString();
    const qpfMm = grid?.quantitativePrecipitation
      ? gridSumWindow(grid.quantitativePrecipitation, hourIso, hourEndIso) : null;
    return {
      time: p.startTime,
      tempF: p.temperature,
      windKt: +mphToKt(w.mid).toFixed(1),
      windDirDeg: dir,
      windDirCardinal: p.windDirection,
      icon: p.icon,
      shortForecast: p.shortForecast,
      precipChancePct: p.probabilityOfPrecipitation?.value ?? 0,
      precipAmountIn: mmToIn(qpfMm) ?? undefined,
    };
  });

  // Group forecast periods (alternating day/night) into 7 days,
  // taking wind from the DAY period preferentially.
  const dailyMap = new Map<string, WeatherDay>();
  for (const p of forecast.properties.periods) {
    const date = p.startTime.slice(0, 10);
    const dayName = new Date(p.startTime).toLocaleDateString("en-US", { weekday: "short" });
    const wind = parseWindMph(p.windSpeed);
    const windKtVal = +mphToKt(wind.mid).toFixed(0);
    const gustKtVal = wind.max && wind.max !== wind.min ? +mphToKt(wind.max).toFixed(0) : undefined;
    const dirCard = p.windDirection;
    const existing = dailyMap.get(date);
    if (existing) {
      if (p.isDaytime) {
        existing.hiF = Math.max(existing.hiF, p.temperature);
        // Daytime wind/icon is what people want to see for a paddle plan.
        existing.windSpeedKt = windKtVal;
        existing.windGustKt = gustKtVal;
        existing.windDirCardinal = dirCard;
        existing.windDirDeg = dirToDeg(dirCard);
        existing.icon = p.icon;
        existing.shortForecast = p.shortForecast;
      } else {
        existing.loF = Math.min(existing.loF, p.temperature);
      }
      existing.precipChancePct = Math.max(existing.precipChancePct, p.probabilityOfPrecipitation?.value ?? 0);
    } else {
      dailyMap.set(date, {
        date, dayName,
        hiF: p.isDaytime ? p.temperature : 999,
        loF: p.isDaytime ? -999 : p.temperature,
        icon: p.icon,
        shortForecast: p.shortForecast,
        detailedForecast: p.detailedForecast,
        precipChancePct: p.probabilityOfPrecipitation?.value ?? 0,
        windSpeedKt: p.isDaytime ? windKtVal : undefined,
        windGustKt: p.isDaytime ? gustKtVal : undefined,
        windDirDeg: p.isDaytime ? dirToDeg(dirCard) : undefined,
        windDirCardinal: p.isDaytime ? dirCard : undefined,
      });
    }
    // Daytime period's detailed forecast is what you want to see.
    if (p.isDaytime && p.detailedForecast) {
      const d = dailyMap.get(date);
      if (d) d.detailedForecast = p.detailedForecast;
    }
  }
  // Add daily precip accumulation totals from the gridpoint feed.
  for (const [date, d] of dailyMap) {
    const start = `${date}T00:00:00Z`;
    const end   = `${date}T23:59:59Z`;
    const total = grid?.quantitativePrecipitation
      ? gridSumWindow(grid.quantitativePrecipitation, start, end) : null;
    d.precipAmountIn = mmToIn(total) ?? undefined;
  }
  const daily = Array.from(dailyMap.values()).slice(0, 7).map(d => ({
    ...d,
    hiF: d.hiF === 999 ? d.loF : d.hiF,
    loF: d.loF === -999 ? d.hiF : d.loF,
  }));

  const office = (point.properties.cwa ?? point.properties.gridId ?? "—").toUpperCase();
  const attribution = {
    office,
    officeName: OFFICE_NAMES[office],
    gridId: (point.properties.gridId ?? office).toUpperCase(),
    gridX: point.properties.gridX ?? 0,
    gridY: point.properties.gridY ?? 0,
    relativeLocation: point.properties.relativeLocation?.properties?.city
      ? `${point.properties.relativeLocation.properties.city}, ${point.properties.relativeLocation.properties.state ?? ""}`.trim().replace(/,\s*$/, "")
      : undefined,
  };

  return {
    now, hourly: hourlyOut, daily,
    attribution,
    source: "NWS",
    fetchedAt: new Date().toISOString(),
  };
}

interface AlertsResp {
  features: {
    properties: {
      id: string; event: string; severity: Alert["severity"];
      headline: string; description: string;
      effective: string; expires: string;
      areaDesc: string; senderName: string;
    }
  }[];
}

/** Active alerts for a forecast zone + marine zone. */
export async function fetchAlerts(zones: string[]): Promise<AlertsResponse> {
  const zoneStr = zones.filter(Boolean).join(",");
  const url = `https://api.weather.gov/alerts/active?zone=${encodeURIComponent(zoneStr)}`;
  const data = await nws<AlertsResp>(url, 60);
  const alerts: Alert[] = data.features.map(f => ({
    id: f.properties.id,
    event: f.properties.event,
    severity: f.properties.severity,
    headline: f.properties.headline,
    description: f.properties.description,
    effective: f.properties.effective,
    expires: f.properties.expires,
    areaDesc: f.properties.areaDesc,
    senderName: f.properties.senderName,
  }));
  return { alerts, source: "NWS", fetchedAt: new Date().toISOString() };
}
