import type { RiverGauge } from "@/lib/types";

// Paddler-relevant labels covering the full flow spectrum: drought-low through
// flood. "Normal" now means within the typical seasonal range (USGS P25-P75),
// not just "below flood stage."
const STATUS_LABEL: Record<RiverGauge["status"], string> = {
  "very-low": "Very Low",
  "low":      "Below Normal",
  "normal":   "Normal",
  "high":     "Above Normal",
  "very-high": "Much Above",
  "action":   "Action",
  "minor":    "Minor Flood",
  "moderate": "Mod Flood",
  "major":    "Major Flood",
  "unknown":  "—",
};

// Color mapping — low water is amber/red (paddler hazard: shallow, exposed
// rocks, mud), normal/high are good for paddling, flood states are red.
const STATUS_CLASS: Record<RiverGauge["status"], "good" | "warn" | "bad" | "info"> = {
  "very-low": "bad",
  "low":      "warn",
  "normal":   "good",
  "high":     "good",
  "very-high": "info",
  "action":   "warn",
  "minor":    "bad",
  "moderate": "bad",
  "major":    "bad",
  "unknown":  "warn",
};

function flowContextLine(g: RiverGauge): string | null {
  if (g.flowPercentile == null) return null;
  const p = g.flowPercentile;
  const med = g.medianFlowCfs;
  const medStr = med != null ? `; median is ${Math.round(med).toLocaleString()} cfs` : "";
  if (p < 10) return `Flow in lowest 10% of record for today${medStr}.`;
  if (p < 25) return `Flow below normal for today (${p}th percentile)${medStr}.`;
  if (p > 90) return `Flow much above normal for today (${p}th percentile)${medStr}.`;
  if (p > 75) return `Flow above normal for today (${p}th percentile)${medStr}.`;
  return `Flow within normal range for today (${p}th percentile)${medStr}.`;
}

export default function RiversTile({ gauges }: { gauges: RiverGauge[] }) {
  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Saved River Gauges</span>
        <span className="tile-meta">USGS · {gauges.length} of 10 saved</span>
      </div>
      {gauges.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "8px 0" }}>
          No gauges saved yet. Add one by USGS site ID.
        </div>
      )}
      {gauges.map((g, idx) => {
        const context = flowContextLine(g);
        return (
          <div key={g.siteId} style={{
            padding: "12px 0",
            borderBottom: idx === gauges.length - 1 ? "none" : "1px solid var(--border-soft)",
          }}>
            <div style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto auto",
              gap: 10, alignItems: "center",
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {g.siteName}
                </div>
                <div className="num" style={{ color: "var(--text-faint)", fontSize: 11, marginTop: 2 }}>
                  USGS {g.siteId}
                  {g.floodStageFt != null && <> · Flood {g.floodStageFt} ft</>}
                  {g.flowPercentile != null && <> · P{g.flowPercentile}</>}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="num" style={{ fontWeight: 700, fontSize: 16 }}>
                  {g.stageFt != null ? `${g.stageFt.toFixed(2)} ft` : "—"}
                </div>
                <div className="num" style={{
                  fontSize: 12,
                  color: g.change24hFt == null
                    ? "var(--text-muted)"
                    : g.change24hFt > 0.5 ? "var(--bad)"
                    : g.change24hFt > 0.1 ? "var(--warn)"
                    : g.change24hFt < -0.5 ? "var(--info)"
                    : "var(--good)",
                }}>
                  {g.change24hFt != null
                    ? `${g.change24hFt >= 0 ? "+" : ""}${g.change24hFt.toFixed(2)} (24h)`
                    : "—"}
                </div>
              </div>
              <span className={`pill ${STATUS_CLASS[g.status]}`}>{STATUS_LABEL[g.status]}</span>
            </div>
            {context && (
              <div style={{
                marginTop: 6, fontSize: 11,
                color: "var(--text-muted)", lineHeight: 1.4,
              }}>
                {context}
              </div>
            )}
          </div>
        );
      })}
      <button style={{
        marginTop: 10, padding: "10px 12px",
        background: "transparent", border: "1px dashed var(--border)",
        color: "var(--text-muted)", borderRadius: 12,
        width: "100%", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}>
        + Add a USGS gauge by station ID
      </button>
      <div style={{
        marginTop: 8, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
      }}>
        Status compares today&apos;s flow against the USGS historical record for the
        same day-of-year (percentiles), then yields to NWS AHPS flood stages at
        the high end.
      </div>
    </section>
  );
}
