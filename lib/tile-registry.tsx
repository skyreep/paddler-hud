// Single source of truth for the dashboard tile set: stable IDs,
// human-readable names, descriptions for the layout editor, and a
// render factory per tile.
//
// Why this file exists:
//   The dashboard's tile order used to be hardcoded in app/page.tsx,
//   which meant the layout editor would have to duplicate that order
//   to know what tiles exist and what to call them. Extracting the
//   list here lets the page renderer and the editor share one mental
//   model: ids are stable identifiers persisted to user_preferences
//   .tile_config, names/descriptions drive the editor UI, and the
//   render factory contains the data-availability logic ("only show
//   wind tile when wind data resolved") so the page just iterates and
//   renders.
//
// Forward compat:
//   Add new tiles by appending to TILE_REGISTRY. Users with saved
//   tile configs will see the new tile at the end of their list
//   (effectiveTileOrder handles unmapped tiles), visible by default.
//   They can re-order via the editor any time.

import type { ReactNode } from "react";

import RightNow from "@/components/tiles/RightNow";
import WindNowTile from "@/components/tiles/WindNowTile";
import MapTile from "@/components/tiles/MapTile";
import ChartTile from "@/components/tiles/ChartTile";
import RadarTile from "@/components/tiles/RadarTile";
import TideTile from "@/components/tiles/TideTile";
import TideMonthTile from "@/components/tiles/TideMonthTile";
import CurrentTile from "@/components/tiles/CurrentTile";
import AstroTile from "@/components/tiles/AstroTile";
import SolunarTile from "@/components/tiles/SolunarTile";
import HourlyTile from "@/components/tiles/HourlyTile";
import WeeklyTile from "@/components/tiles/WeeklyTile";
import MarineTile from "@/components/tiles/MarineTile";
import RiversTile from "@/components/tiles/RiversTile";
import TropicalTile from "@/components/tiles/TropicalTile";

import type {
  AirQualityResponse,
  AstroResponse,
  BuoyResponse,
  CurrentResponse,
  ResolvedLocation,
  RiverGauge,
  TideResponse,
  TileConfig,
  TropicalResponse,
  UserPreferences,
  WaterLevelResponse,
  WeatherResponse,
  WindResponse,
} from "@/lib/types";
import type { UserGauge } from "@/lib/types";

/** Everything a tile's render factory might need to decide whether to
 *  render and what to pass downstream. Page-level data lives here in
 *  one bag so each render factory can pluck what it cares about
 *  without page.tsx having to know about per-tile prop shapes. */
export interface TileRenderContext {
  station: ResolvedLocation;
  weather: WeatherResponse | null;
  tides: TideResponse | null;
  water: WaterLevelResponse | null;
  currents: CurrentResponse | null;
  buoy: BuoyResponse | null;
  airQuality: AirQualityResponse | null;
  tropical: TropicalResponse | null;
  wind: WindResponse | null;
  /** Source label for the wind shown in Right Now, e.g. "CO-OPS · 8670870". */
  windSource: string | undefined;
  astro: AstroResponse;
  gauges: RiverGauge[];
  userGauges: UserGauge[] | null;
  prefs: UserPreferences;
  fetchedAt: string;
}

export interface TileEntry {
  /** Stable identifier persisted to user_preferences.tile_config.
   *  Don't change after shipping — that would orphan saved layouts. */
  id: string;
  /** Display name shown in the layout editor and (someday) in tile
   *  removal confirmation prompts. */
  name: string;
  /** One-line description for the editor row. Helps users decide
   *  whether to hide a tile they're unsure about. */
  description: string;
  /** Return the tile JSX, or null when the tile's data isn't available
   *  for the current view (e.g. no wind data → no wind tile). */
  render: (ctx: TileRenderContext) => ReactNode;
}

