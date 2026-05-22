"use server";

// Server action for persisting user preferences. Called from
// components/preferences/PreferencesModal.tsx whenever the user changes
// a setting. Guests get a no-op (the modal persists their choices to
// localStorage on the client side instead).

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { getSubscription, computeIsPremium } from "@/lib/subscriptions";
import type {
  HeightUnits,
  TempUnits,
  ThemeMode,
  TileConfig,
  TimeFormatPref,
  UserPreferences,
  WindUnits,
} from "@/lib/types";

/** Subset of UserPreferences that can be sent over the wire from the
 *  client. Any field omitted is left alone in the DB. */
export interface PreferencesPatch {
  theme?: ThemeMode;
  unitsWind?: WindUnits;
  unitsTemp?: TempUnits;
  unitsHeight?: HeightUnits;
  timeFormat?: TimeFormatPref;
  dailyBriefingEnabled?: boolean;
  /** 0-23 in America/New_York. Validated against the DB check constraint. */
  dailyBriefingHour?: number;
  /** Tile order + visibility for the dashboard. Replaces (not merges
   *  with) the stored value so a save can both reorder and re-hide in
   *  the same operation. */
  tileConfig?: TileConfig;
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
  if (patch.dailyBriefingEnabled !== undefined) {
    // Premium gate: enabling the daily briefing requires Pro. Disabling
    // (setting to false) is always allowed — never lock someone out of
    // turning a feature OFF, only ON. This mirrors the principle in
    // ROADMAP.md: "the gate is on the save action, not the config UI".
    if (patch.dailyBriefingEnabled === true) {
      const sub = await getSubscription(userData.user.id);
      const premium = sub ? computeIsPremium(sub) : false;
      if (!premium) {
        return {
          ok: false,
          error: "Daily briefing email is a Tidevisor Pro feature. Upgrade at /upgrade or redeem a code.",
        };
      }
    }
    row.daily_briefing_enabled = patch.dailyBriefingEnabled;
  }
  if (patch.dailyBriefingHour !== undefined) {
    // Clamp client-side input before the DB does — gives a cleaner error
    // path than letting the check constraint reject the row.
    const h = Math.round(patch.dailyBriefingHour);
    if (!Number.isFinite(h) || h < 0 || h > 23) {
      return { ok: false, error: "Briefing hour must be between 0 and 23." };
    }
    row.daily_briefing_hour = h;
  }
  if (patch.tileConfig !== undefined) {
    // Defensive sanity check: the column is jsonb so Postgres will
    // accept whatever object we hand it, but bad shapes would break
    // the reader's coercion. Validate keys are strings and values
    // have the expected { visible, order } shape.
    if (typeof patch.tileConfig !== "object" || patch.tileConfig === null) {
      return { ok: false, error: "Invalid tileConfig: expected object." };
    }
    const clean: TileConfig = {};
    for (const [key, val] of Object.entries(patch.tileConfig)) {
      if (typeof key !== "string" || !key) continue;
      if (!val || typeof val !== "object") continue;
      const v = val as Partial<{ visible: boolean; order: number }>;
      if (typeof v.visible !== "boolean") continue;
      if (typeof v.order !== "number" || !Number.isFinite(v.order)) continue;
      clean[key] = { visible: v.visible, order: v.order };
    }
    row.tile_config = clean;
  }
  row.updated_at = new Date().toISOString();

  // Upsert handles the rare case where the profile trigger didn't run
  // (older accounts) — first save creates the row, subsequent saves
  // update it. RLS limits the operation to auth.uid() = user_id.
  const { data: saved, error: saveError } = await supabase
    .from("user_preferences")
    .upsert(row, { onConflict: "user_id" })
    .select(
      "theme, units_wind, units_temp, units_height, time_format, " +
        "tile_config, daily_briefing_enabled, daily_briefing_hour, updated_at",
    )
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
      dailyBriefingEnabled: Boolean(saved.daily_briefing_enabled),
      dailyBriefingHour: Number(saved.daily_briefing_hour ?? 6),
      updatedAt: String(saved.updated_at ?? new Date().toISOString()),
    },
  };
}
