// NDBC buoy parser. NDBC publishes plain-text observations:
//   https://www.ndbc.noaa.gov/data/realtime2/{stationId}.txt
// First two lines are headers; subsequent lines are space-delimited readings.
// Most recent row is at the top.

import type { BuoyResponse, WindObservation, WindResponse } from "./types";

// Human-readable names for the buoys we use. NDBC's TXT feed doesn't include
// the station's display name, so we keep a small table.
const BUOY_NAMES: Record<string, string> = {
  "41008": "Grays Reef NMS",
  "41033": "Fripp Nearshore",
  "41004": "Edisto",
};
export function ndbcBuoyName(id: string): string {
  return BUOY_NAMES[id] ?? `NDBC ${id}`;
}

const COLS = [
  "YY","MM","DD","hh","mm","WDIR","WSPD","GST","WVHT","DPD","APD","MWD",
  "PRES","ATMP","WTMP","DEWP","VIS","PTDY","TIDE"
];

function mToFt(m: number) { return m * 3.28084; }
function cToF(c: number)  { return c * 9/5 + 32; }
function hPaToInHg(h: number) { return h * 0.02953; }
function msToKt(m: number) { return m * 1.94384; }

function isMissing(s: string) { return s === "MM" || s === "" || s == null; }
function num(s: string): number | null { return isMissing(s) ? null : Number(s); }

export async function fetchBuoy(buoyId: string): Promise<BuoyResponse> {
  const url = `https://www.ndbc.noaa.gov/data/realtime2/${buoyId}.txt`;
  const res = await fetch(url, { next: { revalidate: 1800 } });
  if (!res.ok) throw new Error(`NDBC ${buoyId} → ${res.status}`);
  const text = await res.text();
  const lines = text.split("\n").filter(l => l && !l.startsWith("#"));
  if (lines.length === 0) {
    return {
      buoyId, waveHeightFt: null, dominantPeriodSec: null, meanWaveDirDeg: null,
      seaTempF: null, windSpeedKt: null, windDirDeg: null, pressureInHg: null,
      observedAt: null, source: "NDBC", fetchedAt: new Date().toISOString(),
    };
  }
  const latest = lines[0].trim().split(/\s+/);
  const row: Record<string, string> = {};
  COLS.forEach((c, i) => { row[c] = latest[i]; });

  // NDBC publishes wind in m/s, wave height in m, temps in C, pressure in hPa.
  const wvhtM   = num(row.WVHT);
  const wspdMs  = num(row.WSPD);
  const wtmpC   = num(row.WTMP);
  const presHpa = num(row.PRES);

  const observedAt = (() => {
    const y = Number(row.YY), m = Number(row.MM)-1, d = Number(row.DD);
    const hh = Number(row.hh), mm = Number(row.mm);
    if ([y, m, d, hh, mm].some(n => Number.isNaN(n))) return null;
    return new Date(Date.UTC(y, m, d, hh, mm)).toISOString();
  })();

  return {
    buoyId,
    buoyName: ndbcBuoyName(buoyId),
    waveHeightFt:    wvhtM   != null ? +mToFt(wvhtM).toFixed(1) : null,
    dominantPeriodSec: num(row.DPD),
    meanWaveDirDeg:    num(row.MWD),
    seaTempF:        wtmpC   != null ? +cToF(wtmpC).toFixed(1) : null,
    windSpeedKt:     wspdMs  != null ? +msToKt(wspdMs).toFixed(1) : null,
    windDirDeg:      num(row.WDIR),
    pressureInHg:    presHpa != null ? +hPaToInHg(presHpa).toFixed(2) : null,
    observedAt,
    source: "NDBC",
    fetchedAt: new Date().toISOString(),
  };
}

/** Pulls the last `hours` of wind observations from an NDBC buoy. Most
 *  coastal buoys report every 10 min so a 6-hour window yields ~36 samples.
 *  Returns the same WindResponse shape as CO-OPS so the WindNowTile renders
 *  identically regardless of source. */
export async function fetchNdbcWindHistory(buoyId: string, hours = 6): Promise<WindResponse> {
  const url = `https://www.ndbc.noaa.gov/data/realtime2/${buoyId}.txt`;
  const empty = (): WindResponse => ({
    stationId: buoyId, stationName: ndbcBuoyName(buoyId),
    observations: [], latest: null,
    source: "NDBC", fetchedAt: new Date().toISOString(),
  });
  try {
    const res = await fetch(url, { next: { revalidate: 60 } });
    if (!res.ok) return empty();
    const text = await res.text();
    const lines = text.split("\n").filter(l => l && !l.startsWith("#"));
    if (lines.length === 0) return empty();

    const cutoffMs = Date.now() - hours * 3600_000;
    const observations: WindObservation[] = [];

    for (const line of lines) {
      const cols = line.trim().split(/\s+/);
      // YY MM DD hh mm WDIR WSPD GST ...
      if (cols.length < 8) continue;
      const y = Number(cols[0]), mo = Number(cols[1]) - 1, d = Number(cols[2]);
      const hh = Number(cols[3]), mm = Number(cols[4]);
      if ([y, mo, d, hh, mm].some(n => Number.isNaN(n))) continue;
      const ts = Date.UTC(y, mo, d, hh, mm);
      if (ts < cutoffMs) break;   // realtime2 is newest-first; once we pass the window we're done.

      const wdir = cols[5], wspd = cols[6], gst = cols[7];
      if (wspd === "MM" || wdir === "MM") continue;
      const speedMs = Number(wspd);
      const gustMs = gst === "MM" ? null : Number(gst);
      const dirDeg = Number(wdir);
      if ([speedMs, dirDeg].some(n => Number.isNaN(n))) continue;

      observations.push({
        time: new Date(ts).toISOString(),
        speedKt: +msToKt(speedMs).toFixed(1),
        gustKt: gustMs != null ? +msToKt(gustMs).toFixed(1) : null,
        dirDeg,
      });
    }

    // Sort chronologically (file is newest-first, we want oldest-first for charting).
    observations.sort((a, b) => a.time.localeCompare(b.time));

    return {
      stationId: buoyId,
      stationName: ndbcBuoyName(buoyId),
      observations,
      latest: observations[observations.length - 1] ?? null,
      source: "NDBC",
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    return empty();
  }
}
