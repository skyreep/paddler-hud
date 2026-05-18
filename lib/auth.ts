// Server-side auth utilities. Used by Server Components and Route Handlers
// to figure out who (if anyone) is currently signed in.
//
// Guest sessions are first-class — every helper here returns `null` cleanly
// when there's no user, so callers can branch with a single check instead
// of catching errors.

import { createClient } from "@/lib/supabase/server";

/** Minimal user shape the HUD needs for display + scoping data fetches.
 *  We avoid leaking the full Supabase `User` object to client components
 *  so we have a stable contract if we ever swap auth providers. */
export interface CurrentUser {
  id: string;
  email: string | null;
  /** Display name from raw_user_meta_data (set by OAuth providers) or null. */
  name: string | null;
  /** OAuth avatar URL or null. */
  avatarUrl: string | null;
}

/**
 * Returns the currently signed-in user, or `null` if guest / Supabase
 * isn't configured. NEVER throws. Safe to call from any server component.
 *
 * Always calls `supabase.auth.getUser()` (not `getSession()`) because
 * getSession reads cookies without revalidating, which is unsafe — Supabase
 * docs are emphatic about this. The proxy keeps the session fresh upstream,
 * so getUser() doesn't make a network call on hot paths.
 */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const supabase = await createClient();
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  const meta = (data.user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (typeof meta.full_name === "string" && meta.full_name) ||
    (typeof meta.name === "string" && meta.name) ||
    null;
  const avatarUrl =
    (typeof meta.avatar_url === "string" && meta.avatar_url) ||
    (typeof meta.picture === "string" && meta.picture) ||
    null;

  return {
    id: data.user.id,
    email: data.user.email ?? null,
    name,
    avatarUrl,
  };
}
