"use client";

// Wizard for adding a new saved location. Three steps:
//   1. Pick coordinates — chunk 1 only supports "Use my current location"
//      via browser geolocation. Chunk 2 adds town/zip search.
//   2. Preview the resolved bundle — every NOAA/NDBC/NWS station the
//      resolver picked, with distances + warnings.
//   3. Save — the user confirms a display name and the bundle is
//      committed to user_locations.
//
// Renders inside its own portal'd overlay so it can pop over both the
// LocationPicker and the LocationEditorModal without containing-block
// or z-index conflicts.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { addLocation, resolveCandidate } from "@/app/locations/actions";
import type {
  ResolvedLocationBundle,
  ResolverResult,
  ResolverWarning,
} from "@/lib/location-resolver";
import type { WindStationRef } from "@/lib/types";
import {
  FieldSelector,
  tideOption,
  obsOption,
  buoyOption,
  marineZoneOption,
  windOption,
  encodeWindValue,
  decodeWindValue,
} from "./SourcePickers";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent (LocationEditorModal)
   *  can refresh its list and maybe pop a success state. */
  onSaved?: () => void;
}

type WizardStep =
  | { kind: "pick" }
  | { kind: "resolving"; lat: number; lon: number }
  | { kind: "preview"; result: ResolverResult }
  | { kind: "saving"; bundle: ResolvedLocationBundle }
  | { kind: "error"; message: string; retryFrom: "pick" | "preview" };

