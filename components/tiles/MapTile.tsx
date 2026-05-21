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
 * Satellite map tile with optional GPS + compass tracking.
 *
 * Baseline behavior: Esri World Imagery + place-name labels overlay,
 * centered on the user's selected paddling location with an accent
 * marker. Drag/pinch as usual.
 *
 * "Track Me" mode: enables real-time tracking of the user's own
 * position and heading.
 *   - watchPosition for live GPS updates (1Hz, high accuracy)
 *   - deviceorientation for compass heading
 *   - Renders a green user-dot at the GPS position with a translucent
 *     field-of-view cone extending in the direction the phone is
 *     facing — same metaphor as Google Maps' blue beam.
 *   - Follow mode: map auto-pans to keep the user centered. If the
 *     user manually drags the map, follow mode disengages (the map
 *     no longer fights them) but tracking continues. Tap the button
 *     again to re-engage follow mode.
 *
 * Mobile-only feature in practice. Desktop browsers don't have
 * compass hardware, so the cone won't appear there — just the dot.
 * iOS 13+ requires explicit permission to deliver orientation
 * events; we request it via the iOS-specific requestPermission API,
 * which must run from a user gesture (the toggle button tap).
 */

// User-marker palette — deliberately distinct from the location pin
// (which uses --accent-2 / blue) so "where I am" and "where I'm
// paddling" never get confused on the same map.
const USER_COLOR = "#19c39a";          // teal-green
const USER_CONE = "rgba(25,195,154,0.22)";

