"use server";

// Server actions for auth state changes. Keeping these in their own file
// (rather than alongside refreshHud in app/actions.ts) so adding more
// auth flows later — link/unlink provider, change email, etc. — has an
// obvious home.

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/**
 * Sign the current user out. Clears the session cookies and revalidates
 * the root route so any user-scoped data (saved locations, gauges, prefs)
 * disappears from the HUD on the next render. The client is responsible
 * for any navigation afterwards (router.refresh / router.push).
 *
 * (We previously called `redirect()` here, but the caller's try/catch
 * was eating the framework's NEXT_REDIRECT signal. Letting the client
 * navigate keeps the contract obvious — return = success, throw = error.)
 *
 * Safe to call when already signed out.
 */
export async function signOut() {
  const supabase = await createClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
}
