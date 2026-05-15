// USGS Water Services (instantaneous values + historical statistics).
// Free, no key.
//   Param codes: 00065 = gage height (ft), 00060 = discharge (cfs), 00010 = temp (°C)
//   Live data:   https://waterservices.usgs.gov/nwis/iv/
//   Daily stats: https://waterservices.usgs.gov/nwis/stat/

import type { RiverGauge } from "./types";

interface IVRoot {
  value?: { timeSeries?: TimeSeries[] };
}
interface TimeSeries {
  sourceInfo: { siteName: string; siteCode: { value: string }[]; geoLocation?: unknown; siteProperty?: { name: string; value: string }[] };
  variable: { variableCode: { value: string }[] };
  values: { value: { value: string; dateTime: string; qualifiers: string[] }[] }[];
}

interface DailyStat {
  p10: number | null;
  p25: number | null;
  p50: number | null;
  p75: number | null;
  p90: number | null;
}

/** Hydrologist's flow classification.
 *  Low-end thresholds use the USGS daily-percentile convention; high-end
 *  thresholds use NWS AHPS flood stages where available.
 *
 *  The percentile bins follow USGS WaterWatch's official labels:
 *    < P10  : "Much below normal" (drought)
 *    P10–P25: "Below normal"
 *    P25–P75: "Normal"
 *    P75–P90: "Above normal"
 *    > P90  : "Much above normal"
 *  Flood thresholds always win when current stage is approaching or over them.
 */
function statusFor(
  stage: number | null,
  flood: number | null,
  discharge: number | null,
  stat: DailyStat | null,
): RiverGauge["status"] {
  // Flood thresholds take precedence at the high end.
  if (stage != null && flood != null) {
    if (stage >= flood + 5) return "major";
    if (stage >= flood + 2) return "moderate";
    if (stage >= flood)     return "minor";
    if (stage >= flood - 2) return "action";
  }
  // Percentile-based low/normal/high using discharge vs historical record.
  if (discharge != null && stat) {
    const { p10, p25, p75, p90 } = stat;
    if (p10 != null && discharge < p10) return "very-low";
    if (p25 != null && discharge < p25) return "low";
    if (p90 != null && discharge >= p90) return "very-high";
    if (p75 != null && discharge >= p75) return "high";
    return "normal";
  }
  // Fallback when stats aren't available.
  if (stage == null) return "unknown";
  return "normal";
}

/** Today's percentile (0-100) of a discharge value vs the historical bins.
 *  Linear interpolation between the published P10/P25/P50/P75/P90 anchors. */
function percentileOf(value: number, stat: DailyStat): number | null {
  const points: [number, number][] = [];
  if (stat.p10 != null) points.push([10, stat.p10]);
  if (stat.p25 != null) points.push([25, stat.p25]);
  if (stat.p50 != null) points.push([50, stat.p50]);
  if (stat.p75 != null) points.push([75, stat.p75]);
  if (stat.p90 != null) points.push([90, stat.p90]);
  if (points.length < 2) return null;
  if (value <= points[0][1]) return points[0][0];
  if (value >= points[points.length - 1][1]) return points[points.length - 1][0];
  for (let i = 0; i < points.length - 1; i++) {
    const [pA, vA] = points[i], [pB, vB] = points[i + 1];
    if (value >= vA && value <= vB) {
      const frac = vB === vA ? 0 : (value - vA) / (vB - vA);
      return Math.round(pA + frac * (pB - pA));
    }
  }
  return null;
}

// NWS AHPS flood-stage lookup — manual table. Production would scrape AHPS.
const FLOOD_STAGES: Record<string, number> = {
  "02198840": 11.0,  // Savannah River nr Clyo, GA
  "02202500": 11.0,  // Ogeechee at Eden
  "02226000": 14.0,  // Altamaha at Doctortown
  "02175000": 10.0,  // Edisto near Givhans
  "02176500": 11.0,  // Combahee nr Yemassee
};

/** Fetch the daily-statistics record for today's day-of-year for one site.
 *  USGS returns ALL day-of-year stats in one rdb response; we filter to today. */
