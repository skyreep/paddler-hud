"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createCode, disableCode } from "./actions";
import type { CompCode } from "./actions";

interface Props {
  initialCodes: CompCode[];
}

export default function CompCodesClient({ initialCodes }: Props) {
  const router = useRouter();
  const [codes, setCodes] = useState<CompCode[]>(initialCodes);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [durationDays, setDurationDays] = useState("30");
  const [maxUses, setMaxUses] = useState("");
  const [expiresAt, setExpiresAt] = useState("");

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const res = await createCode({
      code,
      description: description.trim() || undefined,
      durationDays: Number(durationDays),
      maxUses: maxUses.trim() ? Number(maxUses) : null,
      expiresAt: expiresAt.trim() || null,
    });
    setSubmitting(false);
    if (!res.ok || !res.code) {
      setFormError(res.error ?? "Couldn't create code.");
      return;
    }
    setCodes((prev) => [res.code!, ...prev]);
    setCode("");
    setDescription("");
    setMaxUses("");
    setExpiresAt("");
    router.refresh();
  }

  async function handleDisable(c: CompCode) {
    if (!confirm(`Disable ${c.code}? Existing redemptions stay; no new ones can be made.`)) {
      return;
    }
    const res = await disableCode(c.code);
    if (!res.ok) {
      alert(res.error ?? "Couldn't disable code.");
      return;
    }
    setCodes((prev) =>
      prev.map((row) =>
        row.code === c.code ? { ...row, expiresAt: new Date().toISOString() } : row,
      ),
    );
    router.refresh();
  }

  return (
    <>
      <section style={{ marginBottom: 32 }}>
        <h2 style={h2}>Create new code</h2>
        <form onSubmit={handleCreate} style={form}>
          <Field label="Code (will be shown to users)" required>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="BETA-2026"
              required
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              style={input}
            />
          </Field>

          <Field label="Description (admin note, optional)">
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Reddit r/Kayaking soft launch"
              style={input}
            />
          </Field>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Field label="Days of Pro" required>
              <input
                type="number"
                min={1}
                max={366}
                value={durationDays}
                onChange={(e) => setDurationDays(e.target.value)}
                required
                style={input}
              />
            </Field>
            <Field label="Max uses (blank = unlimited)">
              <input
                type="number"
                min={1}
                value={maxUses}
                onChange={(e) => setMaxUses(e.target.value)}
                placeholder="50"
                style={input}
              />
            </Field>
            <Field label="Expires (blank = no expiry)">
              <input
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                style={input}
              />
            </Field>
          </div>

          {formError && <div style={errorBox}>{formError}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
            <button type="submit" disabled={submitting} style={primaryBtn}>
              {submitting ? "Creating…" : "Create code"}
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2 style={h2}>Existing codes ({codes.length})</h2>
        {codes.length === 0 ? (
          <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
            No codes yet. Create one above to start handing out comp access.
          </p>
        ) : (
          <table style={table}>
            <thead>
              <tr>
                <th style={th}>Code</th>
                <th style={th}>Description</th>
                <th style={th}>Days</th>
                <th style={th}>Uses</th>
                <th style={th}>Expires</th>
                <th style={th}>Created</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => {
                const expired = c.expiresAt && Date.parse(c.expiresAt) < Date.now();
                const exhausted = c.maxUses != null && c.useCount >= c.maxUses;
                const dead = expired || exhausted;
                return (
                  <tr key={c.code} style={{ opacity: dead ? 0.5 : 1 }}>
                    <td style={tdCode}>{c.code}</td>
                    <td style={td}>{c.description ?? "—"}</td>
                    <td style={td}>{c.durationDays}</td>
                    <td style={td}>
                      {c.useCount}
                      {c.maxUses != null ? ` / ${c.maxUses}` : ""}
                    </td>
                    <td style={td}>
                      {c.expiresAt ? formatShortDate(c.expiresAt) : "—"}
                    </td>
                    <td style={td}>{formatShortDate(c.createdAt)}</td>
                    <td style={td}>
                      {!expired && (
                        <button type="button" onClick={() => handleDisable(c)} style={disableBtn}>
                          Disable
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "block", marginBottom: 12 }}>
      <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 4 }}>
        {label}
        {required && <span style={{ color: "#c44" }}> *</span>}
      </span>
      {children}
    </label>
  );
}

function formatShortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

const form: React.CSSProperties = {
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 12,
  padding: 18,
};

const input: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  color: "var(--text)",
  fontSize: 14,
  fontFamily: "inherit",
  boxSizing: "border-box",
};

const h2: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  margin: "0 0 12px",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 18px",
  background: "var(--accent)",
  color: "white",
  border: "none",
  borderRadius: 8,
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "inherit",
  cursor: "pointer",
};

const disableBtn: React.CSSProperties = {
  padding: "5px 10px",
  background: "transparent",
  color: "#c44",
  border: "1px solid #c44",
  borderRadius: 6,
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
};

const errorBox: React.CSSProperties = {
  padding: "10px 12px",
  marginTop: 10,
  background: "rgba(196,68,68,.08)",
  border: "1px solid #c44",
  borderRadius: 8,
  color: "#c44",
  fontSize: 13,
};

const table: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  background: "var(--bg-elev)",
  border: "1px solid var(--border-soft)",
  borderRadius: 12,
  overflow: "hidden",
  fontSize: 13,
};

const th: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 12px",
  background: "var(--bg-elev-2)",
  borderBottom: "1px solid var(--border-soft)",
  fontWeight: 600,
  fontSize: 12,
  textTransform: "uppercase",
  letterSpacing: ".4px",
  color: "var(--text-muted)",
};

const td: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid var(--border-soft)",
  color: "var(--text)",
};

const tdCode: React.CSSProperties = {
  ...td,
  fontFamily: "var(--font-mono, monospace)",
  fontWeight: 600,
  letterSpacing: ".5px",
};
