// Pure render function for the daily briefing email.
//
// Takes a fully-fetched BriefingContext (user info + location + all the
// upstream data the dashboard normally fetches + user prefs) and returns
// { subject, html, text }. No network calls, no DB calls, no side
// effects — this file is dependency-free at runtime so it's trivial to
// unit-test or preview in a browser.
//
// Design choices:
//   - "Compact text-first" layout: one screen, scannable, no inline SVG
//     or charts. Robust across Gmail / Apple Mail / Outlook web / iOS Mail.
//   - All styles inline. Gmail and Outlook web strip <style> blocks.
//   - 600px max width. System fonts (-apple-system → Segoe UI → Roboto).
//   - Light-mode color palette only. Dark-mode email rendering across
//     clients is inconsistent enough that we use light colors that
//     remain readable when clients auto-invert.
//   - Respects the user's unit + time-format preferences from
//     user_preferences so the email matches what they see on the HUD.

import type {
  AlertsResponse,
  AstroResponse,
  TideExtreme,
  TideResponse,
  UserPreferences,
  WaterLevelResponse,
  WeatherResponse,
} from "./types";
import { fmtTime, stationDayStart, STATION_TZ } from "./time";
import { fmtTemp, fmtHeight, fmtWind, ktToMph } from "./units";

// ─── Public types ────────────────────────────────────────────────────────

export interface BriefingContext {
  /** Optional display name from user_metadata. Used to personalize the
   *  greeting. Falls back to "there" / no greeting if absent. */
  recipientName: string | null;
  recipientEmail: string;
  locationName: string;
  lat: number;
  lon: number;
  /** Today's date (Eastern). Pre-computed by the caller so we don't
   *  drift on edge cases like cron running at 23:59 vs 00:01. */
  today: Date;
  weather: WeatherResponse | null;
  tides: TideResponse | null;
  water: WaterLevelResponse | null;
  alerts: AlertsResponse | null;
  astro: AstroResponse;
  prefs: UserPreferences;
  /** Base URL for in-email links. e.g. "https://tidevisor.com". No
   *  trailing slash. */
  appBaseUrl: string;
}

export interface RenderedBriefing {
  subject: string;
  html: string;
  text: string;
}

// ─── Main entry point ────────────────────────────────────────────────────

export function renderDailyBriefing(ctx: BriefingContext): RenderedBriefing {
  const data = computeBriefingData(ctx);
  return {
    subject: data.subject,
    html: renderHtml(data, ctx),
    text: renderText(data, ctx),
  };
}

// ─── Compute display strings from raw data ───────────────────────────────

interface BriefingData {
  subject: string;
  greeting: string;
  dateLabel: string;
  verdict: { headline: string; detail: string; tone: "good" | "warn" | "bad" };
  /** Today's full NWS forecast — hi/lo + short headline + prose. */
  forecast: {
    hi: string;
    lo: string;
    shortForecast: string;
    detailedForecast: string | null;
  } | null;
  conditions: Array<{ label: string; value: string }> | null;
  tideRows: Array<{ label: string; time: string; height: string }> | null;
  tideNote: string | null;
  windSummary: string | null;
  /** Sun + moon events for today. Null entries (e.g. no moonrise in
   *  this 24h cycle) are filtered before this list is built. */
  sunMoon: Array<{ icon: string; label: string; value: string }> | null;
  alertLines: Array<{ headline: string; description: string; severity: string }>;
  solunarLines: string[];
  appUrl: string;
  settingsUrl: string;
}

