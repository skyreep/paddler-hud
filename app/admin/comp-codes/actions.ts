"use server";

// Admin server actions for the comp-code system. Gated by checking
// the caller's user_id against ADMIN_USER_IDS env var.

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export interface CompCode {
  code: string;
  description: string | null;
  durationDays: number;
  maxUses: number | null;
  useCount: number;
  expiresAt: string | null;
  createdAt: string;
}

export interface ListCodesResult {
  ok: boolean;
  codes?: CompCode[];
  error?: string;
}

export interface CreateCodeInput {
  code: string;
  description?: string;
  durationDays: number;
  maxUses?: number | null;
  expiresAt?: string | null;
}

export interface CreateCodeResult {
  ok: boolean;
  code?: CompCode;
  error?: string;
}

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "Auth not configured." };
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, error: "Not signed in." };
  const allow = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (allow.length === 0) {
    console.error("[admin] ADMIN_USER_IDS not configured");
    return { ok: false, error: "Not authorized." };
  }
  if (!allow.includes(data.user.id)) {
    return { ok: false, error: "Not authorized." };
  }
  return { ok: true, userId: data.user.id };
}

export async function listCodes(): Promise<ListCodesResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Server not configured." };

  const { data, error } = await admin
    .from("comp_codes")
    .select("code, description, duration_days, max_uses, use_count, expires_at, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[admin/listCodes] failed:", error.message);
    return { ok: false, error: error.message };
  }

  const codes: CompCode[] = (data ?? []).map((row) => ({
    code: String(row.code),
    description: row.description == null ? null : String(row.description),
    durationDays: Number(row.duration_days),
    maxUses: row.max_uses == null ? null : Number(row.max_uses),
    useCount: Number(row.use_count ?? 0),
    expiresAt: row.expires_at == null ? null : String(row.expires_at),
    createdAt: String(row.created_at),
  }));

  return { ok: true, codes };
}

export async function createCode(input: CreateCodeInput): Promise<CreateCodeResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };

  const code = (input.code ?? "").trim();
  if (!code) return { ok: false, error: "Code text is required." };
  if (code.length > 100) return { ok: false, error: "Code is too long (max 100 chars)." };

  const days = Math.round(input.durationDays);
  if (!Number.isFinite(days) || days < 1 || days > 366) {
    return { ok: false, error: "Duration must be 1-366 days." };
  }

  const maxUses = input.maxUses ?? null;
  if (maxUses != null && (!Number.isFinite(maxUses) || maxUses < 1)) {
    return { ok: false, error: "Max uses must be a positive integer (or empty for unlimited)." };
  }

  let expiresIso: string | null = null;
  if (input.expiresAt && input.expiresAt.trim()) {
    const t = Date.parse(input.expiresAt);
    if (!Number.isFinite(t)) {
      return { ok: false, error: "Expires-at is not a valid date." };
    }
    expiresIso = new Date(t).toISOString();
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Server not configured." };

  const { data, error } = await admin
    .from("comp_codes")
    .insert({
      code,
      description: input.description?.trim() || null,
      duration_days: days,
      max_uses: maxUses,
      expires_at: expiresIso,
    })
    .select("code, description, duration_days, max_uses, use_count, expires_at, created_at")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "A code with that text already exists." };
    }
    console.error("[admin/createCode] failed:", error.message);
    return { ok: false, error: error.message };
  }

  revalidatePath("/admin/comp-codes");
  return {
    ok: true,
    code: {
      code: String(data.code),
      description: data.description == null ? null : String(data.description),
      durationDays: Number(data.duration_days),
      maxUses: data.max_uses == null ? null : Number(data.max_uses),
      useCount: Number(data.use_count ?? 0),
      expiresAt: data.expires_at == null ? null : String(data.expires_at),
      createdAt: String(data.created_at),
    },
  };
}

export async function disableCode(code: string): Promise<SimpleResult> {
  const auth = await requireAdmin();
  if (!auth.ok) return { ok: false, error: auth.error };
  if (!code?.trim()) return { ok: false, error: "Missing code." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: "Server not configured." };

  const { error } = await admin
    .from("comp_codes")
    .update({ expires_at: new Date().toISOString() })
    .eq("code", code);

  if (error) {
    console.error("[admin/disableCode] failed:", error.message);
    return { ok: false, error: error.message };
  }
  revalidatePath("/admin/comp-codes");
  return { ok: true };
}

export async function isCurrentUserAdmin(): Promise<boolean> {
  const auth = await requireAdmin();
  return auth.ok;
}
