"use server";

// Server action for persisting user preferences. Called from
// components/preferences/PreferencesModal.tsx whenever the user changes
// a setting. Guests get a no-op (the modal persists their choices to
// localStorage on the client side instead).

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type {
  HeightUnits,
  TempUnits,
  ThemeMode,
  TimeFormatPref,
  UserPreferences,
  WindUnits,
} from "@/lib/types";

/** Subset of UserPreferences that can be sent over the wire from the
 *  client. Any field omitted is left alone in the DB. Tile config edits
 *  will arrive in Phase 4 chunk 2 — for now we only accept the simple
 *  scalar prefs. */
export interface PreferencesPatch {
  theme?: ThemeMode;
  unitsWind?: WindUnits;
  unitsTemp?: TempUnits;
  unitsHeight?: HeightUnits;
  timeFormat?: TimeFormatPref;
}

export interface UpdatePreferencesResult {
  ok: boolean;
  /** When ok, the canonical preferences after the update — convenient for
   *  the client to update local state without re-fetching. */
  preferences?: UserPreferences;
  error?: string;
}

/**
 * Upsert the current user's preferences row with the provided patch.
 * Returns { ok: false } for guests so the modal can fall back to
 * localStorage cleanly. The action revalidates the root layout so any
 * server-rendered prefs (currently just the theme served into the
 * pre-paint sync) refresh on the next navigation.
 */
export async function updatePreferences(
  patch: PreferencesPatch,
): Promise<UpdatePreferencesResult> {
  const supabase = await createClient();
  if (!supabase) {
    return { ok: false, error: "Auth is not configured." };
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    return { ok: false, error: "Not signed in." };
  }

  // Translate the camelCase patch to the snake_case columns. Only include
  // keys actually present in the patch so we don't overwrite stored values
  // with undefineds.
  const row: Record<string, unknown> = { user_id: userData.user.id };
  if (patch.theme !== undefined) row.theme = patch.theme;
  if (patch.unitsWind !== undefined) row.units_wind = patch.unitsWind;
  if (patch.unitsTemp !== undefined) row.units_temp = patch.unitsTemp;
  if (patch.unitsHeight !== undefined) row.units_height = patch.unitsHeight;
  if (patch.timeFormat !== undefined) row.time_format = patch.timeFormat;
  row.updated_at = new Date().toISOString();

  // Upsert handles the rare case where the profile trigger didn't run
  // (older accounts) — first save creates the row, subsequent saves
  // update it. RLS limits the operation to auth.uid() = user_id.
  const { data: saved, error: saveError } = await supabase
    .from("user_preferences")
    .upsert(row, { onConflict: "user_id" })
    .select("theme, units_wind, units_temp, units_height, time_format, tile_config, updated_at")
    .single();

  if (saveError || !saved) {
    console.error("[preferences] upsert failed:", saveError?.message);
    return { ok: false, error: saveError?.message ?? "Save failed." };
  }

  revalidatePath("/", "layout");

  return {
    ok: true,
    preferences: {
      theme: saved.theme,
      unitsWind: saved.units_wind,
      unitsTemp: saved.units_temp,
      unitsHeight: saved.units_height,
      timeFormat: saved.time_format,
      tileConfig: (saved.tile_config ?? {}) as UserPreferences["tileConfig"],
      updatedAt: String(saved.updated_at ?? new Date().toISOString()),
    },
  };
}