function computeBriefingData(ctx: BriefingContext): BriefingData {
  const { weather, tides, water, alerts, astro, prefs, locationName, today } = ctx;
  const tf = prefs.timeFormat;
  const tu = prefs.unitsTemp;
  const wu = prefs.unitsWind;
  const hu = prefs.unitsHeight;

  // Today's date in a friendly form (using Eastern timezone for label
  // consistency with the rest of the app).
  const dateLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: STATION_TZ,
  });

  // Subject line — short, scannable in a notification list.
  const subject = `Tidevisor · ${locationName} · ${today.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: STATION_TZ,
  })}`;

  // Greeting — first-name only when we have a name, otherwise just
  // "Good morning." (lowercase "morning" if the user's chosen briefing
  // hour is past noon — minor detail but feels nicer).
  const sendHour = prefs.dailyBriefingHour;
  const greetingTimeOfDay =
    sendHour >= 5 && sendHour < 12 ? "Good morning"
    : sendHour >= 12 && sendHour < 18 ? "Good afternoon"
    : "Good evening";
  const firstName = ctx.recipientName?.split(/\s+/)[0] ?? null;
  const greeting = firstName ? `${greetingTimeOfDay}, ${firstName}.` : `${greetingTimeOfDay}.`;

  // ─── Verdict (the most important single line in the email)
  const verdict = computeVerdict(ctx);

  // ─── "Conditions now" rows
  let conditions: BriefingData["conditions"] = null;
  if (weather) {
    const w = weather.now;
    conditions = [
      { label: "Temp", value: `${fmtTemp(w.tempF, tu)} (feels ${fmtTemp(w.feelsLikeF, tu)})` },
      { label: "Wind", value: `${fmtWind(w.windSpeedKt, wu, { mph: w.windSpeedMph })} ${w.windDirCardinal ?? ""}`.trim() },
      { label: "Sky", value: w.shortForecast || "—" },
    ];
    if (water?.observedHeight != null) {
      conditions.push({ label: "Tide", value: fmtHeight(water.observedHeight, hu) });
    }
    if (w.visibilityMi != null) {
      // Append a hazard tag for visibilities low enough to matter on
      // the water. Same thresholds as the dashboard's Right Now tile.
      const vMi = w.visibilityMi.toFixed(1);
      const tag =
        w.visibilityMi < 0.5 ? " — dense fog"
        : w.visibilityMi < 2   ? " — fog/haze"
        : w.visibilityMi < 6   ? " — reduced"
        : "";
      conditions.push({ label: "Visibility", value: `${vMi} mi${tag}` });
    }
    if (w.precipChancePct != null) {
      conditions.push({
        label: "Precip",
        value: `${w.precipChancePct}%${w.precipAmountIn != null && w.precipAmountIn >= 0.005 ? ` · ${w.precipAmountIn.toFixed(2)}″/6h` : ""}`,
      });
    }
  }

  // ─── Today's full forecast (NWS daily prose + hi/lo)
  let forecast: BriefingData["forecast"] = null;
  if (weather && weather.daily.length > 0) {
    const d = weather.daily[0]; // first entry is today
    forecast = {
      hi: fmtTemp(d.hiF, tu),
      lo: fmtTemp(d.loF, tu),
      shortForecast: d.shortForecast || "",
      detailedForecast: d.detailedForecast?.trim() || null,
    };
  }

  // ─── Sun / moon events. Each can be null individually — moonrise or
  // moonset may simply not occur within a given 24h window, in which
  // case the row drops out cleanly. Daylight length is always available
  // when astro resolves at all.
  let sunMoon: BriefingData["sunMoon"] = null;
  if (astro) {
    const events: NonNullable<BriefingData["sunMoon"]> = [];
    const tFmt = (iso: string | null | undefined) =>
      iso ? fmtTime(iso, tf) : null;

    const sr = tFmt(astro.sunrise);
    if (sr) events.push({ icon: "🌅", label: "Sunrise", value: sr });
    const ss = tFmt(astro.sunset);
    if (ss) events.push({ icon: "🌇", label: "Sunset", value: ss });
    const mr = tFmt(astro.moonrise);
    if (mr) events.push({ icon: "🌒", label: "Moonrise", value: mr });
    const ms = tFmt(astro.moonset);
    if (ms) events.push({ icon: "🌘", label: "Moonset", value: ms });
    if (typeof astro.dayLengthMin === "number" && astro.dayLengthMin > 0) {
      const h = Math.floor(astro.dayLengthMin / 60);
      const m = astro.dayLengthMin % 60;
      events.push({
        icon: "⏱",
        label: "Daylight",
        value: `${h}h ${String(m).padStart(2, "0")}m`,
      });
    }
    if (events.length > 0) sunMoon = events;
  }

  // ─── Tides today
  let tideRows: BriefingData["tideRows"] = null;
  let tideNote: string | null = null;
  if (tides) {
    const dayStart = stationDayStart(today);
    const dayEnd = dayStart + 24 * 3600 * 1000;
    const todayExtremes: TideExtreme[] = tides.extremes.filter((e) => {
      const ms = Date.parse(e.time);
      return ms >= dayStart && ms < dayEnd;
    });
    if (todayExtremes.length > 0) {
      tideRows = todayExtremes.map((e) => ({
        label: e.type === "H" ? "High" : "Low",
        time: fmtTime(e.time, tf),
        height: fmtHeight(e.height, hu),
      }));
    }
    if (tides.stationName && tides.stationId) {
      tideNote = `${tides.stationName} (${tides.stationId})`;
    }
  }

  // ─── Wind summary — peak hour + average from today's forecast hours
  let windSummary: string | null = null;
  if (weather && weather.hourly.length > 0) {
    const dayStart = stationDayStart(today);
    const dayEnd = dayStart + 24 * 3600 * 1000;
    const todayHours = weather.hourly.filter((h) => {
      const ms = Date.parse(h.time);
      return ms >= dayStart && ms < dayEnd;
    });
    const hoursToUse = todayHours.length > 0 ? todayHours : weather.hourly.slice(0, 24);
    if (hoursToUse.length > 0) {
      let peak = hoursToUse[0];
      let sum = 0;
      for (const h of hoursToUse) {
        sum += h.windKt;
        if (h.windKt > peak.windKt) peak = h;
      }
      const avg = sum / hoursToUse.length;
      const peakWindStr = wu === "mph"
        ? `${Math.round(ktToMph(peak.windKt))} mph`
        : `${Math.round(peak.windKt)} kt`;
      const avgWindStr = wu === "mph"
        ? `${Math.round(ktToMph(avg))} mph`
        : `${Math.round(avg)} kt`;
      windSummary = `Peak ${peakWindStr}${peak.windDirCardinal ? ` ${peak.windDirCardinal}` : ""} at ${fmtTime(peak.time, tf)}. Average ${avgWindStr}.`;
    }
  }

  // ─── Alerts — only render if there are active ones
  const alertLines = (alerts?.alerts ?? []).map((a) => ({
    headline: a.headline || a.event,
    description: a.description?.split("\n").slice(0, 2).join(" ").slice(0, 240) ?? "",
    severity: a.severity,
  }));

  // ─── Solunar today — major periods only (the most useful ones)
  let solunarLines: string[] = [];
  if (astro.solunar && astro.solunar.length > 0) {
    const dayStart = stationDayStart(today);
    const dayEnd = dayStart + 24 * 3600 * 1000;
    const todayMajor = astro.solunar.filter((p) => {
      const ms = Date.parse(p.start);
      return p.kind === "major" && ms >= dayStart && ms < dayEnd;
    });
    solunarLines = todayMajor.map((p) =>
      `★ ${p.centerLabel}: ${fmtTime(p.start, tf)} – ${fmtTime(p.end, tf)}`,
    );
  }

  return {
    subject,
    greeting,
    dateLabel,
    verdict,
    forecast,
    conditions,
    tideRows,
    tideNote,
    windSummary,
    sunMoon,
    alertLines,
    solunarLines,
    appUrl: ctx.appBaseUrl,
    settingsUrl: ctx.appBaseUrl,
  };
}

