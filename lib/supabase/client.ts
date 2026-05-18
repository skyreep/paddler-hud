// Browser-side Supabase client. Use this in any "use client" component that
// needs to read user data or trigger auth flows (sign-in/out).
//
// For server-rendered code (Server Components, Route Handlers, Server Actions)
// use the server client in ./server.ts instead — it carries the user's
// session cookies into the server-side request.
//
// `createClient()` returns `null` when env vars aren't configured. Callers
// should check for null and either no-op (e.g. SignInModal's submit handler)
// or hide the auth UI entirely (AccountMenu).

import { createBrowserClient } from "@supabase/ssr";

// NEXT_PUBLIC_* env vars are inlined at build time so this check works
// in the browser bundle.
export const isSupabaseConfigured = !!(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export function createClient() {
  if (!isSupabaseConfigured) return null;

  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
