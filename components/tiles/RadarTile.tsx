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

// ── Playback config ─────────────────────────────────────────────────
// Single frame interval. Earlier versions had a speed picker plus a
// longer hold on the "Now" boundary frame, but the boundary pause
// felt jarring (felt like a stutter rather than a deliberate pause)
// and the speed picker was visual clutter for what most users only
// want one of. One number, applied uniformly to every frame, lets
// the cross-fade do the work of making the animation feel smooth.
const FRAME_MS = 800;

// Cross-fade duration when switching frames. Short enough to feel
// responsive during fast playback, long enough to mask the swap.
const FADE_MS = 220;

// Max attempts to keep retrying when the RainViewer index returns 0
// nowcast frames. Their model regenerates roughly every 10 minutes;
// 3 short retries catches the "regenerating right now" window.
const NOWCAST_RETRY_MAX = 3;
const NOWCAST_RETRY_DELAY_MS = 60_000;

const RADAR_COLOR = 2;       // RainViewer "Universal Blue" — best readability
const RADAR_OPTS = "1_1";    // smooth + show snow colors
const TARGET_OPACITY = 0.75;

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
 *   - Base map: CartoDB Positron (light) / Dark Matter (dark); free, no key
 *   - Radar overlay: RainViewer tile cache, refreshed every 5 min server-side
 *   - Cross-fades between frames using stacked tile layers (no harsh swaps)
 *   - Zoom range goes beyond RainViewer's native z=10 cap via Leaflet's
 *     upscaling — pixelated at z>10 but lets users zoom in on their area
 *   - Variable playback speed (0.5× / 1× / 2×) with a longer hold at the
 *     past-to-forecast boundary so the transition reads cleanly
 *   - Auto-retries nowcast fetch when forecast frames are missing (their
 *     model regenerates ~every 10 min; first call sometimes catches an
 *     empty window)
 */
