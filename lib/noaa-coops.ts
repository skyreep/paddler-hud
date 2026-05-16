// NOAA CO-OPS — Tides, Currents, Water Levels.
// Docs: https://api.tidesandcurrents.noaa.gov/api/prod/

import type {
  CurrentPoint, CurrentResponse, TideExtreme, TidePoint,
  TideResponse, WaterLevelResponse, WindObservation, WindResponse,
} from "./types";

const BASE = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter";

interface CoopsParams {
  product: string;
  station: string;
  date?: string;
  begin_date?: string;
  end_date?: string;
  range?: string;
  datum?: string;
  units?: "english" | "metric";
  time_zone?: "lst_ldt" | "gmt" | "lst";
  interval?: "h" | "hilo" | "MAX_SLACK" | "6";
}

function buildUrl(p: CoopsParams) {
  const q = new URLSearchParams({
    application: "PaddlerHUD",
    format: "json",
    units: "english",
    time_zone: "lst_ldt",
    ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) as Record<string,string>,
  });
  return `${BASE}?${q.toString()}`;
}

/** Parse the CO-OPS "yyyy-MM-dd HH:mm" Eastern-local timestamp into a full
 *  ISO string with an explicit timezone offset (-04:00 in DST, -05:00 in
 *  standard time). Without the offset, iOS Safari occasionally parses the
 *  string as UTC instead of local, shifting every displayed time by ~4 hours.
 *  Stations we serve are all Eastern Time, so we hardcode the rule. */
function isEasternDst(yyyymmdd: string): boolean {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  // March: DST starts the second Sunday. November: DST ends the first Sunday.
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const firstSunday = 1 + ((7 - firstOfMonth.getUTCDay()) % 7);
  if (m === 3) return d >= firstSunday + 7;
  if (m === 11) return d < firstSunday;
  return false;
}

function coopsTimeToISO(t: string): string {
  // "2024-05-13 14:30" → "2024-05-13T14:30:00-04:00"
  const dateStr = t.slice(0, 10);
  const offset = isEasternDst(dateStr) ? "-04:00" : "-05:00";
  return `${t.replace(" ", "T")}:00${offset}`;
}

/** Today's 6-min predictions + today's hi/lo + 30-day hi/lo extremes.
 *
 *  Caller MUST pass a harmonic NOAA station (one with full 6-min curve data).
 *  Subordinate stations like Skull Creek (8666867) or Beaufort (8667060) only
 *  return hi/lo and will produce an empty chart — point those locations at the
 *  nearest harmonic station instead (lib/stations.ts has the canonical list
 *  and explains why).
 */
export async function fetchTides(stationId: string): Promise<TideResponse> {
  const today = new Date();
  const yyyymmdd = (d: Date) =>
    `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,"0")}${String(d.getDate()).padStart(2,"0")}`;
  const end30 = new Date(today.getTime() + 30 * 86400000);

  const [intervalRes, hiloRes, hilo30Res, metaRes] = await Promise.all([
    fetch(buildUrl({ product:"predictions", station:stationId, date:"today", datum:"MLLW", interval:"6" }),
      { next: { revalidate: 1800 } }),
    fetch(buildUrl({ product:"predictions", station:stationId, date:"today", datum:"MLLW", interval:"hilo" }),
      { next: { revalidate: 1800 } }),
    fetch(buildUrl({ product:"predictions", station:stationId,
      begin_date: yyyymmdd(today), end_date: yyyymmdd(end30),
      datum:"MLLW", interval:"hilo" }),
      { next: { revalidate: 21600 } }),
    fetch(`https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/${stationId}.json`,
      { next: { revalidate: 86400 } }),
  ]);

  const interval = (await intervalRes.json()) as { predictions?: { t: string; v: string }[]; error?: { message:string } };
  const hilo     = (await hiloRes.json())     as { predictions?: { t: string; v: string; type:"H"|"L" }[] };
  const hilo30   = (await hilo30Res.json())   as { predictions?: { t: string; v: string; type:"H"|"L" }[] };
  const meta     = (await metaRes.json())     as { stations?: { name?: string }[] };

  if (interval.error) throw new Error(`CO-OPS station ${stationId}: ${interval.error.message}`);

  const predictions: TidePoint[] = (interval.predictions ?? []).map(p => ({
    time: coopsTimeToISO(p.t),
    height: Number(p.v),
  }));
  const extremes: TideExtreme[] = (hilo.predictions ?? []).map(p => ({
    time: coopsTimeToISO(p.t), height: Number(p.v), type: p.type,
  }));
  const extended30Day: TideExtreme[] = (hilo30.predictions ?? []).map(p => ({
    time: coopsTimeToISO(p.t), height: Number(p.v), type: p.type,
  }));

  return {
    stationId,
    stationName: meta.stations?.[0]?.name ?? stationId,
    datum: "MLLW",
    units: "english",
    predictions,
    extremes,
    extended7Day: extended30Day,   // kept name for back-compat; now 30 days
    source: "NOAA CO-OPS",
    fetchedAt: new Date().toISOString(),
  };
}

