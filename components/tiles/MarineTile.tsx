import type { BuoyResponse } from "@/lib/types";

/**
 * Marine conditions tile. The wave visualization is now data-driven:
 *  - amplitude is mapped to actual wave height in feet
 *  - wavelength is mapped to dominant period (longer period = longer wavelength)
 *  - the SVG uses a fixed-aspect viewBox so it never distorts across screen sizes
 * The wave direction is shown as a compass with an arrow indicating the direction
 * waves are *coming from* (NDBC convention).
 */

function cardinalFromDeg(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(deg / 22.5) % 16];
}

function WaveViz({ heightFt, periodSec }: { heightFt: number | null; periodSec: number | null }) {
  // One wave shape, two explicit measurement annotations:
  //  HEIGHT (orange) — vertical bracket measuring crest-to-trough on the right
  //  PERIOD (teal)   — horizontal bracket measuring one full wavelength on the
  //                    bottom, with the time value inline
  // The legend underneath uses the SAME colors so there's zero ambiguity.

  const W = 420, H = 110;
  const waveTop = 12, waveBot = 78, mid = (waveTop + waveBot) / 2;
  const drawEnd = 360;        // wave draws 0 → 360, gutter 360 → 420 for height bracket

  // Map height (ft) to amplitude in viewBox px. 0 ft → 4 px, 8 ft → 30 px.
  const amp = heightFt == null ? 6 : Math.max(4, Math.min(30, 4 + heightFt * 3.2));
  // Map period (sec) to wavelength in viewBox px. 4 s → 60 px, 14 s → 200 px.
  const lambda = periodSec == null ? 110 : Math.max(60, Math.min(220, 30 + periodSec * 12));

  // Sinusoidal wave (quadratic Bezier half-cycles).
  let d = `M0 ${mid}`;
  let x = 0;
  let down = true;
  const half = lambda / 2;
  while (x < drawEnd) {
    const cpX = x + half / 2;
    const cpY = down ? mid + amp * 1.5 : mid - amp * 1.5;
    const endX = Math.min(x + half, drawEnd);
    d += ` Q${cpX} ${cpY} ${endX} ${mid}`;
    x = endX;
    down = !down;
  }

  // Where is the first complete wavelength? Use it to anchor the period bracket.
  // First crest is at x = lambda/4, next crest at x = lambda/4 + lambda. We bracket
  // between two consecutive zero crossings (mid line) which is one full wavelength
  // starting at x = 0 and ending at x = lambda.
  const periodStartX = 0;
  const periodEndX   = Math.min(lambda, drawEnd);
  const periodBarY   = waveBot + 12;
  const heightBarX   = drawEnd + 18;

  const colorHeight = "var(--warn)";
  const colorPeriod = "var(--accent-2)";

  return (
    <div style={{ width: "100%", maxWidth: 480, margin: "10px auto 0" }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label={`Wave height ${heightFt ?? "unknown"} feet, period ${periodSec ?? "unknown"} seconds`}
      >
        {/* Baseline */}
        <line x1="0" y1={mid} x2={drawEnd} y2={mid}
              stroke="var(--border-soft)" strokeDasharray="2,4" />

        {/* The wave itself */}
        <path d={d} fill="none" stroke="var(--accent)" strokeWidth="2.6"
              strokeLinecap="round" />

        {/* HEIGHT bracket on the right (orange) — measures crest to trough */}
        <g stroke={colorHeight} strokeWidth="1.5" fill="none" strokeLinecap="round">
          <line x1={heightBarX} y1={mid - amp} x2={heightBarX} y2={mid + amp} />
          <line x1={heightBarX - 5} y1={mid - amp} x2={heightBarX + 5} y2={mid - amp} />
          <line x1={heightBarX - 5} y1={mid + amp} x2={heightBarX + 5} y2={mid + amp} />
        </g>
        <text x={heightBarX + 8} y={mid + 3} textAnchor="start"
              fontSize="11" fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontWeight="700" fill={colorHeight}>
          {heightFt != null ? `${heightFt.toFixed(1)} ft` : "—"}
        </text>

        {/* PERIOD bracket below (teal) — measures one full wavelength */}
        <g stroke={colorPeriod} strokeWidth="1.5" fill="none" strokeLinecap="round">
          <line x1={periodStartX} y1={periodBarY} x2={periodEndX} y2={periodBarY} />
          <line x1={periodStartX} y1={periodBarY - 5} x2={periodStartX} y2={periodBarY + 5} />
          <line x1={periodEndX}   y1={periodBarY - 5} x2={periodEndX}   y2={periodBarY + 5} />
        </g>
        <text x={(periodStartX + periodEndX) / 2} y={periodBarY + 18} textAnchor="middle"
              fontSize="11" fontFamily="JetBrains Mono, ui-monospace, monospace"
              fontWeight="700" fill={colorPeriod}>
          {periodSec != null ? `${periodSec} s` : "—"}
        </text>
      </svg>

      {/* Color-coded legend so there's no ambiguity about what each annotation means */}
      <div style={{
        display: "flex", justifyContent: "center", gap: 18,
        marginTop: 6, fontSize: 11, lineHeight: 1.3,
        fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 14, height: 3, borderRadius: 2,
            background: "var(--warn)",
          }} aria-hidden />
          <span style={{ color: "var(--text-muted)" }}>height (crest → trough)</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 14, height: 3, borderRadius: 2,
            background: "var(--accent-2)",
          } as React.CSSProperties} aria-hidden />
          <span style={{ color: "var(--text-muted)" }}>period (one full wavelength)</span>
        </span>
      </div>
    </div>
  );
}

