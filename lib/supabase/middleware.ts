// Session-refresh helper called from the project root proxy (../../proxy.ts).
// Supabase access tokens expire on a short cycle (1 hour by default) and need
// to be refreshed using the longer-lived refresh token. The Next.js proxy
// (formerly "middleware" — renamed in Next 16) runs on every request, which
// is the perfect place to do that refresh transparently so server components
// downstream see a valid session.
//
// The implementation MUST follow Supabase's required pattern exactly:
//   1. Create the Supabase client wired to read/write cookies on `request`
//      and `supabaseResponse`.
//   2. Call `supabase.auth.getUser()` IMMEDIATELY — never put logic between
//      createServerClient() and getUser(), or expired sessions won't refresh.
//   3. Return the response (which now carries any rotated cookies).

import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// If the user hasn't filled in their Supabase keys yet (fresh clone,
// missing .env.local, etc.) DON'T call createServerClient — it throws,
// and the proxy runs on every request, so a missing key turns into a
// tight error loop in dev that can chew through gigabytes of memory.
// Bail out quietly instead; auth simply stays disabled until the env
// is configured.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON);
let warnedMissingEnv = false;

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  if (!SUPABASE_CONFIGURED) {
    if (!warnedMissingEnv) {
      warnedMissingEnv = true;
      console.warn(
        "[proxy] NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
          "Skipping Supabase session refresh — auth is disabled until you add them to .env.local.",
      );
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(
    SUPABASE_URL!,
    SUPABASE_ANON!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // CRITICAL: getUser() must be the next call after createServerClient.
  // Any code between them runs before the refresh check, and an expired
  // session would silently stay expired — every downstream Server Component
  // would see the user as logged out.
  await supabase.auth.getUser();

  return supabaseResponse;
}
