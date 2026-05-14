import type { RiverGauge } from "@/lib/types";

const STATUS_LABEL: Record<RiverGauge["status"], string> = {
  normal: "Normal", action: "Action", minor: "Minor", moderate: "Moderate", major: "Major", unknown: "—",
};
const STATUS_CLASS: Record<RiverGauge["status"], "good" | "warn" | "bad"> = {
  normal: "good", action: "warn", minor: "warn", moderate: "bad", major: "bad", unknown: "warn",
};

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
      {gauges.map((g, idx) => (
        <div key={g.siteId} style={{
          display: "grid",
          gridTemplateColumns: "1fr auto auto",
          gap: 10, padding: "12px 0",
          borderBottom: idx === gauges.length - 1 ? "none" : "1px solid var(--border-soft)",
          alignItems: "center",
        }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{g.siteName}</div>
            <div className="num" style={{ color: "var(--text-faint)", fontSize: 11, marginTop: 2 }}>
              USGS {g.siteId}{g.floodStageFt != null ? ` · Flood ${g.floodStageFt} ft` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="num" style={{ fontWeight: 700, fontSize: 16 }}>
              {g.stageFt != null ? `${g.stageFt.toFixed(2)} ft` : "—"}
            </div>
            <div className="num" style={{
              fontSize: 12,
              color: g.change24hFt == null ? "var(--text-muted)" : g.change24hFt > 0.5 ? "var(--bad)" : g.change24hFt > 0.1 ? "var(--warn)" : "var(--good)"
            }}>
              {g.change24hFt != null ? `${g.change24hFt >= 0 ? "+" : ""}${g.change24hFt.toFixed(2)} (24h)` : "—"}
            </div>
          </div>
          <span className={`pill ${STATUS_CLASS[g.status]}`}>{STATUS_LABEL[g.status]}</span>
        </div>
      ))}
      <button style={{
        marginTop: 10, padding: "10px 12px",
        background: "transparent", border: "1px dashed var(--border)",
        color: "var(--text-muted)", borderRadius: 12,
        width: "100%", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}>
        + Add a USGS gauge by station ID
      </button>
    </section>
  );
}
