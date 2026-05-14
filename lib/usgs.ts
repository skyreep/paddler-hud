// USGS Water Services (instantaneous values). Free, no key.
// Param codes:
//   00065 = gage height (ft)
//   00060 = discharge (cfs)
//   00010 = water temperature (°C)

import type { RiverGauge } from "./types";

interface IVRoot {
  value?: {
    timeSeries?: TimeSeries[];
  };
}
interface TimeSeries {
  sourceInfo: { siteName: string; siteCode: { value: string }[]; geoLocation?: unknown; siteProperty?: { name: string; value: string }[] };
  variable: { variableCode: { value: string }[] };
  values: { value: { value: string; dateTime: string; qualifiers: string[] }[] }[];
}

function statusFor(stage: number | null, flood: number | null): RiverGauge["status"] {
  if (stage == null) return "unknown";
  if (flood == null) return "normal";
  if (stage >= flood + 5) return "major";
  if (stage >= flood + 2) return "moderate";
  if (stage >= flood)     return "minor";
  if (stage >= flood - 2) return "action";
  return "normal";
}

// NWS AHPS flood-stage lookup. The AHPS API isn't well-documented; for the MVP
// we expose a manual override per saved gauge (user enters their own flood stage).
// In production, a scheduled scrape job builds a flood-stage table.
const FLOOD_STAGES: Record<string, number> = {
  "02198840": 11.0,  // Savannah River nr Clyo, GA
  "02202500": 11.0,  // Ogeechee at Eden
  "02226000": 14.0,  // Altamaha at Doctortown
  "02175000": 10.0,  // Edisto near Givhans
  "02176500": 11.0,  // Combahee nr Yemassee
};

export async function fetchRiverGauge(siteId: string, floodStageOverride?: number): Promise<RiverGauge> {
  const url = `https://waterservices.usgs.gov/nwis/iv/?sites=${siteId}&parameterCd=00065,00060&period=P2D&format=json`;
  const res = await fetch(url, { next: { revalidate: 600 } });
  if (!res.ok) throw new Error(`USGS ${siteId} → ${res.status}`);
  const json = (await res.json()) as IVRoot;

  const series = json.value?.timeSeries ?? [];
  const stageSeries     = series.find(s => s.variable.variableCode[0].value === "00065");
  const dischargeSeries = series.find(s => s.variable.variableCode[0].value === "00060");
  const stageVals = stageSeries?.values[0]?.value ?? [];
  const dischargeVals = dischargeSeries?.values[0]?.value ?? [];

  const latestStage = stageVals.length ? Number(stageVals[stageVals.length - 1].value) : null;
  const latestDisch = dischargeVals.length ? Number(dischargeVals[dischargeVals.length - 1].value) : null;

  // Compute 24h-ago stage by finding the reading nearest to now - 24h
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

  return {
    siteId,
    siteName,
    state: stateProp ?? "",
    stageFt: latestStage,
    stageAt8amFt: stageAt8am,
    change24hFt: change24h,
    floodStageFt: flood,
    status: statusFor(latestStage, flood),
    dischargeCfs: latestDisch,
    fetchedAt: new Date().toISOString(),
  };
}