// Canonical order — change this to change the default layout for
// users who haven't customized theirs. Stable IDs (left column) are
// frozen once shipped; the right column (factories) can evolve freely.
export const TILE_REGISTRY: TileEntry[] = [
  {
    id: "right-now",
    name: "Right Now",
    description: "Current temp, wind, sky, visibility, air quality.",
    render: (ctx) =>
      ctx.weather && (
        <RightNow
          weather={ctx.weather.now}
          fetchedAt={ctx.fetchedAt}
          airQuality={ctx.airQuality}
          liveTideFt={ctx.water?.observedHeight ?? null}
          attribution={ctx.weather.attribution}
          observation={ctx.weather.observation}
          windSource={ctx.windSource}
          prefs={ctx.prefs}
        />
      ),
  },
  {
    id: "wind-now",
    name: "Wind Now",
    description: "Live wind speed/direction from your selected station chain.",
    render: (ctx) => ctx.wind && <WindNowTile wind={ctx.wind} prefs={ctx.prefs} />,
  },
  {
    id: "map",
    name: "Satellite Map",
    description: "Esri satellite imagery with GPS + heading tracking.",
    render: (ctx) => (
      <MapTile lat={ctx.station.lat} lon={ctx.station.lon} displayName={ctx.station.displayName} />
    ),
  },
  {
    id: "tide",
    name: "Tide Today",
    description: "Today's tide curve with highs/lows and live water-level.",
    render: (ctx) =>
      ctx.tides && (
        <TideTile
          tides={ctx.tides}
          stationNote={ctx.station.tideStationNote}
          liveTideFt={ctx.water?.observedHeight ?? null}
          prefs={ctx.prefs}
        />
      ),
  },
  {
    id: "current",
    name: "Currents",
    description: "Tidal current speed/direction throughout the day.",
    render: (ctx) => ctx.currents && <CurrentTile currents={ctx.currents} prefs={ctx.prefs} />,
  },
  {
    id: "tide-month",
    name: "Tide · 30 Days",
    description: "Month-long tide outlook to plan around spring/neap cycles.",
    render: (ctx) => ctx.tides && <TideMonthTile tides={ctx.tides} prefs={ctx.prefs} />,
  },
  {
    id: "hourly",
    name: "Hourly Forecast",
    description: "Next 24 hours: temp, wind, precip, sky.",
    render: (ctx) =>
      ctx.weather && (
        <HourlyTile hours={ctx.weather.hourly} attribution={ctx.weather.attribution} prefs={ctx.prefs} />
      ),
  },
  {
    id: "weekly",
    name: "7-Day Forecast",
    description: "Daily highs/lows plus NWS narrative for the week ahead.",
    render: (ctx) =>
      ctx.weather && (
        <WeeklyTile days={ctx.weather.daily} attribution={ctx.weather.attribution} prefs={ctx.prefs} />
      ),
  },
  {
    id: "radar",
    name: "Weather Radar",
    description: "Live precipitation radar with animation timeline.",
    render: (ctx) => (
      <RadarTile lat={ctx.station.lat} lon={ctx.station.lon} displayName={ctx.station.displayName} />
    ),
  },
  {
    id: "marine",
    name: "Marine Conditions",
    description: "Open-Meteo wave height, period, direction, and sea-surface temp.",
    render: (ctx) => ctx.buoy && <MarineTile buoy={ctx.buoy} prefs={ctx.prefs} />,
  },
  {
    id: "rivers",
    name: "Rivers",
    description: "USGS gauge readings for paddleable freshwater near you.",
    render: (ctx) => (
      <RiversTile gauges={ctx.gauges} prefs={ctx.prefs} userGauges={ctx.userGauges} />
    ),
  },
  {
    id: "tropical",
    name: "Tropical Weather",
    description: "Atlantic tropical systems from the National Hurricane Center.",
    render: (ctx) => ctx.tropical && <TropicalTile tropical={ctx.tropical} prefs={ctx.prefs} />,
  },
  {
    id: "astro",
    name: "Sun · Moon · Twilight",
    description: "Sunrise/set, moon phase, twilight transitions, next full moon.",
    render: (ctx) => <AstroTile astro={ctx.astro} prefs={ctx.prefs} />,
  },
  {
    id: "solunar",
    name: "Solunar",
    description: "Major/minor feeding periods for paddler-anglers.",
    render: (ctx) => <SolunarTile periods={ctx.astro.solunar} prefs={ctx.prefs} />,
  },
  // Nautical chart kept at the bottom of the default order because it's
  // an iframe embed of ArcGIS — slow to first paint and not the kind of
  // thing most users look at every session. Users who want it higher
  // can reorder via the layout editor.
  {
    id: "chart",
    name: "Nautical Chart",
    description: "Official NOAA ENC chart via ArcGIS Online.",
    render: (ctx) => (
      <ChartTile lat={ctx.station.lat} lon={ctx.station.lon} displayName={ctx.station.displayName} />
    ),
  },
];

/** Per-tile state derived from the user's saved TileConfig plus the
 *  canonical registry. Stable shape for the layout editor and the
 *  page renderer. */
export interface EffectiveTile {
  entry: TileEntry;
  visible: boolean;
  /** Relative order (smaller = earlier in the dashboard). The editor
   *  re-numbers contiguously on save; this field is only used for
   *  sorting and shouldn't be relied on as a stable index. */
  order: number;
}

/** Merge the user's saved TileConfig with the canonical registry to
 *  produce a complete, sorted, visibility-aware tile list. Tiles
 *  introduced after the user saved (i.e. not present in their config)
 *  are appended to the end and default to visible — so adding a tile
 *  never hides it from existing users. */
export function effectiveTileOrder(
  config: TileConfig | undefined | null,
  registry: TileEntry[] = TILE_REGISTRY,
): EffectiveTile[] {
  const cfg = config && typeof config === "object" ? config : {};
  const items: EffectiveTile[] = registry.map((entry, idx) => {
    const saved = cfg[entry.id];
    if (saved && typeof saved === "object") {
      return {
        entry,
        visible: saved.visible !== false, // default-on for partial configs
        // If saved.order is missing/invalid, place after explicitly-
        // ordered tiles in canonical position.
        order: typeof saved.order === "number" && Number.isFinite(saved.order)
          ? saved.order
          : idx + 1000,
      };
    }
    return { entry, visible: true, order: idx + 1000 };
  });
  items.sort((a, b) => a.order - b.order);
  return items;
}

/** Build a fresh TileConfig from an array of EffectiveTile entries.
 *  Called by the layout editor on save to normalize orders to 0..N-1
 *  before persisting. Keeps the stored JSON small and predictable. */
export function tileConfigFromList(items: EffectiveTile[]): TileConfig {
  const out: TileConfig = {};
  items.forEach((it, idx) => {
    out[it.entry.id] = { visible: it.visible, order: idx };
  });
  return out;
}