/** Compute the one-line go/no-go verdict shown right under the header.
 *  Highest-severity signal wins; ties broken by user-relevance for
 *  paddling (tropical > severe weather > advisories > wind > calm). */
function computeVerdict(ctx: BriefingContext): BriefingData["verdict"] {
  const alerts = ctx.alerts?.alerts ?? [];

  // Severity rank: extreme = worst.
  const hasExtreme = alerts.some((a) =>
    (a.severity ?? "").toLowerCase() === "extreme",
  );
  const hasSevere = alerts.some((a) =>
    (a.severity ?? "").toLowerCase() === "severe",
  );

  if (hasExtreme) {
    return {
      headline: "Severe weather alert",
      detail: `${alerts.length} active alert${alerts.length === 1 ? "" : "s"} — check details below before heading out.`,
      tone: "bad",
    };
  }
  if (hasSevere) {
    return {
      headline: "Active weather advisory",
      detail: `${alerts.length} active alert${alerts.length === 1 ? "" : "s"} — review before paddling.`,
      tone: "warn",
    };
  }
  if (alerts.length > 0) {
    return {
      headline: "Advisory active",
      detail: `${alerts.length} alert${alerts.length === 1 ? "" : "s"} for the area — see details below.`,
      tone: "warn",
    };
  }

  // No alerts — use wind as the verdict driver.
  const hourly = ctx.weather?.hourly ?? [];
  if (hourly.length > 0) {
    const dayStart = stationDayStart(ctx.today);
    const dayEnd = dayStart + 24 * 3600 * 1000;
    const todayHours = hourly.filter((h) => {
      const ms = Date.parse(h.time);
      return ms >= dayStart && ms < dayEnd;
    });
    const hoursToUse = todayHours.length > 0 ? todayHours : hourly.slice(0, 24);
    const peak = hoursToUse.reduce((p, h) => h.windKt > p ? h.windKt : p, 0);
    if (peak >= 22) {
      return {
        headline: "Breezy day — small-craft caution",
        detail: `Peaks near ${Math.round(peak)} kt today. Consider staying close to shore or postponing.`,
        tone: "warn",
      };
    }
    if (peak >= 15) {
      return {
        headline: "Moderate winds",
        detail: `Up to ~${Math.round(peak)} kt expected today. Check the wind summary below before launching.`,
        tone: "good",
      };
    }
    return {
      headline: "Light winds, paddle-able",
      detail: `Peak winds around ${Math.round(peak)} kt today — calm to moderate conditions.`,
      tone: "good",
    };
  }

  return {
    headline: "Conditions ready below",
    detail: "Full forecast and tide schedule for today.",
    tone: "good",
  };
}