/** Derive tidal currents from a tide-height curve.
 *  No NOAA currents station? The Lowcountry has very few. Currents are well
 *  approximated by the rate of change of the tide curve, scaled by a
 *  channel-geometry calibration constant (knots per ft/hr of dh/dt).
 *  Tybee Roads / Lowcountry channels run ≈ 1.3 kt per ft/hr at peak,
 *  which lines up with what TideLog and observed data show.
 */
export function deriveCurrentsFromTide(
  predictions: TidePoint[],
  opts: { stationName?: string; calibration?: number } = {},
): CurrentResponse {
  const stationName = opts.stationName ?? "Derived from tide curve";
  const k = opts.calibration ?? 1.3;

  if (predictions.length < 3) {
    return {
      stationId: "derived", stationName,
      predictions: [], slacks: [],
      source: "NOAA CO-OPS",
      fetchedAt: new Date().toISOString(),
    };
  }

  // Central-difference derivative of height vs time → ft/hr.
  // Sign convention: positive dh/dt = tide rising = FLOOD (positive velocity).
  const currents: CurrentPoint[] = [];
  for (let i = 0; i < predictions.length; i++) {
    const prev = predictions[Math.max(0, i - 1)];
    const next = predictions[Math.min(predictions.length - 1, i + 1)];
    const dtHr = (Date.parse(next.time) - Date.parse(prev.time)) / 3_600_000;
    const dhdt = dtHr > 0 ? (next.height - prev.height) / dtHr : 0;
    currents.push({
      time: predictions[i].time,
      velocity: +(dhdt * k).toFixed(2),
      direction: 0,
    });
  }

  const maxFlood = currents.reduce<CurrentPoint | undefined>(
    (best, p) => (p.velocity > (best?.velocity ?? -Infinity) ? p : best),
    undefined,
  );
  const maxEbb = currents.reduce<CurrentPoint | undefined>(
    (best, p) => (p.velocity < (best?.velocity ?? Infinity) ? p : best),
    undefined,
  );

  // Slacks = zero crossings of velocity.
  const slacks: string[] = [];
  for (let i = 1; i < currents.length; i++) {
    const prev = currents[i - 1].velocity, curr = currents[i].velocity;
    if (Math.sign(prev) !== Math.sign(curr) && prev !== 0) {
      const tA = Date.parse(currents[i - 1].time);
      const tB = Date.parse(currents[i].time);
      const frac = Math.abs(prev) / (Math.abs(prev) + Math.abs(curr));
      const tCross = tA + (tB - tA) * frac;
      slacks.push(new Date(tCross).toISOString().slice(0, 19));
    }
  }

  return {
    stationId: "derived", stationName,
    predictions: currents, maxFlood, maxEbb, slacks,
    source: "NOAA CO-OPS",
    fetchedAt: new Date().toISOString(),
  };
}

/** Tidal currents for a station today, plus slack/peak detection. */
export async function fetchCurrents(stationId: string): Promise<CurrentResponse> {
  const url = buildUrl({ product: "currents_predictions", station: stationId, date: "today", interval: "MAX_SLACK" });
  const res = await fetch(url, { next: { revalidate: 1800 } });
  const json = (await res.json()) as {
    current_predictions?: { cp?: { Time: string; Velocity_Major: string; Type: string; meanFloodDir?: string; meanEbbDir?: string }[] };
    error?: { message: string };
  };
  if (json.error) {
    // Many tide stations have no currents data; degrade to empty rather than throwing.
    return {
      stationId, stationName: stationId,
      predictions: [], slacks: [],
      source: "NOAA CO-OPS",
      fetchedAt: new Date().toISOString(),
    };
  }

  const items = json.current_predictions?.cp ?? [];
  const predictions: CurrentPoint[] = items.map(p => ({
    time: coopsTimeToISO(p.Time),
    velocity: Number(p.Velocity_Major),
    direction: 0,
  }));
  const maxFlood = predictions
    .filter(p => p.velocity > 0)
    .sort((a,b) => b.velocity - a.velocity)[0];
  const maxEbb = predictions
    .filter(p => p.velocity < 0)
    .sort((a,b) => a.velocity - b.velocity)[0];
  const slacks = items
    .filter(p => p.Type?.startsWith("slack"))
    .map(p => coopsTimeToISO(p.Time));

  return {
    stationId, stationName: stationId,
    predictions, maxFlood, maxEbb, slacks,
    source: "NOAA CO-OPS",
    fetchedAt: new Date().toISOString(),
  };
}

