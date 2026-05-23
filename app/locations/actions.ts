"use server";

// Server actions for managing the signed-in user's saved paddling
// locations. Called from components/locations/{LocationEditorModal,
// AddLocationWizard}.tsx.
//
// IMPORTANT: this file has "use server" at the top, which requires that
// EVERY export be an async function. Non-function exports (interfaces,
// constants, classes) silently break server-action registration in
// Next 16. Shared types live in lib/location-action-result.ts.

import { createClient } from "@/lib/supabase/server";
import { resolveLocationCandidate } from "@/lib/location-resolver";
import type { ResolvedLocationBundle } from "@/lib/location-resolver";
import { revalidatePath } from "next/cache";
import { getSubscription, computeIsPremium } from "@/lib/subscriptions";
import type { UserLocation, WindStationRef } from "@/lib/types";
import type {
  LocationActionResult,
  ResolveCandidateResult,
  SearchPlacesResult,
  GeocoderHit,
} from "@/lib/location-action-result";

/** Hard cap on saved locations. Pro users hit this; free users hit
 *  MAX_LOCATIONS_FREE first. Set high enough that the cap is never
 *  the *thing* paddlers buy Pro for — Pro is about unlocking the
 *  second, third, fourth location, not about getting to 50. */
const MAX_LOCATIONS = 15;
/** Free-tier cap. Free users get a small handful of locations — enough
 *  to cover a "home spot + two regulars" pattern without making them
 *  feel cramped. Pro removes the cap up to MAX_LOCATIONS. */
const MAX_LOCATIONS_FREE = 3;

type ServerClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function listLocations(supabase: ServerClient): Promise<UserLocation[]> {
  const { data, error } = await supabase
    .from("user_locations")
    .select(
      "id, display_name, lat, lon, tide_station_id, tide_station_note, " +
        "observation_station_id, wind_stations, buoy_id, nws_zone, " +
        "marine_zone, sort_order, is_primary, created_at",
    )
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  return data.map(rowToUserLocation);
}

function rowToUserLocation(row: Record<string, unknown>): UserLocation {
  const wind = Array.isArray(row.wind_stations) ? (row.wind_stations as unknown[]) : [];
  const windStations: WindStationRef[] = wind
    .filter((w): w is Record<string, unknown> => !!w && typeof w === "object")
    .filter((w) => (w.kind === "coops" || w.kind === "ndbc") && typeof w.id === "string")
    .map((w) => ({ kind: w.kind as "coops" | "ndbc", id: String(w.id) }));

  return {
    id: String(row.id),
    displayName: String(row.display_name ?? ""),
    lat: Number(row.lat),
    lon: Number(row.lon),
    tideStationId: String(row.tide_station_id ?? ""),
    tideStationNote: row.tide_station_note == null ? null : String(row.tide_station_note),
    observationStationId: row.observation_station_id == null ? null : String(row.observation_station_id),
    windStations,
    buoyId: row.buoy_id == null ? null : String(row.buoy_id),
    nwsZone: row.nws_zone == null ? null : String(row.nws_zone),
    marineZone: row.marine_zone == null ? null : String(row.marine_zone),
    sortOrder: Number(row.sort_order ?? 0),
    isPrimary: Boolean(row.is_primary),
    createdAt: String(row.created_at ?? new Date().toISOString()),
  };
}

async function requireUserAndClient(): Promise<
  | { error: string }
  | { supabase: ServerClient; userId: string }
> {
  const supabase = await createClient();
  if (!supabase) return { error: "Auth is not configured." };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { error: "Not signed in." };
  return { supabase, userId: data.user.id };
}

// ─── Actions ──────────────────────────────────────────────────────────────

/**
 * Run the resolver for a given lat/lon. This action does NOT save
 * anything — the client uses it to preview the bundle before
 * deciding whether to call addLocation(). Open to guests too so the
 * Add wizard works regardless of session (we just won't let them save).
 */
export async function resolveCandidate(
  lat: number,
  lon: number,
  suggestedName?: string,
): Promise<ResolveCandidateResult> {
  try {
    // Basic sanity check on coordinates — anything wildly out of bounds
    // is almost certainly a bug in the caller, not real data.
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return { ok: false, error: "Invalid coordinates." };
    }
    const result = await resolveLocationCandidate(lat, lon, suggestedName);
    return { ok: true, result };
  } catch (err) {
    console.error("[locations] resolveCandidate crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't resolve a location bundle.",
    };
  }
}

/**
 * Search place names via Open-Meteo's free geocoding API. No API key
 * required — we already use Open-Meteo for UV/marine, so no new
 * provider relationship. Returns up to 5 hits with name + admin1 +
 * country + lat/lon precomputed into a display label.
 *
 * Accepts town names ("Savannah", "Tybee Island") and US zip codes
 * ("31401") — Open-Meteo's index covers both fairly well, though zips
 * can be hit-or-miss for less-populated areas. If a zip fails, the
 * caller can suggest trying a nearby town name instead.
 */
