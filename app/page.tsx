import TopBar from "@/components/TopBar";
import AdvisoryBanner from "@/components/tiles/AdvisoryBanner";
import RightNow from "@/components/tiles/RightNow";
import WindNowTile from "@/components/tiles/WindNowTile";
import MapTile from "@/components/tiles/MapTile";
import RadarTile from "@/components/tiles/RadarTile";
import TideTile from "@/components/tiles/TideTile";
import TideMonthTile from "@/components/tiles/TideMonthTile";
import CurrentTile from "@/components/tiles/CurrentTile";
import AstroTile from "@/components/tiles/AstroTile";
import SolunarTile from "@/components/tiles/SolunarTile";
import HourlyTile from "@/components/tiles/HourlyTile";
import WeeklyTile from "@/components/tiles/WeeklyTile";
import MarineTile from "@/components/tiles/MarineTile";
import RiversTile from "@/components/tiles/RiversTile";
import TropicalTile from "@/components/tiles/TropicalTile";

import { fetchTides, fetchWaterLevel, fetchCurrents, deriveCurrentsFromTide, fetchWindWithFallback } from "@/lib/noaa-coops";
import { fetchWeather, fetchAlerts } from "@/lib/nws";
import { fetchMarine } from "@/lib/open-meteo";
import { fetchRiverGauge } from "@/lib/usgs";
import { computeAstro } from "@/lib/astro";
import { fetchAirQuality } from "@/lib/airnow";
import { fetchTropical } from "@/lib/nhc";
import { resolveWind } from "@/lib/wind-resolver";
import { getCurrentUser } from "@/lib/auth";
import { loadLocations, resolveLocation } from "@/lib/locations";
import { loadGaugeIds } from "@/lib/gauges";
import { loadPreferences } from "@/lib/preferences";

