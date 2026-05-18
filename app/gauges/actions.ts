"use server";

// Server actions for managing the signed-in user's saved USGS river gauges.
// Called from components/gauges/GaugeEditorModal.tsx.
//
// IMPORTANT: this file has "use server" at the top, which requires that
// EVERY export be an async function. Non-function exports (interfaces,
// constants, classes) silently break server-action registration in
// Next 16, which surfaces as "the button does nothing" on the client.
// The shared result type lives in lib/gauge-action-result.ts instead.

import { createClient } from "@/lib/supabase/server";
import { fetchRiverGauge } from "@/lib/usgs";
import { MAX_GAUGES, DEFAULT_GAUGES } from "@/lib/gauges-defaults";
import { revalidatePath } from "next/cache";
import type { UserGauge } from "@/lib/types";
import type { GaugeActionResult } from "@/lib/gauge-action-result";

// ─── helpers (file-local; not exported, so "use server" is happy)

type ServerClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function listGauges(supabase: ServerClient): Promise<UserGauge[]> {
  const { data, error } = await supabase
    .from("user_gauges")
    .select("id, usgs_site_id, display_name, flood_stage_override, sort_order, created_at")
    .order("sort_order", { ascending: true });
  if (error || !data) return [];
  return data.map(rowToUserGauge);
}

function rowToUserGauge(row: Record<string, unknown>): UserGauge {
  return {
    id: String(row.id),
    usgsSiteId: String(row.usgs_site_id),
    displayName: row.display_name == null ? null : String(row.display_name),
    floodStageOverride: row.flood_stage_override == null ? null : Number(row.flood_stage_override),
    sortOrder: Number(row.sort_order ?? 0),
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

// ─── actions

/**
 * Add a new gauge by USGS site ID. Validates the ID by fetching it from
 * USGS — if the lookup fails, the gauge isn't saved and the user sees an
 * error message. The auto-fetched site name is stored as display_name so
 * users get a human-readable label immediately.
 */
export async function addGauge(rawSiteId: string): Promise<GaugeActionResult> {
  try {
    const siteId = rawSiteId.trim();
    // USGS site IDs are usually 8 digits, but 8-15 digits are valid (longer
    // for state-specific sub-codes). Reject anything outside that band, or
    // anything with non-digit characters — that's almost certainly a typo.
    if (!/^\d{8,15}$/.test(siteId)) {
      return { ok: false, error: "Site ID should be 8–15 digits, no spaces or dashes." };
    }

    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase, userId } = auth;

    // Enforce the cap up front so we don't waste a USGS round-trip.
    const existing = await listGauges(supabase);
    if (existing.length >= MAX_GAUGES) {
      return { ok: false, error: `Already at the ${MAX_GAUGES}-gauge cap. Remove one to add another.` };
    }
    if (existing.some((g) => g.usgsSiteId === siteId)) {
      return { ok: false, error: "That gauge is already in your list." };
    }

    // Validate against USGS. If the site doesn't exist or has no recent
    // observations, this throws — we catch and surface a clean error.
    let validatedName: string;
    try {
      const lookup = await fetchRiverGauge(siteId);
      validatedName = lookup.siteName || siteId;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error
          ? `Couldn't load that gauge from USGS: ${err.message}`
          : "Couldn't load that gauge from USGS.",
      };
    }

    // Insert at the end of the list (highest sort_order).
    const { error: insertError } = await supabase.from("user_gauges").insert({
      user_id: userId,
      usgs_site_id: siteId,
      display_name: validatedName,
      sort_order: existing.length,
    });

    if (insertError) {
      return { ok: false, error: insertError.message };
    }

    revalidatePath("/", "page");
    return { ok: true, gauges: await listGauges(supabase) };
  } catch (err) {
    console.error("[gauges] addGauge crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error adding gauge.",
    };
  }
}

/**
 * Seed the user's list with the default Lowcountry gauges. Idempotent —
 * skips any IDs already in the user's list, so safe to call again. Used
 * by the editor's empty state and as a one-time backfill for accounts
 * created before the seed_default_gauges DB trigger landed.
 */
