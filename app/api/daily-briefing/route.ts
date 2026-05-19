// Daily-briefing cron endpoint. Hit hourly by Vercel Cron (see
// vercel.json in step 6). On each call:
//
//   1. Compute the current hour in America/New_York.
//   2. Query user_preferences for everyone with daily_briefing_enabled
//      = true AND daily_briefing_hour = <that hour>.
//   3. For each matching user: load their primary location, fetch the
//      same upstream data the dashboard does (weather/tides/water/
//      alerts/astro), render the email, send via Resend.
//
// Authentication: a shared secret in the Authorization header, checked
// against CRON_SECRET. Vercel Cron sets this automatically; for manual
// testing you'd pass `Authorization: Bearer <CRON_SECRET>` yourself.
//
// Query flags (for testing):
//   ?dryrun=1   skip Resend, return rendered email metadata instead
//   ?hour=N     override "current hour" (0-23) — useful to test without
//               waiting for the wall clock to match a real opted-in user
//
// Per-user errors are caught and logged but never block subsequent users.
// The endpoint always returns a JSON summary of who got what.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchTides, fetchWaterLevel } from "@/lib/noaa-coops";
import { fetchWeather, fetchAlerts } from "@/lib/nws";
import { computeAstro } from "@/lib/astro";
import { renderDailyBriefing } from "@/lib/email-briefing";
import type { UserPreferences, WindStationRef } from "@/lib/types";

// ─── Auth helper ─────────────────────────────────────────────────────────

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    // No secret set means the route is effectively open. Refuse rather
    // than allowing all callers, since this endpoint can send mail.
    return false;
  }
  const header = request.headers.get("authorization");
  return header === `Bearer ${secret}`;
}

// ─── Time helpers ────────────────────────────────────────────────────────

/** Current hour-of-day in America/New_York (0-23). The cron's wall
 *  clock is UTC; convert here so we match the hour the user picked. */
function currentEasternHour(): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    hour12: false,
  });
  return parseInt(fmt.format(new Date()), 10);
}

// ─── Resend wrapper ──────────────────────────────────────────────────────

interface SendArgs {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

async function sendViaResend(args: SendArgs): Promise<{ ok: boolean; id?: string; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    return { ok: false, error: `Resend ${res.status}: ${body}` };
  }
  const data = await res.json() as { id?: string };
  return { ok: true, id: data.id };
}

// ─── Per-user processing ────────────────────────────────────────────────

type Admin = NonNullable<ReturnType<typeof createAdminClient>>;

interface BriefingResult {
  userId: string;
  email: string | null;
  ok: boolean;
  skipped?: string;
  error?: string;
  messageId?: string;
  subject?: string;
}