async function fetchDailyStat(siteId: string): Promise<DailyStat | null> {
  const today = new Date();
  const month = today.getMonth() + 1;
  const day = today.getDate();
  const url =
    `https://waterservices.usgs.gov/nwis/stat/?sites=${siteId}` +
    `&statReportType=daily&statTypeCd=p10,p25,p50,p75,p90` +
    `&parameterCd=00060&format=rdb`;
  try {
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const text = await res.text();
    // rdb format: '#' comments, then header row, then data rows tab-separated.
    const lines = text.split("\n").filter(l => l && !l.startsWith("#"));
    if (lines.length < 3) return null;
    const headers = lines[0].split("\t");
    // Skip the second header row (column types) and parse data rows.
    const idxMonth = headers.indexOf("month_nu");
    const idxDay   = headers.indexOf("day_nu");
    const idxP10   = headers.indexOf("p10_va");
    const idxP25   = headers.indexOf("p25_va");
    const idxP50   = headers.indexOf("p50_va");
    const idxP75   = headers.indexOf("p75_va");
    const idxP90   = headers.indexOf("p90_va");
    if (idxMonth < 0 || idxDay < 0) return null;
    for (let i = 2; i < lines.length; i++) {
      const cols = lines[i].split("\t");
      if (Number(cols[idxMonth]) === month && Number(cols[idxDay]) === day) {
        const num = (s: string | undefined) => (s && s !== "" ? Number(s) : null);
        return {
          p10: num(cols[idxP10]),
          p25: num(cols[idxP25]),
          p50: num(cols[idxP50]),
          p75: num(cols[idxP75]),
          p90: num(cols[idxP90]),
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export async function fetchRiverGauge(siteId: string, floodStageOverride?: number): Promise<RiverGauge> {
  const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${siteId}&parameterCd=00065,00060&period=P2D&format=json`;
  const [ivRes, stat] = await Promise.all([
    fetch(url, { next: { revalidate: 600 } }),
    fetchDailyStat(siteId),
  ]);
  if (!ivRes.ok) throw new Error(`USGS ${siteId} → ${ivRes.status}`);
  const json = (await ivRes.json()) as IVRoot;

  const series = json.value?.timeSeries ?? [];
  const stageSeries     = series.find(s => s.variable.variableCode[0].value === "00065");
  const dischargeSeries = series.find(s => s.variable.variableCode[0].value === "00060");
  const stageVals = stageSeries?.values[0]?.value ?? [];
  const dischargeVals = dischargeSeries?.values[0]?.value ?? [];

  const latestStage = stageVals.length ? Number(stageVals[stageVals.length - 1].value) : null;
  const latestDisch = dischargeVals.length ? Number(dischargeVals[dischargeVals.length - 1].value) : null;

  // 24h-ago stage
  let stage24hAgo: number | null = null;
  if (stageVals.length > 1) {
    const target = Date.now() - 86400000;
    let best = stageVals[0]; let bestDiff = Infinity;
    for (const v of stageVals) {
      const d = Math.abs(new Date(v.dateTime).getTime() - target);
      if (d < bestDiff) { bestDiff = d; best = v; }
    }
    stage24hAgo = Number(best.value);
  }
  const change24h = (latestStage != null && stage24hAgo != null) ? +(latestStage - stage24hAgo).toFixed(2) : null;

  // 8 AM today stage
  let stageAt8am: number | null = null;
  if (stageVals.length) {
    const today = new Date();
    today.setHours(8, 0, 0, 0);
    let best = stageVals[0]; let bestDiff = Infinity;
    for (const v of stageVals) {
      const d = Math.abs(new Date(v.dateTime).getTime() - today.getTime());
      if (d < bestDiff) { bestDiff = d; best = v; }
    }
    stageAt8am = Number(best.value);
  }

  const flood = floodStageOverride ?? FLOOD_STAGES[siteId] ?? null;
  const siteName = stageSeries?.sourceInfo.siteName ?? siteId;
  const stateProp = stageSeries?.sourceInfo.siteProperty?.find(p => p.name === "stateCd")?.value;

  const flowPercentile = latestDisch != null && stat ? percentileOf(latestDisch, stat) : null;

  return {
    siteId,
    siteName,
    state: stateProp ?? "",
    stageFt: latestStage,
    stageAt8amFt: stageAt8am,
    change24hFt: change24h,
    floodStageFt: flood,
    status: statusFor(latestStage, flood, latestDisch, stat),
    flowPercentile,
    medianFlowCfs: stat?.p50 ?? null,
    dischargeCfs: latestDisch,
    fetchedAt: new Date().toISOString(),
  };
}
