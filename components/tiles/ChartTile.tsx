"use client";
import { useMemo } from "react";

interface Props {
  lat: number;
  lon: number;
  displayName: string;
}

// NOAA's chart layer embedded via an ArcGIS Online web map that we
// authored at noaa.maps.arcgis.com. Saved web map ID is fixed; we
// just re-center the iframe on whichever paddling location the user
// has selected by passing center+level URL params.
//
// Why this approach: NOAA's own free tile services (tileservice and
// gis.charttools) are too unreliable to integrate with directly —
// timeouts, blanks, custom tile schemes. AGOL sits in front of those
// services on Esri's production CDN, so embedding the AGOL web map
// effectively borrows Esri's infrastructure to serve NOAA's data
// reliably. The visual chrome inside the iframe is AGOL's, not ours,
// which is why this is a separate tile rather than a mode toggle
// inside MapTile.
const WEB_MAP_ID = "de4b192053d04c8fb77d47b78a4252de";
const DEFAULT_LEVEL = 13;

export default function ChartTile({ lat, lon, displayName }: Props) {
  // Build the AGOL Embed app URL. useMemo so the iframe doesn't
  // re-render on every parent rerender — only when lat/lon change.
  const src = useMemo(() => {
    const params = new URLSearchParams({
      webmap: WEB_MAP_ID,
      // Center + zoom params re-position the saved web map on this
      // user's location instead of using the map's authored extent.
      center: `${lon.toFixed(5)},${lat.toFixed(5)}`,
      level: String(DEFAULT_LEVEL),
      // UI chrome: keep zoom controls and a scale bar (handy for
      // judging distances from the launch), hide AGOL's search box
      // and bookmark button (we don't need them here).
      zoom: "true",
      scale: "true",
      search: "false",
      home: "false",
      details: "false",
      legend: "false",
      previewImage: "false",
      basemap_gallery: "false",
    });
    return `https://www.arcgis.com/apps/Embed/index.html?${params.toString()}`;
  }, [lat, lon]);

  return (
    <section className="tile" style={{ padding: 0, overflow: "hidden" }}>
      <div className="tile-head" style={{ padding: "14px 16px 8px", margin: 0 }}>
        <span className="tile-title">Nautical Chart · {displayName}</span>
        <span className="tile-meta">NOAA ENC · drag to pan · pinch to zoom</span>
      </div>

      {/* Esri iframe — sandboxed with the same permissions Leaflet
          needs (scripts for interactivity, same-origin so map state
          persists across re-renders, popups for chart-feature info). */}
      <iframe
        key={`${lat.toFixed(3)},${lon.toFixed(3)}`}
        src={src}
        title={`NOAA nautical chart of ${displayName}`}
        loading="lazy"
        style={{
          display: "block",
          width: "100%",
          height: 340,
          border: 0,
          background: "var(--bg-elev-2)",
        }}
        sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      />

      <div style={{
        padding: "8px 16px 14px",
        fontSize: 11, color: "var(--text-faint)", lineHeight: 1.4,
      }}>
        Charts © NOAA Office of Coast Survey · Served via ArcGIS Online.
        Not for navigation — always carry an up-to-date official chart on the water.
      </div>
    </section>
  );
}
