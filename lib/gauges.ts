// Resolves the active list of USGS river gauges for the current request.
//
// Resolution order:
//   1. Signed-in users → user_gauges table (their saved list is authoritative,
//      the `?gauges=` URL param is ignored to avoid accidental drift between
//      the URL they share and the dashboard they actually see)
//   2. Guests with `?gauges=` in the URL → that list (max MAX_GAUGES)
//   3. Guests with no param → the hardcoded DEFAULT_GAUGES list
//
// Like loadLocations(), this never throws — any Supabase failure cleanly
// degrades to the guest defaults.

import { createClient } from "@/lib/supabase/server";

/** Default saved river gauges for first-load. Up to MAX_GAUGES USGS sites. */
export const DEFAULT_GAUGES = [
  "02198690",   // Ebenezer Creek nr Springfield, GA
  "02202500",   // Ogeechee River at Eden, GA
  "02226160",   // Altamaha River nr Everett City, GA
  "02316000",   // Suwannee River at White Springs, FL  (region edge)
  "02315500",   // Suwannee River at Fargo, GA
];

export const MAX_GAUGES = 10;

export interface LoadedGauges {
  ids: string[];
  source: "default" | "user-saved" | "url-param";
}

/**
 * Pick the right list of USGS gauge site IDs for this request. `urlParam`
 * is the raw value from `?gauges=...` (or null if not present); it's only
 * honored for guests, since a signed-in user's saved list should win.
 */
export async function loadGaugeIds(urlParam: string | null): Promise<LoadedGauges> {
  const supabase = await createClient();

  // Try the user's saved gauges first.
  if (supabase) {
    const { data: userData } = await supabase.auth.getUser();
    if (userData.user) {
      const { data: rows, error } = await supabase
        .from("user_gauges")
        .select("usgs_site_id")
        .order("sort_order", { ascending: true });

      if (!error && rows && rows.length > 0) {
        const ids = rows
          .map((r) => String(r.usgs_site_id))
          .filter(Boolean)
          .slice(0, MAX_GAUGES);
        if (ids.length > 0) return { ids, source: "user-saved" };
      }
      if (error) {
        console.error("[gauges] user_gauges query failed:", error.message);
      }
      // User exists but has no saved gauges → fall through to defaults
      // (skip the urlParam path — signed-in users don't share gauge URLs
      // with each other in a meaningful way).
      return { ids: DEFAULT_GAUGES, source: "default" };
    }
  }

  // Guest mode: honor the URL param if present, else defaults.
  if (urlParam) {
    const ids = urlParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_GAUGES);
    if (ids.length > 0) return { ids, source: "url-param" };
  }
  return { ids: DEFAULT_GAUGES, source: "default" };
}
