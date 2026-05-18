// Resolves the active list of paddling locations for the current request.
// Source of truth:
//   - Guest sessions → the hardcoded STATIONS list in lib/stations.ts
//   - Signed-in users → the user_locations table in Supabase
//
// Both are projected to the same ResolvedLocation shape so app/page.tsx and
// LocationPicker can treat them uniformly. The `?station=<key>` URL param
// accepts either a default slug ("tybee", "hilton", …) or a user_locations
// UUID; resolveLocation() handles both.
//
// New signups already have rows in user_locations (seed_default_locations
// trigger in migration 001 pre-loads the four Lowcountry spots), so a
// freshly-signed-in user sees the same locations as a guest — just routed
// through their own table so future edits persist.

import { createClient } from "@/lib/supabase/server";
import { STATIONS, DEFAULT_STATION_KEY } from "@/lib/stations";
import type { ResolvedLocation, WindStationRef } from "@/lib/types";

/** Project a hardcoded Station into the unified runtime shape. */
function fromStation(key: string): ResolvedLocation {
  const s = STATIONS[key];
  return {
    ...s,
    source: "default",
    isPrimary: key === DEFAULT_STATION_KEY,
  };
}

/** Project a user_locations row (snake_case from Postgres) into the
 *  unified runtime shape. Skips rows missing fields that the HUD needs
 *  to actually fetch upstream data — the settings UI (Phase 4) will
 *  enforce these at write time. */
function fromUserRow(row: Record<string, unknown>): ResolvedLocation | null {
  const tideStationId = row.tide_station_id;
  const obsStation = row.observation_station_id;
  const buoyId = row.buoy_id;
  const nwsZone = row.nws_zone;
  const marineZone = row.marine_zone;

  if (
    typeof tideStationId !== "string" ||
    typeof obsStation !== "string" ||
    typeof buoyId !== "string" ||
    typeof nwsZone !== "string" ||
    typeof marineZone !== "string"
  ) {
    // Row hasn't been fully configured yet — skip rather than render a
    // half-broken location. Once Phase 4 lands a settings UI we can
    // surface this as a warning to the user.
    return null;
  }

  const wind = Array.isArray(row.wind_stations)
    ? (row.wind_stations as unknown[]).filter(isWindStationRef)
    : [];

  return {
    key: String(row.id),
    displayName: String(row.display_name ?? ""),
    lat: Number(row.lat),
    lon: Number(row.lon),
    tideStationId,
    tideStationNote: typeof row.tide_station_note === "string" ? row.tide_station_note : undefined,
    observationStationId: obsStation,
    windStations: wind.length ? wind : undefined,
    buoyId,
    nwsZone,
    marineZone,
    source: "user",
    isPrimary: Boolean(row.is_primary),
  };
}

function isWindStationRef(v: unknown): v is WindStationRef {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (o.kind === "coops" || o.kind === "ndbc") && typeof o.id === "string";
}

/** Default (guest) list — STATIONS projected. Memoized so repeated calls
 *  share array identity, which prevents needless React re-renders. */
let guestLocationsMemo: ResolvedLocation[] | null = null;
function guestLocations(): ResolvedLocation[] {
  if (!guestLocationsMemo) {
    guestLocationsMemo = Object.keys(STATIONS).map(fromStation);
  }
  return guestLocationsMemo;
}

/** Result of loadLocations() — the list plus the chosen primary, so
 *  callers don't have to find() it again. */
export interface LoadedLocations {
  locations: ResolvedLocation[];
  primary: ResolvedLocation;
  source: "default" | "user";
}

/**
 * Load the appropriate location list for the current request. Never throws —
 * any Supabase failure cleanly falls back to the guest STATIONS list so
 * the HUD always renders. Designed to run in parallel with the other
 * server-side fetches in app/page.tsx.
 */
export async function loadLocations(): Promise<LoadedLocations> {
  const supabase = await createClient();
  if (!supabase) return fallbackToGuest();

  // The proxy keeps the session fresh; here we just need to know if there
  // IS a user before issuing the table query (RLS would block it anyway,
  // but skipping the round-trip is faster).
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return fallbackToGuest();

  const { data: rows, error } = await supabase
    .from("user_locations")
    .select(
      "id, display_name, lat, lon, tide_station_id, tide_station_note, " +
        "observation_station_id, wind_stations, buoy_id, nws_zone, " +
        "marine_zone, sort_order, is_primary",
    )
    .order("sort_order", { ascending: true });

  if (error) {
    console.error("[locations] user_locations query failed:", error.message);
    return fallbackToGuest();
  }
  if (!rows || rows.length === 0) {
    // User exists but has no rows yet (e.g. the seed trigger was disabled).
    // Falling back to the default list keeps the app usable; Phase 4 will
    // surface an empty-state UI for editing.
    return fallbackToGuest();
  }

  const projected = rows
    .map(fromUserRow)
    .filter((l): l is ResolvedLocation => l !== null);

  if (projected.length === 0) return fallbackToGuest();

  const primary = projected.find((l) => l.isPrimary) ?? projected[0];
  // Make sure exactly one is marked primary in the returned list so
  // LocationPicker's URL-stripping logic stays consistent.
  const normalized = projected.map((l) => ({ ...l, isPrimary: l.key === primary.key }));

  return { locations: normalized, primary: { ...primary, isPrimary: true }, source: "user" };
}

function fallbackToGuest(): LoadedLocations {
  const list = guestLocations();
  const primary = list.find((l) => l.isPrimary) ?? list[0];
  return { locations: list, primary, source: "default" };
}

/** Resolve a `?station=<key>` URL param to a location in the given list.
 *  Falls back to the primary when the key is missing or unknown. */
export function resolveLocation(
  key: string | null | undefined,
  locations: ResolvedLocation[],
  primary: ResolvedLocation,
): ResolvedLocation {
  if (!key) return primary;
  return locations.find((l) => l.key === key) ?? primary;
}
