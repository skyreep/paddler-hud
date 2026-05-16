"use client";
import { useEffect, useState } from "react";
import type { WindResponse } from "@/lib/types";
import { fmtTime } from "@/lib/time";
import { beaufort } from "@/lib/beaufort";

function cardinalFromDeg(deg: number): string {
  const dirs = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
                "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}


/** Real-time wind tile fed by a NOAA CO-OPS coastal station. Updates every
 *  6 minutes — more frequent than METAR (which is every 5-15 min) and sourced
 *  from instruments mounted right on the water. Includes a 6-hour speed +
 *  gust chart so paddlers can see whether wind is building or easing.
 */
export default function WindNowTile({ wind }: { wind: WindResponse }) {
  // Track "now" client-side. Computing minutesAgo() during render would
  // execute once on the server (during RSC pre-render) and again on the
  // client at hydration with a different Date.now(), producing different
  // text content and tripping React's hydration check. Production builds
  // surface that as "Application Error: a client-side exception" instead
  // of the dev-mode warning, which is what iPhone users were seeing.
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!wind.latest || wind.observations.length === 0) {
    return (
      <section className="tile">
        <div className="tile-head">
          <span className="tile-title">Real-Time Wind</span>
          <span className="tile-meta">{wind.stationName}</span>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>
          Wind sensor at this station is offline. Use the forecast wind in the Right Now tile.
        </div>
      </section>
    );
  }

  const cur = wind.latest;
  const bf = beaufort(cur.speedKt);
  // ageLabel is null until client mount, then ticks every minute.
  const ageLabel = nowMs == null ? null : (() => {
    const age = Math.max(0, Math.round((nowMs - Date.parse(cur.time)) / 60_000));
    return age === 0 ? "Just now" : age === 1 ? "1 min ago" : `${age} min ago`;
  })();

  // 6-hour history sparkline. Two lines: sustained (accent) + gusts (warn).
  const W = 420, H = 90, padL = 6, padR = 6, padT = 8, padB = 22;
  const obs = wind.observations;
  const tMin = Date.parse(obs[0].time);
  const tMax = Date.parse(obs[obs.length - 1].time);
  const tRange = Math.max(1, tMax - tMin);
  const speeds = obs.map(o => o.speedKt);
  const gusts = obs.map(o => o.gustKt ?? o.speedKt);
  const peak = Math.max(...speeds, ...gusts, 5);
  const yMax = Math.ceil(peak / 5) * 5;     // round up to nearest 5 kt
  const xOf = (i: number) => padL + ((Date.parse(obs[i].time) - tMin) / tRange) * (W - padL - padR);
  const yOf = (kt: number) => padT + (1 - kt / yMax) * (H - padT - padB);

  const speedPath = obs.map((o, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(o.speedKt).toFixed(1)}`).join("");
  const gustPath  = obs.map((o, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(o.gustKt ?? o.speedKt).toFixed(1)}`).join("");

  // Gridlines at 0, 1/3, 2/3, full of yMax
  const gridKt = [yMax, Math.round(yMax * 2 / 3), Math.round(yMax / 3), 0];

  const sourceLabel = wind.source === "NDBC"
    ? `NDBC ${wind.stationId} · ${wind.stationName}`
    : `NOAA CO-OPS · ${wind.stationName}`;

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Real-Time Wind</span>
        <span className="tile-meta">{sourceLabel}{ageLabel ? ` · ${ageLabel}` : ""}</span>
      </div>

      {/* Current reading row — compass + numeric */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "auto minmax(0, 1fr)",
        gap: 14, alignItems: "center",
        padding: "4px 0 10px",
      }}>
        <WindCompass dirDeg={cur.dirDeg} />
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span className="num" style={{ fontSize: 32, fontWeight: 700, lineHeight: 1 }}>
              {cur.speedKt.toFixed(0)}
            </span>
            <span style={{ color: "var(--text-muted)", fontSize: 14 }}>kt</span>
            {cur.gustKt != null && cur.gustKt > cur.speedKt && (
              <span className="num" style={{
                marginLeft: 8, fontSize: 14,
                color: "var(--warn)", fontWeight: 700,
              }}>
                gusts {cur.gustKt.toFixed(0)} kt
              </span>
            )}
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
            {String(Math.round(cur.dirDeg)).padStart(3, "0")}° {cardinalFromDeg(cur.dirDeg)}
          </div>
          <span style={{
            display: "inline-block", marginTop: 6,
            background: "var(--accent-soft)", color: "var(--accent)",
            padding: "3px 9px", borderRadius: 999,
            fontSize: 11, fontWeight: 700,
          }}>
            Force {bf.force} — {bf.name}
          </span>
        </div>
      </div>

      {/* 6-hour speed + gust history sparkline */}
      <div style={{
        marginTop: 8, padding: "8px 8px 4px",
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
        borderRadius: 12,
      }}>
        <div style={{
          display: "flex", justifyContent: "space-between",
          fontSize: 10, fontWeight: 700, letterSpacing: ".5px",
          color: "var(--text-muted)", textTransform: "uppercase",
          marginBottom: 4,
        }}>
          <span>Last 6 hours</span>
          <span>
            <span style={{ color: "var(--accent)" }}>━ Sustained</span>
            <span style={{ marginLeft: 10, color: "var(--warn)" }}>━ Gusts</span>
          </span>
        </div>
        {/* The chart container: SVG renders only paths/gridlines (those stretch
            cleanly with preserveAspectRatio="none"). All text labels are HTML
            overlays positioned by percent so the font stays the same size on
            every viewport instead of being horizontally stretched into a smear
            on wide screens. */}
        <div style={{ position: "relative", height: 90 }}>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
               style={{ width: "100%", height: "100%", display: "block" }} aria-hidden>
            {gridKt.map((kt, i) => (
              <line key={i}
                    x1={padL} y1={yOf(kt)} x2={W - padR} y2={yOf(kt)}
                    stroke="var(--border)" strokeDasharray="2,3" />
            ))}
            <path d={gustPath} fill="none" stroke="var(--warn)"
                  strokeWidth="1.6" strokeLinecap="round"
                  strokeDasharray="3,2" opacity="0.85"
                  vectorEffect="non-scaling-stroke" />
            <path d={speedPath} fill="none" stroke="var(--accent)"
                  strokeWidth="2.2" strokeLinecap="round"
                  vectorEffect="non-scaling-stroke" />
          </svg>
          {/* Y-axis kt labels — one per gridline, anchored at the chart's
              right edge, vertically aligned via percent. */}
          {gridKt.map((kt, i) => (
            <span key={i} style={{
              position: "absolute",
              right: 4,
              top: `${(yOf(kt) / H) * 100}%`,
              transform: "translateY(-100%)",
              fontSize: 9, fontWeight: 600,
              color: "var(--text-faint)",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              pointerEvents: "none",
              background: "var(--bg-elev-2)",
              padding: "0 3px",
              lineHeight: 1.2,
            }}>{kt} kt</span>
          ))}
          {/* X-axis time labels — start / middle / end of the window. */}
          <div style={{
            position: "absolute", left: 0, right: 0, bottom: 2,
            display: "flex", justifyContent: "space-between",
            fontSize: 10, color: "var(--text-faint)",
            fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            pointerEvents: "none",
            padding: "0 4px",
          }}>
            <span>{fmtTime(obs[0].time)}</span>
            <span>{fmtTime(obs[Math.floor(obs.length / 2)].time)}</span>
            <span>{fmtTime(obs[obs.length - 1].time)}</span>
          </div>
        </div>
      </div>

      <div style={{
        marginTop: 8, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
      }}>
        Live wind from {wind.stationName} ({wind.source === "NDBC"
          ? `NDBC buoy ${wind.stationId}, ~10-min updates`
          : "NOAA CO-OPS, 6-min updates"}).
        Forecast wind is in the Right Now tile.
      </div>
    </section>
  );
}

