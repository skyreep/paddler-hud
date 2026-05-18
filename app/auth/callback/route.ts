// OAuth + email-magic-link return point. Every provider we wire up
// (Google, Apple, Email OTP) redirects the browser here after the user
// finishes authenticating with the third party. The query string carries
// a one-time `code` that we exchange for a session cookie, then we send
// the user back to wherever they started (or `/` by default).
//
// This route is registered with each provider in the Supabase Dashboard
// (Authentication → URL Configuration → Redirect URLs):
//   - http://localhost:3000/auth/callback
//   - https://paddler-hud.vercel.app/auth/callback
//   - https://*.paddler-hud.vercel.app/auth/callback   (preview deploys)
//
// If you change this path, change those allow-listed URLs too or the
// provider will refuse to redirect.

import { createClient } from "@/lib/supabase/server";
import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Where to send the user after a successful exchange. Providers preserve
  // the `next` param we attached when we called signInWithOAuth().
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        // Use the request origin (not env var) so localhost stays
        // localhost and preview deploys stay on their preview domain.
        return NextResponse.redirect(`${origin}${next}`);
      }
      console.error("[auth/callback] exchangeCodeForSession failed:", error.message);
    }
  }

  // Something went wrong (missing code, expired code, Supabase misconfigured).
  // Bounce to the home page with an error param the UI can surface.
  return NextResponse.redirect(`${origin}/?auth_error=callback_failed`);
}
