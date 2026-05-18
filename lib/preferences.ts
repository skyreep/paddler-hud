// Resolves the active user preferences for the current request.
//
// Guests get DEFAULT_PREFERENCES. Signed-in users get their user_preferences
// row, falling back to DEFAULT_PREFERENCES if the row is missing or the
// query fails. Like loadLocations / loadGaugeIds, this never throws — auth
// breakage cleanly degrades to guest defaults so the HUD always renders.
//
// The wire format follows the rest of the app: snake_case from Postgres,
// camelCase in TS land. Mapping happens here.

import { createClient } from "@/lib/supabase/server";
import type {
  HeightUnits,
  TempUnits,
  ThemeMode,
  TileConfig,
  TimeFormatPref,
  UserPreferences,
  WindUnits,
} from "@/lib/types";

/** Defaults match the user_preferences column defaults in
 *  supabase/migrations/001_initial_schema.sql, so a guest's UI looks
 *  identical to a brand-new signed-in user's UI. */
export const DEFAULT_PREFERENCES: UserPreferences = {
  theme: "auto",
  unitsWind: "kt",
  unitsTemp: "F",
  unitsHeight: "ft",
  timeFormat: "12h",
  tileConfig: {},
  updatedAt: new Date(0).toISOString(),
};

/** Result of loadPreferences — preferences plus a discriminator for whether
 *  they came from the DB or a fallback. Callers that want to know "is this
 *  the user's real preference or a default" can branch on `source`. */
export interface LoadedPreferences {
  preferences: UserPreferences;
  source: "default" | "user";
}

/**
 * Load preferences for the current request. Always returns a complete
 * UserPreferences object; never throws.
 */
export async function loadPreferences(): Promise<LoadedPreferences> {
  const supabase = await createClient();
  if (!supabase) return guestDefaults();

  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return guestDefaults();

  const { data: row, error } = await supabase
    .from("user_preferences")
    .select("theme, units_wind, units_temp, units_height, time_format, tile_config, updated_at")
    .eq("user_id", userData.user.id)
    .maybeSingle();

  if (error) {
    console.error("[preferences] user_preferences query failed:", error.message);
    return guestDefaults();
  }
  if (!row) {
    // The handle_new_profile_preferences trigger should have created a row
    // when the profile was created, so this branch usually means an older
    // account that predates the trigger. Returning defaults keeps the app
    // working; the row gets created the first time the user saves prefs.
    return guestDefaults();
  }

  return {
    preferences: {
      theme: coerceTheme(row.theme),
      unitsWind: coerceWindUnits(row.units_wind),
      unitsTemp: coerceTempUnits(row.units_temp),
      unitsHeight: coerceHeightUnits(row.units_height),
      timeFormat: coerceTimeFormat(row.time_format),
      tileConfig: coerceTileConfig(row.tile_config),
      updatedAt: String(row.updated_at ?? new Date().toISOString()),
    },
    source: "user",
  };
}

function guestDefaults(): LoadedPreferences {
  return { preferences: DEFAULT_PREFERENCES, source: "default" };
}

// ─── Coercers — guard against bad DB values and Postgres null surprises.
// Each falls back to the corresponding DEFAULT_PREFERENCES field if the
// stored value doesn't match a known option. Defensive but cheap.

function coerceTheme(v: unknown): ThemeMode {
  return v === "light" || v === "dark" || v === "auto" ? v : DEFAULT_PREFERENCES.theme;
}
function coerceWindUnits(v: unknown): WindUnits {
  return v === "kt" || v === "mph" || v === "all" ? v : DEFAULT_PREFERENCES.unitsWind;
}
function coerceTempUnits(v: unknown): TempUnits {
  return v === "F" || v === "C" ? v : DEFAULT_PREFERENCES.unitsTemp;
}
function coerceHeightUnits(v: unknown): HeightUnits {
  return v === "ft" || v === "m" ? v : DEFAULT_PREFERENCES.unitsHeight;
}
function coerceTimeFormat(v: unknown): TimeFormatPref {
  return v === "12h" || v === "24h" ? v : DEFAULT_PREFERENCES.timeFormat;
}
function coerceTileConfig(v: unknown): TileConfig {
  if (!v || typeof v !== "object") return {};
  return v as TileConfig;
}
