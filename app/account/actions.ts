"use server";

// Server actions for account-level operations that don't belong to a
// more specific domain (preferences, locations, gauges).

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface RedeemCompCodeResult {
  ok: boolean;
  daysGranted?: number;
  compUntil?: string;
  error?: string;
}

/**
 * Redeem a comp code for the currently signed-in user. Extends their
 * subscriptions.comp_until by the code's duration_days. Stacks on
 * existing comp windows (added to the end) rather than replacing.
 */
export async function redeemCompCode(rawCode: string): Promise<RedeemCompCodeResult> {
  const code = rawCode.trim().toUpperCase();
  if (!code) return { ok: false, error: "Enter a code to redeem." };
  if (code.length > 100) return { ok: false, error: "Code is too long." };

  // Identify the user (user-context client)
  const userClient = await createClient();
  if (!userClient) return { ok: false, error: "Auth is not configured." };
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    return { ok: false, error: "Sign in to redeem a code." };
  }
  const userId = userData.user.id;

  // Service-role client for everything that follows
  const admin = createAdminClient();
  if (!admin) {
    console.error("[redeemCompCode] admin client not configured");
    return { ok: false, error: "Server isn't configured to redeem codes yet." };
  }

  // Look up the code (case-insensitive)
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
    return { ok: false, error: "That code isn't valid." };
  }
  if (codeRow.expires_at && Date.parse(codeRow.expires_at) < Date.now()) {
    return { ok: false, error: "That code has expired." };
  }
  if (codeRow.max_uses != null && codeRow.use_count >= codeRow.max_uses) {
    return { ok: false, error: "That code has already been used by the maximum number of people." };
  }

  // Check the user hasn't already redeemed it
  const { data: existingRedemption } = await admin
    .from("comp_redemptions")
    .select("id")
    .eq("user_id", userId)
    .eq("code", codeRow.code)
    .maybeSingle();
  if (existingRedemption) {
    return { ok: false, error: "You've already redeemed this code." };
  }

  // Compute the new comp_until — stack on top of any existing window
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

  // Insert redemption + bump use_count + update sub
  const { error: insertErr } = await admin
    .from("comp_redemptions")
    .insert({ user_id: userId, code: codeRow.code });
  if (insertErr) {
    if (insertErr.code === "23505") {
      return { ok: false, error: "You've already redeemed this code." };
    }
    console.error("[redeemCompCode] insert failed:", insertErr.message);
    return { ok: false, error: "Couldn't record the redemption." };
  }

  await admin
    .from("comp_codes")
    .update({ use_count: (codeRow.use_count ?? 0) + 1 })
    .eq("code", codeRow.code);

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
    // Best-effort rollback
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
