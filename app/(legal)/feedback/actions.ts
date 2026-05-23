"use server";

// Server action backing the /feedback form. Inserts a row into the
// `feedback` table on behalf of the currently-signed-in user.
//
// Auth model:
//   - Signed-in only. We re-check auth here (not just on the page that
//     rendered the form) because a guest could in principle POST to the
//     server action directly — RLS would also reject them since the
//     insert policy requires auth.uid() = user_id, but failing fast with
//     a clear error message is friendlier than letting Postgres do it.
//
//   - We pass the user_id explicitly from auth.getUser() rather than
//     relying on RLS alone. Belt-and-suspenders, and lets us return a
//     useful error if Supabase isn't configured at all (e.g. local dev
//     without env vars).

import { createClient } from "@/lib/supabase/server";

export type FeedbackKind = "bug" | "feature" | "other";

export interface SubmitFeedbackInput {
  kind: FeedbackKind;
  subject: string;
  body: string;
  /** Optional — captured client-side so admins know which page the user
   *  was on when they hit "report a bug" (will usually be /feedback
   *  unless we add a "Report this" link from other pages later). */
  pageUrl?: string;
  /** Optional — navigator.userAgent. Useful for triaging mobile-only
   *  bugs without asking the submitter what browser they're using. */
  userAgent?: string;
}

export interface SubmitFeedbackResult {
  ok: boolean;
  error?: string;
}

// Match the DB CHECK constraints in supabase/migrations/006_feedback.sql.
// Duplicated here so we can return a clean validation error instead of
// letting the constraint violation bubble up as an opaque Postgres code.
const SUBJECT_MAX = 200;
const BODY_MAX = 8000;
const ALLOWED_KINDS: ReadonlySet<FeedbackKind> = new Set(["bug", "feature", "other"]);

export async function submitFeedback(
  input: SubmitFeedbackInput,
): Promise<SubmitFeedbackResult> {
  // ── Validation ──────────────────────────────────────────────────────
  if (!ALLOWED_KINDS.has(input.kind)) {
    return { ok: false, error: "Pick a category." };
  }

  const subject = (input.subject ?? "").trim();
  if (!subject) return { ok: false, error: "Add a short subject." };
  if (subject.length > SUBJECT_MAX) {
    return { ok: false, error: `Subject is too long (max ${SUBJECT_MAX} characters).` };
  }

  const body = (input.body ?? "").trim();
  if (!body) return { ok: false, error: "Tell us what happened or what you'd like to see." };
  if (body.length > BODY_MAX) {
    return { ok: false, error: `Message is too long (max ${BODY_MAX} characters).` };
  }

  // Page URL / UA are advisory only — truncate defensively so a malicious
  // client can't bloat the row. The schema has no length cap on them.
  const pageUrl = (input.pageUrl ?? "").slice(0, 500) || null;
  const userAgent = (input.userAgent ?? "").slice(0, 500) || null;

  // ── Auth ────────────────────────────────────────────────────────────
  const supabase = await createClient();
  if (!supabase) return { ok: false, error: "Feedback isn't available right now. Please try again later." };

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth?.user) {
    return { ok: false, error: "Please sign in to send feedback." };
  }

  // ── Insert ──────────────────────────────────────────────────────────
  // RLS will also enforce auth.uid() = user_id, but we pass it
  // explicitly so the insert is unambiguous.
  const { error: insertError } = await supabase.from("feedback").insert({
    user_id: auth.user.id,
    kind: input.kind,
    subject,
    body,
    page_url: pageUrl,
    user_agent: userAgent,
  });

  if (insertError) {
    console.error("[feedback/submit] insert failed:", insertError.message);
    return { ok: false, error: "Couldn't save your feedback. Please try again." };
  }

  return { ok: true };
}