function Compass({ fromDeg }: { fromDeg: number | null }) {
  // Compact 44x44 compass — sits inside a stat cell next to a numeric label.
  // Arrow points FROM the wave-source bearing inward, toward the center.
  const size = 48;
  const cx = size / 2, cy = size / 2, r = size / 2 - 5;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}
         style={{ flexShrink: 0 }} aria-hidden>
      <circle cx={cx} cy={cy} r={r} fill="var(--bg-elev)" stroke="var(--border)" strokeWidth="1.5" />
      <text x={cx}      y="8"        textAnchor="middle" fontSize="7" fontWeight="700" fill="var(--text-muted)">N</text>
      <text x={cx}      y={size-2}   textAnchor="middle" fontSize="7" fontWeight="700" fill="var(--text-muted)">S</text>
      <text x={size-3}  y={cy+3}     textAnchor="end"    fontSize="7" fontWeight="700" fill="var(--text-muted)">E</text>
      <text x="3"       y={cy+3}     textAnchor="start"  fontSize="7" fontWeight="700" fill="var(--text-muted)">W</text>
      {fromDeg != null && (
        <g transform={`rotate(${fromDeg} ${cx} ${cy})`}>
          <line x1={cx} y1={cy - r + 2} x2={cx} y2={cy + 2}
                stroke="var(--accent-2)" strokeWidth="2.2" strokeLinecap="round" />
          <polygon points={`${cx-3},${cy+2} ${cx+3},${cy+2} ${cx},${cy+6}`}
                   fill="var(--accent-2)" />
          <circle cx={cx} cy={cy - r + 2} r="2.2" fill="var(--accent-2)" />
        </g>
      )}
    </svg>
  );
}

export default function MarineTile({ buoy }: { buoy: BuoyResponse }) {
  const title = buoy.source === "NDBC"
    ? `Marine · NDBC ${buoy.buoyId}`
    : "Marine · Modelled (Open-Meteo)";
  const subtitle = buoy.observedAt
    ? new Date(buoy.observedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <section className="tile">
      <div className="tile-head">
        <span className="tile-title">{title}</span>
        <span className="tile-meta">{subtitle}</span>
      </div>

      {/* 2x2 stat grid — wraps gracefully at any width. Compass + direction
          take the fourth cell so direction is given both numerically and
          visually without needing horizontal space outside the grid. */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
        gap: 10,
        alignItems: "stretch",
      }}>
        <Stat label="Wave height" value={buoy.waveHeightFt} unit="ft" decimals={1} />
        <Stat label="Period"      value={buoy.dominantPeriodSec} unit="s" decimals={0} />
        <Stat label="Sea temp"    value={buoy.seaTempF} unit="°F" decimals={0} />
        <CompassCell fromDeg={buoy.meanWaveDirDeg} />
      </div>

      <WaveViz heightFt={buoy.waveHeightFt} periodSec={buoy.dominantPeriodSec} />

      {buoy.source !== "NDBC" && (
        <div style={{
          marginTop: 8, fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
        }}>
          Modelled coastal forecast (WaveWatch III). Wave visualization above is
          drawn to scale: amplitude = wave height, wavelength = period.
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, unit, decimals }: {
  label: string; value: number | null; unit: string; decimals: number;
}) {
  const text = value == null ? "—" : value.toFixed(decimals);
  return (
    <div style={{
      background: "var(--bg-elev-2)",
      border: "1px solid var(--border-soft)",
      borderRadius: 12, padding: "10px 12px",
      minWidth: 0,
    }}>
      <div style={{
        fontSize: 10, color: "var(--text-muted)",
        fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px",
      }}>{label}</div>
      <div className="num" style={{ fontWeight: 700, fontSize: 20, marginTop: 2 }}>
        {text}<span style={{
          color: "var(--text-muted)", fontSize: 12,
          marginLeft: 3, fontWeight: 500,
        }}>{unit}</span>
      </div>
    </div>
  );
}

/** Wave direction stat — looks like the other Stat cells but the value is a
 *  small compass rose with the bearing arrow + numeric/cardinal label. */
function CompassCell({ fromDeg }: { fromDeg: number | null }) {
  return (
    <div style={{
      background: "var(--bg-elev-2)",
      border: "1px solid var(--border-soft)",
      borderRadius: 12, padding: "10px 12px",
      display: "flex", alignItems: "center", gap: 10,
      minWidth: 0,
    }}>
      <Compass fromDeg={fromDeg} />
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontSize: 10, color: "var(--text-muted)",
          fontWeight: 600, textTransform: "uppercase", letterSpacing: ".5px",
        }}>Wave from</div>
        <div className="num" style={{ fontWeight: 700, fontSize: 16, marginTop: 2 }}>
          {fromDeg != null ? (
            <>
              {String(fromDeg).padStart(3, "0")}°
              <span style={{
                color: "var(--text-muted)", fontSize: 12,
                marginLeft: 4, fontWeight: 500,
              }}>{cardinalFromDeg(fromDeg)}</span>
            </>
          ) : "—"}
        </div>
      </div>
    </div>
  );
}
