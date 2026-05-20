"use client";

// Edit the data sources (tide / observation / buoy / marine zone) on an
// existing saved location. Sibling to AddLocationWizard but for a row
// that already exists.
//
// Flow:
//   1. Modal opens with the row's current saved values displayed.
//   2. resolveCandidate runs against the row's lat/lon to fetch a fresh
//      list of nearby stations (so the dropdown options are current).
//   3. Dropdowns initialize to the user's CURRENT saved values — not
//      the resolver's auto-pick — so they see what they actually have.
//   4. User can override any field from its dropdown and save.
//
// Why this exists: real-world sensors go offline, get replaced, or just
// turn out to be subordinate when the user wanted harmonic. Without
// this modal, the only fix was delete + re-add, losing the row's UUID
// and primary status.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { resolveCandidate, updateLocationStations } from "@/app/locations/actions";
import type { ResolverResult } from "@/lib/location-resolver";
import type { UserLocation, WindStationRef } from "@/lib/types";
import {
  FieldSelector,
  tideOption,
  obsOption,
  buoyOption,
  marineZoneOption,
  windOption,
  encodeWindValue,
  decodeWindValue,
  buildWindChain,
} from "./SourcePickers";

interface Props {
  open: boolean;
  onClose: () => void;
  /** The row being edited — its current values seed the dropdowns. */
  location: UserLocation | null;
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; result: ResolverResult }
  | { kind: "saving" }
  | { kind: "error"; message: string };

