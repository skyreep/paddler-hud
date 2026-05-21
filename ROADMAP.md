# Tidevisor — Business Roadmap

A working document for monetization, feature tiers, and pre-launch priorities. Update freely as decisions evolve.

## Pricing structure

Hybrid model: cheap recurring + lifetime option to capture both market segments.

| Plan       | Price        | Notes                                                                 |
| ---------- | ------------ | --------------------------------------------------------------------- |
| Free       | $0           | Single location, all baseline tiles. Genuinely useful on its own.     |
| Monthly    | $2.99 / mo   | Low-commitment entry point. Easy to cancel.                           |
| Annual     | $19 / year   | ~47% off vs monthly. The recommended default for active paddlers.     |
| Lifetime   | $59 one-time | Captures subscription-averse users. Upfront cash, no churn liability. |

At a target of ~$300/month gross, this corresponds roughly to:

- 100 annual subscribers ($19 ÷ 12 ≈ $158/mo), OR
- 100 monthly subscribers ($299/mo), OR
- 5 lifetime sales/month ($295/mo)
- Realistically a blended mix of all three.

## Payment infrastructure

Decision: **web-only Stripe sales, no IAP**.

Apps will be sign-in-only for premium users. The app authenticates against the same Supabase account; subscription state is read from the DB to gate features. Users purchase on tidevisor.com and the unlock propagates to all their devices.

Apple's "reader app" / "multi-platform service" rules explicitly allow this. The constraint: the apps must not mention or link to off-app payment surfaces. So premium-gated screens in the app say "Pro feature" without pointing to the website — users find their way there organically.

Why not IAP: avoids the 15–30% platform cut, reduces operational complexity (one webhook stream instead of three), keeps margins healthy at small scale. Can be revisited if app-store conversion data ever justifies it.

## Feature tiers

### Free tier

Generous enough that someone could happily use Tidevisor without ever upgrading.

- One saved location with full data resolution
- All current dashboard tiles: Right Now, Wind Now, Satellite Map, Nautical Chart, Tide Today, Currents, Tide 30-Day, Hourly Forecast, 7-Day Forecast, Radar, Marine, Rivers, Tropical, Sun/Moon/Twilight, Solunar
- Map satellite view with one-shot "center on my location"
- Tile layout reordering (basic UX customization should never be paid)
- Theme, unit, time-format preferences
- Email account + cross-device sign-in

### Premium ("Tidevisor Pro")

Power-user and convenience features. The kind of things active paddlers will pay $19/year for.

- Unlimited saved locations
- Daily briefing email (real ops cost on our end; classic SaaS gate)
- GPS heading tracking on satellite map (the "navigate with this open" mode)
- Custom data-source selection per location (per-location wind/tide/obs picker)
- Custom alerts: SMS or push when wind drops below X, tide crosses Y, or an alert fires for a saved zone
- **Pro Weather tile** — forecast radar (reliable nowcast everywhere), wind streamlines, multi-layer toggles (precip, wind, temp, clouds, pressure). The Windy-style visualizations free users don't get.

### Not gated (philosophical choices)

- Tile layout reordering — feels punitive to gate
- The Right Now tile — most-used surface should be the most generous
- Daily briefing email *configuration screen* visible to all — the gate is on the "save" action

## Future premium-tier features

Pipeline of ideas for post-launch development. Roughly ordered by user value.

0. **Premium weather visualizations (Windy-style)** — A separate "Pro Weather" tile that goes well beyond what the free radar can offer. Three sub-features, layered:
   - **Forecast radar** — actual nowcast/forecast precipitation animation. Two paths to pick between:
     - **RainViewer paid tier** ($25/mo) — drop-in replacement for our current overlay with reliable nowcast in all US regions. Lowest effort.
     - **NOAA HRRR simulated reflectivity** — free but requires a tile-rendering pipeline (GRIB2 → PNG tiles → CDN). 1–2 days of work to set up. Best long-term economics.
   - **Multi-layer toggles** — wind speed, wind gusts, precipitation, temperature, cloud cover, pressure isobars. Most are available from Open-Meteo's tile endpoints or can be derived from forecast points.
   - **Animated wind streamlines (the Windy hero feature)** — particle-flow visualization of wind direction/speed across the map. JS libraries exist (windy.com is open-source-adjacent; `leaflet-velocity` renders GRIB-style wind fields). Hardest to ship but visually striking.
   - **Implementation hint**: consider just embedding Windy's iframe initially. They allow non-commercial embeds; commercial use needs a paid agreement. Cheap MVP to validate the premium feature before building from scratch.

1. **Trip planning** — drop waypoints, get tide-aware route suggestions ("launch within this window for slack-water timing"), save trip templates for repeat paddles.
2. **Track recording** — record your paddle as GPX, view past trips with stats (distance, pace, elapsed time). Storage cost is real but small.
3. **Shared locations** — paddle buddy sends you their saved spot with one tap. Viral growth mechanic.
4. **Forecast comparison** — side-by-side comparison of two locations to pick the better paddle for tomorrow.
5. **Historical data** — "what were conditions like last Saturday at noon?" Backed by a periodic snapshot job.
6. **Multi-day briefing emails** — weekend forecast, race-day forecast, etc. on demand.
7. **Group / club features** — shared saved locations across a paddle club. B2B angle.
8. **Float plans** — file an electronic float plan with a designated contact; auto-checks-in based on GPS, alerts them if no return by ETA.
9. **Weather model selection** — let power users pick between NWS, ECMWF, GFS for the 7-day.

## Pre-launch priorities (must ship before paid launch)