export async function searchPlaces(query: string): Promise<SearchPlacesResult> {
  try {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      // Too short to be useful — bail without hitting the API.
      return { ok: true, hits: [] };
    }
    const url =
      "https://geocoding-api.open-meteo.com/v1/search"
      + `?name=${encodeURIComponent(trimmed)}`
      + "&count=5&language=en&format=json";
    const res = await fetch(url, {
      // Open-Meteo recommends no-cache for geocoding queries since
      // results are query-specific. Letting Next cache by URL is fine
      // and reasonably hot for common towns.
      next: { revalidate: 86400 },
    });
    if (!res.ok) {
      return { ok: false, error: `Geocoder returned ${res.status}.` };
    }
    const data = await res.json() as {
      results?: Array<{
        name?: string;
        latitude?: number;
        longitude?: number;
        country?: string;
        admin1?: string;
      }>;
    };
    const hits: GeocoderHit[] = (data.results ?? [])
      .filter((r) =>
        r.name && typeof r.latitude === "number" && typeof r.longitude === "number",
      )
      .map((r) => {
        const admin1 = r.admin1 ?? null;
        const country = r.country ?? "";
        // Build the display label. Skip pieces that aren't present so
        // we don't show "Savannah, , United States".
        const labelParts = [r.name!, admin1, country].filter((s): s is string => !!s && s.length > 0);
        return {
          name: r.name!,
          admin1,
          country,
          lat: r.latitude!,
          lon: r.longitude!,
          label: labelParts.join(", "),
        };
      });
    return { ok: true, hits };
  } catch (err) {
    console.error("[locations] searchPlaces crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Place search failed.",
    };
  }
}

/**
 * Save a resolved bundle as a new user_locations row. Enforces the
 * 6-location cap and refuses to insert a duplicate (matching displayName).
 */
export async function addLocation(bundle: ResolvedLocationBundle): Promise<LocationActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase, userId } = auth;

    if (!bundle.displayName?.trim()) {
      return { ok: false, error: "Display name is required." };
    }
    if (!bundle.tideStationId) {
      return { ok: false, error: "Tide station is required (the schema doesn't allow null)." };
    }

    const existing = await listLocations(supabase);
    // Premium gate: free users get one location, Pro users get up to
    // MAX_LOCATIONS. The first save (existing.length === 0) is always
    // allowed regardless of tier so a fresh signup can save their home
    // spot before hitting any paywall.
    const sub = await getSubscription(userId);
    const premium = sub ? computeIsPremium(sub) : false;
    const cap = premium ? MAX_LOCATIONS : MAX_LOCATIONS_FREE;
    if (existing.length >= cap) {
      if (!premium) {
        return {
          ok: false,
          error:
            `Free accounts get ${MAX_LOCATIONS_FREE} saved locations. Upgrade to Tidevisor Pro at /upgrade for more — or redeem a beta code in Preferences.`,
        };
      }
      return { ok: false, error: `Already at the ${MAX_LOCATIONS}-location cap. Remove one to add another.` };
    }

    const { data: inserted, error: insertError } = await supabase
      .from("user_locations")
      .insert({
        user_id: userId,
        display_name: bundle.displayName.trim(),
        lat: bundle.lat,
        lon: bundle.lon,
        tide_station_id: bundle.tideStationId,
        tide_station_note: bundle.tideStationNote,
        observation_station_id: bundle.observationStationId,
        wind_stations: bundle.windStations,
        buoy_id: bundle.buoyId,
        nws_zone: bundle.nwsZone,
        marine_zone: bundle.marineZone,
        sort_order: existing.length,
        // First location auto-becomes primary; subsequent ones don't.
        is_primary: existing.length === 0,
      })
      .select("id")
      .single();

    if (insertError) {
      return { ok: false, error: insertError.message };
    }

    revalidatePath("/", "layout");
    return {
      ok: true,
      locations: await listLocations(supabase),
      // Surface the new row's ID so the wizard can navigate the
      // dashboard to ?station=<addedId> after saving.
      addedId: inserted?.id ? String(inserted.id) : undefined,
    };
  } catch (err) {
    console.error("[locations] addLocation crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error adding location.",
    };
  }
}

/** Remove a location by row ID. Refuses to delete the last remaining one
 *  (guests would still get the hardcoded defaults but signed-in users
 *  shouldn't end up with zero options). Renumbers sort_order on survivors. */
