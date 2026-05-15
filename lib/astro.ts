// Astronomy via SunCalc — sun/twilight phases and moon data.
// Plus a couple of paddler-/angler-specific extras:
//   • Solunar major/minor periods (moon transit, underfoot, rise, set)
//   • Astronomical tidbits (meteor showers, spring/neap tides, full-moon names)

import SunCalc from "suncalc";
import type { AstroResponse, SolunarPeriod } from "./types";
import { stationDayStart, stationToday } from "./time";

function iso(d?: Date) { return d ? d.toISOString() : "—"; }

const PHASE_NAMES: { max: number; name: string }[] = [
  { max: 0.0625, name: "New Moon" },
  { max: 0.1875, name: "Waxing Crescent" },
  { max: 0.3125, name: "First Quarter" },
  { max: 0.4375, name: "Waxing Gibbous" },
  { max: 0.5625, name: "Full Moon" },
  { max: 0.6875, name: "Waning Gibbous" },
  { max: 0.8125, name: "Last Quarter" },
  { max: 0.9375, name: "Waning Crescent" },
  { max: 1.0,    name: "New Moon" },
];

// Traditional North American full-moon names by month.
const FULL_MOON_NAMES = [
  "Wolf Moon",        // Jan
  "Snow Moon",        // Feb
  "Worm Moon",        // Mar
  "Pink Moon",        // Apr
  "Flower Moon",      // May
  "Strawberry Moon",  // Jun
  "Buck Moon",        // Jul
  "Sturgeon Moon",    // Aug
  "Harvest Moon",     // Sep
  "Hunter's Moon",    // Oct
  "Beaver Moon",      // Nov
  "Cold Moon",        // Dec
];

// Major annual meteor showers — peak dates approximate, valid year-round.
const METEOR_SHOWERS: { name: string; start: [number, number]; end: [number, number]; peak: [number, number] }[] = [
  { name: "Quadrantids",     start: [1, 1],  end: [1, 6],   peak: [1, 4] },
  { name: "Lyrids",          start: [4, 14], end: [4, 30],  peak: [4, 22] },
  { name: "Eta Aquariids",   start: [4, 19], end: [5, 28],  peak: [5, 6] },
  { name: "Delta Aquariids", start: [7, 12], end: [8, 23],  peak: [7, 29] },
  { name: "Perseids",        start: [7, 17], end: [8, 24],  peak: [8, 12] },
  { name: "Orionids",        start: [10, 2], end: [11, 7],  peak: [10, 21] },
  { name: "Leonids",         start: [11, 6], end: [11, 30], peak: [11, 17] },
  { name: "Geminids",        start: [12, 4], end: [12, 17], peak: [12, 13] },
  { name: "Ursids",          start: [12, 17], end: [12, 26], peak: [12, 22] },
];

const LUNAR_MONTH_DAYS = 29.530588;

function dateInRange(d: Date, start: [number, number], end: [number, number]): boolean {
  const m = d.getMonth() + 1, day = d.getDate();
  const cur = m * 100 + day;
  const s = start[0] * 100 + start[1];
  const e = end[0] * 100 + end[1];
  return cur >= s && cur <= e;
}

function daysUntil(d: Date, mmdd: [number, number]): number {
  const year = d.getFullYear();
  let target = new Date(year, mmdd[0] - 1, mmdd[1]);
  if (target < d) target = new Date(year + 1, mmdd[0] - 1, mmdd[1]);
  return Math.round((target.getTime() - d.getTime()) / 86400000);
}

/** Approximate moon transit (overhead) and underfoot times by scanning altitude.
 *  Anchored to Eastern midnight rather than server-local midnight so localhost
 *  (Eastern) and Vercel (UTC) produce identical results. */
function findMoonTransits(date: Date, lat: number, lon: number) {
  const startMs = stationDayStart(date);
  let maxAlt = -Infinity, transit: Date | null = null;
  let minAlt = Infinity,  underfoot: Date | null = null;
  // 30-minute resolution is enough for solunar window labeling.
  for (let i = 0; i <= 48; i++) {
    const t = new Date(startMs + i * 30 * 60 * 1000);
    const pos = SunCalc.getMoonPosition(t, lat, lon);
    if (pos.altitude > maxAlt) { maxAlt = pos.altitude; transit = t; }
    if (pos.altitude < minAlt) { minAlt = pos.altitude; underfoot = t; }
  }
  return { transit, underfoot };
}

