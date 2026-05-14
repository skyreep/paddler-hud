# Paddler HUD — Next.js scaffold

Working Next.js 14 (App Router) + TypeScript + Tailwind scaffold that pulls real
data from NOAA, NWS, NDBC, USGS, and (optionally) EPA AirNow, and renders the
HUD tiles defined in the planning doc.

## Quick start

```bash
npm install
cp .env.example .env.local
# Edit .env.local: set NWS_USER_AGENT to your name + email
# (Optional) Get a free AirNow key and paste into AIRNOW_API_KEY
npm run dev
```

Open http://localhost:3000 — it defaults to **Tybee Island, GA**.

Switch locations by URL query string while the location-picker UI is being built:

- `?station=tybee` (default)
- `?station=hilton`
- `?station=beaufort`
- `?station=charleston`
- `?gauges=02198840,02202500,02226000` — comma-separated USGS site IDs (max 5)

## Project layout

```
app/
  api/
    tides/route.ts          NOAA CO-OPS today + 7-day H/L
    currents/route.ts       Tidal current predictions (knots)
    water-level/route.ts    Live water level + surge anomaly
    weather/route.ts        NWS current + 24-hr hourly + 7-day daily
    alerts/route.ts         Active NWS alerts for zones
    rivers/route.ts         USGS river gauges (1-5)
    buoy/route.ts           NDBC buoy parser (waves, period, SST)
    astro/route.ts          SunCalc-derived astronomy
    air-quality/route.ts    EPA AirNow (needs API key)
    tropical/route.ts       NHC active storms + Tropical Weather Outlook
  page.tsx                  Server component — fetches all sources in parallel, renders HUD
  layout.tsx, globals.css

components/
  TopBar.tsx                Sticky header w/ theme toggle (client component)
  tiles/                    One component per HUD tile

lib/
  types.ts                  Shared response shapes
  stations.ts               Tybee/Hilton/Beaufort/Charleston station bundles
  beaufort.ts               kt→Beaufort + cardinal direction
  noaa-coops.ts             Tide, current, water-level fetchers
  nws.ts                    Weather + alerts
  ndbc.ts                   Buoy text-format parser
  usgs.ts                   River gauges + flood-stage table
  astro.ts                  SunCalc wrapper
  airnow.ts                 Air quality (key-gated, degrades to null)
  nhc.ts                    Tropical cyclone fetcher + haversine distance
```

## Caching

Each `fetch()` in `lib/*` sets its own `next.revalidate` window so Next.js
caches at the edge. Tide predictions revalidate every 30 min (effectively
static); live water level every 5 min; weather every 15 min; alerts every
60 sec. This keeps us well under government-API polite-use limits even with
many users.

## Data source notes

- **NOAA CO-OPS** — no key, no CORS, polite-use rate limit. Polling friendly.
- **NWS api.weather.gov** — no key, but *requires* a `User-Agent` header.
  Set `NWS_USER_AGENT` in `.env.local` to your name and contact email.
- **NDBC** — text format (not JSON). The parser is in `lib/ndbc.ts`.
- **USGS Water Services** — JSON, no key. Returns instantaneous values with
  several hours of history. Flood stages come from a small built-in table
  in `lib/usgs.ts`; in production this should be replaced by NWS AHPS scraping.
- **EPA AirNow** — needs a free API key from <https://docs.airnowapi.org/>.
  If `AIRNOW_API_KEY` is empty, the AQI display is omitted gracefully.
- **Astronomy** — computed locally with the `suncalc` library, USNO-compatible
  to within ~1 minute for any location/date in the modern era. No network call.
- **Open-Meteo** — used as the primary source for two pieces NWS+NDBC don't
  reliably cover on this coast: UV index (NWS gridpoint office support is
  inconsistent for the Lowcountry) and marine wave height/period/direction/SST
  (coastal NDBC buoys here often lack wave instruments). Open-Meteo is free,
  requires no key, and has no rate limit for non-commercial use.
- **Tidal currents** — When NOAA has no current-prediction station nearby
  (which is the case for almost the entire Lowcountry coast), the HUD derives
  currents from the rate-of-change of the tide curve, calibrated for the
  region (~1.3 kt per ft/hr of tide change). This is the same approach
  TideLog uses. The CurrentTile labels itself "Derived" in that case.

## What's intentionally not here yet

- **Auth / user accounts.** Supabase wiring is on the Phase-4 list. For now,
  station and gauge selection lives in the URL.
- **Stripe billing.** Phase 4.
- **PWA / offline.** Phase 3 polish.
- **Push notifications.** Phase 5.

## Try the API routes directly

While the page is running:

```
http://localhost:3000/api/tides?station=tybee
http://localhost:3000/api/weather?station=tybee
http://localhost:3000/api/alerts?station=tybee
http://localhost:3000/api/buoy?id=41008
http://localhost:3000/api/rivers?ids=02198840,02202500
http://localhost:3000/api/astro?station=tybee
http://localhost:3000/api/tropical?station=tybee
```
