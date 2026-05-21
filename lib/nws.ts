// NWS (api.weather.gov) — forecasts and active alerts.
// Requires a User-Agent header (set NWS_USER_AGENT env var).

import type {
  Alert, AlertsResponse, WeatherDay, WeatherHour, WeatherNow, WeatherResponse,
} from "./types";
import { beaufort, cardinal, mphToKt } from "./beaufort";
import { fetchAtmospheric } from "./open-meteo";
import { fetchLatestObservation } from "./nws-observations";

const UA = () => process.env.NWS_USER_AGENT ?? "LoCoWX/0.1 (contact@example.com)";

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
  windGust?: string;        // "25 mph" — separate from sustained wind, optional
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
  const lower = s.toLowerCase();
  // NWS uses descriptive phrasing for low wind that has no digits — preserve
  // a reasonable non-zero value so the UI doesn't claim "0 mph" when there's
  // actually a 3-5 mph breeze.
  if (lower.includes("calm")) return { min: 0, max: 2, mid: 1 };
  if (lower.includes("light and variable") || lower.includes("light variable")) {
    return { min: 1, max: 6, mid: 4 };
  }
  if (lower.includes("light")) return { min: 2, max: 8, mid: 5 };
  const m = s.match(/(\d+)(?:\s+to\s+(\d+))?/);
  if (!m) return { min: 0, max: 0, mid: 0 };
  const min = Number(m[1]); const max = m[2] ? Number(m[2]) : min;
  return { min, max, mid: (min + max) / 2 };
}

/** Parse a gust string like "25 mph" or "20 to 30 mph". Returns the peak mph. */
function parseGustMph(s?: string): number {
  if (!s) return 0;
  // Range "20 to 30 mph" — use the higher end. Single "25 mph" — use it.
  const matches = [...s.matchAll(/(\d+)/g)].map(m => Number(m[1]));
  return matches.length ? Math.max(...matches) : 0;
}
function dirToDeg(card: string): number {
  const map: Record<string, number> = {
    N:0, NNE:22.5, NE:45, ENE:67.5, E:90, ESE:112.5, SE:135, SSE:157.5,
    S:180, SSW:202.5, SW:225, WSW:247.5, W:270, WNW:292.5, NW:315, NNW:337.5,
  };
  return map[card] ?? 0;
}
function cToF(c: number | null | undefined) { return c == null ? undefined : (c * 9/5) + 32; }

/** Get a normalized weather payload for a lat/lon: now, hourly 24h, daily 7d.
 *  When `observationStationId` is provided (a METAR/ASOS station like "KSAV"),
 *  real-time observed values from that instrument take precedence over the
 *  forecast in the `now` block. */