/** Compact compass rose with arrow pointing FROM the wind source. */
function WindCompass({ dirDeg }: { dirDeg: number }) {
  const size = 80;
  const cx = size / 2, cy = size / 2, r = size / 2 - 6;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
         style={{ flexShrink: 0 }} aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg-elev-2)"
              stroke="var(--border)" strokeWidth="1.5" />
      <text x={cx}     y="9"        textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--text-muted)">N</text>
      <text x={cx}     y={size - 2} textAnchor="middle" fontSize="9" fontWeight="700" fill="var(--text-muted)">S</text>
      <text x={size-3} y={cy + 3}   textAnchor="end"    fontSize="9" fontWeight="700" fill="var(--text-muted)">E</text>
      <text x="3"      y={cy + 3}   textAnchor="start"  fontSize="9" fontWeight="700" fill="var(--text-muted)">W</text>
      {/* Arrow shaft from edge toward center — wind FROM that bearing */}
      <g transform={`rotate(${dirDeg} ${cx} ${cy})`}>
        <line x1={cx} y1={cy - r + 4} x2={cx} y2={cy + 4}
              stroke="var(--accent-2)" strokeWidth="3" strokeLinecap="round" />
        <polygon points={`${cx-4},${cy+4} ${cx+4},${cy+4} ${cx},${cy+10}`}
                 fill="var(--accent-2)" />
        <circle cx={cx} cy={cy - r + 4} r="3" fill="var(--accent-2)" />
      </g>
    </svg>
  );
}
