import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import FeedbackForm from "./FeedbackForm";

// User feedback page — bug reports and feature requests. Lives in the
// (legal) route group so it inherits the same minimal header/footer
// chrome as /help, /privacy, /terms.
//
// Auth model: signed-in only. Guests get bounced to the home page with
// the sign-in modal open (?signin=1), matching how /admin/comp-codes
// handles the same case. Once signed in we attach the user_id to every
// submission automatically.

export const metadata: Metadata = {
  title: "Feedback · Tidevisor",
  description:
    "Report a bug or request a feature for Tidevisor. Submissions go " +
    "straight to the team and are tied to your account so we can " +
    "follow up if needed.",
};

// Always render fresh: the form is auth-gated and we don't want a
// cached version that assumes the user is signed in (or vice versa)
// served to a different visitor.
export const dynamic = "force-dynamic";

const CONTACT_EMAIL = "contact@tidevisor.com";

export default async function FeedbackPage() {
  const user = await getCurrentUser();
  if (!user) {
    // Bounce to home matching the /admin/comp-codes pattern. The
    // ?signin=1 param isn't currently consumed by any component
    // (it's a convention waiting for a feature), but using the same
    // URL keeps the two gated pages consistent.
    redirect("/?signin=1");
  }

  return (
    <article>
      <h1 style={h1}>Send feedback</h1>
      <p style={subtle}>
        Tidevisor is built by a small team that actually paddles the boats
        we&rsquo;re forecasting for. Real feedback is how the app gets
        better &mdash; tell us what&rsquo;s broken, what&rsquo;s missing,
        or what&rsquo;s annoying.
      </p>

      <p style={infoNote}>
        We read every submission. If we need more detail to act on it,
        we&rsquo;ll email you back at{" "}
        <strong>{user.email ?? "the address on your account"}</strong>.
        For refunds or billing questions, email{" "}
        <a href={`mailto:${CONTACT_EMAIL}`} style={link}>{CONTACT_EMAIL}</a>{" "}
        directly &mdash; that gets handled faster than the queue.
      </p>

      <FeedbackForm userEmail={user.email} />

      <p style={fineprint}>
        Submissions are tied to your account so we can follow up. We
        don&rsquo;t share them. See our{" "}
        <Link href="/privacy" style={link}>Privacy Policy</Link> for the
        full picture.
      </p>
    </article>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────
// Local copies of the same tokens used in /help — kept inline rather
// than shared because the (legal) route group is intentionally
// self-contained and the styles are small.

const h1: React.CSSProperties = {
  fontSize: 32,
  fontWeight: 800,
  margin: "0 0 8px",
  letterSpacing: "-.5px",
};

const subtle: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
  margin: "0 0 12px",
};

const infoNote: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text)",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  padding: "10px 14px",
  margin: "16px 0",
  lineHeight: 1.6,
};

const link: React.CSSProperties = {
  color: "var(--accent)",
  textDecoration: "underline",
};

const fineprint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  margin: "24px 0 8px",
};