/** Try each station in order until one returns non-empty wind data.
 *  Subordinate tide stations frequently lack wind sensors — this lets each
 *  location declare a local-first preference with a regional fallback. */
export async function fetchWindWithFallback(stationIds: string[], hours = 6): Promise<WindResponse> {
  for (const id of stationIds) {
    const r = await fetchWind(id, hours);
    if (r.observations.length > 0) return r;
  }
  // Nothing worked — return an empty shape so the UI shows the offline state.
  return {
    stationId: stationIds[0] ?? "",
    stationName: stationIds[0] ?? "",
    observations: [], latest: null,
    source: "NOAA CO-OPS",
    fetchedAt: new Date().toISOString(),
  };
}

/** Real-time wind from a CO-OPS station — speed, gust, direction every 6 min.
 *  Returns the last `hours` of observations (default 6) plus a `latest` shortcut. */
export async function fetchWind(stationId: string, hours = 6): Promise<WindResponse> {
  // CO-OPS supports range=N for last N hours (1-72).
  const url = `${BASE}?` + new URLSearchParams({
    product: "wind",
    station: stationId,
    range: String(hours),
    units: "english",         // wind in knots, gust in knots
    time_zone: "lst_ldt",
    format: "json",
    application: "PaddlerHUD",
  }).toString();
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) {
      return {
        stationId, stationName: stationId,
        observations: [], latest: null,
        source: "NOAA CO-OPS", fetchedAt: new Date().toISOString(),
      };
    }
    const json = (await res.json()) as {
      data?: { t: string; s: string; g: string; d: string }[];
      metadata?: { name?: string };
      error?: { message: string };
    };
    if (json.error || !json.data?.length) {
      return {
        stationId, stationName: json.metadata?.name ?? stationId,
        observations: [], latest: null,
        source: "NOAA CO-OPS", fetchedAt: new Date().toISOString(),
      };
    }
    const observations: WindObservation[] = json.data.map(d => ({
      time: coopsTimeToISO(d.t),
      speedKt: Number(d.s),
      gustKt: d.g === "" ? null : Number(d.g),
      dirDeg: Number(d.d),
    }));
    return {
      stationId,
      stationName: json.metadata?.name ?? stationId,
      observations,
      latest: observations[observations.length - 1] ?? null,
      source: "NOAA CO-OPS",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return {
      stationId, stationName: stationId,
      observations: [], latest: null,
      source: "NOAA CO-OPS", fetchedAt: new Date().toISOString(),
    };
  }
}

/** Live water level and predicted level for surge anomaly. */
export async function fetchWaterLevel(stationId: string): Promise<WaterLevelResponse> {
  const [obsRes, predRes, tempRes] = await Promise.all([
    fetch(buildUrl({ product: "water_level", station: stationId, date: "latest", datum: "MLLW" }), { next: { revalidate: 300 } }),
    fetch(buildUrl({ product: "predictions", station: stationId, date: "today", datum: "MLLW", interval: "h" }), { next: { revalidate: 3600 } }),
    fetch(buildUrl({ product: "water_temperature", station: stationId, date: "latest" }), { next: { revalidate: 600 } }),
  ]);

  const obs  = (await obsRes.json()) as { data?: { t: string; v: string }[] };
  const pred = (await predRes.json()) as { predictions?: { t: string; v: string }[] };
  const temp = (await tempRes.json()) as { data?: { v: string }[]; error?: object };

  const observedHeight  = Number(obs.data?.[0]?.v ?? "0");
  const obsTime         = obs.data?.[0]?.t;
  // Match the prediction at the same hour
  const predNearest     = (pred.predictions ?? []).find(p =>
    obsTime && p.t.startsWith(obsTime.substring(0, 13))
  );
  const predictedHeight = Number(predNearest?.v ?? "0");

  return {
    stationId,
    observedHeight,
    predictedHeight,
    surgeAnomaly: +(observedHeight - predictedHeight).toFixed(2),
    time: obsTime ? coopsTimeToISO(obsTime) : new Date().toISOString(),
    waterTempF: temp.data?.[0]?.v ? Number(temp.data[0].v) : undefined,
    fetchedAt: new Date().toISOString(),
  };
}
