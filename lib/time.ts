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

/** "9:42 AM" — time only, station-anchored. */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: STATION_TZ,
  });
}

/** "Mon May 13" — short date, station-anchored. */
export function fmtDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: STATION_TZ,
  });
}

/** "Mon 5:42 PM" — short date + time. */
export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: STATION_TZ,
  });
}

/** "12" or "1" — bare hour (no AM/PM), station-anchored. */
export function fmtHourBare(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    timeZone: STATION_TZ,
  }).replace(/\s?[AaPp][Mm]$/, "");
}
