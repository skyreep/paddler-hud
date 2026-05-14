// NDBC buoy parser. NDBC publishes plain-text observations:
//   https://www.ndbc.noaa.gov/data/realtime2/{stationId}.txt
// First two lines are headers; subsequent lines are space-delimited readings.
// We just want the most recent line.

import type { BuoyResponse } from "./types";

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
