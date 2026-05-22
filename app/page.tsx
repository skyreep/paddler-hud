import { Fragment } from "react";
import TopBar from "@/components/TopBar";
import AdvisoryBanner from "@/components/tiles/AdvisoryBanner";
import { TILE_REGISTRY, effectiveTileOrder } from "@/lib/tile-registry";

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
import { loadSubscription } from "@/lib/subscriptions";

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
  const [currentUser, locationsResult, gaugesResult, prefsResult, subResult] = await Promise.all([
    getCurrentUser().catch(() => null),
    loadLocations(),
    loadGaugeIds(params.gauges ?? null),
    loadPreferences(),
    loadSubscription().catch(() => null),
  ]);
  const { locations, primary, userRows: userLocations } = locationsResult;
  const initialPreferences = prefsResult.preferences;
  // Subscription state powers Upgrade/Manage-subscription UI in TopBar
  // and gates premium-only features. Falls back to "free" if the load
  // crashed — we never want a transient DB failure to lock out a paid user
  // permanently, but we also never want to fake premium on errors.
  const isPremium = subResult?.isPremium ?? false;
  const hasStripeCustomer = !!subResult?.subscription.stripeCustomerId;
  const station = resolveLocation(params.station, locations, primary);
  // The URL key only persists when it actually resolves; if the user passed
  // a stale or unknown station key, drop it so the URL matches what's shown.
  const stationKey = station.key;
  const gaugeIds = gaugesResult.ids;
  // Full DB rows for the gauge editor — null for guests so the editor
  // renders the read-only "sign in to customize" variant.
  const userGauges = gaugesResult.userRows;

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
        userLocations={userLocations}
        initialPreferences={initialPreferences}
        isPremium={isPremium}
        hasStripeCustomer={hasStripeCustomer}
      />

      <main style={{ maxWidth: 1200, margin: "0 auto", padding: 14 }}>
        <AdvisoryBanner alerts={alerts?.alerts ?? []} tropical={tropical} prefs={initialPreferences} />

        <div style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 14,
        }} className="hud-grid">
          {/* Tile order/visibility comes from the user's saved tileConfig
              (or the canonical default if they haven't customized).
              effectiveTileOrder handles tiles introduced after the user's
              last save by appending them visible. Each tile's render
              factory decides whether it has the data to render at all
              (e.g. wind tile returns null when no wind data resolved). */}
          {effectiveTileOrder(initialPreferences.tileConfig, TILE_REGISTRY)
            .filter((t) => t.visible)
            .map((t) => (
              <Fragment key={t.entry.id}>
                {t.entry.render({
                  station,
                  weather,
                  tides,
                  water,
                  currents,
                  buoy,
                  airQuality,
                  tropical,
                  wind,
                  windSource,
                  astro,
                  gauges: validGauges,
                  userGauges,
                  prefs: initialPreferences,
                  fetchedAt,
                })}
              </Fragment>
            ))}
        </div>

        <div style={{
          textAlign: "center", fontSize: 11, color: "var(--text-faint)",
          padding: "24px 16px", lineHeight: 1.6,
        }}>
          Data: NOAA CO-OPS, NWS, USGS, NHC, EPA AirNow, Open-Meteo (UV + marine model), SunCalc.<br />
          Always verify conditions with official sources before launching.
          <div style={{ marginTop: 10 }}>
            <a href="/help" style={{ color: "var(--text-muted)", textDecoration: "none", marginRight: 10 }}>Help</a>
            <span style={{ opacity: 0.5 }}>·</span>
            <a href="/privacy" style={{ color: "var(--text-muted)", textDecoration: "none", marginLeft: 10, marginRight: 10 }}>Privacy</a>
            <span style={{ opacity: 0.5 }}>·</span>
            <a href="/terms" style={{ color: "var(--text-muted)", textDecoration: "none", marginLeft: 10 }}>Terms</a>
          </div>
          <div style={{ marginTop: 8, color: "var(--text-faint)", opacity: 0.85 }}>
            Tidevisor is a product of the Georgia Coast.
          </div>
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
