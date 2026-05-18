// Client-safe constants for river gauges. Kept in their own module so
// client components (e.g. GaugeEditorModal) can import the cap without
// pulling in lib/gauges.ts — which imports from lib/supabase/server.ts,
// which imports next/headers (server-only). That accidental graph pull
// causes a Next.js build error: "You're importing a module that depends
// on 'next/headers' ... in the Pages Router."

/** Default saved river gauges for first-load. Up to MAX_GAUGES USGS sites. */
export const DEFAULT_GAUGES = [
  "02198690",   // Ebenezer Creek nr Springfield, GA
  "02202500",   // Ogeechee River at Eden, GA
  "02226160",   // Altamaha River nr Everett City, GA
  "02316000",   // Suwannee River at White Springs, FL  (region edge)
  "02315500",   // Suwannee River at Fargo, GA
];

/** Per-user cap on saved gauges. Mirrored by enforce_user_gauges_limit()
 *  trigger in supabase/migrations/001_initial_schema.sql. Keep in sync. */
export const MAX_GAUGES = 10;