These improvements are blocking the paid rollout because they undermine the value proposition of the product or limit the addressable market.

### 1. Improved weather radar
**Status**: Mostly done. Cross-fade animation, zoom-to-z14 with upscaling, slower uniform playback all shipped. Radar timer-leak bug (multiplying timers under React StrictMode) fixed.

**Remaining limitation**: RainViewer's free nowcast doesn't reliably cover the SE US (confirmed empty for Georgia paddling locations). The retry logic still polls in case coverage appears, but in practice futurecast will be empty for our primary user base. UI gracefully hides forecast-related elements when frames are unavailable.

**Forecast radar is now deferred to premium tier** (see "Premium-tier weather visualizations" below).

### 2. National-scale timezone support
Tidevisor today assumes America/New_York for most "today" math (briefing emails, tile-month tide windows, station-day calculations). To support West Coast and inland paddlers, this must become per-location.

**Investigation areas**:
- `lib/time.ts` STATION_TZ is hardcoded. Refactor to derive TZ per-station from lat/lon at location-creation time. Library: `tz-lookup` (pure JS, ~150KB, no network dependency).
- Each saved location needs a `tz: string` (IANA name like "America/Los_Angeles") stored in `locations` table. Migration required.
- Daily briefing renderer and cron need to fire at the user's local time, not Eastern. Means the cron handler iterates over delivery-eligible users by computing "is it currently their delivery hour in their location's tz?"
- Tile-month, hourly, weekly all use `stationDayStart()` which depends on STATION_TZ — refactor to take a tz param.
- Astro: SunCalc handles UTC internally; we just need to format display strings in location-local time. Mostly already correct since we accept a tf arg.

### 3. Inland-paddler friendliness
Many of our features apply to inland (river/lake) paddlers, but the current resolver leans coastal. Once timezones are fixed:
- Tide tile should gracefully hide rather than show "no tide data" for inland locations.
- Marine zone tile should hide for inland.
- Buoy tile should hide.
- Currents tile should hide (or show river current from USGS if available).
- Sun/moon, weather, radar, rivers, solunar, astro should all work nationwide already.
- Verify location resolver handles inland coordinates without trying to attach coastal stations.

### 4. Stripe integration (parallel work)
Scaffolding can proceed in parallel with the above. The infrastructure is needed regardless.

**Scope**:
- Stripe account setup (manual)
- DB schema additions: `subscriptions` table or columns on `profiles` for `stripe_customer_id`, `subscription_status`, `subscription_tier`, `current_period_end`, `lifetime_purchase_at`
- Stripe Checkout flow on web (`/upgrade` page)
- Webhook handler at `/api/stripe/webhook` (subscription.created/updated/deleted, invoice.paid, etc.)
- Customer portal link for self-service management
- Feature-gating helpers: server-side `requirePremium()` and client-side conditional UI
- Receipt emails (Stripe handles natively)

## Operational cost considerations

Current monthly burn at zero users (just Skyler):
- Vercel: $0 (Hobby tier)
- Supabase: $0 (free tier)
- Email via Resend: $0 (free tier up to 3k/month)
- MapTiler (if/when added): $0 (free tier 100k loads/month)
- Domain: ~$1/month amortized

At ~1000 users:
- Vercel: probably still $0, maybe $20/mo if function invocations spike
- Supabase: probably still $0; storage and reads scale fine
- Resend: still likely under free tier if briefing adoption is ~30%
- Total: ~$0–25/month

At ~5000 users with 25% premium adoption:
- Vercel: $20/mo Pro tier likely required
- Supabase: $25/mo Pro tier for higher row counts + auth volume
- Resend: $20/mo paid tier for higher send volumes
- Total: ~$65/mo
- Revenue at 25% × 5000 × ~$15/yr blended ARPU: ~$1500/mo
- Margin: ~95%

## Marketing & launch notes

Channels to pursue when ready:
- r/Kayaking (100k+ subs), r/SeaKayaking (smaller but enthusiast-dense)
- r/Surfing, r/Sailing for adjacent communities
- NACK forums (kayakers.org)
- Regional paddle-club newsletters (Maine, Georgia, Pacific NW have active clubs)
- Outfitter blogs/partnerships (offer them a referral code)
- Coastal Living / Outside magazine pitching if a feature angle exists
- YouTube paddler influencers (small but loyal audiences)

Launch sequence ideas:
1. Soft launch: free tier only, gather usage data and feedback for 4–8 weeks.
2. Paid launch: introduce Pro tier with grandfathered "founding paddler" discount (e.g. $39 lifetime for first 100 users).
3. Open call for testimonials/reviews on launch day.

## Open questions / decisions to make later

- Refund policy: 7 days no-questions-asked? Pro-rata?
- Education / nonprofit pricing for paddle clubs?
- Bundling: should locations + alerts be sub-tiers within Pro, or all-or-nothing?
- Family plan? Probably premature.
- Affiliate / referral program?
- App store listing strategy — submit iOS first, Android once iOS is stable.

## Realistic targets

| Timeframe   | Total signups | Pro conversions | Monthly revenue |
| ----------- | ------------- | --------------- | --------------- |
| Launch + 3mo | 200–500      | 5–20            | $25–150         |
| Launch + 12mo | 1k–3k       | 50–150          | $150–500        |
| Launch + 24mo | 3k–8k       | 150–500         | $400–1500       |

These are honest indie-utility-app numbers. Paddling is a real community but a niche one; growth will be steady, not viral. The lifetime tier may produce occasional larger one-time hits that don't follow these monthly numbers.
