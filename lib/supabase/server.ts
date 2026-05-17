// Server-side Supabase client for Server Components, Route Handlers, and
// Server Actions. Reads session cookies from the incoming request so the
// `supabase.auth.getUser()` call returns the actual signed-in user (or null
// if guest).
//
// Note: Server Components in Next.js can't *write* cookies, so the setAll
// callback is wrapped in try/catch. Cookie refreshes happen in the
// middleware (see ./middleware.ts) instead.

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createClient() {
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