export async function fetchWeather(
  lat: number,
  lon: number,
  observationStationId?: string,
): Promise<WeatherResponse> {
  const point = await nws<PointResp>(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, 86400);
  const [forecast, hourly, gridRaw, atmos, observation] = await Promise.all([
    nws<ForecastResp>(point.properties.forecast, 1800),
    nws<ForecastResp>(point.properties.forecastHourly, 900),
    nws<GridpointResp>(point.properties.forecastGridData, 1800).catch(() => null),
    fetchAtmospheric(lat, lon),
    // Real-time observed conditions from the nearest METAR station — what an
    // instrument actually measured 5-15 minutes ago, not what a model predicts.
    observationStationId ? fetchLatestObservation(observationStationId) : Promise.resolve(null),
  ]);

  const h = hourly.properties.periods[0];
  const windMph = parseWindMph(h?.windSpeed);
  const windKt = mphToKt(windMph.mid);
  const dirDeg = dirToDeg(h?.windDirection ?? "N");
  const bf = beaufort(windKt);

  const nowIso = new Date().toISOString();
  const sixHrIso = new Date(Date.now() + 6 * 3600_000).toISOString();
  const grid = gridRaw?.properties;

  // Open-Meteo only for UV / visibility / pressure. The previous NWS-gridpoint
  // fallback caused source-mixing between deployments (one would get
  // Open-Meteo, the other would silently fall back to NWS gridpoint at the
  // hour boundary or on a transient null), producing the "Vercel says X but
  // localhost says Y" discrepancy. Using one source keeps them in sync.
  const uvNow         = atmos.uvIndex;
  const pressureInHg  = atmos.pressureInHg;
  const visibilityMi  = atmos.visibilityMi;
  const precipNext6mm = grid?.quantitativePrecipitation
    ? gridSumWindow(grid.quantitativePrecipitation, nowIso, sixHrIso) : null;
  const cloudNow      = grid?.skyCover ? gridValueAt(grid.skyCover, nowIso) : null;

  // Real gust comes from NWS's separate windGust field (only populated when
  // a significant gust is forecast). Don't fall back to the sustained-wind
  // upper bound — that's a sustained range, not a peak gust.
  const gustNowMph = parseGustMph(h?.windGust);
  // Forecast values first (used as fallbacks if the METAR station's value is null).
  const forecastNow: WeatherNow = {
    tempF: h?.temperature ?? 0,
    feelsLikeF: h?.temperature ?? 0,
    shortForecast: h?.shortForecast ?? "",
    windSpeedKt: +windKt.toFixed(1),
    windSpeedMph: +windMph.mid.toFixed(1),
    windGustKt: gustNowMph > 0 ? +mphToKt(gustNowMph).toFixed(1) : undefined,
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
    pressureInHg: pressureInHg ?? undefined,
    visibilityMi: visibilityMi ?? undefined,
  };

  // Merge in real-time METAR observations — they win for every field they
  // populate, because actual measurements beat model predictions for "now."
  // BUT: trust-check wind specifically. METAR stations periodically report
  // 0 mph when:
  //   - the sensor is iced/stuck
  //   - the cup anemometer is below threshold
  //   - the latest sample is stale (station offline for hours)
  // For a coastal paddling app, a 0-mph reading is suspect — if the forecast
  // model says there's wind, prefer the forecast.
  let now: WeatherNow = forecastNow;
  if (observation) {
    const obsAgeMin = (Date.now() - Date.parse(observation.timestamp)) / 60000;
    const obsTooOld = obsAgeMin > 75;   // beyond ~5 sample windows = stale
    const obsWindSuspect =
      observation.windSpeedKt != null &&
      observation.windSpeedKt === 0 &&
      forecastNow.windSpeedKt > 1;
    const useObsWind =
      observation.windSpeedKt != null && !obsTooOld && !obsWindSuspect;

    const windSpeedKt = useObsWind ? observation.windSpeedKt! : forecastNow.windSpeedKt;
    const windSpeedMph = useObsWind && observation.windSpeedMph != null ? observation.windSpeedMph : forecastNow.windSpeedMph;
    const windGustKt = useObsWind ? (observation.windGustKt ?? forecastNow.windGustKt) : forecastNow.windGustKt;
    const windDirDeg = useObsWind && observation.windDirDeg != null ? observation.windDirDeg : forecastNow.windDirDeg;
    const obsBf = useObsWind ? beaufort(windSpeedKt) : null;

    now = {
      ...forecastNow,
      tempF:          obsTooOld ? forecastNow.tempF       : (observation.tempF        ?? forecastNow.tempF),
      feelsLikeF:     obsTooOld ? forecastNow.feelsLikeF  : (observation.heatIndexF   ?? observation.windChillF ?? observation.tempF ?? forecastNow.feelsLikeF),
      shortForecast:  obsTooOld ? forecastNow.shortForecast : (observation.textDescription ?? forecastNow.shortForecast),
      windSpeedKt,
      windSpeedMph,
      windGustKt,
      windDirDeg,
      windDirCardinal: cardinal(windDirDeg),
      beaufortForce:  obsBf?.force ?? forecastNow.beaufortForce,
      beaufortName:   obsBf?.name  ?? forecastNow.beaufortName,
      humidity:       obsTooOld ? forecastNow.humidity     : (observation.humidity     ?? forecastNow.humidity),
      dewPointF:      obsTooOld ? forecastNow.dewPointF    : (observation.dewPointF    ?? forecastNow.dewPointF),
      pressureInHg:   obsTooOld ? forecastNow.pressureInHg : (observation.pressureInHg ?? forecastNow.pressureInHg),
      visibilityMi:   obsTooOld ? forecastNow.visibilityMi : (observation.visibilityMi ?? forecastNow.visibilityMi),
    };
  }

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
    // Real gust comes from the windGust field. Don't substitute the sustained-
    // wind upper bound when no gust is forecast — that would over-report.
    const gustMph = parseGustMph(p.windGust);
    const gustKtVal = gustMph > 0 ? +mphToKt(gustMph).toFixed(0) : undefined;
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
  // The 12-hour period grouping above can collapse hi === lo when NWS
  // returns only one period for a calendar date — e.g. when the
  // "Tonight" period's startTime offset slices to tomorrow's date
  // instead of today's, leaving today with just the daytime period and
  // a -999 loF sentinel that the fallback turns into a duplicate of
  // hiF. Use the hourly forecast (24 × 1-hour samples) as the primary
  // source of truth for hi/lo on any date we have substantial hourly
  // coverage for (≥6 samples); fall back to period-derived values for
  // days 3-7 that the hourly window doesn't reach.
  const hourlyStats = new Map<string, { hi: number; lo: number; count: number }>();
  for (const p of hourly.properties.periods) {
    const date = p.startTime.slice(0, 10);
    const t = p.temperature;
    const ex = hourlyStats.get(date);
    if (ex) {
      if (t > ex.hi) ex.hi = t;
      if (t < ex.lo) ex.lo = t;
      ex.count++;
    } else {
      hourlyStats.set(date, { hi: t, lo: t, count: 1 });
    }
  }

  const daily = Array.from(dailyMap.values()).slice(0, 7).map(d => {
    const h = hourlyStats.get(d.date);
    if (h && h.count >= 6) {
      // Merge: hourly gives us the true continuous range, but the
      // 12-hour period temperatures are NWS's "stated" hi/lo and can
      // peak past the hourly samples (which are at hour boundaries).
      // Take the max of both, similarly for lo.
      const periodHi = d.hiF === 999 ? -Infinity : d.hiF;
      const periodLo = d.loF === -999 ? Infinity  : d.loF;
      return {
        ...d,
        hiF: Math.max(h.hi, periodHi),
        loF: Math.min(h.lo, periodLo),
      };
    }
    return {
      ...d,
      hiF: d.hiF === 999 ? d.loF : d.hiF,
      loF: d.loF === -999 ? d.hiF : d.loF,
    };
  });

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
    observationStationId,
  };

  return {
    now, hourly: hourlyOut, daily,
    observation,
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