export async function seedDefaultGauges(): Promise<GaugeActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase, userId } = auth;

    const existing = await listGauges(supabase);
    const existingIds = new Set(existing.map((g) => g.usgsSiteId));
    const newIds = DEFAULT_GAUGES.filter((id) => !existingIds.has(id));
    if (newIds.length === 0) {
      // Already seeded — return the current list so the UI updates without error.
      return { ok: true, gauges: existing };
    }

    // Cap at MAX_GAUGES total so we don't exceed the per-user limit.
    const slotsLeft = MAX_GAUGES - existing.length;
    const idsToInsert = newIds.slice(0, Math.max(0, slotsLeft));
    if (idsToInsert.length === 0) {
      return { ok: false, error: `Already at the ${MAX_GAUGES}-gauge cap.` };
    }

    // Look up names in parallel so the seeded rows have human-readable
    // display_names instead of bare site IDs. Failures fall back to the ID.
    const rows = await Promise.all(
      idsToInsert.map(async (siteId, idx) => {
        let displayName = siteId;
        try {
          const lookup = await fetchRiverGauge(siteId);
          if (lookup.siteName) displayName = lookup.siteName;
        } catch {
          // Keep displayName = siteId; user can rename later.
        }
        return {
          user_id: userId,
          usgs_site_id: siteId,
          display_name: displayName,
          sort_order: existing.length + idx,
        };
      }),
    );

    const { error: insertError } = await supabase.from("user_gauges").insert(rows);
    if (insertError) {
      return { ok: false, error: insertError.message };
    }

    revalidatePath("/", "page");
    return { ok: true, gauges: await listGauges(supabase) };
  } catch (err) {
    console.error("[gauges] seedDefaultGauges crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error seeding gauges.",
    };
  }
}

/** Remove a gauge by row ID. Renumbers sort_order on the survivors so
 *  there are no gaps. */
export async function removeGauge(id: string): Promise<GaugeActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase } = auth;

    const { error: deleteError } = await supabase.from("user_gauges").delete().eq("id", id);
    if (deleteError) {
      return { ok: false, error: deleteError.message };
    }

    // Repack sort_order so the next reorder UI doesn't drift.
    const remaining = await listGauges(supabase);
    await Promise.all(
      remaining.map((g, idx) =>
        g.sortOrder !== idx
          ? supabase.from("user_gauges").update({ sort_order: idx }).eq("id", g.id)
          : Promise.resolve(),
      ),
    );

    revalidatePath("/", "page");
    return { ok: true, gauges: await listGauges(supabase) };
  } catch (err) {
    console.error("[gauges] removeGauge crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error removing gauge.",
    };
  }
}

/** Update display_name override for a gauge. Set name to empty string or
 *  null to clear the override and fall back to the USGS site name. */
export async function updateGaugeName(id: string, displayName: string | null): Promise<GaugeActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase } = auth;

    const trimmed = displayName?.trim() ?? null;
    const value = trimmed && trimmed.length > 0 ? trimmed : null;

    const { error } = await supabase
      .from("user_gauges")
      .update({ display_name: value })
      .eq("id", id);

    if (error) {
      return { ok: false, error: error.message };
    }

    revalidatePath("/", "page");
    return { ok: true, gauges: await listGauges(supabase) };
  } catch (err) {
    console.error("[gauges] updateGaugeName crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error renaming gauge.",
    };
  }
}

/**
 * Reorder gauges by setting sort_order to the row's position in the input
 * array. Pass the full list of IDs in the desired order; missing IDs are
 * ignored (won't accidentally repack them to the top).
 */
export async function reorderGauges(orderedIds: string[]): Promise<GaugeActionResult> {
  try {
    const auth = await requireUserAndClient();
    if ("error" in auth) return { ok: false, error: auth.error };
    const { supabase } = auth;

    // Issue updates in parallel — small list, safe.
    const results = await Promise.all(
      orderedIds.map((id, idx) =>
        supabase.from("user_gauges").update({ sort_order: idx }).eq("id", id),
      ),
    );

    const failed = results.find((r) => r.error);
    if (failed?.error) {
      return { ok: false, error: failed.error.message };
    }

    revalidatePath("/", "page");
    return { ok: true, gauges: await listGauges(supabase) };
  } catch (err) {
    console.error("[gauges] reorderGauges crashed:", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unexpected error reordering gauges.",
    };
  }
}
