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
import { addLocation, resolveCandidate, searchPlaces } from "@/app/locations/actions";
import type {
  ResolvedLocationBundle,
  ResolverResult,
  ResolverWarning,
} from "@/lib/location-resolver";
import type { GeocoderHit } from "@/lib/location-action-result";
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
  buildWindChain,
} from "./SourcePickers";
import MapPickerOverlay from "./MapPickerOverlay";

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
  const [mapPickerOpen, setMapPickerOpen] = useState(false);

  // Reset state every time the wizard opens.
  useEffect(() => {
    if (!open) return;
    setStep({ kind: "pick" });
    setGeolocating(false);
    setMapPickerOpen(false);
  }, [open]);

  /** Drive the resolve → preview transition. Shared by all three coord
   *  sources (search hit, current location, map tap) so failure handling
   *  and step-state writes live in one place. */
  async function resolveAndAdvance(lat: number, lon: number, suggestedName?: string) {
    setStep({ kind: "resolving", lat, lon });
    const result = await resolveCandidate(lat, lon, suggestedName);
    if (!result.ok || !result.result) {
      setStep({
        kind: "error",
        message: result.error ?? "Couldn't look up station data for that location.",
        retryFrom: "pick",
      });
      return;
    }
    setStep({ kind: "preview", result: result.result });
  }

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
        message: "Your browser doesn't support geolocation. Try searching by town/zip or tapping on the map instead.",
        retryFrom: "pick",
      });
      return;
    }
    setGeolocating(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setGeolocating(false);
        await resolveAndAdvance(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setGeolocating(false);
        let message = "Couldn't get your location.";
        if (err.code === err.PERMISSION_DENIED) {
          message = "Location permission denied. Try searching by town/zip or tapping on the map instead.";
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

  /** Place-search result clicked. */
  async function pickFromSearchHit(hit: GeocoderHit) {
    await resolveAndAdvance(hit.lat, hit.lon, hit.label);
  }

  /** Map picker tapped + confirmed. */
  async function pickFromMap(lat: number, lon: number) {
    setMapPickerOpen(false);
    await resolveAndAdvance(lat, lon);
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
    // Auto-switch the dashboard to the newly-added spot. Without this
    // the page just refreshes on whatever station was active, and the
    // user has to manually click the new location in the picker — which
    // is surprising right after they just created it. router.push()
    // implicitly invalidates the route cache, so a separate refresh()
    // isn't needed.
    if (result.addedId) {
      router.push(`/?station=${result.addedId}`);
    } else {
      router.refresh();
    }
    onSaved?.();
    onClose();
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <>
    <div onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="add-location-title" style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={dragHandle} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 id="add-location-title" style={{ margin: 0, fontSize: 18 }}>Add a location</h2>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>✕</button>
        </div>

        {step.kind === "pick" && (
          <PickStep
            onCurrentLocation={useCurrentLocation}
            onSearchPick={pickFromSearchHit}
            onOpenMap={() => setMapPickerOpen(true)}
            geolocating={geolocating}
          />
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
    </div>
    <MapPickerOverlay
      open={mapPickerOpen}
      onClose={() => setMapPickerOpen(false)}
      onPick={pickFromMap}
    />
    </>,
    document.body,
  );
}

// ─── Step components ──────────────────────────────────────────────────────

function PickStep({
  onCurrentLocation, onSearchPick, onOpenMap, geolocating,
}: {
  onCurrentLocation: () => void;
  onSearchPick: (hit: GeocoderHit) => void;
  onOpenMap: () => void;
  geolocating: boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocoderHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Debounce the search by 300ms so we don't fire a server action on
  // every keystroke. Open-Meteo's geocoder is fast (~150ms) but we
  // still don't want to spam it during typing bursts.
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setHits([]);
      setSearchError(null);
      return;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError(null);
    const timer = setTimeout(async () => {
      const res = await searchPlaces(trimmed);
      if (cancelled) return;
      setSearching(false);
      if (!res.ok) {
        setHits([]);
        setSearchError(res.error ?? "Search failed.");
        return;
      }
      setHits(res.hits ?? []);
      if ((res.hits ?? []).length === 0) {
        setSearchError("No matches. Try a different town name or zip code.");
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  return (
    <>
      <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 12px" }}>
        We&apos;ll find the nearest tide station, weather observation, and wave buoy
        automatically and let you review before saving.
      </p>

      {/* Search box — the most universal input method, prominent at top. */}
      <label style={searchLabel}>
        Search by town or zip code
      </label>
      {/* No autoFocus — on mobile it triggers the soft keyboard before the
          user has a chance to see the other input methods (current location,
          map picker) and the keyboard hides them. Field is still tappable;
          desktop users can also just click it. */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="e.g. Tybee Island, Savannah, or 31328"
        style={input}
        autoComplete="off"
      />
      {searching && (
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, marginBottom: 8 }}>
          Searching…
        </div>
      )}
      {searchError && !searching && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, marginBottom: 8 }}>
          {searchError}
        </div>
      )}
      {hits.length > 0 && (
        <div style={{
          marginTop: 8, marginBottom: 8,
          background: "var(--bg-elev-2)",
          border: "1px solid var(--border-soft)",
          borderRadius: 10,
          overflow: "hidden",
        }}>
          {hits.map((h, i) => (
            <button
              key={`${h.lat},${h.lon}`}
              type="button"
              onClick={() => onSearchPick(h)}
              style={{
                display: "block", width: "100%", textAlign: "left",
                padding: "10px 12px",
                background: "transparent",
                color: "var(--text)",
                border: "none",
                borderTop: i === 0 ? "none" : "1px solid var(--border-soft)",
                fontSize: 13, fontWeight: 500,
                fontFamily: "inherit", cursor: "pointer",
              }}
            >
              <div style={{ fontWeight: 600 }}>{h.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {[h.admin1, h.country].filter(Boolean).join(", ")} · {h.lat.toFixed(3)}, {h.lon.toFixed(3)}
              </div>
            </button>
          ))}
        </div>
      )}

      <div style={dividerLabel}>or</div>

      <button type="button" onClick={onCurrentLocation} disabled={geolocating} style={methodBtn}>
        <span style={methodIcon}>📍</span>
        <span style={{ flex: 1, textAlign: "left" }}>
          <div style={methodTitle}>Use my current location</div>
          <div style={methodSub}>{geolocating ? "Getting your location…" : "Best on a phone, at the launch point"}</div>
        </span>
      </button>

      <button type="button" onClick={onOpenMap} style={methodBtn}>
        <span style={methodIcon}>🗺️</span>
        <span style={{ flex: 1, textAlign: "left" }}>
          <div style={methodTitle}>Tap on a map</div>
          <div style={methodSub}>Pick an exact spot for a specific launch</div>
        </span>
      </button>
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
    // Wind chain: user-picked primary, plus up to 3 more candidates as
    // automatic fallbacks. The candidates list is already ranked
    // live-then-distance by the resolver, so the fallbacks come in
    // useful order without any extra logic here. Empty array if user
    // picks "none".
    const windStations: WindStationRef[] = decodedWind
      ? buildWindChain(decodedWind, candidates.wind)
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
const searchLabel: React.CSSProperties = {
  ...fieldLabel,
};
const dividerLabel: React.CSSProperties = {
  textAlign: "center",
  fontSize: 11, color: "var(--text-faint)",
  margin: "16px 0 10px",
  textTransform: "uppercase",
  letterSpacing: ".5px",
};
const methodBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  width: "100%", padding: "12px 14px",
  marginBottom: 8,
  background: "var(--bg-elev-2)",
  color: "var(--text)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  fontFamily: "inherit", cursor: "pointer",
};
const methodIcon: React.CSSProperties = {
  fontSize: 22, flexShrink: 0,
  width: 32, textAlign: "center",
};
const methodTitle: React.CSSProperties = {
  fontWeight: 600, fontSize: 14,
};
const methodSub: React.CSSProperties = {
  fontSize: 12, color: "var(--text-muted)",
  marginTop: 2,
};
