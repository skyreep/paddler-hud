"use client";
import { useState } from "react";
import type { WeatherDay, NwsAttribution } from "@/lib/types";
import { STATION_TZ } from "@/lib/time";

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

interface Props {
  days: WeatherDay[];
  attribution?: NwsAttribution;
}

export default function WeeklyTile({ days, attribution }: Props) {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  if (!days.length) return null;

  const sourceLabel = attribution
    ? `${attribution.relativeLocation ?? attribution.officeName ?? "NWS"} · NWS ${attribution.office}`
    : "NWS";

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">7-Day Forecast</span>
        <span className="tile-meta">{sourceLabel}</span>
      </div>

      <div style={{ display: "grid", gap: 0, fontSize: 13 }}>
        {days.map((d, idx) => {
          const isOpen = openIdx === idx;
          const hi = Math.round(d.hiF);
          const lo = Math.round(d.loF);
          const popPct = d.precipChancePct ?? 0;
          const amount = d.precipAmountIn;
          const sameTemps = hi === lo;

          return (
            <div key={d.date} style={{
              borderBottom: idx === days.length - 1 ? "none" : "1px solid var(--border-soft)",
            }}>
              <button
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                aria-expanded={isOpen}
                style={{
                  // Tighter column widths so the row fits even in narrow tile cells.
                  display: "grid",
                  gridTemplateColumns: "56px 28px minmax(0, 1fr) auto 14px",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 0",
                  width: "100%",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  textAlign: "left",
                  color: "var(--text)",
                  font: "inherit",
                }}
              >
                <div>
                  <div style={{ fontWeight: 700 }}>{idx === 0 ? "Today" : d.dayName}</div>
                  <div style={{
                    fontSize: 10, color: "var(--text-faint)", marginTop: 2,
                  }}>
                    {new Date(d.date + "T12:00:00-04:00").toLocaleDateString("en-US", {
                      month: "short", day: "numeric",
                      timeZone: STATION_TZ,
                    })}
                  </div>
                </div>

                <div style={{ fontSize: 22, textAlign: "center" }}>{iconFor(d.shortForecast)}</div>

                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontWeight: 600,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>
                    {d.shortForecast}
                  </div>
                  <div style={{
                    display: "flex", gap: 10, flexWrap: "wrap",
                    fontSize: 11, color: "var(--text-muted)", marginTop: 2,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                  }}>
                    {d.windSpeedKt != null && (
                      <span>{d.windSpeedKt} kt{d.windDirCardinal ? ` ${d.windDirCardinal}` : ""}
                        {d.windGustKt != null && d.windGustKt > d.windSpeedKt && (
                          <span style={{ color: "var(--text-faint)" }} title="Wind gusts in knots">
                            {" "}· gusts {d.windGustKt} kt
                          </span>
                        )}
                      </span>
                    )}
                    <span style={{ color: popPct >= 40 ? "var(--info)" : "var(--text-faint)" }}>
                      💧 {popPct}%
                      {amount != null && amount >= 0.005 && (
                        <span> · {amount.toFixed(2)}″</span>
                      )}
                    </span>
                  </div>
                </div>

                <div className="num" style={{
                  textAlign: "right", fontWeight: 700, fontSize: 15,
                  whiteSpace: "nowrap",
                }}>
                  {sameTemps ? (
                    <span>{hi}°</span>
                  ) : (
                    <>
                      <span style={{ color: "var(--text-muted)", marginRight: 6, fontWeight: 600 }}>{lo}°</span>
                      <span>{hi}°</span>
                    </>
                  )}
                </div>

                <div style={{
                  fontSize: 12, color: "var(--text-muted)",
                  transform: isOpen ? "rotate(180deg)" : "none",
                  transition: "transform .2s",
                }}>▼</div>
              </button>

              {isOpen && (
                <div style={{
                  padding: "4px 0 14px 0",
                  fontSize: 13, color: "var(--text-muted)",
                  lineHeight: 1.55,
                }}>
                  {d.detailedForecast ?? d.shortForecast}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
