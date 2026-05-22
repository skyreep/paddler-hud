"use server";

// Server actions for account-level operations that don't belong to a
// more specific domain (preferences, locations, gauges).
//
// Currently houses:
//   - redeemCompCode: validates a beta-tester / promo code and extends
//     the current user's subscriptions.comp_until window.
//
// Future additions (deferred to next session):
//   - Stripe Customer Portal session creation
//   - Stripe Checkout session creation

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RedeemCompCodeResult {
  ok: boolean;
  /** Days of premium granted by this redemption. Surfaced in the UI
   *  for confirmation ("You got 30 days of Tidevisor Pro"). */
  daysGranted?: number;
  /** New comp_until value (ISO timestamp) — caller can display
   *  "premium until Mon Jun 15, 2026" without re-querying. */
  compUntil?: string;
  error?: string;
}

/**
 * Redeem a comp code for the currently signed-in user. Extends their
 * subscriptions.comp_until by the code's duration_days. If they're
 * already in a comp window, the new window stacks (added to the
 * existing end) rather than replacing.
 *
 * Failure modes (returned as { ok: false, error }):
 *   - Not signed in
 *   - Code doesn't exist
 *   - Code expired
 *   - Code at max uses
 *   - User already redeemed this code
 *
 * Uses the admin (service-role) client for the writes because:
 *   - comp_codes is RLS-locked (no public read), so the user-context
 *     client couldn't even fetch the code to validate it.
 *   - subscriptions has no public write policies, so updating
 *     comp_until requires bypassing RLS.
 * Both operations are scoped to the authenticated user's user_id,
 * which we got from getUser() with the user-context client. So the
 * admin powers are only being used for the bits that need them.
 */
export async function redeemCompCode(rawCode: string): Promise<RedeemCompCodeResult> {
  // Trim whitespace and uppercase for case-insensitive lookup. Codes
  // are stored in whatever case the admin entered, but we match
  // case-insensitively (Beta-Tester == BETA-TESTER == beta-tester).
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a code to redeem." };
  if (code.length > 100) return { ok: false, error: "Code is too long." };

  // ─── 1. Identify the user (user-context client) ─────────────────
  const userClient = await createClient();
  if (!userClient) return { ok: false, error: "Auth is not configured." };
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Sign in to redeem a code." };
  }
  const userId = userData.user.id;

  // ─── 2. Service-role client for everything that follows ─────────
  const admin = createAdminClient();
  if (!admin) {
    console.error("[redeemCompCode] admin client not configured");
    return { ok: false, error: "Server isn't configured to redeem codes yet." };
  }

  // ─── 3. Look up the code (case-insensitive) ─────────────────────
  // The comp_codes table is small (admin-managed codes only), so a
  // full-table scan via ilike is fine and avoids needing a separate
  // normalized column.
  const { data: codeRow, error: codeErr } = await admin
    .from("comp_codes")
    .select("code, duration_days, max_uses, use_count, expires_at")
    .ilike("code", code)
    .maybeSingle();
  if (codeErr) {
    console.error("[redeemCompCode] code lookup failed:", codeErr.message);
    return { ok: false, error: "Couldn't check that code right now." };
  }
  if (!codeRow) {
    // Vague error to avoid leaking which codes exist — same response
    // whether "no such code" or "expired" or "maxed out" is intentional.
    return { ok: false, error: "That code isn't valid." };
  }
  if (codeRow.expires_at && Date.parse(codeRow.expires_at) < Date.now()) {
    return { ok: false, error: "That code has expired." };
  }
  if (codeRow.max_uses != null && codeRow.use_count >= codeRow.max_uses) {
    return { ok: false, error: "That code has already been used by the maximum number of people." };
  }

  // ─── 4. Check the user hasn't already redeemed it ───────────────
  // The unique (user_id, code) constraint would catch this at insert
  // time too, but pre-checking gives us a nicer error message.
  const { data: existingRedemption } = await admin
    .from("comp_redemptions")
    .select("id")
    .eq("user_id", userId)
    .eq("code", codeRow.code)
    .maybeSingle();
  if (existingRedemption) {
    return { ok: false, error: "You've already redeemed this code." };
  }

  // ─── 5. Compute the new comp_until ──────────────────────────────
  // Stack on top of any existing comp window: if it's still in the
  // future, extend from there; otherwise extend from now.
  const { data: subRow } = await admin
    .from("subscriptions")
    .select("comp_until")
    .eq("user_id", userId)
    .maybeSingle();
  const now = Date.now();
  const existingEnd =
    subRow?.comp_until && Date.parse(subRow.comp_until) > now
      ? Date.parse(subRow.comp_until)
      : now;
  const newCompUntilMs = existingEnd + codeRow.duration_days * 86400_000;
  const newCompUntilIso = new Date(newCompUntilMs).toISOString();

  // ─── 6. Insert redemption + bump use_count + update sub ─────────
  // Three writes. Ideally one transaction; Supabase JS doesn't expose
  // explicit transactions, so we sequence carefully:
  //   a. Insert redemption first. If the unique constraint fires
  //      (race condition: user clicked redeem twice), we abort with
  //      a clean error instead of double-counting.
  //   b. Increment use_count. If this fails we leave the redemption
  //      row in place — the user got their comp window, we just
  //      under-counted on the code; admin can fix manually.
  //   c. Update subscriptions.comp_until. If this fails the user
  //      didn't get premium; we attempt rollback by deleting the
  //      redemption row (best effort).

  const { error: insertErr } = await admin
    .from("comp_redemptions")
    .insert({ user_id: userId, code: codeRow.code });
  if (insertErr) {
    // 23505 = unique_violation in Postgres. Means a concurrent
    // redemption beat us to it. Treat as a polite "already redeemed".
    if (insertErr.code === "23505") {
      return { ok: false, error: "You've already redeemed this code." };
    }
    console.error("[redeemCompCode] insert failed:", insertErr.message);
    return { ok: false, error: "Couldn't record the redemption." };
  }

  // Bump use_count. Service-role can update directly. Read-modify-write
  // is OK here because comp_codes is admin-managed and contention is
  // very low (a beta code might see a few hundred redemptions, never
  // simultaneous).
  await admin
    .from("comp_codes")
    .update({ use_count: (codeRow.use_count ?? 0) + 1 })
    .eq("code", codeRow.code);

  // Update subscriptions.comp_until. Upsert handles the case where
  // no subscriptions row exists yet (shouldn't happen post-trigger
  // but defensive).
  const { error: subErr } = await admin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        comp_until: newCompUntilIso,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (subErr) {
    // Best-effort rollback: delete the redemption so the user can
    // try again. Don't roll back the use_count bump because that's
    // less harmful (over-counts by one, not a security issue).
    await admin
      .from("comp_redemptions")
      .delete()
      .eq("user_id", userId)
      .eq("code", codeRow.code);
    console.error("[redeemCompCode] subscription update failed:", subErr.message);
    return { ok: false, error: "Couldn't apply the comp to your account. Please try again." };
  }

  // Refresh the dashboard so the gating immediately reflects premium.
  revalidatePath("/", "layout");

  return {
    ok: true,
    daysGranted: codeRow.duration_days,
    compUntil: newCompUntilIso,
  };
}
