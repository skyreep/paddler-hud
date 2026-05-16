// Shared data shapes the HUD components consume.
// Every API route in app/api/* returns one of these.

export interface TideExtreme {
  time: string;       // ISO local time
  type: "H" | "L";
  height: number;     // ft, MLLW
}
export interface TidePoint {
  time: string;       // ISO
  height: number;     // ft
}
export interface TideResponse {
  stationId: string;
  stationName: string;
  datum: string;          // "MLLW"
  units: "english";
  predictions: TidePoint[];   // 6-min interval today
  extremes: TideExtreme[];    // today's H/L
  extended7Day: TideExtreme[];
  source: "NOAA CO-OPS";
  fetchedAt: string;
}

export interface CurrentPoint { time: string; velocity: number; direction: number }
export interface CurrentResponse {
  stationId: string;
  stationName: string;
  predictions: CurrentPoint[];   // signed knots (+ flood, - ebb)
  maxFlood?: CurrentPoint;
  maxEbb?: CurrentPoint;
  slacks: string[];              // ISO times of slack water
  source: "NOAA CO-OPS";
  fetchedAt: string;
}

export interface WaterLevelResponse {
  stationId: string;
  observedHeight: number;
  predictedHeight: number;
  surgeAnomaly: number;       // observed - predicted, ft
  time: string;
  waterTempF?: number;
  fetchedAt: string;
}

export interface WeatherNow {
  tempF: number;
  feelsLikeF: number;
  shortForecast: string;
  windSpeedKt: number;
  windSpeedMph: number;
  windGustKt?: number;
  windDirDeg: number;
  windDirCardinal: string;
  beaufortForce: number;
  beaufortName: string;
  humidity?: number;
  dewPointF?: number;
  pressureInHg?: number;
  visibilityMi?: number;
  uvIndex?: number;
  cloudCoverPct?: number;
  precipChancePct?: number;
  precipAmountIn?: number;       // expected accumulation, inches (next 6h)
}
export interface WeatherHour {
  time: string;
  tempF: number;
  windKt: number;
  windDirDeg?: number;
  windDirCardinal?: string;
  icon: string;
  shortForecast: string;
  precipChancePct: number;
  precipAmountIn?: number;       // qpf for this hour, inches
}
export interface WeatherDay {
  date: string;     // YYYY-MM-DD
  dayName: string;  // "Mon"
  hiF: number;
  loF: number;
  icon: string;
  shortForecast: string;
  detailedForecast?: string;     // NWS prose paragraph for the day
  precipChancePct: number;
  precipAmountIn?: number;       // 24h accumulation, inches
  windSpeedKt?: number;
  windGustKt?: number;
  windDirDeg?: number;
  windDirCardinal?: string;
}
export interface NwsAttribution {
  office: string;        // e.g. "CHS" — forecast office identifier
  officeName?: string;   // "Charleston, SC"
  gridId: string;        // typically same as office
  gridX: number;
  gridY: number;
  relativeLocation?: string; // "Tybee Island, GA"
  observationStationId?: string; // e.g. "KSAV" — METAR station feeding Right Now
}

/** Real-time observed conditions from a METAR/ASOS station. */
export interface WeatherObservation {
  stationId: string;
  timestamp: string;            // ISO UTC, when the sample was recorded
  tempF: number | null;
  dewPointF: number | null;
  humidity: number | null;
  windSpeedKt: number | null;
  windSpeedMph: number | null;
  windDirDeg: number | null;
  windGustKt: number | null;
  pressureInHg: number | null;
  visibilityMi: number | null;
  precipLastHourIn: number | null;
  textDescription: string | null;
  heatIndexF: number | null;
  windChillF: number | null;
}

export interface WeatherResponse {
  now: WeatherNow;
  hourly: WeatherHour[];        // next 24 hr
  daily: WeatherDay[];          // 7 days
  observation?: WeatherObservation | null; // most recent METAR for the area
  attribution: NwsAttribution;
  source: "NWS";
  fetchedAt: string;
}

/** Real-time wind series from a NOAA CO-OPS station (every 6 min). */
export interface WindObservation {
  time: string;     // ISO local
  speedKt: number;
  gustKt: number | null;
  dirDeg: number;
}
export interface WindResponse {
  stationId: string;
  stationName: string;
  observations: WindObservation[];   // chronological, oldest first
  latest: WindObservation | null;
  source: "NOAA CO-OPS";
  fetchedAt: string;
}

export interface Alert {
  id: string;
  event: string;             // "Small Craft Advisory"
  severity: "Minor" | "Moderate" | "Severe" | "Extreme" | "Unknown";
  headline: string;
  description: string;
  effective: string;
  expires: string;
  areaDesc: string;
  senderName: string;
}
export interface AlertsResponse {
  alerts: Alert[];
  source: "NWS";
  fetchedAt: string;
}