export default function RadarTile({ lat, lon, displayName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L | null>(null);
  const baseLayerRef = useRef<L | null>(null);
  // Track all radar layers currently on the map. We add a new layer
  // for each frame change and remove old ones once the new one's
  // tiles have loaded — that's what makes the transition feel smooth
  // instead of jumping through a blank moment between layers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const radarLayersRef = useRef<any[]>([]);
  const nowcastRetriesRef = useRef(0);

  const [host, setHost] = useState<string | null>(null);
  const [frames, setFrames] = useState<RvFrame[]>([]);
  const [nowcastStartIdx, setNowcastStartIdx] = useState(0);
  const [idx, setIdx] = useState(0);
  // Start paused — auto-play causes a flashing animation that's distracting
  // when scanning the rest of the HUD. User can hit Play if they want it.
  const [playing, setPlaying] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Theme tracked in state — not read synchronously from the DOM at map
  // init time — because of a real race on mobile: app/layout.tsx's
  // pre-paint script can read a stale matchMedia "false" on iOS first
  // paint, set data-theme="light", and then TopBar's post-hydration
  // effect corrects it to "dark". Tracking in state with a mount-time
  // observer fires the swap even when the change predates mapReady.
  const [theme, setTheme] = useState<"light" | "dark">("light");

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

  // Cache-busted URL — RainViewer's CDN caches the index aggressively,
  // and when a regeneration cycle returns 0 nowcast frames, that empty
  // response can stick around for a while. A per-request timestamp
  // forces a fresh origin hit.
  const indexUrl = () =>
    `https://api.rainviewer.com/public/weather-maps.json?t=${Date.now()}`;

  // ----- fetch loader (shared by initial load, auto-refresh, retry, and button) -----
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
      // Default landing on the "Now" frame (last past frame) so the
      // user sees the current radar immediately. If the index is
      // refreshed mid-session, preserve their current idx.
      setIdx((prev) =>
        prev === 0 && all.length > 1 ? Math.max(0, past.length - 1) : prev,
      );
      // Auto-retry if nowcast empty — RainViewer's model regenerates
      // every ~10 minutes and the first poll after a regeneration
      // sometimes catches an empty window. A couple of 60-second
      // retries is usually enough to land on a populated cycle.
      if (nowcast.length === 0 && nowcastRetriesRef.current < NOWCAST_RETRY_MAX) {
        nowcastRetriesRef.current++;
        setTimeout(() => { if (!signal?.aborted) loadIndex(signal); }, NOWCAST_RETRY_DELAY_MS);
      } else if (nowcast.length > 0) {
        // Reset the counter so future regenerations get fresh retries.
        nowcastRetriesRef.current = 0;
      }
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

  // ----- track theme from the document element -----
  useEffect(() => {
    const read = (): "light" | "dark" =>
      document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
    setTheme(read());
    const observer = new MutationObserver(() => setTheme(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  function baseUrlForTheme(t: "light" | "dark"): string {
    return t === "dark" ? CARTO_DARK : CARTO_LIGHT;
  }

  // ----- init Leaflet map -----
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
        zoom: 7,                   // regional view by default
        minZoom: 3,                // continental
        // Higher than RainViewer's native cap (10) — Leaflet upscales
        // overlay tiles for closer zoom, which is grainy but readable.
        // Most paddlers want at least 11-12 to see their immediate area.
        maxZoom: 14,
        zoomControl: true,
        attributionControl: true,
        scrollWheelZoom: true,
        dragging: true,
        touchZoom: true,
        doubleClickZoom: true,
      });
      mapRef.current = map;

      const initialTheme: "light" | "dark" =
        document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
      baseLayerRef.current = L.tileLayer(baseUrlForTheme(initialTheme), {
        attribution: "© OpenStreetMap, © CARTO",
        subdomains: "abcd",
        // Carto tiles also cap at z=20 native, but we don't go past 14
        // so the basemap is always crisp.
        maxZoom: 14,
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
      radarLayersRef.current = [];
      setMapReady(false);
    };
  }, [lat, lon, displayName]);

  // ----- swap base layer when theme changes -----
  useEffect(() => {
    if (!mapReady) return;
    let cancelled = false;
    (async () => {
      const map = mapRef.current;
      if (!map) return;
      const mod = await import("leaflet");
      if (cancelled) return;
      const L = mod.default ?? mod;
      if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
      baseLayerRef.current = L.tileLayer(baseUrlForTheme(theme), {
        attribution: "© OpenStreetMap, © CARTO",
        subdomains: "abcd",
        maxZoom: 14,
        r: window.devicePixelRatio > 1 ? "@2x" : "",
      }).addTo(map);
      // Radar overlays should stay on top of any new base layer.
      for (const layer of radarLayersRef.current) {
        if (layer && map.hasLayer(layer)) layer.bringToFront();
      }
    })();
    return () => { cancelled = true; };
  }, [theme, mapReady]);

  // ----- show the requested frame with cross-fade -----
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
      // RainViewer tile URL:
      //   {host}{path}/{tileSize}/{z}/{x}/{y}/{color}/{smooth}_{snow}.png
      const url = `${host}${frame.path}/${tileSize}/{z}/{x}/{y}/${RADAR_COLOR}/${RADAR_OPTS}.png`;

      // Add the new layer ON TOP of the old one, starting at opacity 0.
      // We cross-fade it in once its tiles report loaded (or after a
      // short timeout, whichever comes first — slow connections
      // shouldn't lock us into showing the old frame forever).
      const newLayer = L.tileLayer(url, {
        tileSize,
        opacity: 0,
        attribution: "Radar © RainViewer",
        zIndex: 1000 + radarLayersRef.current.length,
        // RainViewer's free tile cache covers zoom 0-10 natively. Beyond
        // that, Leaflet upscales the z=10 tile via maxNativeZoom — grainy
        // but visible (better than the previous hard cap that just
        // refused to render anything past 10).
        minZoom: 0,
        maxNativeZoom: 10,
        maxZoom: 14,
        errorTileUrl: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
      });
      newLayer.addTo(map);
      radarLayersRef.current.push(newLayer);

      let triggered = false;
      const beginCrossfade = () => {
        if (triggered || cancelled) return;
        triggered = true;
        // If a newer layer has been added since this one (fast scrub /
        // playback), skip the fade-in and just remove this stale layer.
        const isLatest =
          radarLayersRef.current[radarLayersRef.current.length - 1] === newLayer;
        if (!isLatest) {
          map.removeLayer(newLayer);
          radarLayersRef.current = radarLayersRef.current.filter((l) => l !== newLayer);
          return;
        }
        // Fade in the new layer, fade out everything older.
        const oldLayers = radarLayersRef.current.slice(0, -1);
        animateLayerOpacity(newLayer, 0, TARGET_OPACITY, FADE_MS);
        for (const old of oldLayers) {
          animateLayerOpacity(old, TARGET_OPACITY, 0, FADE_MS, () => {
            if (map.hasLayer(old)) map.removeLayer(old);
          });
        }
        radarLayersRef.current = [newLayer];
      };

      // Cross-fade as soon as the new tiles are loaded — that prevents
      // a flash of the old frame's tiles bleeding through during the fade.
      newLayer.once("load", beginCrossfade);
      // Safety fallback: if `load` doesn't fire within 800ms (no tiles in
      // viewport, all error'd, or very slow network), fade anyway.
      setTimeout(beginCrossfade, 800);
    })();
    return () => { cancelled = true; };
  }, [idx, frames, host, mapReady]);

  // ----- playback loop -----
  // Re-scheduled on every `idx` change (or play/pause toggle). The
  // earlier version nested a setTimeout inside a setIdx callback to
  // implement a boundary pause — but React StrictMode double-invokes
  // setter callbacks, so each tick was spawning duplicate timer
  // chains, only the latest of which got cleared on pause. Result:
  // timer leak, scrubber appearing to "speed up" as the chains
  // multiplied. Splitting scheduling into its own effect tied to idx
  // gives React's cleanup function a clean handle on the current
  // timer no matter how the effect was triggered.
  useEffect(() => {
    if (!playing || frames.length === 0) return;
    const timer = setTimeout(() => {
      setIdx((i) => (i + 1) % frames.length);
    }, FRAME_MS);
    return () => clearTimeout(timer);
  }, [playing, frames.length, idx]);

  // ----- current frame metadata -----
  const currentFrame = frames[idx];
  const nowSec = Math.floor(Date.now() / 1000);
  const deltaSec = currentFrame ? currentFrame.time - nowSec : 0;
  const isNowcast = idx >= nowcastStartIdx;
  const forecastCount = frames.length - nowcastStartIdx;

  const tickMarks = useMemo(() => {
    if (frames.length === 0) return [];
    const result: { ratio: number; label: string }[] = [];
    const oldest = frames[0];
    const newest = frames[frames.length - 1];
    const nowFrame = frames[Math.max(0, nowcastStartIdx - 1)];
    const hasFuture = nowcastStartIdx < frames.length;
    result.push({ ratio: 0, label: formatOffset(oldest.time - nowSec) });
    result.push({
      ratio: frames.length > 1 ? (nowcastStartIdx - 1) / (frames.length - 1) : 0,
      label: "Now",
    });
    if (hasFuture && newest !== nowFrame) {
      result.push({ ratio: 1, label: formatOffset(newest.time - nowSec) });
    }
    return result;
  }, [frames, nowcastStartIdx, nowSec]);

  // Position of the "Now" boundary on the slider track, used to
  // color the past-vs-forecast portions differently. Only meaningful
  // when there are forecast frames to color — otherwise the whole
  // slider is past data and we render it uniformly.
  const boundaryRatio =
    frames.length > 1 ? (nowcastStartIdx - 1) / (frames.length - 1) : 0;
  const showForecastSplit = forecastCount > 0;

  const stepBack    = useCallback(() => { setPlaying(false); setIdx((i) => Math.max(0, i - 1)); }, []);
  const stepForward = useCallback(() => { setPlaying(false); setIdx((i) => Math.min(frames.length - 1, i + 1)); }, [frames.length]);
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
            onClick={() => setPlaying((p) => !p)}
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

          {/* Manual refresh of the RainViewer index. */}
          <button
            onClick={() => { nowcastRetriesRef.current = 0; loadIndex(); }}
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

        {/* Scrubber with past/forecast visual split.
            We color the slider track in two segments — neutral up to
            the "Now" boundary, accent-2 past it — so users can see at
            a glance how much past data vs future forecast is loaded
            and where they are on the timeline. */}
        <div style={{ position: "relative", height: 32, width: "100%" }}>
          <div
            aria-hidden
            style={{
              position: "absolute", top: 12, left: 0, right: 0,
              height: 6, borderRadius: 3,
              background: showForecastSplit
                ? `linear-gradient(to right,
                    var(--bg-elev-2) 0%,
                    var(--bg-elev-2) ${boundaryRatio * 100}%,
                    color-mix(in srgb, var(--accent-2) 30%, var(--bg-elev-2)) ${boundaryRatio * 100}%,
                    color-mix(in srgb, var(--accent-2) 30%, var(--bg-elev-2)) 100%)`
                : "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              pointerEvents: "none",
            }}
          />
          <input
            type="range"
            min={0}
            max={Math.max(0, frames.length - 1)}
            value={idx}
            onChange={(e) => { setPlaying(false); setIdx(Number(e.target.value)); }}
            className="phud-radar-slider"
            aria-label="Radar timeline"
            style={{ position: "relative", zIndex: 1 }}
          />
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
                // Tick alignment: leftmost tick aligns its LEFT edge to 0%,
                // rightmost tick aligns its RIGHT edge to 100%, everything
                // in between centers on its ratio. Without translateX(-100%)
                // on the rightmost tick, the label's left edge lands at
                // 100% and the text overflows the slider — which made the
                // cyan "Now" label visually bleed past the bar's right
                // edge when no forecast frames were loaded.
                transform:
                  i === 0 ? "translateX(0)" :
                  i === tickMarks.length - 1 ? "translateX(-100%)" :
                  "translateX(-50%)",
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
              {forecastCount > 0
                ? <>
                    Loaded · {nowcastStartIdx} past · {" "}
                    <span style={{ color: "var(--accent-2)" }}>
                      {forecastCount} forecast frame{forecastCount === 1 ? "" : "s"}
                    </span>
                  </>
                : <>Loaded · {nowcastStartIdx} radar frames</>
              }
            </div>
          )}
          {forecastCount > 0
            ? <>
                Past 2 hours + 30 min nowcast · Drag the slider to scrub · Forecast frames in {" "}
                <strong style={{ color: "var(--accent-2)" }}>cyan</strong>.
              </>
            : <>Past 2 hours of NEXRAD radar · Drag the slider to scrub.</>
          }
          {" "}Radar © RainViewer · Basemap © CARTO / OpenStreetMap.
        </div>
      </div>
    </section>
  );
}

// ── Opacity animation helper ───────────────────────────────────────
// rAF-driven setOpacity loop. Promise-less (callback-based) because
// these animations fire from inside the cross-fade orchestration and
// promises would just add async noise to an already-procedural flow.
function animateLayerOpacity(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layer: any,
  from: number,
  to: number,
  durationMs: number,
  onDone?: () => void,
) {
  let start = 0;
  const step = (now: number) => {
    if (!start) start = now;
    const t = Math.min(1, (now - start) / durationMs);
    // Linear is fine for tile opacity — eased in/out wouldn't be
    // visually distinguishable at the 220ms duration we use, and adds
    // a tiny perceptual lag on the leading edge.
    const opacity = from + (to - from) * t;
    try { layer.setOpacity(opacity); } catch { /* layer removed mid-flight */ }
    if (t < 1) requestAnimationFrame(step);
    else if (onDone) onDone();
  };
  requestAnimationFrame(step);
}