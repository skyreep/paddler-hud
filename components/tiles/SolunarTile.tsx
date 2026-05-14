"use client";
import { useEffect, useState } from "react";
import type { SolunarPeriod } from "@/lib/types";
import { fmtTime } from "@/lib/time";

function fmtRange(start: string, end: string): string {
  return `${fmtTime(start)} – ${fmtTime(end)}`;
}

/** Major / minor solunar feeding periods for the day, computed from the moon's
 *  position. Popular with kayak anglers — fish activity peaks during these
 *  windows, especially when they overlap with sunrise / sunset.
 *
 *  Major periods (≈ 2 hours): moon overhead, moon underfoot. ★★ best.
 *  Minor periods (≈ 1 hour):  moonrise, moonset. ★ secondary.
 */
export default function SolunarTile({ periods }: { periods: SolunarPeriod[] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  if (!periods || periods.length === 0) return null;

  // Day timeline 0..1.
  const dayStart = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const dayEnd = dayStart + 24 * 3600_000;
  const pctOf = (t: number) => Math.max(0, Math.min(100, ((t - dayStart) / (dayEnd - dayStart)) * 100));
  const nowPct = now != null ? pctOf(now) : null;

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Solunar · Fishing Periods</span>
        <span className="tile-meta">Major ★★ · Minor ★</span>
      </div>

      {/* Top hour scale — labels for every 3 hours so the timeline below is
          legible regardless of cell width. Labels are absolutely positioned
          on percent-based anchors so they line up with the bands underneath. */}
      <div style={{
        position: "relative", height: 14, marginBottom: 4,
      }}>
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map(h => {
          const isQuarter = h % 6 === 0;
          const label = h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : h === 24 ? "12a" : `${h - 12}p`;
          return (
            <span key={h} style={{
              position: "absolute",
              left: `${(h / 24) * 100}%`,
              transform: h === 0 ? "translateX(0)" : h === 24 ? "translateX(-100%)" : "translateX(-50%)",
              fontSize: 9,
              fontWeight: isQuarter ? 700 : 500,
              color: isQuarter ? "var(--text-muted)" : "var(--text-faint)",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              whiteSpace: "nowrap",
            }}>{label}</span>
          );
        })}
      </div>

      {/* Visual timeline */}
      <div style={{
        position: "relative", height: 36,
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
        borderRadius: 10, overflow: "hidden",
      }}>
        {/* Vertical grid lines every 3 hours; quarter marks heavier */}
        {[3, 6, 9, 12, 15, 18, 21].map(h => {
          const isQuarter = h % 6 === 0;
          return (
            <div key={h} style={{
              position: "absolute",
              top: 0, bottom: 0, width: isQuarter ? 1 : 1,
              left: `${(h / 24) * 100}%`,
              background: isQuarter ? "var(--border)" : "var(--border-soft)",
              opacity: isQuarter ? 1 : 0.7,
            }} />
          );
        })}
        {/* Solunar bands */}
        {periods.map((p, i) => {
          const startMs = Date.parse(p.start);
          const endMs   = Date.parse(p.end);
          const startPct = pctOf(startMs);
          const endPct   = pctOf(endMs);
          return (
            <div key={i} style={{
              position: "absolute",
              top: p.kind === "major" ? 4 : 18,
              height: p.kind === "major" ? 28 : 14,
              left: `${startPct}%`,
              width: `${Math.max(0.5, endPct - startPct)}%`,
              background: p.kind === "major" ? "var(--accent)" : "var(--accent-2)",
              opacity: p.kind === "major" ? 0.75 : 0.55,
              borderRadius: 4,
            }} title={`${p.centerLabel} · ${fmtRange(p.start, p.end)}`} />
          );
        })}
        {/* NOW indicator */}
        {nowPct != null && (
          <>
            <div style={{
              position: "absolute", top: 0, bottom: 0, width: 0,
              left: `${nowPct}%`,
              borderLeft: "2px solid var(--warn)",
              pointerEvents: "none",
            }} />
            <div style={{
              position: "absolute", top: -2, left: `${nowPct}%`,
              transform: "translate(-50%, -100%)",
              fontSize: 9, fontWeight: 700, color: "var(--warn)",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
            }}>NOW</div>
          </>
        )}
      </div>

      {/* Period list */}
      <div style={{ marginTop: 10, display: "grid", gap: 6, fontSize: 13 }}>
        {periods.map((p, i) => {
          const isActive = now != null && now >= Date.parse(p.start) && now <= Date.parse(p.end);
          return (
            <div key={i} style={{
              display: "grid",
              gridTemplateColumns: "auto 1fr auto",
              gap: 10, alignItems: "center",
              padding: "8px 10px",
              background: isActive ? "var(--accent-soft)" : "var(--bg-elev-2)",
              border: `1px solid ${isActive ? "var(--accent)" : "var(--border-soft)"}`,
              borderRadius: 8,
            }}>
              <span style={{
                fontSize: 14, fontWeight: 700,
                color: p.kind === "major" ? "var(--accent)" : "var(--accent-2)",
                width: 28, textAlign: "center",
              }}>
                {p.kind === "major" ? "★★" : "★"}
              </span>
              <div>
                <div style={{ fontWeight: 600 }}>{p.centerLabel}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 11 }}>
                  Centered at {fmtTime(p.centerTime)}
                  {isActive && <span style={{ marginLeft: 8, color: "var(--accent)", fontWeight: 700 }}>· active now</span>}
                </div>
              </div>
              <span className="num" style={{
                fontSize: 12, color: "var(--text-muted)",
                whiteSpace: "nowrap",
              }}>
                {fmtRange(p.start, p.end)}
              </span>
            </div>
          );
        })}
      </div>

      <div style={{
        marginTop: 10, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
      }}>
        Periods computed from the moon&apos;s daily position. Best fishing typically
        when a major period overlaps sunrise / sunset.
      </div>
    </section>
  );
}
