import type { AstroResponse } from "@/lib/types";
import { fmtTime } from "@/lib/time";

function t(iso: string | null) {
  if (!iso || iso === "—") return "—";
  return fmtTime(iso);
}

export default function AstroTile({ astro }: { astro: AstroResponse }) {
  const dayLenHrs = Math.floor(astro.dayLengthMin / 60);
  const dayLenMin = astro.dayLengthMin % 60;

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">Sun · Moon · Twilight</span>
        <span className="tile-meta">{astro.lat.toFixed(2)}°N {Math.abs(astro.lon).toFixed(2)}°W</span>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "8px 0 10px", borderBottom: "1px dashed var(--border-soft)" }}>
        <div style={{
          width: 56, height: 56, borderRadius: "50%",
          background: "radial-gradient(circle at 30% 30%, #f7e9b8, #cfb877)",
          position: "relative",
          boxShadow: "0 0 24px rgba(247,233,184,.25)",
        }}>
          <div style={{
            position: "absolute", inset: 0, borderRadius: "50%",
            background: "var(--bg-elev)",
            clipPath: `ellipse(${50 - astro.moonIlluminationPct/2}% 50% at 70% 50%)`,
            opacity: 0.92,
          }} />
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{astro.moonPhaseName}</div>
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>{astro.moonIlluminationPct}% illuminated</div>
        </div>
      </div>

      <Grid items={[
        ["🌅", "Sunrise",    t(astro.sunrise)],
        ["🌇", "Sunset",     t(astro.sunset)],
        ["☀️", "Solar noon", t(astro.solarNoon)],
        ["🌒", "Moonrise",   t(astro.moonrise)],
        ["🌘", "Moonset",    t(astro.moonset)],
        ["⏱",  "Daylight",   `${dayLenHrs}h ${String(dayLenMin).padStart(2, "0")}m`],
      ]} />

      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px dashed var(--border-soft)" }}>
        <Grid items={[
          ["◔", "Civil dawn",  t(astro.civilDawn)],
          ["◕", "Civil dusk",  t(astro.civilDusk)],
          ["◐", "Naut. dawn",  t(astro.nauticalDawn)],
          ["◑", "Naut. dusk",  t(astro.nauticalDusk)],
          ["○", "First light", t(astro.astroDawn)],
          ["●", "Full dark",   t(astro.astroDusk)],
        ]} />
      </div>

      {astro.tidbits && astro.tidbits.length > 0 && (
        <div style={{
          marginTop: 12, padding: "10px 12px",
          background: "var(--bg-elev-2)",
          borderRadius: 10,
          border: "1px solid var(--border-soft)",
        }}>
          <div style={{
            fontSize: 11, fontWeight: 700, letterSpacing: ".5px",
            color: "var(--text-muted)", textTransform: "uppercase",
            marginBottom: 6,
          }}>
            ✨ Tonight&apos;s sky &amp; tides
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
            {astro.tidbits.map((tb, i) => (
              <li key={i} style={{
                fontSize: 13, color: "var(--text)",
                padding: "3px 0", lineHeight: 1.4,
              }}>
                · {tb}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Grid({ items }: { items: [string, string, string][] }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(2, 1fr)",
      gap: "10px 12px",
      fontSize: 13,
      paddingTop: 8,
    }}>
      {items.map(([ico, label, val], i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 26, textAlign: "center", fontSize: 18 }}>{ico}</span>
          <div>
            <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", letterSpacing: ".5px", fontWeight: 600 }}>{label}</div>
            <div className="num" style={{ fontWeight: 600, fontSize: 14 }}>{val}</div>
          </div>
        </div>
      ))}
    </div>
  );
}
