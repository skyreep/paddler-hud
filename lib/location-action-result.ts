// Shared result shape for location server actions. Lives in its own
// file because app/locations/actions.ts has the "use server" directive
// — files with that directive can only export async functions, so
// interfaces have to be hosted elsewhere (same pattern as gauges).

import type { UserLocation } from "@/lib/types";
import type { ResolverResult } from "@/lib/location-resolver";

export interface LocationActionResult {
  ok: boolean;
  /** Refreshed list of the user's saved locations, sorted by sort_order. */
  locations?: UserLocation[];
  error?: string;
}

/** Result for resolveCandidate — wraps the resolver's output so the
 *  client gets the bundle + warnings + ok/error flag in one shape. */
export interface ResolveCandidateResult {
  ok: boolean;
  result?: ResolverResult;
  error?: string;
}
