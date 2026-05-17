// Next.js proxy (formerly "middleware" — renamed in Next 16; see
// https://nextjs.org/docs/messages/middleware-to-proxy). Runs on every
// matching request before the route is handled. We use it for one job
// right now: refreshing the Supabase auth session cookies so server
// components downstream always see a valid user.
//
// The matcher below excludes static asset paths to avoid wasting auth
// checks on icon/font/image requests. Add any new always-public paths
// (favicon, OG images, etc.) to the exclusion list if you create them.

import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Run on everything EXCEPT:
    //   - ALL Next internals (_next/* covers static, image, webpack-hmr,
    //     data, on-demand compiles, source maps — anything dev or prod
    //     might serve under that prefix). Earlier we only excluded
    //     _next/static and _next/image, which left HMR pings going
    //     through Supabase on every keystroke — that turned into a
    //     memory loop when the proxy errored.
    //   - The PWA / icon files we serve from /app
    //   - Any static asset request (extension-based catch-all)
    "/((?!_next|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|ttf|woff|woff2)$).*)",
  ],
};