async function processUser(
  admin: Admin,
  userId: string,
  prefsRow: Record<string, unknown>,
  dryrun: boolean,
): Promise<BriefingResult> {
  // 1. Look up user info (email + name)
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
  if (userError || !userData?.user?.email) {
    return { userId, email: null, ok: false, skipped: "no_email" };
  }
  const recipientEmail = userData.user.email;
  const meta = (userData.user.user_metadata ?? {}) as Record<string, unknown>;
  const recipientName =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    null;

  // 2. Load primary location (or first row by sort_order if no primary).
  const { data: locRows, error: locError } = await admin
    .from("user_locations")
    .select(
      "id, display_name, lat, lon, tide_station_id, tide_station_note, " +
        "observation_station_id, wind_stations, buoy_id, nws_zone, " +
        "marine_zone, sort_order, is_primary",
    )
    .eq("user_id", userId)
    .order("is_primary", { ascending: false })
    .order("sort_order", { ascending: true })
    .limit(1);
  if (locError || !locRows || locRows.length === 0) {
    return { userId, email: recipientEmail, ok: false, skipped: "no_location" };
  }
  const loc = locRows[0];

  // 3. Project to the values the upstream fetchers want.
  const tideStationId = String(loc.tide_station_id ?? "");
  const obsStation = loc.observation_station_id ? String(loc.observation_station_id) : "";
  const nwsZone = loc.nws_zone ? String(loc.nws_zone) : "";
  const marineZone = loc.marine_zone ? String(loc.marine_zone) : "";
  const lat = Number(loc.lat);
  const lon = Number(loc.lon);
  if (!tideStationId || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { userId, email: recipientEmail, ok: false, skipped: "bad_location_data" };
  }

  // 4. Fetch upstream data — same pattern as page.tsx + the preview
  // route. Per-fetch failures degrade to null; the renderer collapses
  // any section it doesn't have data for.
  const safe = <T,>(p: Promise<T>) =>
    p.catch((e) => { console.error(`[briefing-cron ${userId}] fetch:`, e); return null; });
  const zoneList = [nwsZone, marineZone].filter((z) => z && z.length > 0);
  const [tides, weather, alerts, water] = await Promise.all([
    safe(fetchTides(tideStationId)),
    obsStation
      ? safe(fetchWeather(lat, lon, obsStation))
      : Promise.resolve(null),
    zoneList.length > 0 ? safe(fetchAlerts(zoneList)) : Promise.resolve(null),
    safe(fetchWaterLevel(tideStationId)),
  ]);
  const astro = computeAstro(lat, lon);

  // 5. Build the preferences object from the prefs row.
  const prefs: UserPreferences = {
    theme: coerceEnum(prefsRow.theme, ["light", "dark", "auto"], "auto"),
    unitsWind: coerceEnum(prefsRow.units_wind, ["kt", "mph", "all"], "kt"),
    unitsTemp: coerceEnum(prefsRow.units_temp, ["F", "C"], "F"),
    unitsHeight: coerceEnum(prefsRow.units_height, ["ft", "m"], "ft"),
    timeFormat: coerceEnum(prefsRow.time_format, ["12h", "24h"], "12h"),
    tileConfig: (prefsRow.tile_config ?? {}) as UserPreferences["tileConfig"],
    dailyBriefingEnabled: Boolean(prefsRow.daily_briefing_enabled),
    dailyBriefingHour: Number(prefsRow.daily_briefing_hour ?? 6),
    updatedAt: String(prefsRow.updated_at ?? new Date().toISOString()),
  };

  // Wind stations from the location row aren't currently used by the
  // email (no real-time wind section), but reading them keeps the
  // future-proofing parity with the dashboard's loader.
  const _windStations: WindStationRef[] = Array.isArray(loc.wind_stations)
    ? (loc.wind_stations as unknown[])
      .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
      .filter((w) => (w.kind === "coops" || w.kind === "ndbc") && typeof w.id === "string")
      .map((w) => ({ kind: w.kind as "coops" | "ndbc", id: String(w.id) }))
    : [];

  // 6. Render the email.
  const appBaseUrl = process.env.APP_BASE_URL ?? "https://tidevisor.com";
  const rendered = renderDailyBriefing({
    recipientName,
    recipientEmail,
    locationName: String(loc.display_name ?? ""),
    lat,
    lon,
    today: new Date(),
    weather,
    tides,
    water,
    alerts,
    astro,
    prefs,
    appBaseUrl,
  });

  // 7. Send (or skip in dryrun mode).
  if (dryrun) {
    return {
      userId,
      email: recipientEmail,
      ok: true,
      skipped: "dryrun",
      subject: rendered.subject,
    };
  }

  const from = process.env.RESEND_FROM_EMAIL ?? "Tidevisor <noreply@auth.tidevisor.com>";
  const sendResult = await sendViaResend({
    to: recipientEmail,
    from,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (!sendResult.ok) {
    return { userId, email: recipientEmail, ok: false, error: sendResult.error };
  }
  return {
    userId,
    email: recipientEmail,
    ok: true,
    messageId: sendResult.id,
    subject: rendered.subject,
  };
}

function coerceEnum<T extends string>(v: unknown, allowed: T[], fallback: T): T {
  return typeof v === "string" && (allowed as string[]).includes(v) ? (v as T) : fallback;
}

// ─── Route handler ──────────────────────────────────────────────────────

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { ok: false, error: "Service role not configured (set SUPABASE_SERVICE_ROLE_KEY)" },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(request.url);
  const dryrun = searchParams.get("dryrun") === "1";
  const hourOverride = searchParams.get("hour");
  const targetHour =
    hourOverride != null && /^\d+$/.test(hourOverride)
      ? Math.max(0, Math.min(23, parseInt(hourOverride, 10)))
      : currentEasternHour();

  // Find opted-in users for this hour.
  const { data: prefRows, error: queryError } = await admin
    .from("user_preferences")
    .select("*")
    .eq("daily_briefing_enabled", true)
    .eq("daily_briefing_hour", targetHour);
  if (queryError) {
    return NextResponse.json({ ok: false, error: queryError.message }, { status: 500 });
  }

  // Iterate sequentially with a small delay between sends. Resend's
  // free tier allows much higher throughput than this, but staying
  // polite keeps logs clean and avoids any edge-case rate limiting.
  const results: BriefingResult[] = [];
  for (const prefRow of prefRows ?? []) {
    const userId = String(prefRow.user_id);
    try {
      const r = await processUser(admin, userId, prefRow, dryrun);
      results.push(r);
    } catch (err) {
      console.error(`[briefing-cron ${userId}] crashed:`, err);
      results.push({
        userId,
        email: null,
        ok: false,
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
    if (!dryrun && (prefRows?.length ?? 0) > 1) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  const sent = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;

  return NextResponse.json({
    ok: true,
    targetHour,
    dryrun,
    counts: { matched: results.length, sent, skipped, failed },
    results,
  });
}

export async function POST(request: NextRequest) { return handle(request); }
// GET is allowed too so Vercel Cron's GET trigger works without
// configuration acrobatics. Same auth check applies.
export async function GET(request: NextRequest) { return handle(request); }
