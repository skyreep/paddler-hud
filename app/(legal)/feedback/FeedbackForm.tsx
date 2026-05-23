"use client";

// Client form for /feedback. Three controlled inputs (kind / subject /
// body) plus a submit button. On submit we call the submitFeedback
// server action, which validates and inserts.
//
// State machine:
//   idle    → user is editing the form
//   sending → action in flight, button disabled
//   sent    → success view; "Send another" resets back to idle
//   error   → inline error message below the form; user can retry
//
// We capture page_url and user_agent here (client-side) and pass them
// through to the action. The action runs on /feedback so it can't
// figure these out by itself, and they're useful for triage.

import { useState, useTransition } from "react";
import { submitFeedback, type FeedbackKind } from "./actions";

const KIND_OPTIONS: { value: FeedbackKind; label: string; hint: string }[] = [
  { value: "bug",     label: "Bug report",     hint: "Something's broken or behaving wrong." },
  { value: "feature", label: "Feature request", hint: "An idea for something Tidevisor should do." },
  { value: "other",   label: "Other",           hint: "Anything else — questions, comments, etc." },
];

export default function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>("bug");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);

    // Read page_url / user_agent at submit time, not render time, so
    // the values reflect the moment of submission (and so we don't trip
    // an SSR/CSR mismatch by reading `window` during the first paint).
    const pageUrl = typeof window !== "undefined" ? window.location.href : "";
    const userAgent = typeof navigator !== "undefined" ? navigator.userAgent : "";

    startTransition(async () => {
      const result = await submitFeedback({
        kind, subject, body, pageUrl, userAgent,
      });
      if (result.ok) {
        setSent(true);
        setSubject("");
        setBody("");
      } else {
        setError(result.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  if (sent) {
    return (
      <div style={successBox} role="status">
        <div style={successTitle}>Thanks — we got it.</div>
        <p style={successBody}>
          Your feedback is in the queue. We read every submission. If we
          need more detail to act on it, we&rsquo;ll email you at the
          address on your account.
        </p>
        <button
          type="button"
          onClick={() => { setSent(false); setError(null); setKind("bug"); }}
          style={resetButton}
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={formStyle} noValidate>
      {/* ── Category ─────────────────────────────────────────────── */}
      <fieldset style={fieldset}>
        <legend style={legend}>What kind of feedback is this?</legend>
        <div style={radioGroup}>
          {KIND_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              style={{
                ...radioCard,
                ...(kind === opt.value ? radioCardActive : null),
              }}
            >
              <input
                type="radio"
                name="kind"
                value={opt.value}
                checked={kind === opt.value}
                onChange={() => setKind(opt.value)}
                style={radioInput}
              />
              <span style={radioLabel}>{opt.label}</span>
              <span style={radioHint}>{opt.hint}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* ── Subject ──────────────────────────────────────────────── */}
      <label htmlFor="fb-subject" style={fieldLabel}>
        Subject
        <span style={requiredMark} aria-hidden> *</span>
      </label>
      <input
        id="fb-subject"
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        placeholder={
          kind === "bug"
            ? "Wind tile shows no data on iPhone Safari"
            : kind === "feature"
            ? "Per-location timezone setting"
            : "Quick question about the daily briefing"
        }
        maxLength={200}
        required
        style={inputStyle}
      />

      {/* ── Body ─────────────────────────────────────────────────── */}
      <label htmlFor="fb-body" style={fieldLabel}>
        {kind === "bug" ? "What happened?" : kind === "feature" ? "Describe the feature" : "Your message"}
        <span style={requiredMark} aria-hidden> *</span>
      </label>
      <textarea
        id="fb-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={
          kind === "bug"
            ? "Steps to reproduce, what you expected, what you saw instead. Screenshots optional — email them to contact@tidevisor.com if helpful."
            : kind === "feature"
            ? "What problem would this solve for you? How would you use it?"
            : "Type your message here..."
        }
        rows={8}
        maxLength={8000}
        required
        style={textareaStyle}
      />
      <div style={charCount}>
        {body.length} / 8000
      </div>

      {/* ── Error ────────────────────────────────────────────────── */}
      {error && (
        <div style={errorBox} role="alert">
          {error}
        </div>
      )}

      {/* ── Submit ───────────────────────────────────────────────── */}
      <button type="submit" disabled={pending} style={pending ? submitButtonDisabled : submitButton}>
        {pending ? "Sending…" : "Send feedback"}
      </button>
    </form>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
// Inline styles (matching the rest of the (legal) pages) so this stays
// self-contained and doesn't fight with the dashboard's Tailwind setup.

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  margin: "20px 0 8px",
};

const fieldset: React.CSSProperties = {
  border: "none",
  padding: 0,
  margin: "0 0 12px",
};

const legend: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text)",
  padding: 0,
  marginBottom: 8,
};

const radioGroup: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
  gap: 8,
};

const radioCard: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "10px 12px",
  border: "1px solid var(--border-soft)",
  borderRadius: 10,
  background: "var(--bg-elev)",
  cursor: "pointer",
  fontSize: 13,
  position: "relative",
};

const radioCardActive: React.CSSProperties = {
  borderColor: "var(--accent)",
  boxShadow: "0 0 0 1px var(--accent) inset",
  background: "var(--bg-elev-2)",
};

// Visually hidden but still keyboard-focusable. We use the surrounding
// label as the click target so the whole card is hit-friendly on mobile.
const radioInput: React.CSSProperties = {
  position: "absolute",
  opacity: 0,
  pointerEvents: "none",
  width: 0,
  height: 0,
};

const radioLabel: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 13,
};

const radioHint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  lineHeight: 1.4,
};

const fieldLabel: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 700,
  color: "var(--text)",
  margin: "12px 0 4px",
};

const requiredMark: React.CSSProperties = {
  color: "var(--accent)",
  fontWeight: 700,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  fontFamily: "inherit",
  background: "var(--bg-elev)",
  color: "var(--text)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  outline: "none",
  boxSizing: "border-box",
};

const textareaStyle: React.CSSProperties = {
  ...inputStyle,
  resize: "vertical",
  minHeight: 140,
  lineHeight: 1.5,
  fontFamily: "inherit",
};

const charCount: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-faint)",
  textAlign: "right",
  marginTop: 2,
};

const errorBox: React.CSSProperties = {
  padding: "10px 14px",
  background: "rgba(196,68,68,.08)",
  border: "1px solid #c44",
  borderRadius: 10,
  color: "#c44",
  fontSize: 13,
  marginTop: 8,
};

const submitButton: React.CSSProperties = {
  marginTop: 12,
  padding: "11px 18px",
  fontSize: 14,
  fontWeight: 700,
  color: "white",
  background: "linear-gradient(135deg, var(--accent), var(--accent-2))",
  border: "none",
  borderRadius: 10,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(15,110,168,.35)",
  alignSelf: "flex-start",
};

const submitButtonDisabled: React.CSSProperties = {
  ...submitButton,
  opacity: 0.6,
  cursor: "not-allowed",
};

// ─── Success view ──────────────────────────────────────────────────────────

const successBox: React.CSSProperties = {
  marginTop: 20,
  padding: "20px 22px",
  border: "1px solid var(--border-soft)",
  borderLeft: "3px solid var(--accent)",
  background: "var(--bg-elev)",
  borderRadius: 10,
};

const successTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 6,
};

const successBody: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text)",
  lineHeight: 1.6,
  margin: "0 0 14px",
};

const resetButton: React.CSSProperties = {
  padding: "8px 14px",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text)",
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  cursor: "pointer",
};