export default function MapTile({ lat, lon, displayName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const LRef = useRef<any>(null);          // cached Leaflet module
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const userMarkerRef = useRef<any>(null);
  const watchIdRef = useRef<number | null>(null);
  // Last raw position from watchPosition + last smoothed heading.
  const lastPosRef = useRef<{ lat: number; lon: number } | null>(null);
  const headingRef = useRef<number | null>(null);
  // Re-engaged on each tracking toggle, disengaged when the user
  // drags the map. Tracking continues even when follow is off.
  const followRef = useRef(false);

  const [err, setErr] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [trackingErr, setTrackingErr] = useState<string | null>(null);

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
        LRef.current = L;
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
        tap: true,
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

      // ---- Marker at the active paddling location ----
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

      // Manual drag disengages follow mode (but leaves tracking running)
      // so the user can browse the map without the auto-pan fighting them.
      map.on("dragstart", () => { followRef.current = false; });

      setTimeout(() => map.invalidateSize(), 200);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      userMarkerRef.current = null;
    };
  }, [lat, lon, displayName]);

  // ─── Tracking lifecycle ──────────────────────────────────────────
  // Subscribes to geolocation + deviceorientation when `tracking` is
  // true, cleans up on toggle-off or unmount.
  useEffect(() => {
    if (!tracking) return;

    const map = mapRef.current;
    const L = LRef.current;
    if (!map || !L || !navigator.geolocation) {
      setTrackingErr("Tracking not available in this browser.");
      setTracking(false);
      return;
    }

    let cancelled = false;
    let rafScheduled = false;
    setTrackingErr(null);
    followRef.current = true;

    // iOS 13+ requires explicit permission for deviceorientation;
    // Android/desktop Chrome deliver events by default. The
    // requestPermission call must originate from a user gesture —
    // it does here, since the tracking effect is triggered by the
    // button tap that flipped `tracking` to true.
    type DoeStatic = typeof DeviceOrientationEvent & {
      requestPermission?: () => Promise<"granted" | "denied">;
    };
    const Doe = (typeof DeviceOrientationEvent !== "undefined"
      ? DeviceOrientationEvent
      : null) as DoeStatic | null;

    (async () => {
      if (Doe && typeof Doe.requestPermission === "function") {
        try {
          const state = await Doe.requestPermission();
          if (state !== "granted") return;
        } catch {
          return;
        }
      }
      if (cancelled) return;
      window.addEventListener("deviceorientationabsolute", handleOrient as EventListener, true);
      window.addEventListener("deviceorientation", handleOrient, true);
    })();

    function handleOrient(e: DeviceOrientationEvent) {
      const ev = e as DeviceOrientationEvent & { webkitCompassHeading?: number };
      // iOS gives us a true tilt-corrected compass heading. Everywhere
      // else we fall back to alpha (rotation around device-vertical
      // axis), inverted so 0° = north.
      const raw =
        typeof ev.webkitCompassHeading === "number" ? ev.webkitCompassHeading
        : typeof ev.alpha === "number"               ? (360 - ev.alpha) % 360
        : null;
      if (raw == null || Number.isNaN(raw)) return;
      headingRef.current = smoothHeading(raw, headingRef.current);
      // Throttle marker updates to one per animation frame — orientation
      // can fire 60Hz which is way more than the map needs.
      if (!rafScheduled) {
        rafScheduled = true;
        requestAnimationFrame(() => {
          rafScheduled = false;
          updateMarker();
        });
      }
    }

    function updateMarker() {
      if (!mapRef.current || !LRef.current || !lastPosRef.current) return;
      const { lat: la, lon: lo } = lastPosRef.current;
      const icon = buildUserIcon(LRef.current, headingRef.current);
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([la, lo]);
        userMarkerRef.current.setIcon(icon);
      } else {
        userMarkerRef.current = LRef.current
          .marker([la, lo], { icon, zIndexOffset: 1000, interactive: false })
          .addTo(mapRef.current);
      }
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        if (cancelled) return;
        const { latitude, longitude } = pos.coords;
        lastPosRef.current = { lat: latitude, lon: longitude };
        updateMarker();
        if (followRef.current && mapRef.current) {
          mapRef.current.setView([latitude, longitude], mapRef.current.getZoom(), {
            animate: true,
            duration: 0.4,
          });
        }
      },
      (gpsErr) => {
        setTrackingErr(
          gpsErr.code === gpsErr.PERMISSION_DENIED
            ? "Location permission denied."
            : "Couldn't read your location.",
        );
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );

    return () => {
      cancelled = true;
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      window.removeEventListener("deviceorientationabsolute", handleOrient as EventListener, true);
      window.removeEventListener("deviceorientation", handleOrient, true);
      if (userMarkerRef.current && mapRef.current) {
        mapRef.current.removeLayer(userMarkerRef.current);
      }
      userMarkerRef.current = null;
      lastPosRef.current = null;
      headingRef.current = null;
      followRef.current = false;
    };
  }, [tracking]);

  function toggleTracking() {
    setTracking(v => !v);
  }
  function recenter() {
    if (mapRef.current) mapRef.current.setView([lat, lon], 13, { animate: true });
  }
  function recenterOnMe() {
    // Re-engage follow mode if tracking is on, or take a one-shot pan
    // if it isn't. Pairs nicely with the user dragging away and then
    // wanting to snap back to themselves.
    if (tracking && lastPosRef.current && mapRef.current) {
      followRef.current = true;
      mapRef.current.setView([lastPosRef.current.lat, lastPosRef.current.lon], 15, { animate: true });
      return;
    }
    if (!navigator.geolocation || !mapRef.current) return;
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
        <span className="tile-meta">
          {tracking ? "Tracking · drag to free-pan" : "Drag to pan · pinch to zoom"}
        </span>
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
            className={`phud-map-btn ${tracking ? "on" : ""}`}
            onClick={toggleTracking}
            title={tracking ? "Stop tracking my position" : "Track my position + heading (mobile only)"}
            aria-pressed={tracking}
          >
            {/* Stylized compass-needle / location-with-direction icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="12,3 16,20 12,17 8,20" />
            </svg>
          </button>
          <button className="phud-map-btn" onClick={recenterOnMe} title={tracking ? "Re-center on me" : "Center on my GPS location"}>
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

        {trackingErr && (
          <div style={{
            position: "absolute", left: 12, bottom: 12,
            padding: "6px 10px",
            background: "var(--bg-elev-2)",
            border: "1px solid var(--border-soft)",
            borderRadius: 8,
            fontSize: 12, color: "var(--text-muted)",
            maxWidth: "70%",
          }}>{trackingErr}</div>
        )}
      </div>

      <div style={{
        padding: "8px 16px 14px",
        fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
      }}>
        Imagery © Esri, Maxar, Earthstar Geographics.
      </div>
    </section>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Build a divIcon for the user's GPS position. When heading is
 *  provided, includes a translucent field-of-view cone pointing in
 *  that direction. Heading-less devices (most desktops) get just a
 *  dot — still useful for "I'm here." */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildUserIcon(L: any, heading: number | null): any {
  const rotate = heading != null ? `transform:rotate(${heading.toFixed(0)}deg);` : "";
  const cone = heading != null ? `
    <div style="
      position:absolute; bottom:50%; left:50%;
      width:0; height:0;
      border-left:22px solid transparent;
      border-right:22px solid transparent;
      border-bottom:34px solid ${USER_CONE};
      transform:translateX(-50%);
      pointer-events:none;
    "></div>
  ` : "";
  return L.divIcon({
    className: "phud-me-marker",
    html: `
      <div style="position:relative; width:48px; height:48px; ${rotate} transform-origin:center center; pointer-events:none;">
        ${cone}
        <div style="
          position:absolute; top:50%; left:50%;
          width:14px; height:14px; border-radius:50%;
          background:${USER_COLOR};
          border:2px solid #fff;
          box-shadow:0 0 0 1px ${USER_COLOR}, 0 2px 6px rgba(0,0,0,.4);
          transform:translate(-50%, -50%);
          pointer-events:none;
        "></div>
      </div>
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24],
  });
}

/** Exponential smoothing for compass heading, wrap-aware so the
 *  marker doesn't spin the long way when the heading crosses the
 *  359°→0° boundary. Higher alpha = more responsive, less smooth. */
function smoothHeading(raw: number, prev: number | null, alpha = 0.25): number {
  if (prev == null || Number.isNaN(prev)) return raw;
  let diff = raw - prev;
  while (diff >  180) diff -= 360;
  while (diff < -180) diff += 360;
  return (prev + alpha * diff + 360) % 360;
}
