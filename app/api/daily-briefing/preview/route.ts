// Preview endpoint for the daily briefing email. Auth-gated to the
// signed-in user, so you can hit `/api/daily-briefing/preview` in a
// browser and see the rendered email for your primary location.
//
// Query flags:
//   ?text=1     → return plaintext fallback instead of HTML
//   ?subject=1  → return just the subject line (handy for sanity-checking)
//
// This route uses the same upstream data fetchers as the dashboard
// (lib/noaa-coops, lib/nws, lib/astro). Failures in any single fetch
// degrade gracefully — the email-briefing renderer collapses any
// section it doesn't have data for.

import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { loadLocations } from "@/lib/locations";
import { loadPreferences } from "@/lib/preferences";
import { fetchTides, fetchWaterLevel } from "@/lib/noaa-coops";
import { fetchWeather, fetchAlerts } from "@/lib/nws";
import { computeAstro } from "@/lib/astro";
import { renderDailyBriefing } from "@/lib/email-briefing";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse(
      "Sign in to preview your daily briefing.",
      { status: 401, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const { searchParams } = new URL(request.url);
  const wantText = searchParams.get("text") === "1";
  const wantSubject = searchParams.get("subject") === "1";

  // Load the user's primary location and current preferences in parallel.
  const [locationsResult, prefsResult] = await Promise.all([
    loadLocations(),
    loadPreferences(),
  ]);
  const station = locationsResult.primary;
  const prefs = prefsResult.preferences;

  // Fetch the upstream data the email actually uses. (Buoy, marine,
  // rivers, tropical, air quality aren't in the email so we skip them.)
  // safe() mirrors the pattern from app/page.tsx — never throw, just
  // log and return null. Render handles missing sections gracefully.
  const safe = <T,>(p: Promise<T>) =>
    p.catch((e) => { console.error("[briefing-preview] fetch:", e); return null; });
  const [tides, weather, alerts, water] = await Promise.all([
    safe(fetchTides(station.tideStationId)),
    safe(fetchWeather(station.lat, station.lon, station.observationStationId)),
    station.nwsZone || station.marineZone
      ? safe(fetchAlerts([station.nwsZone, station.marineZone].filter(Boolean) as string[]))
      : Promise.resolve(null),
    safe(fetchWaterLevel(station.tideStationId)),
  ]);
  const astro = computeAstro(station.lat, station.lon);

  // Build the briefing context and render.
  const rendered = renderDailyBriefing({
    recipientName: user.name,
    recipientEmail: user.email ?? "",
    locationName: station.displayName,
    lat: station.lat,
    lon: station.lon,
    today: new Date(),
    weather,
    tides,
    water,
    alerts,
    astro,
    prefs,
    // Use the request's own origin so the in-email links work whether
    // you're on localhost, a preview deploy, or production. For the
    // actual cron-sent email (step 5) we'll use a stable env var
    // instead so the link is always tidevisor.com.
    appBaseUrl: new URL(request.url).origin,
  });

  if (wantSubject) {
    return new NextResponse(rendered.subject, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  if (wantText) {
    return new NextResponse(rendered.text, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  return new NextResponse(rendered.html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // No-cache for preview — we want every page reload to reflect the
      // current data and any tweaks to the renderer.
      "Cache-Control": "no-store",
    },
  });
}