export default function AddLocationWizard({ open, onClose, onSaved }: Props) {
  const router = useRouter();
  const [step, setStep] = useState<WizardStep>({ kind: "pick" });
  const [geolocating, setGeolocating] = useState(false);

  // Reset state every time the wizard opens.
  useEffect(() => {
    if (!open) return;
    setStep({ kind: "pick" });
    setGeolocating(false);
  }, [open]);

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

  async function useCurrentLocation() {
    if (!navigator.geolocation) {
      setStep({
        kind: "error",
        message: "Your browser doesn't support geolocation. Search by town/zip is coming in a future update.",
        retryFrom: "pick",
      });
      return;
    }
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGeolocating(false);
        const { latitude, longitude } = pos.coords;
        setStep({ kind: "resolving", lat: latitude, lon: longitude });
        const result = await resolveCandidate(latitude, longitude);
        if (!result.ok || !result.result) {
          setStep({
            kind: "error",
            message: result.error ?? "Couldn't look up station data for that location.",
            retryFrom: "pick",
          });
          return;
        }
        setStep({ kind: "preview", result: result.result });
      },
      (err) => {
        setGeolocating(false);
        let message = "Couldn't get your location.";
        if (err.code === err.PERMISSION_DENIED) {
          message = "Location permission denied. You'll need to allow location access (or use town/zip search in a future update).";
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          message = "Your device couldn't determine your position. Try again outside or near a window.";
        } else if (err.code === err.TIMEOUT) {
          message = "Location lookup timed out. Try again.";
        }
        setStep({ kind: "error", message, retryFrom: "pick" });
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  async function handleSave(bundle: ResolvedLocationBundle) {
    const trimmed = bundle.displayName.trim();
    if (!trimmed) {
      setStep({ kind: "error", message: "Please give this location a name.", retryFrom: "preview" });
      return;
    }
    const toSave: ResolvedLocationBundle = { ...bundle, displayName: trimmed };
    setStep({ kind: "saving", bundle: toSave });
    const result = await addLocation(toSave);
    if (!result.ok) {
      setStep({ kind: "error", message: result.error ?? "Couldn't save.", retryFrom: "preview" });
      return;
    }
    // Force a refresh so the new location shows up in the picker
    // and all downstream loaders pick it up.
    router.refresh();
    onSaved?.();
    onClose();
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-location-title" style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={dragHandle} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 id="add-location-title" style={{ margin: 0, fontSize: 18 }}>Add a location</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>✕</button>
        </div>

        {step.kind === "pick" && (
          <PickStep onCurrentLocation={useCurrentLocation} geolocating={geolocating} />
        )}

        {step.kind === "resolving" && (
          <div style={notice}>
            <div style={{ fontWeight: 600 }}>Looking up stations near {step.lat.toFixed(3)}, {step.lon.toFixed(3)}…</div>
            <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 4 }}>
              Querying NWS, NOAA tide stations, and NDBC buoys.
            </div>
          </div>
        )}

        {step.kind === "preview" && (
          <PreviewStep
            result={step.result}
            onSave={handleSave}
            onBack={() => setStep({ kind: "pick" })}
          />
        )}

        {step.kind === "saving" && (
          <div style={notice}>
            <div style={{ fontWeight: 600 }}>Saving {step.bundle.displayName}…</div>
          </div>
        )}

        {step.kind === "error" && (
          <>
            <div style={{ ...notice, borderColor: "#c44", color: "#c44" }}>
              {step.message}
            </div>
            <button
              type="button"
              onClick={() => setStep({ kind: step.retryFrom === "preview" ? "pick" : "pick" })}
              style={primaryBtn}
            >
              Try again
            </button>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Step components ──────────────────────────────────────────────────────

function PickStep({ onCurrentLocation, geolocating }: { onCurrentLocation: () => void; geolocating: boolean }) {
  return (
    <>
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 16px" }}>
        We&apos;ll find the nearest tide station, weather observation, and wave buoy automatically.
        You&apos;ll get a preview to review before saving.
      </p>

      <button type="button" onClick={onCurrentLocation} disabled={geolocating} style={primaryBtn}>
        {geolocating ? "Getting your location…" : "📍 Use my current location"}
      </button>

      <div style={{
        marginTop: 14, padding: 12,
        background: "var(--bg-elev-2)", border: "1px dashed var(--border)",
        borderRadius: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5,
      }}>
        <strong>Coming soon:</strong> search by town or zip code, and tap-on-a-map. For now,
        adding by current location works best on a phone where you actually paddle from.
      </div>
    </>
  );
}

function PreviewStep({
  result, onSave, onBack,
}: {
  result: ResolverResult;
  onSave: (bundle: ResolvedLocationBundle) => void;
  onBack: () => void;
}) {
  const { bundle, warnings, candidates } = result;
  // Local state holds the user's choices. Each starts at whatever the
  // resolver auto-picked (the top of the relevant candidate list).
  // Name seeds from the resolver's suggested displayName — this comes
  // from NWS's relativeLocation city/state when available, falling back
  // to lat/lon coordinates if the API didn't return a useful name.
  const [name, setName] = useState(bundle.displayName);
  const [tideId, setTideId] = useState<string>(bundle.tideStationId);
  const [observationId, setObservationId] = useState<string>(bundle.observationStationId ?? "");
  const [buoyId, setBuoyId] = useState<string>(bundle.buoyId ?? "");
  const [marineZoneId, setMarineZoneId] = useState<string>(bundle.marineZone ?? "");
  // Wind source is a "kind:id" composite (e.g. "coops:8670870") so a
  // single <select> can hold both CO-OPS stations and NDBC buoys. Seed
  // from the first entry in the resolver's wind chain.
  const [windValue, setWindValue] = useState<string>(
    bundle.windStations[0] ? encodeWindValue(bundle.windStations[0].kind, bundle.windStations[0].id) : "",
  );

  const selectedTide = candidates.tide.find((c) => c.stationId === tideId);
  const selectedObs = candidates.observation.find((c) => c.stationId === observationId);
  const selectedBuoy = candidates.buoy.find((c) => c.buoyId === buoyId);
  const selectedMarineZone = candidates.marineZone.find((c) => c.id === marineZoneId);
  const decodedWind = decodeWindValue(windValue);
  const selectedWind = decodedWind
    ? candidates.wind.find((c) => c.kind === decodedWind.kind && c.id === decodedWind.id) ?? null
    : null;

  const hasError = warnings.some((w) => w.severity === "error");
  const hasTideCandidates = candidates.tide.length > 0;
  const hasObsCandidates = candidates.observation.length > 0;
  const hasBuoyCandidates = candidates.buoy.length > 0;
  const hasWindCandidates = candidates.wind.length > 0;
  const hasMarineZoneCandidates = candidates.marineZone.length > 0;

  function buildBundle(): ResolvedLocationBundle {
    // Wind chain now comes from its own picker, not derived from tide
    // or buoy. Single primary source — empty array if user picks "none".
    const windStations: WindStationRef[] = decodedWind
      ? [{ kind: decodedWind.kind, id: decodedWind.id }]
      : [];

    // Regenerate the tide station note based on the selected (not auto-picked) station.
    let tideNote: string | null = null;
    if (selectedTide && selectedTide.distanceMi > 5) {
      tideNote = `Reference: ${selectedTide.stationName}. ~${selectedTide.distanceMi.toFixed(0)} mi from this location; tide times may run a few minutes off.`;
    }

    return {
      ...bundle,
      displayName: name,
      tideStationId: tideId,
      tideStationNote: tideNote,
      observationStationId: observationId || null,
      windStations,
      buoyId: buoyId || null,
      marineZone: marineZoneId || null,
    };
  }

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <label style={fieldLabel}>Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Tybee Island, GA"
          style={input}
        />
      </div>

      <div style={fieldLabel}>Stations &amp; zones</div>
      <p style={{ fontSize: 11, color: "var(--text-faint)", margin: "0 0 10px", lineHeight: 1.5 }}>
        Default picks shown — change any field to override.
      </p>

      <FieldSelector
        label="Tide station"
        value={tideId}
        onChange={setTideId}
        options={candidates.tide.map(tideOption)}
        helpText={
          selectedTide
            ? `${selectedTide.distanceMi.toFixed(1)} mi · ${selectedTide.isHarmonic ? "harmonic (full curve)" : "subordinate (extremes only)"}`
            : null
        }
        emptyText={!hasTideCandidates ? "No tide stations found in range." : null}
        required
      />

      <FieldSelector
        label="Weather observation"
        value={observationId}
        onChange={setObservationId}
        options={[{ value: "", label: "— None (use forecast values)" }, ...candidates.observation.map(obsOption)]}
        helpText={
          selectedObs
            ? `${selectedObs.distanceMi.toFixed(1)} mi · ${selectedObs.isIcao ? "ICAO airport (ASOS)" : "mesonet / other"}`
            : observationId === "" ? "Right Now tile will use the gridded forecast." : null
        }
        emptyText={!hasObsCandidates ? "No weather stations found via NWS." : null}
      />

      <FieldSelector
        label="Wind source"
        value={windValue}
        onChange={setWindValue}
        options={[
          { value: "", label: "— None (hide real-time wind tile)" },
          ...candidates.wind.map(windOption),
        ]}
        helpText={
          selectedWind
            ? `${selectedWind.distanceMi.toFixed(1)} mi · ${selectedWind.kind === "coops" ? "CO-OPS coastal station" : "NDBC offshore buoy"}`
            : windValue === "" ? "Real-time wind tile will be hidden." : null
        }
        emptyText={!hasWindCandidates ? "No wind-equipped stations found in range." : null}
      />

      <FieldSelector
        label="Wave buoy"
        value={buoyId}
        onChange={setBuoyId}
        options={[{ value: "", label: "— None (hide Marine tile)" }, ...candidates.buoy.map(buoyOption)]}
        helpText={
          selectedBuoy
            ? `${selectedBuoy.distanceMi.toFixed(1)} mi · drives wave height + period`
            : buoyId === "" ? "Marine tile (wave height / period) will be hidden." : null
        }
        emptyText={!hasBuoyCandidates ? "No NDBC buoys found in range." : null}
      />

      <FieldSelector
        label="NWS marine zone"
        value={marineZoneId}
        onChange={setMarineZoneId}
        options={[{ value: "", label: "— None (no marine alerts)" }, ...candidates.marineZone.map(marineZoneOption)]}
        helpText={
          selectedMarineZone
            ? selectedMarineZone.source === "containing"
              ? "Contains your coordinates"
              : "Marine zone in your state (you're inland)"
            : marineZoneId === "" ? "Marine alerts won't apply to this location." : null
        }
        emptyText={!hasMarineZoneCandidates ? "No marine zones found for your area." : null}
      />

      <div style={{ ...fieldLabel, marginTop: 10 }}>Fixed</div>
      <div style={{
        background: "var(--bg-elev-2)",
        border: "1px solid var(--border-soft)",
        borderRadius: 10,
        padding: 12,
        marginBottom: 14,
      }}>
        <BundleRow label="Coordinates" value={`${bundle.lat.toFixed(4)}, ${bundle.lon.toFixed(4)}`} />
        <BundleRow label="NWS land zone" value={bundle.nwsZone || "—"} last />
      </div>

      {warnings.length > 0 && (
        <div style={{ marginBottom: 14 }}>
          {warnings.map((w, i) => <WarningPill key={i} warning={w} />)}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" onClick={onBack} style={secondaryBtn}>Back</button>
        <button
          type="button"
          onClick={() => onSave(buildBundle())}
          disabled={!tideId || !name.trim()}
          style={{
            ...primaryBtn, flex: 1,
            background: hasError ? "var(--warn)" : "var(--accent)",
          }}
        >
          {hasError ? "Save anyway" : "Save location"}
        </button>
      </div>
    </>
  );
}

// FieldSelector + option formatters live in ./SourcePickers.tsx so the
// edit-sources modal can share them.

function BundleRow({ label, value, meta, note, last }: {
  label: string;
  value: string;
  /** Inline secondary text — e.g. "12.4 mi · harmonic". Always visible
   *  when present, regardless of whether a warning was generated. */
  meta?: string | null;
  /** Long-form explanatory note shown on its own line below. */
  note?: string | null;
  last?: boolean;
}) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "120px 1fr",
      gap: 8, padding: "6px 0",
      borderBottom: last ? "none" : "1px solid var(--border-soft)",
      fontSize: 13,
    }}>
      <span style={{ color: "var(--text-muted)" }}>{label}</span>
      <span className="num" style={{ minWidth: 0 }}>
        <span style={{ fontWeight: 600 }}>{value}</span>
        {meta && (
          <span style={{ color: "var(--text-faint)", fontWeight: 500, marginLeft: 6, fontSize: 11 }}>
            · {meta}
          </span>
        )}
        {note && (
          <span style={{ display: "block", color: "var(--text-muted)", fontSize: 11, marginTop: 2 }}>
            {note}
          </span>
        )}
      </span>
    </div>
  );
}

