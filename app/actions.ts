"use server";
import { revalidatePath } from "next/cache";

/**
 * Hard-refresh the HUD route. Invalidates both the Full Route Cache (so the
 * page is regenerated) AND the Data Cache for every fetch inside that route
 * (so atmospheric/UV/marine/etc. actually re-fetch from upstream).
 *
 * router.refresh() alone only invalidates the client's Router Cache — it does
 * NOT bust Next.js's server-side caches, which is why "refresh" felt like a
 * no-op for time-sensitive values like UV index.
 */
export async function refreshHud() {
  revalidatePath("/", "page");
}