// ─── HTML render ─────────────────────────────────────────────────────────

const FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const COLOR_TEXT = "#0b1d2a";
const COLOR_MUTED = "#5b6b73";
const COLOR_FAINT = "#8a9aa3";
const COLOR_BORDER = "#d8e1e8";
const COLOR_BG = "#f5f7f9";
const COLOR_CARD = "#ffffff";
const COLOR_ACCENT = "#0f6ea8";
const COLOR_GOOD = "#3a8a4b";
const COLOR_WARN = "#b06d00";
const COLOR_BAD = "#c44";

function renderHtml(data: BriefingData, ctx: BriefingContext): string {
  const verdictColor =
    data.verdict.tone === "bad" ? COLOR_BAD
    : data.verdict.tone === "warn" ? COLOR_WARN
    : COLOR_GOOD;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(data.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${COLOR_BG};color:${COLOR_TEXT};font-family:${FONT_STACK};-webkit-font-smoothing:antialiased;">
  <div style="max-width:600px;margin:0 auto;padding:20px 16px;">

    <!-- Header -->
    <div style="margin-bottom:18px;">
      <div style="font-size:13px;font-weight:700;letter-spacing:1.5px;color:${COLOR_ACCENT};text-transform:uppercase;">Tidevisor</div>
      <div style="font-size:14px;color:${COLOR_MUTED};margin-top:4px;">${escapeHtml(ctx.locationName)} · ${escapeHtml(data.dateLabel)}</div>
    </div>

    <!-- Greeting -->
    <p style="margin:0 0 14px;font-size:15px;color:${COLOR_TEXT};">${escapeHtml(data.greeting)}</p>

    <!-- Verdict card -->
    <div style="padding:14px 16px;background:${COLOR_CARD};border:1px solid ${COLOR_BORDER};border-left:4px solid ${verdictColor};border-radius:10px;margin-bottom:18px;">
      <div style="font-size:16px;font-weight:700;color:${verdictColor};">${escapeHtml(data.verdict.headline)}</div>
      <div style="font-size:14px;color:${COLOR_MUTED};margin-top:4px;line-height:1.5;">${escapeHtml(data.verdict.detail)}</div>
    </div>

    ${renderAlertsHtml(data.alertLines)}
    ${renderForecastHtml(data.forecast)}
    ${renderConditionsHtml(data.conditions)}
    ${renderTidesHtml(data.tideRows, data.tideNote)}
    ${renderWindHtml(data.windSummary)}
    ${renderSunMoonHtml(data.sunMoon)}
    ${renderSolunarHtml(data.solunarLines)}

    <!-- Footer -->
    <div style="margin-top:24px;padding-top:14px;border-top:1px solid ${COLOR_BORDER};">
      <a href="${escapeAttr(data.appUrl)}" style="display:inline-block;padding:10px 16px;background:${COLOR_ACCENT};color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;margin-right:8px;">Open full dashboard</a>
      <a href="${escapeAttr(buildShareMailto(data.appUrl))}" style="display:inline-block;padding:10px 16px;background:${COLOR_CARD};color:${COLOR_ACCENT};text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;border:1px solid ${COLOR_ACCENT};">Share with a friend</a>
      <div style="margin-top:14px;font-size:11px;color:${COLOR_FAINT};line-height:1.6;">
        Data: NOAA CO-OPS · NWS · USGS · NHC · EPA AirNow · Open-Meteo · SunCalc. Always verify with official sources before launching.
      </div>
      <div style="margin-top:8px;font-size:11px;color:${COLOR_FAINT};">
        <a href="${escapeAttr(data.settingsUrl)}" style="color:${COLOR_FAINT};text-decoration:underline;">Manage briefing settings</a>
        &nbsp;·&nbsp;
        <a href="${escapeAttr(data.appUrl)}/privacy" style="color:${COLOR_FAINT};text-decoration:underline;">Privacy</a>
        &nbsp;·&nbsp;
        <a href="${escapeAttr(data.appUrl)}/terms" style="color:${COLOR_FAINT};text-decoration:underline;">Terms</a>
      </div>
      <div style="margin-top:6px;font-size:11px;color:${COLOR_FAINT};">
        Tidevisor is a product of the Georgia Coast.
      </div>
    </div>

  </div>
</body>
</html>`;
}

function renderAlertsHtml(lines: BriefingData["alertLines"]): string {
  if (lines.length === 0) return "";
  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${COLOR_BAD};text-transform:uppercase;margin-bottom:8px;">⚠ Active alerts</div>
      ${lines.map((a) => `
        <div style="padding:10px 12px;background:${COLOR_CARD};border:1px solid ${COLOR_BAD};border-radius:8px;margin-bottom:6px;">
          <div style="font-size:14px;font-weight:700;color:${COLOR_BAD};">${escapeHtml(a.headline)}</div>
          ${a.description ? `<div style="font-size:13px;color:${COLOR_TEXT};margin-top:4px;line-height:1.4;">${escapeHtml(a.description)}</div>` : ""}
        </div>
      `).join("")}
    </div>`;
}

function renderForecastHtml(forecast: BriefingData["forecast"]): string {
  if (!forecast) return "";
  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${COLOR_MUTED};text-transform:uppercase;margin-bottom:8px;">Today's forecast</div>
      <div style="padding:12px 14px;background:${COLOR_CARD};border:1px solid ${COLOR_BORDER};border-radius:10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          <tr>
            <td style="font-size:15px;font-weight:700;color:${COLOR_TEXT};vertical-align:baseline;">${escapeHtml(forecast.shortForecast || "—")}</td>
            <td align="right" style="font-size:14px;color:${COLOR_MUTED};font-family:'JetBrains Mono',Menlo,Consolas,monospace;vertical-align:baseline;white-space:nowrap;">
              <span style="color:${COLOR_TEXT};font-weight:600;">Hi ${escapeHtml(forecast.hi)}</span>
              &nbsp;·&nbsp;
              Lo ${escapeHtml(forecast.lo)}
            </td>
          </tr>
        </table>
        ${forecast.detailedForecast ? `
          <div style="font-size:13px;color:${COLOR_MUTED};margin-top:8px;line-height:1.5;">
            ${escapeHtml(forecast.detailedForecast)}
          </div>
        ` : ""}
      </div>
    </div>`;
}

function renderSunMoonHtml(items: BriefingData["sunMoon"]): string {
  if (!items || items.length === 0) return "";
  // 3-column table per row: icon (fixed width), label (flexes), time
  // (right-aligned monospace). Tables render reliably in every email
  // client, where flex/inline-block + float can break in Gmail web /
  // older Outlook.
  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${COLOR_MUTED};text-transform:uppercase;margin-bottom:8px;">Sun &amp; moon</div>
      <div style="padding:12px 14px;background:${COLOR_CARD};border:1px solid ${COLOR_BORDER};border-radius:10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          ${items.map((it, i) => {
            const pad = i === 0 ? "0" : "6px 0 0 0";
            const border = i > 0 ? `border-top:1px solid ${COLOR_BORDER};` : "";
            return `
              <tr>
                <td style="width:28px;padding:${pad};${border}font-size:16px;text-align:center;">${it.icon}</td>
                <td style="padding:${pad};${border}font-size:14px;color:${COLOR_MUTED};">${escapeHtml(it.label)}</td>
                <td align="right" style="padding:${pad};${border}font-size:14px;color:${COLOR_TEXT};font-weight:600;font-family:'JetBrains Mono',Menlo,Consolas,monospace;">${escapeHtml(it.value)}</td>
              </tr>
            `;
          }).join("")}
        </table>
      </div>
    </div>`;
}

function renderConditionsHtml(rows: BriefingData["conditions"]): string {
  if (!rows || rows.length === 0) return "";
  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${COLOR_MUTED};text-transform:uppercase;margin-bottom:8px;">Conditions now</div>
      <div style="padding:12px 14px;background:${COLOR_CARD};border:1px solid ${COLOR_BORDER};border-radius:10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          ${rows.map((r, i) => `
            <tr>
              <td style="font-size:14px;color:${COLOR_MUTED};padding:${i === 0 ? "0" : "6px 0 0 0"};${i > 0 ? `border-top:1px solid ${COLOR_BORDER};` : ""}">${escapeHtml(r.label)}</td>
              <td align="right" style="font-size:14px;color:${COLOR_TEXT};font-weight:600;padding:${i === 0 ? "0" : "6px 0 0 0"};${i > 0 ? `border-top:1px solid ${COLOR_BORDER};` : ""}">${escapeHtml(r.value)}</td>
            </tr>
          `).join("")}
        </table>
      </div>
    </div>`;
}

function renderTidesHtml(rows: BriefingData["tideRows"], note: string | null): string {
  if (!rows || rows.length === 0) return "";
  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${COLOR_MUTED};text-transform:uppercase;margin-bottom:8px;">Tides today</div>
      <div style="padding:12px 14px;background:${COLOR_CARD};border:1px solid ${COLOR_BORDER};border-radius:10px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
          ${rows.map((r, i) => {
            const tCell = (extra = "") =>
              `padding:${i === 0 ? "0" : "6px 0 0 0"};${i > 0 ? `border-top:1px solid ${COLOR_BORDER};` : ""}${extra}`;
            return `
              <tr>
                <td style="${tCell("width:25%;font-size:14px;font-weight:600;color:" + (r.label === "High" ? COLOR_ACCENT : COLOR_MUTED) + ";")}">${escapeHtml(r.label)}</td>
                <td align="center" style="${tCell("width:40%;font-size:14px;color:" + COLOR_TEXT + ";font-family:'JetBrains Mono',Menlo,Consolas,monospace;")}">${escapeHtml(r.time)}</td>
                <td align="right" style="${tCell("width:35%;font-size:14px;color:" + COLOR_MUTED + ";font-family:'JetBrains Mono',Menlo,Consolas,monospace;")}">${escapeHtml(r.height)}</td>
              </tr>
            `;
          }).join("")}
        </table>
        ${note ? `<div style="margin-top:8px;font-size:11px;color:${COLOR_FAINT};">${escapeHtml(note)}</div>` : ""}
      </div>
    </div>`;
}

function renderWindHtml(summary: string | null): string {
  if (!summary) return "";
  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${COLOR_MUTED};text-transform:uppercase;margin-bottom:8px;">Wind today</div>
      <div style="padding:12px 14px;background:${COLOR_CARD};border:1px solid ${COLOR_BORDER};border-radius:10px;font-size:14px;color:${COLOR_TEXT};line-height:1.5;">
        ${escapeHtml(summary)}
      </div>
    </div>`;
}

function renderSolunarHtml(lines: string[]): string {
  if (lines.length === 0) return "";
  return `
    <div style="margin-bottom:18px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:${COLOR_MUTED};text-transform:uppercase;margin-bottom:8px;">Solunar majors</div>
      <div style="padding:12px 14px;background:${COLOR_CARD};border:1px solid ${COLOR_BORDER};border-radius:10px;font-size:13px;color:${COLOR_TEXT};line-height:1.6;">
        ${lines.map((l) => `<div>${escapeHtml(l)}</div>`).join("")}
      </div>
    </div>`;
}

// ─── Text render (plaintext fallback) ────────────────────────────────────

function renderText(data: BriefingData, ctx: BriefingContext): string {
  const lines: string[] = [];
  lines.push("TIDEVISOR · DAILY BRIEFING");
  lines.push(`${ctx.locationName} · ${data.dateLabel}`);
  lines.push("");
  lines.push(data.greeting);
  lines.push("");
  lines.push(`VERDICT: ${data.verdict.headline}`);
  lines.push(data.verdict.detail);
  lines.push("");

  if (data.alertLines.length > 0) {
    lines.push("ACTIVE ALERTS");
    for (const a of data.alertLines) {
      lines.push(`! ${a.headline}`);
      if (a.description) lines.push(`  ${a.description}`);
    }
    lines.push("");
  }

  if (data.forecast) {
    lines.push("TODAY'S FORECAST");
    lines.push(`  ${data.forecast.shortForecast || "—"} · Hi ${data.forecast.hi} · Lo ${data.forecast.lo}`);
    if (data.forecast.detailedForecast) {
      lines.push(`  ${data.forecast.detailedForecast}`);
    }
    lines.push("");
  }

  if (data.conditions && data.conditions.length > 0) {
    lines.push("CONDITIONS NOW");
    for (const c of data.conditions) {
      lines.push(`  ${c.label}: ${c.value}`);
    }
    lines.push("");
  }

  if (data.tideRows && data.tideRows.length > 0) {
    lines.push("TIDES TODAY");
    for (const r of data.tideRows) {
      lines.push(`  ${padRight(r.label, 5)} ${padRight(r.time, 9)} ${r.height}`);
    }
    if (data.tideNote) lines.push(`  (${data.tideNote})`);
    lines.push("");
  }

  if (data.windSummary) {
    lines.push("WIND TODAY");
    lines.push(`  ${data.windSummary}`);
    lines.push("");
  }

  if (data.sunMoon && data.sunMoon.length > 0) {
    lines.push("SUN & MOON");
    for (const it of data.sunMoon) {
      lines.push(`  ${it.icon} ${padRight(it.label, 9)} ${it.value}`);
    }
    lines.push("");
  }

  if (data.solunarLines.length > 0) {
    lines.push("SOLUNAR MAJORS");
    for (const s of data.solunarLines) {
      lines.push(`  ${s}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push(`Open dashboard: ${data.appUrl}`);
  lines.push(`Share with a friend: forward this email, or share ${data.appUrl}`);
  lines.push(`Manage briefing settings: ${data.settingsUrl}`);
  lines.push(`Privacy: ${data.appUrl}/privacy`);
  lines.push(`Terms: ${data.appUrl}/terms`);
  lines.push("");
  lines.push("Tidevisor is a product of the Georgia Coast.");

  return lines.join("\n");
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Minimal HTML escape — enough for user-controlled strings (display
 *  names, alert text) flowing through our template literals. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Stricter escape for attribute values like href. */
function escapeAttr(s: string): string {
  return escapeHtml(s);
}

function padRight(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

/** Build a mailto: URL that opens the user's email client with a
 *  pre-filled invitation. The subject and body are URL-encoded. No
 *  recipient ("To:" empty) so the user picks who to send it to.
 *  Universal pattern — works in every email client without needing JS
 *  or a third-party share API. */
function buildShareMailto(appUrl: string): string {
  const subject = encodeURIComponent("Have you tried Tidevisor?");
  const body = encodeURIComponent(
    `I've been using this for daily paddling conditions — tides, wind,`
    + ` weather, alerts, all in one daily email. Thought you might like it:\n\n`
    + `${appUrl}\n`,
  );
  return `mailto:?subject=${subject}&body=${body}`;
}
