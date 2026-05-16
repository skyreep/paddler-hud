"use client";
import { useEffect, useState } from "react";
import type { TideResponse } from "@/lib/types";
import { fmtTime } from "@/lib/time";

export default function TideTile({ tides, stationNote, liveTideFt }: {
  tides: TideResponse;
  stationNote?: string;
  /** Live observed water level (ft, MLLW) from the same station. When present,
   *  the NOW marker uses this value so the chart agrees with the Right Now tile. */
  liveTideFt?: number | null;
}) {
  // "Now" position depends on real-time clock — compute on client only to avoid
  // hydration mismatch (page cache window is 5 min, clock keeps moving).
  const [nowTime, setNowTime] = useState<Date | null>(null);
  useEffect(() => {
    setNowTime(new Date());
    const id = setInterval(() => setNowTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!tides.predictions.length) return null;

  const W = 600, H = 200, top = 20, bot = 180;
  const minH = Math.min(...tides.predictions.map(p => p.height));
  const maxH = Math.max(...tides.predictions.map(p => p.height));
  const range = Math.max(0.1, maxH - minH);
  const yOf = (h: number) => bot - ((h - minH) / range) * (bot - top);
  const xOf = (i: number) => (i / (tides.predictions.length - 1)) * W;

  const linePath = tides.predictions
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.height).toFixed(1)}`)
    .join("");
  const fillPath = `${linePath} L${W},${H} L0,${H} Z`;

  // Compute now marker only after client mount.
  // Dot Y is taken from the PREDICTED height at this moment so the marker
  // always sits exactly on the curve. The badge shows the live observed
  // height when available (with a small "Δ" anomaly note if it differs
  // meaningfully from prediction — that gap is the storm surge / wind
  // setup, which is real information rather than a chart bug).
  let nowX: number | null = null;
  let nowY: number | null = null;
  let nowPredictedFt: number | null = null;
  let nowObservedFt: number | null = null;
  let surgeAnomalyFt: number | null = null;
  if (nowTime) {
    const nowIdx = tides.predictions.findIndex(p => new Date(p.time) >= nowTime);
    const idx = nowIdx === -1 ? tides.predictions.length - 1 : nowIdx;
    nowX = xOf(idx);
    nowPredictedFt = tides.predictions[idx].height;
    nowY = yOf(nowPredictedFt);   // ← always on the curve
    if (liveTideFt != null) {
      nowObservedFt = liveTideFt;
      const diff = +(liveTideFt - nowPredictedFt).toFixed(2);
      if (Math.abs(diff) >= 0.15) surgeAnomalyFt = diff;
    }
  }
  const nowDisplayFt = nowObservedFt ?? nowPredictedFt;

  // Convert SVG-space X to a CSS left percentage so the HTML overlay text
  // stays unstretched even though the SVG uses preserveAspectRatio="none".
  // Clamp to keep the badge fully on-screen.
  const nowLeftPct = nowX != null ? Math.max(2, Math.min(98, (nowX / W) * 100)) : null;
  const nowTopPct  = nowY != null ? Math.max(8, Math.min(92, (nowY / H) * 100)) : null;

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Today&apos;s Tides — {tides.stationName} ({tides.stationId})</span>
        <span className="tile-meta">{tides.datum} · ft</span>
      </div>
      {stationNote && (
        <div style={{
          fontSize: 11, color: "var(--text-muted)",
          margin: "-4px 0 8px",
          padding: "6px 10px",
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          borderRadius: 8,
          lineHeight: 1.4,
        }}>
          ℹ {stationNote}
        </div>
      )}

      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 180, display: "block" }}
        >
          <defs>
            <linearGradient id="tg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity=".5" />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g stroke="var(--border-soft)" strokeWidth="1">
            <line x1="0" y1="40"  x2={W} y2="40" />
            <line x1="0" y1="100" x2={W} y2="100" />
            <line x1="0" y1="160" x2={W} y2="160" />
          </g>
          <path d={fillPath} fill="url(#tg)" />
          <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2.5"
                strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke" />
        </svg>

        {/* HTML overlay (unstretched) — only rendered after client mount */}
        {nowLeftPct != null && nowTopPct != null && nowDisplayFt != null && (
          <>
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: `${nowLeftPct}%`, top: 6, bottom: 10,
                width: 0,
                borderLeft: "1.5px dashed var(--accent-2)",
                pointerEvents: "none",
              }}
            />
            <div
              aria-hidden
              style={{
                position: "absolute",
                left: `${nowLeftPct}%`, top: `${nowTopPct}%`,
                width: 10, height: 10,
                background: "var(--accent-2)",
                border: "2px solid var(--bg-elev)",
                borderRadius: "50%",
                transform: "translate(-50%, -50%)",
                pointerEvents: "none",
              }}
            />
            <div
              style={{
                position: "absolute",
                left: `${nowLeftPct}%`, top: -2,
                transform: nowLeftPct > 60 ? "translateX(calc(-100% - 6px))" : "translateX(6px)",
                fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                fontSize: 11, fontWeight: 700,
                lineHeight: 1.4,
                color: "var(--accent-2)",
                background: "var(--bg-elev)",
                padding: "3px 8px",
                borderRadius: 8,
                border: "1px solid var(--accent-2)",
                whiteSpace: "nowrap",
                pointerEvents: "none",
                boxShadow: "0 2px 6px rgba(15, 30, 45, .08)",
                letterSpacing: ".3px",
              }}
            >
              NOW · {nowDisplayFt.toFixed(1)} ft
              {surgeAnomalyFt != null && (
                <span style={{
                  marginLeft: 6,
                  color: surgeAnomalyFt > 0 ? "var(--warn)" : "var(--info)",
                  fontWeight: 600,
                }}
                title={`Surge anomaly: live water level is ${Math.abs(surgeAnomalyFt).toFixed(2)} ft ${surgeAnomalyFt > 0 ? "above" : "below"} the predicted curve. Usually wind / pressure driven.`}>
                  {surgeAnomalyFt > 0 ? "+" : ""}{surgeAnomalyFt.toFixed(1)} Δ
                </span>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginTop: 10 }}>
        {tides.extremes.slice(0, 4).map((e, i) => (
          <div key={i} style={{
            background: "var(--bg-elev-2)", borderRadius: 10, padding: "8px 10px",
            border: "1px solid var(--border-soft)",
          }}>
            <div style={{ color: "var(--text-muted)", fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px" }}>
              {e.type === "H" ? "High" : "Low"}
            </div>
            <div className="num" style={{ fontWeight: 700, fontSize: 16 }}>
              {fmtTime(e.time)}
            </div>
            <div className="num" style={{ color: "var(--text-muted)", fontSize: 12 }}>{e.height.toFixed(1)} ft</div>
          </div>
        ))}
      </div>
    </section>
  );
}
