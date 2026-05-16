import type { Station } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Lowcountry station bundles. Each maps a location to the specific NOAA / NDBC
// / NWS resources used for its HUD data.
//
// IMPORTANT NOTE ON TIDE STATIONS:
//  NOAA distinguishes "harmonic" stations (full 6-min predictions + hi/lo) from
//  "subordinate" stations (hi/lo only, no 6-min curve). In the Lowcountry the
//  harmonic stations are sparse:
//
//    • 8670870  Fort Pulaski, GA            ✓ harmonic
//    • 8665530  Charleston Cooper Riv Ent.  ✓ harmonic
//
//  Subordinate stations (Skull Creek 8666867, Beaufort 8667060, etc.) don't
//  publish a 6-min curve, which leaves the chart blank. The fix: point each
//  location at the NEAREST harmonic station and accept a small time offset
//  (Skull Creek ≈ +5 min vs Fort Pulaski; Beaufort ≈ +10 min). Set
//  `tideStationNote` so the UI surfaces the caveat to the user.
//
//  To add a new location, copy a block and:
//    1) pick the closest harmonic station for `tideStationId`
//    2) write a `tideStationNote` if it's not the location's own station
//    3) leave `currentStationId` unset — the HUD derives currents from the
//       tide curve when no NOAA current station is available (most of the
//       Lowcountry has no current station at all).
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
  hilton: {
    key: "hilton",
    displayName: "Hilton Head, SC",
    lat: 32.2163,
    lon: -80.7526,
    tideStationId: "8670870",          // Fort Pulaski (nearest harmonic, ~12 mi S)
    tideStationNote: "Reference: Fort Pulaski. Hilton Head tides run ~5 min later.",
    observationStationId: "KHXD",       // Hilton Head Island Airport — on the island
    // Try Skull Creek first (on Hilton Head); subordinate CO-OPS stations
    // often lack wind sensors, so the next preference is NDBC 41033
    // (Fripp Nearshore buoy, ~15 mi offshore from Hilton Head — much closer
    // and more representative of on-water wind than Fort Pulaski 25+ mi south).
    // Fort Pulaski stays as a regional last resort.
    windStations: [
      { kind: "coops", id: "8666867" },   // Skull Creek (probably no wind, but try)
      { kind: "ndbc",  id: "41033"   },   // Fripp Nearshore buoy — most local water-based
      { kind: "coops", id: "8670870" },   // Fort Pulaski — regional fallback
    ],
    buoyId: "41033",
    nwsZone: "SCZ050",
    marineZone: "AMZ330",
  },
  beaufort: {
    key: "beaufort",
    displayName: "Beaufort, SC",
    lat: 32.4316,
    lon: -80.6698,
    tideStationId: "8670870",          // Fort Pulaski (nearest harmonic, ~25 mi SSW)
    tideStationNote: "Reference: Fort Pulaski. Beaufort tides run ~10 min later.",
    observationStationId: "KARW",       // Beaufort County Airport (Lady's Island)
    // Beaufort tide station first; NDBC 41033 (Fripp Nearshore, ~18 mi) is
    // significantly closer than Fort Pulaski (~30 mi SSW) and water-based.
    windStations: [
      { kind: "coops", id: "8667060" },   // Beaufort station (probably no wind)
      { kind: "ndbc",  id: "41033"   },   // Fripp Nearshore buoy — closest water-based
      { kind: "coops", id: "8670870" },   // Fort Pulaski — regional fallback
    ],
    buoyId: "41033",
    nwsZone: "SCZ049",
    marineZone: "AMZ330",
  },
  charleston: {
    key: "charleston",
    displayName: "Charleston, SC",
    lat: 32.7833,
    lon: -79.9333,
    tideStationId: "8665530",          // Cooper River Entrance — local + harmonic
    observationStationId: "KCHS",       // Charleston Intl (METAR)
    windStations: [
      { kind: "coops", id: "8665530" },   // Cooper River — local + wind
      { kind: "ndbc",  id: "41004"   },   // Edisto buoy — backup
    ],
    buoyId: "41004",                    // Edisto
    nwsZone: "SCZ048",
    marineZone: "AMZ330",
  },
};

export const DEFAULT_STATION_KEY = "tybee";

export function getStation(key?: string | null): Station {
  if (key && STATIONS[key]) return STATIONS[key];
  return STATIONS[DEFAULT_STATION_KEY];
}