export async function removeLocation(id: string): Promise<LocationActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase } = auth;

    const existing = await listLocations(supabase);
    if (existing.length <= 1) {
      return { ok: false, error: "Can't remove your last saved location." };
    }
    const target = existing.find((l) => l.id === id);
    if (!target) {
      return { ok: false, error: "Location not found." };
    }

    const { error: deleteError } = await supabase.from("user_locations").delete().eq("id", id);
    if (deleteError) {
      return { ok: false, error: deleteError.message };
    }

    // If we just deleted the primary, promote the (new) first row.
    const remaining = await listLocations(supabase);
    if (target.isPrimary && remaining.length > 0) {
      await supabase
        .from("user_locations")
        .update({ is_primary: true })
        .eq("id", remaining[0].id);
    }

    // Repack sort_order so the next reorder UI starts from 0.
    await Promise.all(
      remaining.map((l, idx) =>
        l.sortOrder !== idx
          ? supabase.from("user_locations").update({ sort_order: idx }).eq("id", l.id)
          : Promise.resolve(),
      ),
    );

    revalidatePath("/", "layout");
    return { ok: true, locations: await listLocations(supabase) };
  } catch (err) {
    console.error("[locations] removeLocation crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error removing location.",
    };
  }
}

/** Update the data-source fields on an existing location — tide
 *  station, observation, buoy, wind chain, marine zone. Used by the
 *  "Edit sources" modal when a user discovers one of their picks has
 *  an offline sensor or otherwise doesn't fit. Leaves displayName,
 *  lat/lon, sort_order, and is_primary untouched. */
export async function updateLocationStations(
  id: string,
  patch: {
    tideStationId?: string;
    tideStationNote?: string | null;
    observationStationId?: string | null;
    windStations?: WindStationRef[];
    buoyId?: string | null;
    marineZone?: string | null;
  },
): Promise<LocationActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase } = auth;

    // Build the snake_case row to update — only include keys actually
    // present in the patch so we don't overwrite stored values with
    // undefineds. tide_station_id is NOT NULL in the schema, so refuse
    // to clear it.
    const row: Record<string, unknown> = {};
    if (patch.tideStationId !== undefined) {
      if (!patch.tideStationId) {
        return { ok: false, error: "Tide station is required." };
      }
      row.tide_station_id = patch.tideStationId;
    }
    if (patch.tideStationNote !== undefined) row.tide_station_note = patch.tideStationNote;
    if (patch.observationStationId !== undefined) row.observation_station_id = patch.observationStationId;
    if (patch.windStations !== undefined) row.wind_stations = patch.windStations;
    if (patch.buoyId !== undefined) row.buoy_id = patch.buoyId;
    if (patch.marineZone !== undefined) row.marine_zone = patch.marineZone;

    if (Object.keys(row).length === 0) {
      // Nothing to update — treat as no-op success.
      return { ok: true, locations: await listLocations(supabase) };
    }

    const { error } = await supabase
      .from("user_locations")
      .update(row)
      .eq("id", id);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/", "layout");
    return { ok: true, locations: await listLocations(supabase) };
  } catch (err) {
    console.error("[locations] updateLocationStations crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error updating location sources.",
    };
  }
}

/** Update display_name for a location. */
export async function updateLocationName(id: string, displayName: string): Promise<LocationActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase } = auth;

    const trimmed = displayName.trim();
    if (!trimmed) {
      return { ok: false, error: "Display name can't be empty." };
    }

    const { error } = await supabase
      .from("user_locations")
      .update({ display_name: trimmed })
      .eq("id", id);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/", "layout");
    return { ok: true, locations: await listLocations(supabase) };
  } catch (err) {
    console.error("[locations] updateLocationName crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error renaming location.",
    };
  }
}

/** Atomically mark one location as primary, clearing the flag on all
 *  others. Two updates because Postgres + Supabase RLS don't expose
 *  multi-row CASE expressions cleanly here. */
export async function setPrimary(id: string): Promise<LocationActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase, userId } = auth;

    // Clear primary on everything else, then set on the target. Order
    // matters: clear first so we don't violate any future "exactly one
    // primary" partial-unique-index constraint if/when added.
    const { error: clearError } = await supabase
      .from("user_locations")
      .update({ is_primary: false })
      .eq("user_id", userId)
      .neq("id", id);
    if (clearError) {
      return { ok: false, error: clearError.message };
    }

    const { error: setError } = await supabase
      .from("user_locations")
      .update({ is_primary: true })
      .eq("id", id);
    if (setError) {
      return { ok: false, error: setError.message };
    }

    revalidatePath("/", "layout");
    return { ok: true, locations: await listLocations(supabase) };
  } catch (err) {
    console.error("[locations] setPrimary crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error setting primary location.",
    };
  }
}

/** Reorder locations by setting sort_order to the row's position in the input array. */
export async function reorderLocations(orderedIds: string[]): Promise<LocationActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase } = auth;

    const results = await Promise.all(
      orderedIds.map((id, idx) =>
        supabase.from("user_locations").update({ sort_order: idx }).eq("id", id),
      ),
    );
    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return { ok: false, error: failed.error.message };
    }

    revalidatePath("/", "layout");
    return { ok: true, locations: await listLocations(supabase) };
  } catch (err) {
    console.error("[locations] reorderLocations crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error reordering locations.",
    };
  }
}

