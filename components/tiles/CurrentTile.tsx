"use client";
import { useEffect, useState } from "react";
import type { CurrentResponse } from "@/lib/types";

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export default function CurrentTile({ currents }: { currents: CurrentResponse }) {
  const [nowTime, setNowTime] = useState<Date | null>(null);
  useEffect(() => {
    setNowTime(new Date());
    const id = setInterval(() => setNowTime(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!currents.predictions.length) {
    return (
      <section className="tile">
        <div className="tile-head">
          <span className="tile-title">Tidal Current</span>
          <span className="tile-meta">{currents.stationId}</span>
        </div>
        <div style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          No current-prediction station available near this location.
          Use the tide tile above — current peaks roughly 3 hours after each high/low.
        </div>
      </section>
    );
  }

  // Build SVG curve. Width matches TideTile (600) so the two charts line up
  // visually when stacked. Y axis: positive flood up, negative ebb down,
  // zero in the middle.
  const W = 600, H = 180;
  const vMax = Math.max(1, ...currents.predictions.map(p => Math.abs(p.velocity)));
  const mid = H / 2;
  const xOf = (i: number) => (i / (currents.predictions.length - 1)) * W;
  const yOf = (v: number) => mid - (v / vMax) * (mid - 12);

  const linePath = currents.predictions
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)},${yOf(p.velocity).toFixed(1)}`)
    .join("");
  const fillPath = `${linePath} L${W},${mid} L0,${mid} Z`;

  // Find "current state" — the prediction nearest to client now.
  let stateVel: number | null = null;
  let stateNextSlackIso: string | null = null;
  let nowIdx = 0;
  if (nowTime) {
    nowIdx = currents.predictions.reduce((bi, p, i) => {
      const d = Math.abs(new Date(p.time).getTime() - nowTime.getTime());
      const bestD = Math.abs(new Date(currents.predictions[bi].time).getTime() - nowTime.getTime());
      return d < bestD ? i : bi;
    }, 0);
    stateVel = currents.predictions[nowIdx].velocity;
    stateNextSlackIso = currents.slacks.find(s => new Date(s) > nowTime) ?? null;
  }

  const stateLabel = stateVel == null
    ? "—"
    : Math.abs(stateVel) < 0.1
    ? "Slack water"
    : `${stateVel > 0 ? "+" : ""}${stateVel.toFixed(1)} kt ${stateVel > 0 ? "Flooding" : "Ebbing"}`;

  // Now-marker position (matches TideTile's clamping behavior).
  const nowX = nowTime ? xOf(nowIdx) : null;
  const nowY = nowTime ? yOf(currents.predictions[nowIdx].velocity) : null;
  const nowLeftPct = nowX != null ? Math.max(2, Math.min(98, (nowX / W) * 100)) : null;
  const nowTopPct  = nowY != null ? Math.max(8, Math.min(92, (nowY / H) * 100)) : null;

  const isDerived = currents.stationId === "derived";
  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Tidal Current{isDerived ? " · Derived" : ""}</span>
        <span className="tile-meta">{isDerived ? "from tide curve" : currents.stationId}</span>
      </div>

      <div style={{ position: "relative" }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: 180, display: "block" }}
        >
          <defs>
            <linearGradient id="cg" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%"  stopColor="var(--accent-2)" stopOpacity=".55" />
              <stop offset="100%" stopColor="var(--accent-2)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <line x1="0" y1={mid} x2={W} y2={mid}
                stroke="var(--border-soft)" strokeDasharray="3,3" />
          <path d={fillPath} fill="url(#cg)" />
          <path d={linePath} fill="none" stroke="var(--accent-2)"
                strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
                vectorEffect="non-scaling-stroke" />
        </svg>

        {/* NOW marker — matches TideTile's design (dashed line + dot + badge) */}
        {nowLeftPct != null && nowTopPct != null && stateVel != null && (
          <>
            <div aria-hidden style={{
              position: "absolute",
              left: `${nowLeftPct}%`, top: 6, bottom: 10,
              width: 0,
              borderLeft: "1.5px dashed var(--accent-2)",
              pointerEvents: "none",
            }} />
            <div aria-hidden style={{
              position: "absolute",
              left: `${nowLeftPct}%`, top: `${nowTopPct}%`,
              width: 10, height: 10,
              background: "var(--accent-2)",
              border: "2px solid var(--bg-elev)",
              borderRadius: "50%",
              transform: "translate(-50%, -50%)",
              pointerEvents: "none",
            }} />
            <div style={{
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
            }}>
              NOW · {stateVel >= 0 ? "+" : ""}{stateVel.toFixed(1)} kt
            </div>
          </>
        )}
      </div>

      <div style={{
        display: "flex", justifyContent: "space-between",
        marginTop: 6, fontSize: 11, color: "var(--text-faint)",
        fontFamily: "JetBrains Mono, ui-monospace, monospace",
      }}>
        <span>Flood +</span>
        <span>Ebb −</span>
      </div>

      <div style={{ display: "grid", gap: 8, marginTop: 10, fontSize: 13 }}>
        <Row label="Current state" value={stateLabel} highlight />
        {currents.maxFlood && (
          <Row label="Max flood"
               value={`+${currents.maxFlood.velocity.toFixed(1)} kt · ${fmtTime(currents.maxFlood.time)}`} />
        )}
        {stateNextSlackIso && (
          <Row label="Next slack" value={fmtTime(stateNextSlackIso)} />
        )}
        {currents.maxEbb && (
          <Row label="Max ebb"
               value={`${currents.maxEbb.velocity.toFixed(1)} kt · ${fmtTime(currents.maxEbb.time)}`} />
        )}
      </div>

      {isDerived && (
        <div style={{
          marginTop: 10, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
        }}>
          Derived from the rate of change of the tide curve, calibrated for
          Lowcountry channels (≈ 1.3 kt per ft/hr). Actual currents in narrow
          creeks may be 50–100% higher; always allow for it on tight tidal windows.
        </div>
      )}
    </section>
  );
}

function Row({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="num" style={{ fontWeight: highlight ? 700 : 600, color: highlight ? "var(--text)" : undefined }}>
        {value}
      </span>
    </div>
  );
}