export default function EditLocationSourcesModal({ open, onClose, location }: Props) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  // Selections — seeded from the user's CURRENT row values on open,
  // updated as they pick alternatives from the dropdowns.
  const [tideId, setTideId] = useState("");
  const [observationId, setObservationId] = useState("");
  const [buoyId, setBuoyId] = useState("");
  const [marineZoneId, setMarineZoneId] = useState("");
  // Wind source ("coops:id" / "ndbc:id" composite, or "" for none).
  // Seeded from the first entry in the row's existing windStations chain.
  const [windValue, setWindValue] = useState("");

  // Kick off the candidate resolver when the modal opens with a row.
  useEffect(() => {
    if (!open || !location) {
      setState({ kind: "idle" });
      return;
    }
    setState({ kind: "loading" });
    setTideId(location.tideStationId || "");
    setObservationId(location.observationStationId ?? "");
    setBuoyId(location.buoyId ?? "");
    setMarineZoneId(location.marineZone ?? "");
    setWindValue(
      location.windStations && location.windStations[0]
        ? encodeWindValue(location.windStations[0].kind, location.windStations[0].id)
        : "",
    );

    let cancelled = false;
    (async () => {
      const r = await resolveCandidate(location.lat, location.lon, location.displayName);
      if (cancelled) return;
      if (!r.ok || !r.result) {
        setState({ kind: "error", message: r.error ?? "Couldn't load alternative stations." });
        return;
      }
      setState({ kind: "ready", result: r.result });
    })();
    return () => { cancelled = true; };
  }, [open, location]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  async function handleSave() {
    if (!location || state.kind !== "ready") return;
    setState({ kind: "saving" });

    // Wind chain: user-picked primary + up to 3 more candidates as
    // automatic fallbacks (live-then-distance ranked, so a stuck primary
    // sensor doesn't take the whole tile down). Empty array if user
    // picked "none".
    const decodedWind = decodeWindValue(windValue);
    const windStations: WindStationRef[] = decodedWind
      ? buildWindChain(decodedWind, state.result.candidates.wind)
      : [];

    // Regenerate the tide note based on the selected station's distance.
    const selectedTide = state.result.candidates.tide.find((c) => c.stationId === tideId);
    let tideNote: string | null = null;
    if (selectedTide && selectedTide.distanceMi > 5) {
      tideNote = `Reference: ${selectedTide.stationName}. ~${selectedTide.distanceMi.toFixed(0)} mi from this location; tide times may run a few minutes off.`;
    }

    const result = await updateLocationStations(location.id, {
      tideStationId: tideId,
      tideStationNote: tideNote,
      observationStationId: observationId || null,
      windStations,
      buoyId: buoyId || null,
      marineZone: marineZoneId || null,
    });

    if (!result.ok) {
      setState({ kind: "error", message: result.error ?? "Couldn't save." });
      return;
    }
    router.refresh();
    onClose();
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="edit-sources-title" style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={dragHandle} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <div>
            <h2 id="edit-sources-title" style={{ margin: 0, fontSize: 18 }}>Edit data sources</h2>
            {location && (
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                {location.displayName}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>✕</button>
        </div>

        {state.kind === "loading" && (
          <div style={notice}>Looking up nearby alternatives…</div>
        )}

        {state.kind === "error" && (
          <div style={{ ...notice, borderColor: "#c44", color: "#c44" }}>
            {state.message}
          </div>
        )}

        {(state.kind === "ready" || state.kind === "saving") && location && (
          <SourceFields
            result={state.kind === "ready" ? state.result : null}
            tideId={tideId}
            observationId={observationId}
            buoyId={buoyId}
            marineZoneId={marineZoneId}
            windValue={windValue}
            onTide={setTideId}
            onObservation={setObservationId}
            onBuoy={setBuoyId}
            onMarineZone={setMarineZoneId}
            onWind={setWindValue}
            saving={state.kind === "saving"}
          />
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={state.kind !== "ready" || !tideId}
            style={{ ...primaryBtn, flex: 1 }}
          >
            {state.kind === "saving" ? "Saving…" : "Save changes"}
          </button>
        </div>

        <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "14px 0 0", textAlign: "center", lineHeight: 1.5 }}>
          To change coordinates or the location name, delete this entry and add a fresh one.
        </p>
      </div>
    </div>,
    document.body,
  );
}

function SourceFields({
  result, tideId, observationId, buoyId, marineZoneId, windValue,
  onTide, onObservation, onBuoy, onMarineZone, onWind, saving,
}: {
  result: ResolverResult | null;
  tideId: string;
  observationId: string;
  buoyId: string;
  marineZoneId: string;
  windValue: string;
  onTide: (v: string) => void;
  onObservation: (v: string) => void;
  onBuoy: (v: string) => void;
  onMarineZone: (v: string) => void;
  onWind: (v: string) => void;
  saving: boolean;
}) {
  if (!result) return null;
  const c = result.candidates;

  const selectedTide = c.tide.find((x) => x.stationId === tideId);
  const selectedObs = c.observation.find((x) => x.stationId === observationId);
  const selectedBuoy = c.buoy.find((x) => x.buoyId === buoyId);
  const selectedMarine = c.marineZone.find((x) => x.id === marineZoneId);
  const decodedWind = decodeWindValue(windValue);
  const selectedWind = decodedWind
    ? c.wind.find((x) => x.kind === decodedWind.kind && x.id === decodedWind.id) ?? null
    : null;

  // The user's currently-saved station might not appear in the resolver's
  // fresh candidate list (e.g. it's been retired or it's farther than the
  // top N). Inject it as an extra option so they don't lose what they
  // already have just by opening the modal.
  const tideOptions = ensureCurrentInOptions(c.tide.map(tideOption), tideId, `${tideId} (current — not in nearby list)`);
  const obsOptions = [
    { value: "", label: "— None (use forecast values)" },
    ...ensureCurrentInOptions(c.observation.map(obsOption), observationId, `${observationId} (current — not in nearby list)`),
  ];
  const windOptions = [
    { value: "", label: "— None (hide real-time wind tile)" },
    ...ensureCurrentInOptions(
      c.wind.map(windOption),
      windValue,
      decodedWind ? `${decodedWind.id} (${decodedWind.kind === "coops" ? "CO-OPS" : "NDBC"}) (current — not in nearby list)` : "",
    ),
  ];
  const buoyOptions = [
    { value: "", label: "— None (hide Marine tile)" },
    ...ensureCurrentInOptions(c.buoy.map(buoyOption), buoyId, `${buoyId} (current — not in nearby list)`),
  ];
  const marineOptions = [
    { value: "", label: "— None (no marine alerts)" },
    ...ensureCurrentInOptions(c.marineZone.map(marineZoneOption), marineZoneId, `${marineZoneId} (current — not in this office)`),
  ];

  return (
    <>
      <FieldSelector
        label="Tide station"
        value={tideId}
        onChange={onTide}
        options={tideOptions}
        helpText={
          selectedTide
            ? `${selectedTide.distanceMi.toFixed(1)} mi · ${selectedTide.isHarmonic ? "harmonic (full curve)" : "subordinate (extremes only)"}`
            : tideId ? "Current selection isn't in the nearby list — switch to a nearby one if your sensor is offline." : null
        }
        disabled={saving}
        required
      />
      <FieldSelector
        label="Weather observation"
        value={observationId}
        onChange={onObservation}
        options={obsOptions}
        helpText={
          selectedObs
            ? `${selectedObs.distanceMi.toFixed(1)} mi · ${selectedObs.isIcao ? "ICAO airport (ASOS)" : "mesonet / other"}`
            : observationId === "" ? "Right Now tile will use the gridded forecast." : null
        }
        disabled={saving}
      />
      <FieldSelector
        label="Wind source"
        value={windValue}
        onChange={onWind}
        options={windOptions}
        helpText={
          selectedWind
            ? `${selectedWind.distanceMi.toFixed(1)} mi · ${selectedWind.kind === "coops" ? "CO-OPS coastal station" : "NDBC offshore buoy"}`
            : windValue === "" ? "Real-time wind tile will be hidden." : null
        }
        disabled={saving}
      />
      <FieldSelector
        label="Wave buoy"
        value={buoyId}
        onChange={onBuoy}
        options={buoyOptions}
        helpText={
          selectedBuoy
            ? `${selectedBuoy.distanceMi.toFixed(1)} mi · drives wave height + period`
            : buoyId === "" ? "Marine tile (wave height / period) will be hidden." : null
        }
        disabled={saving}
      />
      <FieldSelector
        label="NWS marine zone"
        value={marineZoneId}
        onChange={onMarineZone}
        options={marineOptions}
        helpText={
          selectedMarine
            ? selectedMarine.source === "containing"
              ? "Contains your coordinates"
              : "Managed by your local NWS office"
            : marineZoneId === "" ? "Marine alerts won't apply to this location." : null
        }
        disabled={saving}
      />
    </>
  );
}

/** If `current` isn't already represented in the options list, prepend a
 *  placeholder entry so the dropdown can still display the user's current
 *  selection. Keeps users from being silently switched off a station
 *  just because the modal opened. */
function ensureCurrentInOptions(
  options: Array<{ value: string; label: string }>,
  current: string,
  placeholderLabel: string,
): Array<{ value: string; label: string }> {
  if (!current) return options;
  if (options.some((o) => o.value === current)) return options;
  return [{ value: current, label: placeholderLabel }, ...options];
}

// ─── Styles

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 10100,
  background: "rgba(7,17,26,.6)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const sheet: React.CSSProperties = {
  background: "var(--bg-elev)",
  width: "100%", maxWidth: 480, maxHeight: "92vh",
  borderRadius: "22px 22px 0 0",
  padding: 18,
  paddingBottom: "calc(18px + env(safe-area-inset-bottom))",
  overflowY: "auto",
  animation: "phud-slideup .25s ease",
  color: "var(--text)",
};
const dragHandle: React.CSSProperties = {
  width: 40, height: 4, background: "var(--border)",
  borderRadius: 2, margin: "0 auto 14px",
};
const closeBtn: React.CSSProperties = {
  marginLeft: "auto",
  width: 32, height: 32,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: "50%",
  display: "grid", placeItems: "center",
  color: "var(--text)", cursor: "pointer", fontSize: 14,
};
const notice: React.CSSProperties = {
  padding: "10px 12px", marginBottom: 12,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 13, color: "var(--text)",
};
const primaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  background: "var(--accent)", color: "white",
  border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  padding: "12px 16px",
  background: "var(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
