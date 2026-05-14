"use client";
import { useMemo, useState } from "react";
import type { TideResponse, TideExtreme } from "@/lib/types";
import { fmtTime, STATION_TZ } from "@/lib/time";

interface DaySummary {
  date: string;          // YYYY-MM-DD
  label: string;         // "Mon May 13"
  highs: TideExtreme[];
  lows: TideExtreme[];
  range: number;
  maxHigh: number;
  minLow: number;
}

function summarize(extremes: TideExtreme[]): DaySummary[] {
  const buckets = new Map<string, TideExtreme[]>();
  for (const e of extremes) {
    const date = e.time.slice(0, 10);   // YYYY-MM-DD
    if (!buckets.has(date)) buckets.set(date, []);
    buckets.get(date)!.push(e);
  }
  return Array.from(buckets.entries()).map(([date, list]) => {
    const highs = list.filter(e => e.type === "H").sort((a, b) => a.time.localeCompare(b.time));
    const lows  = list.filter(e => e.type === "L").sort((a, b) => a.time.localeCompare(b.time));
    const maxHigh = highs.length ? Math.max(...highs.map(h => h.height)) : 0;
    const minLow  = lows.length  ? Math.min(...lows.map(l => l.height))  : 0;
    const range = maxHigh - minLow;
    const d = new Date(`${date}T12:00:00-04:00`);  // anchor midday Eastern
    const label = d.toLocaleDateString("en-US", {
      weekday: "short", month: "short", day: "numeric",
      timeZone: STATION_TZ,
    });
    return { date, label, highs, lows, range, maxHigh, minLow };
  });
}

export default function TideMonthTile({ tides }: { tides: TideResponse }) {
  const days = useMemo(() => summarize(tides.extended7Day), [tides.extended7Day]);
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  if (!days.length) return null;

  const rangeMax = Math.max(...days.map(d => d.range));

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">30-Day Tide Outlook</span>
        <span className="tile-meta">{tides.stationName}</span>
      </div>

      <div style={{
        display: "grid", gap: 1,
        background: "var(--border-soft)",
        borderRadius: 10, overflow: "hidden",
        maxHeight: 360, overflowY: "auto",
        WebkitOverflowScrolling: "touch",
      }}>
        {days.map((d, idx) => {
          const isOpen = openIdx === idx;
          const isToday = idx === 0;
          // Range strength bar (0–100% relative to the strongest day of the 30-day window).
          const rangePct = Math.round((d.range / rangeMax) * 100);
          return (
            <div key={d.date} style={{ background: "var(--bg-elev)" }}>
              <button
                onClick={() => setOpenIdx(isOpen ? null : idx)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "100px 1fr auto",
                  gap: 10, alignItems: "center",
                  width: "100%", padding: "12px 14px",
                  background: "transparent",
                  color: "var(--text)",
                  border: "none", cursor: "pointer",
                  textAlign: "left",
                  font: "inherit",
                }}
                aria-expanded={isOpen}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>
                    {isToday ? "Today" : d.label}
                  </div>
                  {!isToday && (
                    <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>
                      {d.label.split(" ").slice(0, 1).join("")}
                    </div>
                  )}
                </div>
                <div>
                  <div className="num" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                    Range <strong style={{ color: "var(--text)" }}>{d.range.toFixed(1)} ft</strong> · Hi {d.maxHigh.toFixed(1)} · Lo {d.minLow.toFixed(1)}
                  </div>
                  <div style={{
                    marginTop: 6, height: 4, background: "var(--border-soft)",
                    borderRadius: 999, overflow: "hidden",
                  }}>
                    <div style={{
                      width: `${rangePct}%`, height: "100%",
                      background: "linear-gradient(90deg, var(--accent), var(--accent-2))",
                      borderRadius: 999,
                    }} />
                  </div>
                </div>
                <div style={{
                  fontSize: 14, color: "var(--text-muted)",
                  transform: isOpen ? "rotate(180deg)" : "none",
                  transition: "transform .2s",
                }}>▼</div>
              </button>

              {isOpen && (
                <div style={{
                  padding: "8px 14px 14px",
                  background: "var(--bg-elev-2)",
                  borderTop: "1px solid var(--border-soft)",
                }}>
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                    gap: 8,
                  }}>
                    {[...d.highs, ...d.lows]
                      .sort((a, b) => a.time.localeCompare(b.time))
                      .map((e, i) => (
                        <div key={i} style={{
                          background: "var(--bg-elev)",
                          border: "1px solid var(--border-soft)",
                          borderRadius: 8, padding: "8px 10px",
                        }}>
                          <div style={{
                            fontSize: 10, fontWeight: 700, letterSpacing: ".5px",
                            color: e.type === "H" ? "var(--accent-2)" : "var(--text-muted)",
                            textTransform: "uppercase",
                          }}>
                            {e.type === "H" ? "High" : "Low"}
                          </div>
                          <div className="num" style={{ fontWeight: 700, fontSize: 14 }}>
                            {fmtTime(e.time)}
                          </div>
                          <div className="num" style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            {e.height.toFixed(1)} ft
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 10, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
      }}>
        Range bar shows the day&apos;s tidal swing relative to the largest swing in the next 30 days.
        Bigger swings = stronger currents and faster water movement in the marsh.
      </div>
    </section>
  );
}