function WarningPill({ warning }: { warning: ResolverWarning }) {
  const color = warning.severity === "error" ? "#c44"
    : warning.severity === "warning" ? "var(--warn)"
    : "var(--text-muted)";
  const icon = warning.severity === "error" ? "✕"
    : warning.severity === "warning" ? "!"
    : "ℹ";
  return (
    <div style={{
      display: "flex", gap: 8, alignItems: "flex-start",
      padding: "8px 10px",
      background: "var(--bg-elev-2)",
      border: `1px solid ${color}`,
      borderRadius: 8,
      fontSize: 12, color: "var(--text)",
      marginBottom: 6,
    }}>
      <span style={{
        flexShrink: 0, width: 18, height: 18, borderRadius: "50%",
        background: color, color: "white",
        display: "grid", placeItems: "center",
        fontSize: 11, fontWeight: 700,
      }}>{icon}</span>
      <span style={{ lineHeight: 1.4 }}>{warning.message}</span>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

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
  display: "block", width: "100%", padding: "12px 16px",
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
const input: React.CSSProperties = {
  display: "block", width: "100%", padding: "10px 12px",
  background: "var(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontFamily: "inherit",
  boxSizing: "border-box",
};
const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 12, color: "var(--text-muted)",
  textTransform: "uppercase", letterSpacing: ".4px",
  fontWeight: 600,
  marginBottom: 6,
};
