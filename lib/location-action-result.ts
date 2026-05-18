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
  /** UUID of the row just added — set by addLocation only. Lets the
   *  client navigate to `?station=<id>` so the dashboard auto-switches
   *  to the new spot instead of staying on whatever was active. */
  addedId?: string;
  error?: string;
}

/** Result for resolveCandidate — wraps the resolver's output so the
 *  client gets the bundle + warnings + ok/error flag in one shape. */
export interface ResolveCandidateResult {
  ok: boolean;
  result?: ResolverResult;
  error?: string;
}

/** A single hit from the place-name geocoder. The label is precomputed
 *  on the server so the UI doesn't have to reassemble it. */
export interface GeocoderHit {
  name: string;          // e.g. "Savannah"
  admin1: string | null; // e.g. "Georgia"
  country: string;       // e.g. "United States"
  lat: number;
  lon: number;
  /** "Savannah, Georgia, United States" — ready to display. */
  label: string;
}

export interface SearchPlacesResult {
  ok: boolean;
  hits?: GeocoderHit[];
  error?: string;
}
