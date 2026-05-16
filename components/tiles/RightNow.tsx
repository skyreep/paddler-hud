import type { WeatherNow, AirQualityResponse, NwsAttribution, WeatherObservation } from "@/lib/types";
import { fmtTime } from "@/lib/time";

interface Props {
  weather: WeatherNow;
  fetchedAt: string;
  airQuality?: AirQualityResponse | null;
  liveTideFt?: number | null;
  attribution?: NwsAttribution;
  observation?: WeatherObservation | null;
  /** Resolved wind data source ("Fort Pulaski · NOAA CO-OPS · 4 min ago", etc.) */
  windSource?: string;
}

function minutesAgo(iso: string): number {
  return Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
}

export default function RightNow({ weather, fetchedAt, airQuality, liveTideFt, attribution, observation, windSource }: Props) {
  const updated = fmtTime(fetchedAt);
  // When METAR observation is feeding the tile, lead with "Observed X min ago"
  // so users know these are real measurements, not forecast for the next hour.
  const src = observation
    ? `Observed ${observation.stationId} · ${minutesAgo(observation.timestamp)} min ago`
    : attribution
      ? `${attribution.relativeLocation ?? attribution.officeName ?? "NWS"} · NWS ${attribution.office}`
      : "NWS";

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Right Now</span>
        <span className="tile-meta">{src} · Updated {updated}</span>
      </div>
      <div style={{
        display: "grid",
        // Two-column inside the tile when there's enough width; stacks below 380px.
        gridTemplateColumns: "minmax(0, auto) minmax(0, 1fr)",
        gap: 16, alignItems: "center", rowGap: 14,
      }} className="phud-now-top">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 56, fontWeight: 700, lineHeight: 1, letterSpacing: -1.5 }}>
            {Math.round(weather.tempF)}<sup style={{ fontSize: 20, color: "var(--text-muted)", fontWeight: 500 }}>°F</sup>
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{weather.shortForecast}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 13, marginTop: 2 }}>
            Feels like {Math.round(weather.feelsLikeF)}°F
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: 12, alignItems: "center", minWidth: 0 }}>
          <WindRose dirDeg={weather.windDirDeg} />
          <div>
            <div className="num" style={{ fontSize: 22, fontWeight: 700 }}>
              {Math.round(weather.windSpeedKt)} <span style={{ color: "var(--text-muted)", fontSize: 14 }}>kt</span>
            </div>
            <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
              {Math.round(weather.windSpeedMph)} mph · {weather.windDirCardinal} · {Math.round(weather.windDirDeg)}°
            </div>
            <span style={pill}>Force {weather.beaufortForce} — {weather.beaufortName}</span>
            {weather.windGustKt && (
              <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 6 }}>Gusts to {Math.round(weather.windGustKt)} kt</div>
            )}
            {windSource && (
              <div style={{
                fontSize: 10, color: "var(--text-faint)", marginTop: 6,
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              }} title="Wind data source — priority chain: NOAA CO-OPS → METAR → NWS forecast">
                {windSource}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14, fontSize: 13 }}>
        <Row label="Humidity"  value={weather.humidity != null ? `${weather.humidity}%` : "—"} />
        <Row label="Dew point" value={weather.dewPointF != null ? `${Math.round(weather.dewPointF)}°F` : "—"} />
        <Row label="Precip"    value={precipLabel(weather.precipChancePct, weather.precipAmountIn)} />
        <Row label="Live tide" value={liveTideFt != null ? `${liveTideFt.toFixed(1)} ft` : "—"} />
        <Row label="Air quality" value={
          airQuality?.available && airQuality.aqi != null
            ? <span className={`pill ${aqiClass(airQuality.aqi)}`}>{airQuality.category} · AQI {airQuality.aqi}</span>
            : <span style={{ color: "var(--text-faint)" }}>Set AIRNOW_API_KEY</span>
        } />
        <Row label="UV index"  value={
          weather.uvIndex != null
            ? <span className={`pill ${uvClass(weather.uvIndex)}`}>{weather.uvIndex} — {uvLabel(weather.uvIndex)}</span>
            : "—"
        } />
        <Row label="Visibility" value={visibilityValue(weather.visibilityMi)} />
        <Row label="Pressure" value={
          weather.pressureInHg != null ? `${weather.pressureInHg.toFixed(2)} inHg` : "—"
        } />
      </div>
    </section>
  );
}

function precipLabel(pct?: number, amountIn?: number): string {
  if (pct == null && amountIn == null) return "—";
  const pctStr = pct != null ? `${pct}%` : "—";
  if (amountIn != null && amountIn >= 0.005) return `${pctStr} · ${amountIn.toFixed(2)}″ /6h`;
  return pctStr;
}
function uvLabel(uv: number): string {
  if (uv < 3) return "Low";
  if (uv < 6) return "Mod";
  if (uv < 8) return "High";
  if (uv < 11) return "V.High";
  return "Extreme";
}
function uvClass(uv: number): "good" | "warn" | "bad" {
  if (uv < 3) return "good";
  if (uv < 8) return "warn";
  return "bad";
}

/** Visibility row value with fog-hazard pill styling.
 *  Paddler-relevant thresholds:
 *    < 0.5 mi : Dense fog (red — disorientation hazard)
 *    < 2 mi   : Fog / haze (amber — keep close to shore)
 *    ≥ 2 mi   : Clear-ish (green) */
function visibilityValue(miles: number | undefined): React.ReactNode {
  if (miles == null) return "—";
  const v = miles.toFixed(1);
  if (miles < 0.5) return <span className="pill bad">{v} mi — Dense fog</span>;
  if (miles < 2)   return <span className="pill warn">{v} mi — Fog/haze</span>;
  if (miles < 6)   return <span className="pill warn" style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>{v} mi — Reduced</span>;
  return <span>{v} mi</span>;
}

const pill: React.CSSProperties = {
  display: "inline-block", marginTop: 6,
  background: "var(--accent-soft)", color: "var(--accent)",
  padding: "4px 10px", borderRadius: 999,
  fontSize: 12, fontWeight: 700,
};

function aqiClass(aqi: number) {
  if (aqi <= 50) return "good";
  if (aqi <= 100) return "warn";
  return "bad";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="num">{value}</span>
    </div>
  );
}

function WindRose({ dirDeg }: { dirDeg: number }) {
  return (
    <div style={{
      width: 90, height: 90, borderRadius: "50%",
      border: "2px solid var(--border)", position: "relative",
      display: "grid", placeItems: "center",
      background: "radial-gradient(circle at center, var(--bg-elev-2) 0%, var(--bg-elev-2) 40%, transparent 70%)",
    }}>
      <span style={{ position: "absolute", top: 2, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>N</span>
      <span style={{ position: "absolute", bottom: 2, left: "50%", transform: "translateX(-50%)", fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>S</span>
      <span style={{ position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>E</span>
      <span style={{ position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)", fontSize: 10, color: "var(--text-muted)", fontWeight: 700 }}>W</span>
      <div style={{
        width: 0, height: 0,
        borderLeft: "8px solid transparent", borderRight: "8px solid transparent",
        borderBottom: "36px solid var(--accent)",
        position: "absolute", top: 8, left: "50%",
        transform: `translateX(-50%) rotate(${dirDeg}deg)`,
        transformOrigin: "50% calc(100% + 8px)",
      }} />
    </div>
  );
}