function solunarPeriods(date: Date, lat: number, lon: number): SolunarPeriod[] {
  // Use Eastern-noon "today" so moon rise/set lookups land on the right day
  // regardless of whether the server is in UTC or Eastern.
  const today = stationToday(date);
  const moon = SunCalc.getMoonTimes(today, lat, lon, true);
  const { transit, underfoot } = findMoonTransits(date, lat, lon);
  const periods: SolunarPeriod[] = [];

  // Majors — moon overhead / underfoot, ±1 hour. Best feeding windows.
  if (transit) {
    periods.push({
      kind: "major",
      centerTime: transit.toISOString(),
      start: new Date(transit.getTime() - 60 * 60_000).toISOString(),
      end:   new Date(transit.getTime() + 60 * 60_000).toISOString(),
      centerLabel: "Moon overhead",
    });
  }
  if (underfoot) {
    periods.push({
      kind: "major",
      centerTime: underfoot.toISOString(),
      start: new Date(underfoot.getTime() - 60 * 60_000).toISOString(),
      end:   new Date(underfoot.getTime() + 60 * 60_000).toISOString(),
      centerLabel: "Moon underfoot",
    });
  }

  // Minors — moonrise / moonset, ±30 min.
  if (moon.rise) {
    periods.push({
      kind: "minor",
      centerTime: moon.rise.toISOString(),
      start: new Date(moon.rise.getTime() - 30 * 60_000).toISOString(),
      end:   new Date(moon.rise.getTime() + 30 * 60_000).toISOString(),
      centerLabel: "Moonrise",
    });
  }
  if (moon.set) {
    periods.push({
      kind: "minor",
      centerTime: moon.set.toISOString(),
      start: new Date(moon.set.getTime() - 30 * 60_000).toISOString(),
      end:   new Date(moon.set.getTime() + 30 * 60_000).toISOString(),
      centerLabel: "Moonset",
    });
  }

  // Sort chronologically across the day.
  periods.sort((a, b) => a.centerTime.localeCompare(b.centerTime));
  return periods;
}

function buildTidbits(date: Date, phase: number, illumPct: number): string[] {
  const out: string[] = [];

  // Spring vs neap context. ±2 days from quarter.
  const distNew  = Math.min(phase, 1 - phase);
  const distFull = Math.abs(phase - 0.5);
  const distQtr  = Math.min(Math.abs(phase - 0.25), Math.abs(phase - 0.75));
  if (distNew < 0.06 || distFull < 0.06) {
    out.push("Spring tides — biggest range, strongest currents.");
  } else if (distQtr < 0.06) {
    out.push("Neap tides — smallest range, gentlest currents.");
  }

  // Days until next full / new moon.
  const daysToNextFull = phase < 0.5
    ? (0.5 - phase) * LUNAR_MONTH_DAYS
    : (1.5 - phase) * LUNAR_MONTH_DAYS;
  const daysToNextNew = phase < 0.5
    ? (1 - phase) * LUNAR_MONTH_DAYS
    : (1 - phase) * LUNAR_MONTH_DAYS;
  const nextEvent = daysToNextFull < daysToNextNew
    ? { name: "Full moon", days: daysToNextFull }
    : { name: "New moon",  days: daysToNextNew };
  if (nextEvent.days < 0.5) {
    out.push(`${nextEvent.name} today — peak spring tides.`);
  } else if (nextEvent.days < 3) {
    out.push(`${nextEvent.name} in ${Math.round(nextEvent.days)} day${Math.round(nextEvent.days) === 1 ? "" : "s"}.`);
  }

  // If today is essentially full moon, surface the traditional name.
  if (distFull < 0.03) {
    out.push(`Full ${FULL_MOON_NAMES[date.getMonth()]} tonight (${illumPct}% illuminated).`);
  }

  // Meteor showers active or peaking today.
  for (const s of METEOR_SHOWERS) {
    if (!dateInRange(date, s.start, s.end)) continue;
    const daysToPeak = daysUntil(date, s.peak);
    if (daysToPeak === 0) {
      out.push(`${s.name} meteor shower peaks tonight.`);
    } else if (daysToPeak <= 5) {
      out.push(`${s.name} meteor shower active — peaks in ${daysToPeak} day${daysToPeak === 1 ? "" : "s"}.`);
    } else {
      out.push(`${s.name} meteor shower active.`);
    }
  }

  return out;
}

export function computeAstro(lat: number, lon: number, date: Date = new Date()): AstroResponse {
  const sun = SunCalc.getTimes(date, lat, lon);
  const moon = SunCalc.getMoonTimes(date, lat, lon, true);
  const illum = SunCalc.getMoonIllumination(date);
  const phaseName = PHASE_NAMES.find(p => illum.phase <= p.max)!.name;
  const illumPct = Math.round(illum.fraction * 100);

  const dayLength = (sun.sunset.getTime() - sun.sunrise.getTime()) / 60000;
  const { transit, underfoot } = findMoonTransits(date, lat, lon);

  return {
    date: date.toISOString().slice(0, 10),
    lat, lon,
    sunrise:      iso(sun.sunrise),
    sunset:       iso(sun.sunset),
    solarNoon:    iso(sun.solarNoon),
    civilDawn:    iso(sun.dawn),
    civilDusk:    iso(sun.dusk),
    nauticalDawn: iso(sun.nauticalDawn),
    nauticalDusk: iso(sun.nauticalDusk),
    astroDawn:    iso(sun.nightEnd),
    astroDusk:    iso(sun.night),
    dayLengthMin: Math.round(dayLength),
    moonrise:     moon.rise ? iso(moon.rise) : null,
    moonset:      moon.set  ? iso(moon.set)  : null,
    moonTransit:  transit ? iso(transit) : null,
    moonUnderfoot: underfoot ? iso(underfoot) : null,
    moonPhaseName: phaseName,
    moonIlluminationPct: illumPct,
    tidbits: buildTidbits(date, illum.phase, illumPct),
    solunar: solunarPeriods(date, lat, lon),
    source: "SunCalc (USNO-compatible)",
    fetchedAt: new Date().toISOString(),
  };
}
