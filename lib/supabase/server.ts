// Server-side Supabase client for Server Components, Route Handlers, and
// Server Actions. Reads session cookies from the incoming request so the
// `supabase.auth.getUser()` call returns the actual signed-in user (or null
// if guest).
//
// Note: Server Components in Next.js can't *write* cookies, so the setAll
// callback is wrapped in try/catch. Cookie refreshes happen in the
// proxy (see ./middleware.ts which is imported by the root proxy.ts) instead.
//
// Returns `null` when Supabase env vars aren't configured so callers can
// degrade gracefully to guest mode instead of crashing every server render.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export const isSupabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function createClient() {
  if (!isSupabaseConfigured) return null;

  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Setting cookies from a Server Component throws — that's fine,
            // the middleware refreshes the session on every request.
          }
        },
      },
    },
  );
}
