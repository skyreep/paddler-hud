"use client";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { STATION_TZ } from "@/lib/time";

interface Props {
  lat: number;
  lon: number;
  displayName: string;
}

interface RvFrame {
  time: number;    // unix seconds
  path: string;
}
interface RvIndex {
  host: string;
  radar: { past: RvFrame[]; nowcast: RvFrame[] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;

const FRAME_MS = 650;        // playback speed
const RADAR_COLOR = 2;       // RainViewer "Universal Blue" palette, very readable
const RADAR_OPTS = "1_1";    // smooth + show snow colors

const CARTO_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const CARTO_DARK  = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";

function formatOffset(deltaSec: number): string {
  const abs = Math.abs(deltaSec);
  if (abs < 60) return "Now";
  const totalMin = Math.round(abs / 60);
  if (totalMin < 60) return `${deltaSec < 0 ? "−" : "+"}${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const sign = deltaSec < 0 ? "−" : "+";
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

function formatClock(t: number): string {
  return new Date(t * 1000).toLocaleTimeString("en-US", {
    hour: "numeric", minute: "2-digit", timeZone: STATION_TZ,
  });
}

/**
 * Weather Radar tile. Past 2 hours of NEXRAD + 30 min nowcast from RainViewer.
 *
 *  - Base map: CartoDB Positron (light) or Dark Matter (dark); free, no key
 *  - Radar overlay: RainViewer tile cache, refreshed every 5 min server-side
 *  - Scrubber: HTML range slider with custom styling, drag on touch + desktop
 *  - Play / pause / step controls for keyboard- and touch-friendly use
 */
export default function RadarTile({ lat, lon, displayName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L | null>(null);
  const baseLayerRef = useRef<L | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const radarLayerRef = useRef<any>(null);

  const [host, setHost] = useState<string | null>(null);
  const [frames, setFrames] = useState<RvFrame[]>([]);
  const [nowcastStartIdx, setNowcastStartIdx] = useState(0);
  const [idx, setIdx] = useState(0);
  // Start paused — auto-play causes a flashing animation that's distracting
  // when scanning the rest of the HUD. User can hit Play if they want it.
  const [playing, setPlaying] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ----- inject Leaflet CSS once (shared with MapTile) -----
  useEffect(() => {
    if (document.getElementById("phud-leaflet-css")) return;
    const link = document.createElement("link");
    link.id = "phud-leaflet-css";
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
    link.crossOrigin = "";
    document.head.appendChild(link);
  }, []);

  // Cache-busted URL — RainViewer's CDN caches the index aggressively, and
  // when a regeneration cycle returns 0 nowcast frames, that empty response
  // can stick around in the CDN for a while. A per-request timestamp param
  // forces a fresh origin hit every time.
  const indexUrl = () =>
    `https://api.rainviewer.com/public/weather-maps.json?t=${Date.now()}`;

  // ----- fetch loader (shared by initial load, auto-refresh, and Retry button) -----
  const loadIndex = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(indexUrl(), { cache: "no-store", signal });
      if (!res.ok) throw new Error(`RainViewer ${res.status}`);
      const data = (await res.json()) as RvIndex;
      if (!data?.radar) throw new Error("Unexpected RainViewer response shape");
      const past = data.radar.past ?? [];
      const nowcast = data.radar.nowcast ?? [];
      const all = [...past, ...nowcast];
      if (all.length === 0) {
        setErr("Radar feed empty.");
        return;
      }
      setErr(null);
      setHost(data.host);
      setFrames(all);
      setNowcastStartIdx(past.length);
      // Only reset idx on initial load (when there were no frames yet).
      setIdx(prev => prev === 0 && all.length > 1 ? Math.max(0, past.length - 1) : prev);
    } catch (e) {
      if ((e as Error)?.name === "AbortError") return;
      setErr(e instanceof Error ? e.message : "Radar load failed.");
    }
  }, []);

  // ----- initial load + 5-min auto-refresh -----
  useEffect(() => {
    const controller = new AbortController();
    loadIndex(controller.signal);
    const refreshId = setInterval(() => loadIndex(), 5 * 60 * 1000);
    return () => { controller.abort(); clearInterval(refreshId); };
  }, [loadIndex]);

  // ----- helper: pick base tile URL by current theme -----
  function baseUrlForTheme(): string {
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    return dark ? CARTO_DARK : CARTO_LIGHT;
  }

  // ----- init Leaflet map (recreates when location changes) -----
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let L: L;
      try {
        const mod = await import("leaflet");
        L = mod.default ?? mod;
      } catch {
        if (!cancelled) setErr("Map library failed to load. Run `npm install`.");
        return;
      }
      if (cancelled || !containerRef.current) return;

      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }

      const map = L.map(containerRef.current, {
        center: [lat, lon],
        zoom: 7,                   // regional view — solidly inside RainViewer's coverage
        minZoom: 3,                // continental — radar still meaningful
        maxZoom: 10,               // RainViewer free 256-px tiles cap at 10
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        dragging: true,
        touchZoom: true,
        doubleClickZoom: true,
      });
      mapRef.current = map;

      baseLayerRef.current = L.tileLayer(baseUrlForTheme(), {
        attribution: "© OpenStreetMap, © CARTO",
        subdomains: "abcd",
        maxZoom: 10,
        // High-DPI tiles
        r: window.devicePixelRatio > 1 ? "@2x" : "",
      }).addTo(map);

      // Location marker
      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent-2").trim() || "#1d8fc9";
      L.marker([lat, lon], {
        icon: L.divIcon({
          className: "phud-marker",
          html: `<div style="
            width:14px;height:14px;border-radius:50%;
            background:${accent};
            border:2px solid #fff;
            box-shadow:0 0 0 2px ${accent}, 0 1px 4px rgba(0,0,0,.4);
          "></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(map).bindPopup(displayName);

      setMapReady(true);
      setTimeout(() => map.invalidateSize(), 200);
    })();
    return () => {
      cancelled = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      baseLayerRef.current = null;
      radarLayerRef.current = null;
      setMapReady(false);
    };
  }, [lat, lon, displayName]);

  // ----- swap base layer when the user toggles theme -----
  useEffect(() => {
    if (!mapReady) return;
    const observer = new MutationObserver(async () => {
      const map = mapRef.current;
      if (!map) return;
      const mod = await import("leaflet");
      const L = mod.default ?? mod;
      if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = L.tileLayer(baseUrlForTheme(), {
        attribution: "© OpenStreetMap, © CARTO",
        subdomains: "abcd",
        maxZoom: 10,
        r: window.devicePixelRatio > 1 ? "@2x" : "",
      }).addTo(map);
      // Make sure the radar overlay stays on top.
      if (radarLayerRef.current) radarLayerRef.current.bringToFront();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [mapReady]);

  // ----- update radar overlay when frame changes -----
  useEffect(() => {
    if (!mapReady || !host || frames.length === 0) return;
    let cancelled = false;
    (async () => {
      const mod = await import("leaflet");
      const L = mod.default ?? mod;
      const map = mapRef.current;
      if (cancelled || !map) return;
      const frame = frames[idx];
      if (!frame) return;
      const tileSize = 256;
      const url = `${host}${frame.path}/${tileSize}/{z}/{x}/{y}/${RADAR_COLOR}/${RADAR_OPTS}.png`;
      // Remove old radar layer
      if (radarLayerRef.current) {
        map.removeLayer(radarLayerRef.current);
        radarLayerRef.current = null;
      }
      const layer = L.tileLayer(url, {
        tileSize,
        opacity: 0.75,
        attribution: "Radar © RainViewer",
        zIndex: 1000,
        // RainViewer free 256-px tile cache covers zoom 0-10. Anything outside
        // that range returns a "Zoom level not supported" placeholder image.
        minZoom: 0,
        maxZoom: 10,
        // If a specific tile errors (rare — usually edge of coverage), serve a
        // transparent 1px placeholder instead of leaving Leaflet's broken-image icon.
        errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
      });
      layer.addTo(map);
      radarLayerRef.current = layer;
    })();
    return () => { cancelled = true; };
  }, [idx, frames, host, mapReady]);

  // ----- playback loop -----
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const id = setInterval(() => {
      setIdx(i => (i + 1) % frames.length);
    }, FRAME_MS);
    return () => clearInterval(id);
  }, [playing, frames.length]);

  // ----- current frame metadata -----
  const currentFrame = frames[idx];
  const nowSec = Math.floor(Date.now() / 1000);
  const deltaSec = currentFrame ? currentFrame.time - nowSec : 0;
  const isNowcast = idx >= nowcastStartIdx;
  const tickMarks = useMemo(() => {
    // Build a compact set of axis labels: oldest, midpoint past, now, midpoint future, latest
    if (frames.length === 0) return [];
    const result: { ratio: number; label: string }[] = [];
    const oldest = frames[0];
    const newest = frames[frames.length - 1];
    const nowFrame = frames[Math.max(0, nowcastStartIdx - 1)];
    const hasFuture = nowcastStartIdx < frames.length;
    result.push({ ratio: 0, label: formatOffset(oldest.time - nowSec) });
    result.push({
      // Anchor "Now" to where the last past frame sits on the slider.
      ratio: frames.length > 1 ? (nowcastStartIdx - 1) / (frames.length - 1) : 0,
      label: "Now",
    });
    if (hasFuture && newest !== nowFrame) {
      result.push({ ratio: 1, label: formatOffset(newest.time - nowSec) });
    }
    return result;
  }, [frames, nowcastStartIdx, nowSec]);

  const stepBack    = useCallback(() => { setPlaying(false); setIdx(i => Math.max(0, i - 1)); }, []);
  const stepForward = useCallback(() => { setPlaying(false); setIdx(i => Math.min(frames.length - 1, i + 1)); }, [frames.length]);
  const jumpToNow   = useCallback(() => { setPlaying(false); setIdx(Math.max(0, nowcastStartIdx - 1)); }, [nowcastStartIdx]);

  return (
    <section className="tile" style={{ padding: 0, overflow: "hidden" }}>
      <div className="tile-head" style={{ padding: "14px 16px 8px", margin: 0 }}>
        <span className="tile-title">Weather Radar · {displayName}</span>
        <span className="tile-meta">
          {currentFrame && (
            <>
              <strong style={{
                color: isNowcast ? "var(--accent-2)" : "var(--text)",
                marginRight: 6,
              }}>
                {formatOffset(deltaSec)}
              </strong>
              {formatClock(currentFrame.time)}
              {isNowcast && <span style={{ marginLeft: 4, color: "var(--text-muted)" }}>· forecast</span>}
            </>
          )}
        </span>
      </div>

      <div style={{ position: "relative" }}>
        <div
          ref={containerRef}
          aria-label={`Weather radar map for ${displayName}`}
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
      </div>

      {/* Playback controls — buttons on top, slider below at full width so it
          works on phones without the buttons squeezing it to nothing. */}
      <div style={{
        padding: "12px 16px 14px",
        display: "grid", gap: 10,
      }}>
        <div style={{
          display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
        }}>
          <button
            onClick={stepBack}
            className="phud-radar-btn"
            aria-label="Previous frame"
            title="Previous frame"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18V6h2v12H6zm3.5-6 8.5 6V6l-8.5 6z"/></svg>
          </button>

          <button
            onClick={() => setPlaying(p => !p)}
            className="phud-radar-btn primary"
            aria-label={playing ? "Pause" : "Play"}
            title={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
            <span style={{ fontSize: 12, fontWeight: 700 }}>{playing ? "Pause" : "Play"}</span>
          </button>

          <button
            onClick={stepForward}
            className="phud-radar-btn"
            aria-label="Next frame"
            title="Next frame"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M16 18V6h-2v12h2zm-3.5-6L4 6v12l8.5-6z" transform="scale(-1 1) translate(-24 0)"/></svg>
          </button>

          <button
            onClick={jumpToNow}
            className="phud-radar-btn"
            aria-label="Jump to current radar"
            title="Jump to now"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
            </svg>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Now</span>
          </button>

          {/* Manual refresh of the RainViewer index. Useful when their model
              is in a regeneration cycle and returns 0 forecast frames; without
              waiting the full 5-min auto-refresh, the user can poke it. */}
          <button
            onClick={() => loadIndex()}
            className="phud-radar-btn"
            aria-label="Retry radar feed"
            title="Re-fetch the RainViewer index (useful when forecast frames are missing)"
            style={{ marginLeft: "auto" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
            </svg>
          </button>
        </div>

        {/* Scrubber on its own row so it has the full tile width to work with. */}
        <div style={{ position: "relative", height: 32, width: "100%" }}>
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={idx}
              onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
              className="phud-radar-slider"
              aria-label="Radar timeline"
            />
            {/* Tick labels under the slider */}
            <div style={{
              position: "absolute", left: 0, right: 0, top: 22,
              display: "flex", justifyContent: "space-between",
              fontSize: 10, color: "var(--text-faint)",
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              pointerEvents: "none",
            }}>
              {tickMarks.map((t, i) => (
                <span key={i} style={{
                  whiteSpace: "nowrap",
                  // anchor: middle for "Now" in the center, edges otherwise
                  transform:
                    i === 0 ? "translateX(0)" :
                    i === tickMarks.length - 1 ? "translateX(0)" : "translateX(-50%)",
                  position: "absolute", left: `${t.ratio * 100}%`,
                  fontWeight: t.label === "Now" ? 700 : 500,
                  color: t.label === "Now" ? "var(--accent-2)" : "var(--text-faint)",
                }}>{t.label}</span>
              ))}
            </div>
        </div>

        <div style={{
          fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
          paddingTop: 4,
        }}>
          {frames.length > 0 && (
            <div style={{ marginBottom: 6, color: "var(--text-muted)", fontWeight: 600 }}>
              Loaded · {nowcastStartIdx} past frame{nowcastStartIdx === 1 ? "" : "s"}
              {" · "}
              <span style={{ color: frames.length - nowcastStartIdx > 0 ? "var(--accent-2)" : "var(--bad)" }}>
                {frames.length - nowcastStartIdx} forecast frame{frames.length - nowcastStartIdx === 1 ? "" : "s"}
              </span>
              {frames.length - nowcastStartIdx === 0 && (
                <span style={{ display: "block", color: "var(--text-faint)", fontWeight: 400, marginTop: 2 }}>
                  RainViewer&apos;s nowcast model is regenerating — tap the retry button above to check again, or wait for the next auto-refresh in 5 min.
                </span>
              )}
            </div>
          )}
          Past 2 hours + 30 min nowcast · Drag the slider to scrub · Past frames in {" "}
          <strong style={{ color: "var(--text-muted)" }}>standard radar</strong>; forecast in {" "}
          <strong style={{ color: "var(--accent-2)" }}>cyan</strong>.
          Radar © RainViewer · Basemap © CARTO / OpenStreetMap.
        </div>
      </div>
    </section>
  );
}
