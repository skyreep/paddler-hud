/**
 * Time/date helpers. Every time in the HUD is formatted in the STATION's
 * timezone (America/New_York for the Lowcountry alpha), not the user's
 * device timezone. This fixes the "everything is 4 hours forward" bug
 * reported when an iPad/iPhone is set to UTC — without this override,
 * `toLocaleTimeString()` defaults to the device's local zone, shifting
 * every time on the page by the offset between EDT and that zone.
 *
 * If you ever add stations outside Eastern Time, replace STATION_TZ with
 * a per-station value passed through from page.tsx.
 */

export const STATION_TZ = "America/New_York";

/** User's preferred time format. Defaults to 12-hour everywhere if not
 *  passed in (back-compat for any callsite that doesn't yet thread the
 *  preference through). */
export type TimeFmt = "12h" | "24h";

/** "9:42 AM" (12h) or "09:42" (24h) — time only, station-anchored. */
export function fmtTime(iso: string, format: TimeFmt = "12h"): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: format === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: format === "12h",
    timeZone: STATION_TZ,
  });
}

/** "Mon May 13" — short date, station-anchored. Date-only, so time
 *  format doesn't apply. */
export function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: STATION_TZ,
  });
}

/** "Mon 5:42 PM" or "Mon 17:42" — short date + time. */
export function fmtDateTime(iso: string, format: TimeFmt = "12h"): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: format === "24h" ? "2-digit" : "numeric",
    minute: "2-digit",
    hour12: format === "12h",
    timeZone: STATION_TZ,
  });
}

/** "12" / "1" / "13" — bare hour (no AM/PM), station-anchored. In 24h
 *  mode this returns 0-23. */
export function fmtHourBare(iso: string, format: TimeFmt = "12h"): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: format === "24h" ? "2-digit" : "numeric",
    hour12: format === "12h",
    timeZone: STATION_TZ,
  }).replace(/\s?[AaPp][Mm]$/, "");
}

/** True if the given Eastern calendar date is in Daylight Saving Time. */
function isEasternDst(yyyymmdd: string): boolean {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  if (m < 3 || m > 11) return false;
  if (m > 3 && m < 11) return true;
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const firstSunday = 1 + ((7 - firstOfMonth.getUTCDay()) % 7);
  if (m === 3)  return d >= firstSunday + 7;
  if (m === 11) return d <  firstSunday;
  return false;
}

/** Returns the UTC timestamp (ms) of Eastern midnight on the current
 *  Eastern calendar day. Used to anchor day-long timelines and scans to
 *  the user's actual paddling day, regardless of where the server or
 *  client device thinks midnight is. */
export function stationDayStart(now: Date = new Date()): number {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: STATION_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find(p => p.type === "year")!.value;
  const m = parts.find(p => p.type === "month")!.value;
  const d = parts.find(p => p.type === "day")!.value;
  const offset = isEasternDst(`${y}-${m}-${d}`) ? "-04:00" : "-05:00";
  return new Date(`${y}-${m}-${d}T00:00:00${offset}`).getTime();
}

/** Date representing noon-Eastern of today (a safe instant that's always
 *  within "today Eastern" regardless of caller's timezone). */
export function stationToday(now: Date = new Date()): Date {
  return new Date(stationDayStart(now) + 12 * 3600_000);
}
