"use client";
import { useEffect, useRef, useState } from "react";

interface Props {
  lat: number;
  lon: number;
  displayName: string;
}

// We declare a loose Leaflet type so this file is dependency-tolerant
// before `npm install` has been run on the user's machine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;

/**
 * Satellite map tile. Esri World Imagery base + Esri place-label overlay +
 * optional OpenSeaMap nautical-marks overlay (channel markers, depths,
 * aids to navigation). Fully touch-/wheel-pannable and pinch-zoomable;
 * controls match the app's accent colors via globals.css overrides.
 *
 * No API key required for any of these tile services.
 */
export default function MapTile({ lat, lon, displayName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlayRef = useRef<any>(null);
  const [chartsOn, setChartsOn] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Inject Leaflet's stylesheet once per page.
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

  // Init / re-init when the active station changes.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let L: L;
      try {
        const mod = await import("leaflet");
        L = mod.default ?? mod;
      } catch (e) {
        if (!cancelled) setErr("Map library failed to load. Run `npm install`.");
        return;
      }
      if (cancelled || !containerRef.current) return;

      // Tear down any previous instance.
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(containerRef.current, {
        center: [lat, lon],
        zoom: 13,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        dragging: true,
        tap: true,                  // mobile tap to interact
        touchZoom: true,
        doubleClickZoom: true,
        boxZoom: false,
      });
      mapRef.current = map;

      // ---- Base layer: Esri World Imagery (free, no key, global, ~0.5m near coasts) ----
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        {
          attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
          maxZoom: 19,
        }
      ).addTo(map);

      // ---- Place-name labels overlay (semi-transparent) ----
      L.tileLayer(
        "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        { maxZoom: 19, opacity: 0.9 }
      ).addTo(map);

      // ---- Optional: OpenSeaMap nautical-marks overlay (transparent — just marks) ----
      const sea = L.tileLayer("https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png", {
        attribution: "Nautical marks © OpenSeaMap contributors",
        maxZoom: 18,
        opacity: 1,
      });
      if (chartsOn) sea.addTo(map);
      overlayRef.current = sea;

      // ---- Marker at the active location ----
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-2").trim() || "#1d8fc9";
      const divIcon = L.divIcon({
        className: "phud-marker",
        html: `<div style="
          width:18px;height:18px;border-radius:50%;
          background:${accent};
          border:3px solid #fff;
          box-shadow:0 0 0 2px ${accent}, 0 2px 8px rgba(0,0,0,.4);
        "></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker([lat, lon], { icon: divIcon })
        .addTo(map)
        .bindPopup(`<strong>${displayName}</strong>`);

      // Resize once after mount in case the tile started hidden.
      setTimeout(() => map.invalidateSize(), 200);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // chartsOn intentionally not in deps — we toggle the overlay below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, displayName]);

  // Toggle OpenSeaMap nautical-marks overlay without rebuilding the map.
  useEffect(() => {
    const map = mapRef.current;
    const sea = overlayRef.current;
    if (!map || !sea) return;
    if (chartsOn) { if (!map.hasLayer(sea)) sea.addTo(map); }
    else          { if (map.hasLayer(sea))  map.removeLayer(sea); }
  }, [chartsOn]);

  function recenter() {
    if (mapRef.current) mapRef.current.setView([lat, lon], 13, { animate: true });
  }
  function locateMe() {
    if (!mapRef.current || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current.setView([pos.coords.latitude, pos.coords.longitude], 15, { animate: true }),
      () => {/* permission denied — ignore */},
      { enableHighAccuracy: true, timeout: 5000 },
    );
  }

  return (
    <section className="tile" style={{ padding: 0, overflow: "hidden" }}>
      <div className="tile-head" style={{ padding: "14px 16px 8px", margin: 0 }}>
        <span className="tile-title">Satellite · {displayName}</span>
        <span className="tile-meta">Drag to pan · pinch to zoom</span>
      </div>

      <div style={{ position: "relative" }}>
        <div
          ref={containerRef}
          aria-label={`Satellite map centered on ${displayName}`}
          style={{
            width: "100%",
            height: 340,
            background: "var(--bg-elev-2)",
          }}
        />

        {err && (
          <div style={{
            position: "absolute", inset: 0,
            display: "grid", placeItems: "center",
            background: "var(--bg-elev-2)",
            color: "var(--text-muted)", fontSize: 13, padding: 16, textAlign: "center",
          }}>{err}</div>
        )}

        {/* Floating control cluster — top-right corner */}
        <div className="phud-map-ctrl">
          <button
            className={`phud-map-btn ${chartsOn ? "on" : ""}`}
            onClick={() => setChartsOn(v => !v)}
            title="Toggle OpenSeaMap nautical marks (channel buoys, beacons, lights)"
            aria-pressed={chartsOn}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2 L12 22 M2 12 L22 12" />
              <circle cx="12" cy="12" r="4" />
            </svg>
            <span>Marks</span>
          </button>
          <button className="phud-map-btn" onClick={locateMe} title="Center on my GPS location">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
          </button>
          <button className="phud-map-btn" onClick={recenter} title={`Recenter on ${displayName}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h3M18 12h3M12 3v3M12 18v3" />
              <circle cx="12" cy="12" r="6" />
            </svg>
          </button>
        </div>
      </div>

      <div style={{
        padding: "8px 16px 14px",
        fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
      }}>
        Imagery © Esri, Maxar, Earthstar Geographics.
        {chartsOn && <> Marks © OpenSeaMap contributors.</>}
      </div>
    </section>
  );
}
