import type { Metadata } from "next";
import Link from "next/link";

// User-facing help / FAQ / about page. Lives in the (legal) route group
// so it inherits the same minimal chrome as Privacy and Terms — single
// long page with anchored sections, easy to skim, easy to maintain.
//
// Content is written as JSX (not markdown) to keep the styling
// consistent with the rest of the legal pages and to avoid pulling in
// a markdown renderer for ~1500 words. Reuses the same h1/h2/p/link
// helpers defined in app/(legal)/privacy/page.tsx (re-declared locally
// because Next's "use client" / Server Component split makes shared
// style objects awkward across pages).

export const metadata: Metadata = {
  title: "Help · Tidevisor",
  description:
    "How Tidevisor works: data sources, customization, troubleshooting, " +
    "and the difference between the free and Pro tiers.",
};

const CONTACT_EMAIL = "contact@tidevisor.com";

export default function HelpPage() {
  return (
    <article>
      <h1 style={h1}>Help &amp; reference</h1>
      <p style={subtle}>
        Quick reference for how Tidevisor pulls its data, how to customize
        what you see, and what the Pro tier unlocks. Skim the table of
        contents for the section you need.
      </p>

      <nav style={toc} aria-label="Help contents">
        <a href="#what" style={tocLink}>What is Tidevisor</a>
        <a href="#data" style={tocLink}>Where the data comes from</a>
        <a href="#stale" style={tocLink}>When data looks stale or wrong</a>
        <a href="#customize" style={tocLink}>Customizing your dashboard</a>
        <a href="#pro" style={tocLink}>Tidevisor Pro</a>
        <a href="#trouble" style={tocLink}>Troubleshooting</a>
        <a href="#limits" style={tocLink}>Known limitations</a>
        <a href="#contact" style={tocLink}>Contact</a>
      </nav>

      {/* ─── What is Tidevisor ──────────────────────────────────── */}
      <h2 id="what" style={h2}>What is Tidevisor</h2>
      <p>
        Tidevisor is a marine information dashboard for paddlers. It pulls
        tides, wind, weather, currents, river gauges, and alerts from
        official sources into a single screen so you can decide whether
        it&rsquo;s a paddleable day without bouncing between five apps.
      </p>
      <p>
        It is <strong>not</strong> a navigation app, an official safety
        product, or a substitute for checking the conditions yourself
        before you launch. The forecast tiles show what the experts predict;
        the live tiles show the last data the upstream sensors reported.
        Always verify what you see here against the actual water in front
        of you.
      </p>

      {/* ─── Data sources ──────────────────────────────────────── */}
      <h2 id="data" style={h2}>Where the data comes from</h2>
      <p>
        Every tile is backed by a public, government-run data source. We
        don&rsquo;t generate any of our own forecasts — the value is in
        bringing them together, surfacing the relevant slice for paddlers,
        and gracefully handling sensor outages.
      </p>

      <dl style={dlStyle}>
        <dt style={dt}>Tides &amp; live water level</dt>
        <dd style={dd}>
          <strong>NOAA CO-OPS</strong> — the same predictions and
          observations the National Weather Service uses. We point each
          saved location at the nearest <em>harmonic</em> station (full
          6-minute curve plus highs/lows). Some subordinate stations
          publish only highs/lows; for those we use the nearest harmonic
          station and surface a note about the time offset.
        </dd>

        <dt style={dt}>Forecast, alerts, hourly &amp; 7-day</dt>
        <dd style={dd}>
          <strong>National Weather Service (NWS)</strong> via api.weather.gov.
          Marine zones drive the offshore advisory banner; coastal zones
          drive the standard small-craft / gale / storm warnings.
        </dd>

        <dt style={dt}>Live wind</dt>
        <dd style={dd}>
          <strong>NOAA CO-OPS or NDBC buoys</strong>, with METAR as a
          fallback. We probe up to four stations per location in priority
          order and use the first one with fresh data (less than ~75
          minutes old). You can re-rank these in <em>Sources</em> per
          location.
        </dd>

        <dt style={dt}>Tidal currents</dt>
        <dd style={dd}>
          <strong>NOAA CO-OPS currents</strong> when a real current
          station exists nearby (rare on most of the SE US coast). Where
          one doesn&rsquo;t exist, we derive a reasonable estimate from
          the local tide curve.
        </dd>

        <dt style={dt}>Offshore waves &amp; sea-surface temp</dt>
        <dd style={dd}>
          <strong>NDBC buoys</strong> for stations that publish wave data;
          <strong> Open-Meteo</strong> marine model elsewhere. The
          model resolution is coarse (~10km) but covers anywhere a buoy
          doesn&rsquo;t.
        </dd>

        <dt style={dt}>Radar</dt>
        <dd style={dd}>
          <strong>RainViewer</strong> (free tier) — past 2 hours of
          precipitation overlays from US national radar mosaics. Forecast
          (nowcast) coverage is unreliable in some regions; see &ldquo;Known
          limitations&rdquo; below.
        </dd>

        <dt style={dt}>Tropical systems</dt>
        <dd style={dd}>
          <strong>National Hurricane Center</strong> — active Atlantic
          basin storms with cone-of-uncertainty awareness when one
          intersects your location.
        </dd>

        <dt style={dt}>Air quality</dt>
        <dd style={dd}>
          <strong>EPA AirNow</strong> — official US AQI for the nearest
          monitor.
        </dd>

        <dt style={dt}>Rivers</dt>
        <dd style={dd}>
          <strong>USGS Water Services</strong> — live discharge / gauge
          height for any USGS site ID you save.
        </dd>

        <dt style={dt}>Sun, moon, twilight, solunar</dt>
        <dd style={dd}>
          <strong>SunCalc</strong> — astronomical calculations from
          lat/lon and date. No external API call; pure math.
        </dd>

        <dt style={dt}>Map imagery</dt>
        <dd style={dd}>
          <strong>Esri World Imagery</strong> via the standard public
          embed.
        </dd>
      </dl>

      <p style={small}>
        We do not pay for any of these sources. If a tile is empty or
        slow, it&rsquo;s almost always because the upstream provider is
        having a moment — not because of anything we can fix
        client-side.
      </p>

      {/* ─── When data looks wrong ───────────────────────────── */}
      <h2 id="stale" style={h2}>When data looks stale or wrong</h2>
      <p>
        Real sensors break, drift, and go offline. We try to surface that
        clearly rather than silently showing yesterday&rsquo;s reading.
      </p>
      <p>
        <strong>Stale dots in the wind / tide / observation picker.</strong>{" "}
        When you add or edit a location, candidate stations show a green
        dot (data within the last hour or two) or an amber dot (no recent
        data — probably a broken sensor). Picking a station with an amber
        dot is allowed but you&rsquo;ll likely see blanks until that
        sensor comes back online.
      </p>
      <p>
        <strong>Swap a broken source.</strong> Open the location picker,
        tap <em>Sources</em> on the location you want to fix, and select
        a different station from the candidates list. The change applies
        immediately to your next dashboard render.
      </p>
      <p>
        <strong>Hidden tiles for inland locations.</strong> If you save a
        spot far from the coast, the marine / buoy / current tiles
        won&rsquo;t render because there&rsquo;s no relevant station
        nearby. That&rsquo;s intentional — better an absent tile than a
        confusing one.
      </p>

      {/* ─── Customizing ──────────────────────────────────────── */}
      <h2 id="customize" style={h2}>Customizing your dashboard</h2>
      <p>
        <strong>Locations.</strong> Tap the location pill at the top of
        the dashboard. From there you can search by town or zip, drop a
        pin on a map, or use your current GPS location. Free accounts can
        save up to 3 locations; Pro removes the cap.
      </p>
      <p>
        <strong>Data sources per location.</strong> Inside the location
        picker, hit <em>Sources</em> on any saved spot to swap tide /
        observation / wind / buoy / marine-zone stations. Useful when a
        sensor goes dark or you want offshore wind instead of a sheltered
        in-creek station.
      </p>
      <p>
        <strong>Tile layout.</strong> Open Preferences (gear icon in the
        top bar) and scroll to <em>Tile layout</em>. You can hide tiles
        you don&rsquo;t use and reorder the rest. Tile reordering is free
        for all users.
      </p>
      <p>
        <strong>Rivers.</strong> Open the Rivers tile&rsquo;s editor to
        add or remove USGS site IDs. The defaults are Georgia / South
        Carolina spots; replace them with whatever you actually paddle.
      </p>
      <p>
        <strong>Units, theme, time format.</strong> All in Preferences.
        Choices sync across devices when signed in; guests get
        device-local storage instead.
      </p>

      {/* ─── Pro ──────────────────────────────────────────────── */}
      <h2 id="pro" style={h2}>Tidevisor Pro</h2>
      <p>
        The free tier is meant to be genuinely useful on its own — one
        well-curated location, every dashboard tile, customizable
        layout, daily-briefing email turned off, GPS tracking on the
        map, no ads, no analytics. Pro adds the convenience features that
        make the app actively part of your paddling routine.
      </p>
      <p><strong>What Pro includes:</strong></p>
      <ul style={ul}>
        <li>Up to 6 saved locations (vs. 3 on free)</li>
        <li>Daily briefing email — one-screen summary delivered at your chosen hour</li>
        <li>Custom per-location data source picker</li>
        <li>The future Pro Weather tile (forecast radar, wind streamlines, multi-layer toggles)</li>
        <li>First crack at upcoming features like trip planning and route tracking</li>
      </ul>

      <p><strong>Pricing:</strong></p>
      <ul style={ul}>
        <li>Monthly — $2.99/mo, cancel any time</li>
        <li>Annual — $19/year (~47% off vs. monthly)</li>
        <li>Lifetime — $59 once, never renews</li>
      </ul>

      <p>
        Manage your subscription any time from the account menu →
        <em>Manage subscription</em>, which opens Stripe&rsquo;s billing
        portal where you can switch plans, update your card, or cancel.
        See <Link href="/upgrade" style={link}>the upgrade page</Link> for
        the full breakdown.
      </p>

      <p>
        <strong>Refunds.</strong> Within 7 days of purchase, no questions
        asked. Email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>{" "}
        and we&rsquo;ll process it.
      </p>

      <p>
        <strong>Beta-tester codes.</strong> If someone shared a code with
        you, sign in, open Preferences from the account menu, and paste
        it into the <em>Redeem code</em> field at the top. Each code
        grants a fixed window (typically 30 days) of Pro — no card
        required.
      </p>

      {/* ─── Troubleshooting ────────────────────────────────── */}
      <h2 id="trouble" style={h2}>Troubleshooting</h2>

      <p>
        <strong>Daily briefing email never arrives.</strong> Check three
        things, in order: (1) the toggle in Preferences → Daily briefing
        is actually on, (2) the email address on your account is correct
        (look in the account menu), (3) it&rsquo;s past the hour you
        scheduled it for (we deliver within ~5 minutes of the chosen
        hour, Eastern). If all three check out and you still aren&rsquo;t
        getting them, check your spam folder for &ldquo;Tidevisor&rdquo;
        and add the sender to your contacts.
      </p>

      <p>
        <strong>Wind shows &ldquo;no data&rdquo; or feels obviously
        wrong.</strong> The station you&rsquo;re reading from probably
        went stale. Open the location picker → Sources, and pick a
        different wind station from the candidates list. Stations with a
        green dot are reporting fresh data right now.
      </p>

      <p>
        <strong>Dashboard feels slow on first load.</strong> The very
        first request fans out to ~10 upstream APIs. After that, our
        cache holds most of it for 5 minutes so subsequent loads should
        be near-instant. If the first load takes more than 10 seconds,
        usually one of the upstream APIs is throttling — refresh in a
        minute and it&rsquo;ll usually clear up.
      </p>

      <p>
        <strong>Pro features didn&rsquo;t unlock after I paid.</strong>{" "}
        Stripe&rsquo;s confirmation hits us via webhook, which usually
        completes in a few seconds. If it&rsquo;s been more than a
        minute, hard-refresh the dashboard. If still nothing, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>{" "}
        with the email you used at checkout and we&rsquo;ll sort it
        manually.
      </p>

      <p>
        <strong>I redeemed a code but don&rsquo;t see Pro.</strong> Try
        refreshing the dashboard. The redemption is instant on the
        server side but the in-page Pro badge updates on the next render.
      </p>

      {/* ─── Limitations ───────────────────────────────────── */}
      <h2 id="limits" style={h2}>Known limitations</h2>
      <p>
        <strong>Radar nowcast in the SE US.</strong> RainViewer&rsquo;s
        free-tier forecast frames are reliably empty for much of the
        Southeast. We retry, but in practice you&rsquo;ll usually see
        only the past 2 hours, not the future. A more reliable nowcast
        is on the roadmap as part of the Pro Weather tile.
      </p>

      <p>
        <strong>Timezone is currently US Eastern.</strong> All
        &ldquo;today&rdquo; math (briefing emails, 30-day tide outlook,
        the daily window highlights) assumes America/New_York. West Coast
        paddlers can still use everything; the day boundaries will just
        be shifted. Per-location timezones are on the roadmap.
      </p>

      <p>
        <strong>Inland-paddler coverage is improving.</strong> The
        resolver still leans coastal — if you save an inland river spot,
        you may see empty tide or marine tiles. The river gauges and
        forecast tiles work fine. We&rsquo;re working on graceful
        hide-the-irrelevant-tiles behavior.
      </p>

      <p>
        <strong>Nautical chart tile.</strong> Temporarily removed from
        the dashboard while we build a proper chart-based route planner
        as a Pro feature. The free satellite map (with GPS tracking)
        still works.
      </p>

      {/* ─── Contact ──────────────────────────────────────── */}
      <h2 id="contact" style={h2}>Contact</h2>
      <p>
        Bug reports, feature requests, refunds, paddle-club bulk codes —
        all the same address:{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>.
        We&rsquo;re a small operation; expect a response within a day or
        two.
      </p>
      <p>
        For legal questions or data-handling concerns, see our{" "}
        <Link href="/privacy" style={link}>Privacy Policy</Link> and{" "}
        <Link href="/terms" style={link}>Terms of Service</Link>.
      </p>
    </article>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const h1: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 800,
  margin: "0 0 8px",
  letterSpacing: "-.5px",
};

const h2: React.CSSProperties = {
  fontSize: 20,
  fontWeight: 700,
  margin: "32px 0 12px",
  paddingTop: 8,
  borderTop: "1px solid var(--border-soft)",
  scrollMarginTop: "20px",
};

const subtle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
  margin: "0 0 12px",
};

const small: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  fontStyle: "italic",
};

const link: React.CSSProperties = {
  color: "var(--accent)",
  textDecoration: "underline",
};

const toc: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  padding: "12px 14px",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  margin: "20px 0 8px",
};

const tocLink: React.CSSProperties = {
  fontSize: 12,
  color: "var(--accent)",
  textDecoration: "none",
  padding: "4px 8px",
  borderRadius: 999,
  background: "var(--bg-elev-2)",
};

const dlStyle: React.CSSProperties = {
  margin: "12px 0 20px",
};

const dt: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 14,
  marginTop: 14,
};

const dd: React.CSSProperties = {
  margin: "4px 0 0 0",
  fontSize: 14,
  color: "var(--text)",
};

const ul: React.CSSProperties = {
  margin: "6px 0 14px 20px",
  padding: 0,
  fontSize: 14,
  lineHeight: 1.7,
};
