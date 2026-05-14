import type { Alert, TropicalResponse } from "@/lib/types";
import { STATION_TZ } from "@/lib/time";

interface Props {
  alerts: Alert[];
  tropical?: TropicalResponse | null;
}

/**
 * Active advisories / warnings banner. Always renders — when there's nothing
 * to flag, it confirms that explicitly so users know the feed is live.
 *
 * Sources monitored:
 *   • NWS active alerts for the location's land + marine zones:
 *     small craft, special marine warnings, dense fog, wind, coastal flood,
 *     rip currents, special weather statements, thunderstorm / tornado,
 *     hurricane / tropical-storm watches & warnings, beach hazards.
 *   • NHC tropical outlook — any active named storm with a threat heuristic.
 */
export default function AdvisoryBanner({ alerts, tropical }: Props) {
  // Tropical threat: any system flagged threat-to-user (within 600 mi & NW-bound).
  const tropicalThreat = tropical?.activeSystems?.find(s => s.threatToUser);

  // Compute overall severity for the calm-state border + color.
  const top = alerts[0];
  const severity = top?.severity?.toLowerCase() ?? "";
  const hasBadAlert = alerts.some(a => {
    const s = a.severity?.toLowerCase() ?? "";
    return s.includes("extreme") || s.includes("severe");
  });
  const cls = tropicalThreat ? "bad"
    : hasBadAlert ? "bad"
    : alerts.length > 0 ? "warn"
    : "calm";

  const borderColor =
    cls === "bad"  ? "var(--bad)" :
    cls === "warn" ? "var(--warn)" :
    "var(--good)";
  const bg =
    cls === "bad"  ? "var(--bad-soft)" :
    cls === "warn" ? "var(--warn-soft)" :
    "var(--good-soft)";
  const icon = cls === "calm" ? "✓" : "⚠️";

  // Empty state: explicit confirmation.
  if (alerts.length === 0 && !tropicalThreat) {
    return (
      <div
        style={{
          borderRadius: 16, padding: "12px 16px",
          display: "flex", gap: 12, alignItems: "center",
          boxShadow: "var(--shadow)",
          borderLeft: `5px solid ${borderColor}`,
          background: bg,
          color: "var(--text)", marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 20, lineHeight: 1, color: "var(--good)" }} aria-hidden>{icon}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>No active advisories for your area</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>
            Monitoring: small craft, marine, wind, fog, coastal flood, rip current,
            thunderstorm, hurricane / tropical storm, special weather statements,
            and NHC tropical outlook.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        borderRadius: 16, padding: "14px 16px",
        display: "flex", gap: 12, alignItems: "flex-start",
        boxShadow: "var(--shadow)",
        borderLeft: `5px solid ${borderColor}`,
        background: bg,
        color: "var(--text)", marginBottom: 14,
      }}
    >
      <div style={{ fontSize: 22, lineHeight: 1 }} aria-hidden>{icon}</div>
      <div style={{ flex: 1 }}>
        {tropicalThreat && (
          <div style={{ marginBottom: alerts.length ? 10 : 0, paddingBottom: alerts.length ? 10 : 0, borderBottom: alerts.length ? "1px solid var(--border-soft)" : "none" }}>
            <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>
              {tropicalThreat.classification} {tropicalThreat.name}
            </h3>
            <p style={{ margin: 0, fontSize: 13 }}>
              {tropicalThreat.maxWindMph != null && <>{tropicalThreat.maxWindMph} mph · </>}
              {tropicalThreat.movement ?? "track pending"}
              {tropicalThreat.distanceMi != null && <> · {tropicalThreat.distanceMi.toLocaleString()} mi away</>}
            </p>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontWeight: 600, letterSpacing: ".3px", textTransform: "uppercase" }}>
              NHC tropical threat
            </div>
          </div>
        )}
        {top && (
          <>
            <h3 style={{ margin: "0 0 4px", fontSize: 15, fontWeight: 700 }}>{top.event}</h3>
            <p style={{ margin: 0, fontSize: 13 }}>{top.headline}</p>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, fontWeight: 600, letterSpacing: ".3px", textTransform: "uppercase" }}>
              Expires {new Date(top.expires).toLocaleString("en-US", { hour: "numeric", minute: "2-digit", weekday: "short", timeZone: STATION_TZ })} · {top.senderName}
            </div>
            {alerts.length > 1 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)" }}>
                +{alerts.length - 1} more active alert{alerts.length > 2 ? "s" : ""}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
