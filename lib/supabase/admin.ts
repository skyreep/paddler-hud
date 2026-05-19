// Service-role Supabase client. NEVER imported by any client component
// or even any server component that handles user-facing requests — this
// client bypasses Row Level Security and can read every user's data,
// so it's strictly for trusted backend operations (the daily-briefing
// cron, future admin tools).
//
// Returns null when env vars are missing so callers can degrade
// gracefully instead of crashing — mirrors the pattern in
// lib/supabase/server.ts.
//
// The service-role key MUST stay server-side. It's loaded from
// SUPABASE_SERVICE_ROLE_KEY (no NEXT_PUBLIC_ prefix, so Next won't
// inline it into the client bundle).

import { createClient } from "@supabase/supabase-js";

export const isAdminConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Build a service-role Supabase client. Returns null if env isn't
 * configured. Auth is disabled (no session refresh, no cookies) since
 * this client doesn't represent a user — it represents the server itself
 * acting with admin privileges.
 */
export function createAdminClient() {
  if (!isAdminConfigured) return null;
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}
