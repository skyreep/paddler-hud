"use client";

// Full-screen Leaflet-based "tap on a map" overlay. Used by the
// AddLocationWizard's pick step as an alternative to typing a town/zip
// or using the device's geolocation. Mounts on top of the wizard so
// the user can tap a spot, see a marker + a "Use this point" button,
// and bounce back to the wizard's resolve → preview flow.
//
// Reuses the Esri World Imagery tiles + place-label overlay we already
// load in MapTile, so the visual style matches the dashboard.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called when the user confirms a tapped point. Triggers the
   *  wizard's resolveCandidate → preview chain. */
  onPick: (lat: number, lon: number) => void;
  /** Initial map center. Falls back to a sensible East Coast view if
   *  nothing's known yet. */
  initialLat?: number;
  initialLon?: number;
}

export default function MapPickerOverlay({
  open, onClose, onPick, initialLat, initialLon,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markerRef = useRef<any>(null);
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Inject Leaflet CSS once per page (shared with MapTile).
  useEffect(() => {
    const id = "phud-leaflet-css";
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.crossOrigin = "";
    document.head.appendChild(link);
  }, []);

  // Mount / tear down the map when the overlay opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    (async () => {
      let L: L;
      try {
        const mod = await import("leaflet");
        L = mod.default ?? mod;
      } catch {
        if (!cancelled) setLoadError("Map library failed to load. Run `npm install`.");
        return;
      }
      if (cancelled || !containerRef.current) return;

      // Tear down any previous instance (shouldn't usually happen — we
      // remount when `open` flips — but defensive).
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      // Center: passed-in point > sensible US East Coast default.
      const lat = typeof initialLat === "number" ? initialLat : 32.0;
      const lon = typeof initialLon === "number" ? initialLon : -81.0;

      const map = L.map(containerRef.current, {
        center: [lat, lon],
        zoom: typeof initialLat === "number" ? 11 : 7,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        dragging: true,
        tap: true,
        touchZoom: true,
      });
      mapRef.current = map;

      // Same tile stack as MapTile so the picker looks like part of the app.
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        { attribution: "Imagery © Esri", maxZoom: 19 },
      ).addTo(map);
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, opacity: 0.9 },
      ).addTo(map);

      // Click handler — drop a marker, capture coords, await confirmation.
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        const { lat: clickedLat, lng: clickedLon } = e.latlng;
        if (markerRef.current) {
          markerRef.current.setLatLng([clickedLat, clickedLon]);
        } else {
          markerRef.current = L.marker([clickedLat, clickedLon]).addTo(map);
        }
        setPicked({ lat: clickedLat, lon: clickedLon });
      });
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markerRef.current = null;
    };
  }, [open, initialLat, initialLon]);

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

  // Reset selection on close.
  useEffect(() => {
    if (!open) setPicked(null);
  }, [open]);

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Tap on a map" style={overlay}>
      {/* Top bar with title + close. Stays on top of the map. */}
      <div style={topBar}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14 }}>Tap on a map</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
            {picked
              ? `${picked.lat.toFixed(4)}, ${picked.lon.toFixed(4)}`
              : "Tap anywhere on the map to drop a pin"}
          </div>
        </div>
        <button onClick={onClose} aria-label="Cancel" style={closeBtn}>✕</button>
      </div>

      {/* Map fills the rest of the screen. */}
      {loadError ? (
        <div style={errorBox}>{loadError}</div>
      ) : (
        <div ref={containerRef} style={mapEl} />
      )}

      {/* Footer with confirm button — only when a point is selected. */}
      {picked && (
        <div style={footer}>
          <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
          <button
            type="button"
            onClick={() => onPick(picked.lat, picked.lon)}
            style={primaryBtn}
          >
            Use this point
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 10200,
  background: "var(--bg-elev)",
  display: "flex", flexDirection: "column",
};
const topBar: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 12,
  padding: "12px 16px",
  paddingTop: "calc(12px + env(safe-area-inset-top))",
  background: "var(--bg-elev)",
  borderBottom: "1px solid var(--border-soft)",
  color: "var(--text)",
  flexShrink: 0,
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
const mapEl: React.CSSProperties = {
  flex: 1,
  minHeight: 0, // critical for flexbox + Leaflet sizing
  background: "var(--bg-elev-2)",
};
const errorBox: React.CSSProperties = {
  flex: 1,
  display: "grid", placeItems: "center",
  color: "var(--text-muted)", fontSize: 13,
  padding: 24, textAlign: "center",
};
const footer: React.CSSProperties = {
  display: "flex", gap: 10,
  padding: "12px 16px",
  paddingBottom: "calc(12px + env(safe-area-inset-bottom))",
  background: "var(--bg-elev)",
  borderTop: "1px solid var(--border-soft)",
  flexShrink: 0,
};
const primaryBtn: React.CSSProperties = {
  flex: 1,
  padding: "12px 16px",
  background: "var(--accent)", color: "white",
  border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
const secondaryBtn: React.CSSProperties = {
  padding: "12px 18px",
  background: "var(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