export interface RiverGauge {
  siteId: string;
  siteName: string;
  state: string;
  stageFt: number | null;
  stageAt8amFt: number | null;
  change24hFt: number | null;
  floodStageFt: number | null;
  /** Paddler-relevant flow classification.
   *  Low end is based on USGS historical-percentile statistics for today's
   *  day-of-year (drought visibility). High end uses the NWS AHPS flood stages. */
  status:
    | "very-low"   // < P10 — drought / sections may be unpaddleable
    | "low"        // P10-P25 — below normal, watch for shallow spots
    | "normal"     // P25-P75 — typical seasonal flow
    | "high"       // P75-P90 — above normal, good flow
    | "very-high"  // > P90 — much above normal
    | "action"     // approaching flood stage
    | "minor"      // minor flood
    | "moderate"   // moderate flood
    | "major"      // major flood
    | "unknown";
  /** Today's discharge as a percentile of the long-term record (0-100). */
  flowPercentile: number | null;
  /** P50 (median) discharge for today's day-of-year, for context. */
  medianFlowCfs: number | null;
  dischargeCfs: number | null;
  fetchedAt: string;
}

export interface BuoyResponse {
  buoyId: string;
  buoyName?: string;
  waveHeightFt: number | null;
  dominantPeriodSec: number | null;
  meanWaveDirDeg: number | null;
  seaTempF: number | null;
  windSpeedKt: number | null;
  windDirDeg: number | null;
  pressureInHg: number | null;
  observedAt: string | null;
  source: "NDBC" | "Open-Meteo";
  fetchedAt: string;
}

export interface SolunarPeriod {
  kind: "major" | "minor";
  start: string;        // ISO
  end: string;          // ISO
  centerTime: string;   // ISO — exact moon-event moment
  centerLabel: string;  // "Moon overhead" | "Moon underfoot" | "Moonrise" | "Moonset"
}
export interface AstroResponse {
  date: string;
  lat: number;
  lon: number;
  sunrise: string;
  sunset: string;
  solarNoon: string;
  civilDawn: string;
  civilDusk: string;
  nauticalDawn: string;
  nauticalDusk: string;
  astroDawn: string;
  astroDusk: string;
  dayLengthMin: number;
  moonrise: string | null;
  moonset: string | null;
  moonTransit: string | null;
  moonUnderfoot: string | null;
  moonPhaseName: string;
  moonIlluminationPct: number;
  tidbits: string[];
  solunar: SolunarPeriod[];
  source: "SunCalc (USNO-compatible)";
  fetchedAt: string;
}

export interface AirQualityResponse {
  aqi: number | null;
  category: string | null;
  dominantPollutant: string | null;
  source: "EPA AirNow";
  fetchedAt: string;
  available: boolean;
}

export interface TropicalSystem {
  id: string;                // ATCF ID, e.g. "AL022026"
  name: string;              // "Beryl"
  classification: string;    // "Tropical Storm", "Hurricane Cat 2"
  category: number | null;   // 1-5 for hurricanes, null otherwise
  maxWindMph: number | null;
  minPressureMb: number | null;
  position: { lat: number; lon: number } | null;
  movement: string | null;   // "WNW at 14 mph"
  distanceMi?: number;       // computed distance from user lat/lon
  threatToUser: boolean;
}
export interface TropicalDisturbance {
  id: string;                // "AL95"
  area: string;
  formationChance48h: number;
  formationChance7d: number;
}
export interface TropicalResponse {
  inSeason: boolean;
  activeSystems: TropicalSystem[];
  disturbances: TropicalDisturbance[];
  basin: "Atlantic";
  source: "NHC";
  fetchedAt: string;
}

export interface Station {
  key: string;
  displayName: string;
  lat: number;
  lon: number;
  tideStationId: string;
  /** Optional note shown in the tide tile when tideStationId isn't local to
   *  this location (e.g. "Reference: Fort Pulaski. Hilton Head tides run ~5 min later."). */
  tideStationNote?: string;
  currentStationId?: string;
  /** NWS METAR/ASOS observation station ID — feeds the Right Now tile's
   *  observed values (temp, dewpoint, wind, pressure, visibility). 4-letter ICAO. */
  observationStationId: string;
  /** NOAA CO-OPS station ID with real-time wind product (6-min updates).
   *  Used by the dedicated Wind tile. Falls back to METAR if missing. */
  windStationId?: string;
  buoyId: string;
  nwsZone: string;
  marineZone: string;
}