export default async function Home({
  searchParams,
}: {
  // Next 15+: `searchParams` is a Promise on the server and must be awaited
  // before its keys can be read. See:
  // https://nextjs.org/docs/messages/sync-dynamic-apis
  searchParams: Promise<{ station?: string; gauges?: string }>;
}) {
  const params = await searchParams;

  // Resolve auth + the user-aware data sources together. loadLocations /
  // loadGaugeIds / loadPreferences each do at most one Supabase round-trip
  // and gracefully fall back to the hardcoded defaults if anything goes
  // wrong, so they're safe to await before the upstream weather/tide fetches.
  const [currentUser, locationsResult, gaugesResult, prefsResult] = await Promise.all([
    getCurrentUser().catch(() => null),
    loadLocations(),
    loadGaugeIds(params.gauges ?? null),
    loadPreferences(),
  ]);
  const { locations, primary } = locationsResult;
  const initialPreferences = prefsResult.preferences;
  const station = resolveLocation(params.station, locations, primary);
  // The URL key only persists when it actually resolves; if the user passed
  // a stale or unknown station key, drop it so the URL matches what's shown.
  const stationKey = station.key;
  const gaugeIds = gaugesResult.ids;

  const safe = <T,>(p: Promise<T>) => p.catch((e) => { console.error("hud fetch:", e); return null; });

  const [tides, noaaCurrents, weather, alerts, buoy, water, airQuality, tropical, wind, ...gauges] = await Promise.all([
    safe(fetchTides(station.tideStationId)),
    station.currentStationId ? safe(fetchCurrents(station.currentStationId)) : Promise.resolve(null),
    safe(fetchWeather(station.lat, station.lon, station.observationStationId)),
    safe(fetchAlerts([station.nwsZone, station.marineZone])),
    safe(fetchMarine(station.lat, station.lon)),
    safe(fetchWaterLevel(station.tideStationId)),
    safe(fetchAirQuality(station.lat, station.lon)),
    safe(fetchTropical(station.lat, station.lon)),
    station.windStations?.length ? safe(fetchWindWithFallback(station.windStations, 6)) : Promise.resolve(null),
    ...gaugeIds.map((id) => safe(fetchRiverGauge(id.trim()))),
  ]);

  // Currents: use NOAA station data when present; otherwise derive from the
  // tide curve. The Lowcountry has almost no NOAA current-prediction stations,
  // so derivation is the realistic default here (matches what TideLog does).
  const currents = noaaCurrents && noaaCurrents.predictions.length > 0
    ? noaaCurrents
    : (tides && tides.predictions.length > 0
        ? deriveCurrentsFromTide(tides.predictions, {
            stationName: `Derived for ${station.displayName}`,
            calibration: 1.3,
          })
        : null);

  const astro = computeAstro(station.lat, station.lon);
  const validGauges = gauges.filter(Boolean) as NonNullable<typeof gauges[number]>[];
  const fetchedAt = new Date().toISOString();

  // Resolve "best available" real-time wind from the multi-source chain
  // (CO-OPS → METAR → NWS forecast) and override the wind fields in
  // weather.now so the Right Now tile shows hyper-local, never-zero data.
  let windSource: string | undefined;
  if (weather) {
    const resolved = resolveWind(weather.now, weather.observation ?? null, wind);
    weather.now = {
      ...weather.now,
      windSpeedKt:     resolved.speedKt,
      windSpeedMph:    resolved.speedMph,
      windGustKt:      resolved.gustKt,
      windDirDeg:      resolved.dirDeg,
      windDirCardinal: resolved.dirCardinal,
      beaufortForce:   resolved.beaufortForce,
      beaufortName:    resolved.beaufortName,
    };
    windSource = resolved.source;
  }

  return (
    <>
      <TopBar
        locationName={station.displayName}
        stationKey={stationKey}
        currentUser={currentUser}
        locations={locations}
        primaryKey={primary.key}
        initialPreferences={initialPreferences}
      />

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: 14 }}>
        <AdvisoryBanner alerts={alerts?.alerts ?? []} tropical={tropical} />

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 14,
        }} className="hud-grid">
          {/* Order: gate-keeping info first, weather grouped together, marine + rivers, tropical, astro */}
          {weather && (
            <RightNow
              weather={weather.now}
              fetchedAt={fetchedAt}
              airQuality={airQuality}
              liveTideFt={water?.observedHeight ?? null}
              attribution={weather.attribution}
              observation={weather.observation}
              windSource={windSource}
            />
          )}
          {wind && <WindNowTile wind={wind} />}
          <MapTile lat={station.lat} lon={station.lon} displayName={station.displayName} />
          {tides && <TideTile tides={tides} stationNote={station.tideStationNote} liveTideFt={water?.observedHeight ?? null} />}
          {currents && <CurrentTile currents={currents} />}
          {tides && <TideMonthTile tides={tides} />}
          {weather && <HourlyTile hours={weather.hourly} attribution={weather.attribution} />}
          {weather && <WeeklyTile days={weather.daily} attribution={weather.attribution} />}
          <RadarTile lat={station.lat} lon={station.lon} displayName={station.displayName} />
          {buoy && <MarineTile buoy={buoy} />}
          <RiversTile gauges={validGauges} />
          {tropical && <TropicalTile tropical={tropical} />}
          <AstroTile astro={astro} />
          <SolunarTile periods={astro.solunar} />
        </div>

        <div style={{
          textAlign: "center", fontSize: 11, color: "var(--text-faint)",
          padding: "24px 16px", lineHeight: 1.6,
        }}>
          Data: NOAA CO-OPS, NWS, USGS, NHC, EPA AirNow, Open-Meteo (UV + marine model), SunCalc.<br />
          Always verify conditions with official sources before launching.
        </div>
      </main>

      {/* Grid breakpoints + tile-cell guards live in globals.css.
          Putting them in an inline <style> tag triggers a Next.js hydration
          mismatch because React escapes special chars in the server payload
          but leaves them literal on the client. */}
    </>
  );
}

// Revalidate the page itself every 5 minutes; individual fetches have their own cache windows.
export const revalidate = 300;
