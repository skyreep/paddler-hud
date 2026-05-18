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
//
// NOTE: this module is server-only because of the createClient import
// (which transitively pulls in next/headers). Client components that just
// need the DEFAULT_GAUGES list or the MAX_GAUGES cap should import them
// from lib/gauges-defaults.ts instead. The constants are re-exported here
// so server-side callers can still do a single `import` from "@/lib/gauges".

import { createClient } from "@/lib/supabase/server";
import type { UserGauge } from "@/lib/types";
import { DEFAULT_GAUGES, MAX_GAUGES } from "@/lib/gauges-defaults";

export { DEFAULT_GAUGES, MAX_GAUGES };

export interface LoadedGauges {
  /** Site IDs in display order. What page.tsx fans out to fetchRiverGauge(). */
  ids: string[];
  /** Full DB rows for signed-in users, or null for guests / when defaults
   *  are in use. The gauge editor needs id + sortOrder + displayName to
   *  render the management UI. */
  userRows: UserGauge[] | null;
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
        .select("id, usgs_site_id, display_name, flood_stage_override, sort_order, created_at")
        .order("sort_order", { ascending: true });

      if (!error && rows && rows.length > 0) {
        const userRows: UserGauge[] = rows.map((r) => ({
          id: String(r.id),
          usgsSiteId: String(r.usgs_site_id),
          displayName: r.display_name == null ? null : String(r.display_name),
          floodStageOverride: r.flood_stage_override == null ? null : Number(r.flood_stage_override),
          sortOrder: Number(r.sort_order ?? 0),
          createdAt: String(r.created_at ?? new Date().toISOString()),
        }));
        const ids = userRows.map((r) => r.usgsSiteId).slice(0, MAX_GAUGES);
        if (ids.length > 0) return { ids, userRows, source: "user-saved" };
      }
      if (error) {
        console.error("[gauges] user_gauges query failed:", error.message);
      }
      // User exists but has no saved gauges → fall through to defaults
      // (skip the urlParam path — signed-in users don't share gauge URLs
      // with each other in a meaningful way). userRows is an empty array
      // rather than null so the editor knows this is a signed-in user
      // with no saved gauges (vs a guest, where userRows is null).
      return { ids: DEFAULT_GAUGES, userRows: [], source: "default" };
    }
  }

  // Guest mode: honor the URL param if present, else defaults.
  if (urlParam) {
    const ids = urlParam.split(",").map((s) => s.trim()).filter(Boolean).slice(0, MAX_GAUGES);
    if (ids.length > 0) return { ids, userRows: null, source: "url-param" };
  }
  return { ids: DEFAULT_GAUGES, userRows: null, source: "default" };
}
