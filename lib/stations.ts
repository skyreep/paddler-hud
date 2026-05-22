import type { Station } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Default location bundles for guests and first-paint. Trimmed to one
// entry (Tybee) so the free-tier 3-location cap doesn't appear to be
// already-used when someone first lands on the app. Signed-in users
// curate their own list via the Add Location wizard; the seed trigger
// in supabase/migrations/005 seeds the same single default into their
// user_locations row at profile creation.
//
// NOAA tide-station notes: harmonic stations (6-min curve + hi/lo) are
// sparse in the Lowcountry. Tybee uses Fort Pulaski (8670870), which is
// harmonic and right on the island. If you ever add more bundles here,
// keep the same pattern — point at the nearest harmonic station and
// surface a `tideStationNote` for any meaningful time offset.
// ─────────────────────────────────────────────────────────────────────────────

export const STATIONS: Record<string, Station> = {
  tybee: {
    key: "tybee",
    displayName: "Tybee Island, GA",
    lat: 31.9912,
    lon: -80.847,
    tideStationId: "8670870",          // Fort Pulaski — local + harmonic
    observationStationId: "KSAV",       // Savannah/Hilton Head Intl (METAR, ~10 mi)
    windStations: [
      { kind: "coops", id: "8670870" },   // Fort Pulaski — local + 6-min wind
      { kind: "ndbc",  id: "41008"   },   // Grays Reef NMS buoy — offshore backup
    ],
    buoyId: "41008",                    // Grays Reef
    nwsZone: "GAZ139",
    marineZone: "AMZ350",
  },
};

export const DEFAULT_STATION_KEY = "tybee";

export function getStation(key?: string | null): Station {
  if (key && STATIONS[key]) return STATIONS[key];
  return STATIONS[DEFAULT_STATION_KEY];
}
