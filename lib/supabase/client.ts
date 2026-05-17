// Browser-side Supabase client. Use this in any "use client" component that
// needs to read user data or trigger auth flows (sign-in/out).
//
// For server-rendered code (Server Components, Route Handlers, Server Actions)
// use the server client in ./server.ts instead — it carries the user's
// session cookies into the server-side request.

import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
