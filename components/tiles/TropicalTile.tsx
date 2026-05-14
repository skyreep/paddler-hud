import type { TropicalResponse } from "@/lib/types";

export default function TropicalTile({ tropical }: { tropical: TropicalResponse }) {
  // Hide entirely off-season unless there's an active system or a high-chance disturbance.
  const hasActivity =
    tropical.activeSystems.length > 0 ||
    tropical.disturbances.some(d => d.formationChance7d >= 40);
  if (!tropical.inSeason && !hasActivity) return null;

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Tropical Outlook · NHC</span>
        <span className="tile-meta">Atlantic Basin</span>
      </div>

      {tropical.activeSystems.length === 0 && (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "6px 0" }}>
          No active named storms. Season runs June 1 – Nov 30.
        </div>
      )}

      {tropical.activeSystems.map((s, idx) => (
        <div key={s.id} style={{
          display: "flex", gap: 14, alignItems: "center",
          paddingTop: idx === 0 ? 0 : 12,
          marginTop: idx === 0 ? 0 : 12,
          borderTop: idx === 0 ? "none" : "1px dashed var(--border-soft)",
        }}>
          <div style={{
            width: 56, height: 56, flexShrink: 0,
            display: "grid", placeItems: "center",
            fontSize: 38,
            background: s.threatToUser
              ? "linear-gradient(135deg, #b9333a, #ff7a6f)"
              : "linear-gradient(135deg, #4a90c9, #87cfee)",
            color: "white", borderRadius: 14,
            animation: "spin 6s linear infinite",
          }} aria-hidden>🌀</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{s.classification} {s.name}</div>
            <div style={{ color: s.threatToUser ? "var(--bad)" : "var(--text)", fontWeight: 600, fontSize: 13 }}>
              {s.maxWindMph != null ? `${s.maxWindMph} mph` : "—"}
              {s.movement && <> · Moving {s.movement}</>}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              {s.distanceMi != null && <>{s.distanceMi.toLocaleString()} mi away</>}
              {s.position && <> · {s.position.lat.toFixed(1)}°N {Math.abs(s.position.lon).toFixed(1)}°W</>}
              {!s.threatToUser && <> · No coastal threat to your area</>}
            </div>
          </div>
        </div>
      ))}

      {tropical.disturbances.length > 0 && (
        <div style={{
          marginTop: 12, padding: "10px 12px",
          background: "var(--bg-elev-2)", borderRadius: 10,
          fontSize: 12, color: "var(--text-muted)",
          border: "1px solid var(--border-soft)",
        }}>
          <strong style={{ color: "var(--text)" }}>7-Day Outlook:</strong>{" "}
          {tropical.disturbances.length} area
          {tropical.disturbances.length === 1 ? "" : "s"} of disturbed weather being monitored.
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </section>
  );
}
