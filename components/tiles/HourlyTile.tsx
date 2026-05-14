import type { WeatherHour, NwsAttribution } from "@/lib/types";

function iconFor(forecast: string) {
  const f = forecast.toLowerCase();
  if (f.includes("thunder")) return "⛈";
  if (f.includes("rain") || f.includes("showers")) return "🌧";
  if (f.includes("snow")) return "❄️";
  if (f.includes("fog")) return "🌫";
  if (f.includes("cloud")) return "⛅";
  if (f.includes("clear") || f.includes("sunny")) return "☀️";
  return "🌤";
}

export default function HourlyTile({ hours, attribution }: {
  hours: WeatherHour[];
  attribution?: NwsAttribution;
}) {
  // Total expected precip across the entire window (typically 24 h).
  const totalIn = hours.reduce((sum, h) => sum + (h.precipAmountIn ?? 0), 0);
  // Peak hourly chance across the window — useful "will it rain at all" indicator.
  const peakPop = hours.reduce((max, h) => Math.max(max, h.precipChancePct ?? 0), 0);
  const windowHours = hours.length;
  const isWet = totalIn >= 0.005;

  const src = attribution
    ? `${attribution.relativeLocation ?? attribution.officeName ?? "NWS"} · NWS ${attribution.office}`
    : "NWS";

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Next {windowHours} Hours</span>
        <span className="tile-meta">{src}</span>
      </div>

      {/* Standalone precip-window banner so it's unambiguous that this number
          is a cumulative total over the entire forecast window, not per-hour. */}
      <div style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "10px 12px",
        background: isWet ? "var(--accent-soft)" : "var(--bg-elev-2)",
        border: `1px solid ${isWet ? "var(--accent)" : "var(--border-soft)"}`,
        borderRadius: 10,
        marginBottom: 10,
        fontSize: 13,
      }}>
        <span style={{ fontSize: 18 }} aria-hidden>💧</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, color: isWet ? "var(--accent)" : "var(--text)" }}>
            {isWet
              ? <>Total expected precip · {totalIn.toFixed(2)} in over the next {windowHours} hr</>
              : <>No measurable precip expected in the next {windowHours} hr</>}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
            Peak hourly chance {peakPop}% · per-hour breakdown below
          </div>
        </div>
      </div>
      <div style={{
        display: "flex", gap: 8,
        overflowX: "auto", margin: "0 -16px", padding: "4px 16px 8px",
        WebkitOverflowScrolling: "touch",
      }}>
        {hours.map((h, i) => {
          const popPct = h.precipChancePct ?? 0;
          // Per-hour amounts are intentionally NOT shown here — cumulative is
          // surfaced once in the banner above to avoid confusion about scope.
          return (
            <div key={i} style={{
              flex: "0 0 auto", width: 72, textAlign: "center", padding: "10px 6px",
              background: i === 0 ? "var(--accent-soft)" : "var(--bg-elev-2)",
              border: `1px solid ${i === 0 ? "var(--accent)" : "var(--border-soft)"}`,
              borderRadius: 12, fontSize: 12,
            }}>
              <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600 }}>
                {i === 0 ? "Now" : new Date(h.time).toLocaleTimeString([], { hour: "numeric" })}
              </div>
              <div style={{ fontSize: 22, margin: "4px 0" }}>{iconFor(h.shortForecast)}</div>
              <div className="num" style={{ fontWeight: 700, fontSize: 14 }}>
                {Math.round(h.tempF)}°
              </div>
              <div className="num" style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
                {Math.round(h.windKt)} kt
                {h.windDirCardinal && <span style={{ marginLeft: 2 }}>{h.windDirCardinal}</span>}
              </div>
              <div style={{
                marginTop: 4, fontSize: 10,
                color: popPct >= 50 ? "var(--info)" : "var(--text-faint)",
                fontWeight: popPct >= 50 ? 700 : 500,
              }}>
                💧 {popPct}%
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
