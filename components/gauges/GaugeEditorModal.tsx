"use client";

// River-gauge editor modal. Opens from the RiversTile header.
//
// Signed-in users get the full editor: add by USGS site ID (validated
// against the USGS API server-side), rename, reorder with up/down
// arrows, remove. Up to MAX_GAUGES total.
//
// Empty-state handling: when a signed-in user has zero saved gauges,
// the dashboard falls back to the hardcoded DEFAULT_GAUGES list, so
// the editor previews those defaults inline with a one-click "Save
// these to my list" action. Once saved, the editor becomes a normal
// list view with reorder / rename / remove per row.
//
// Guests see a read-only list of whatever's on the dashboard with a
// "Sign in to customize" notice.
//
// Portal'd to document.body to escape the topbar's backdrop-filter
// containing block (same reason as SignInModal / PreferencesModal).

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
// Import from the client-safe constants module, NOT lib/gauges.ts —
// lib/gauges.ts imports the server-only Supabase client which would
// drag next/headers into the client bundle and fail the build.
import { MAX_GAUGES } from "@/lib/gauges-defaults";
import {
  addGauge,
  removeGauge,
  reorderGauges,
  seedDefaultGauges,
  updateGaugeName,
} from "@/app/gauges/actions";
import type { UserGauge } from "@/lib/types";
import type { GaugeActionResult } from "@/lib/gauge-action-result";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Full DB rows for signed-in users. `null` means guest mode (the
   *  modal renders a read-only view with the default site IDs). */
  initialGauges: UserGauge[] | null;
  /** Site IDs currently shown on the dashboard — used for guests so the
   *  read-only list reflects exactly what they're looking at, and for
   *  signed-in users with an empty saved list so they can preview /
   *  one-click-save the defaults. */
  fallbackIds: string[];
}

export default function GaugeEditorModal({ open, onClose, initialGauges, fallbackIds }: Props) {
  const router = useRouter();
  const [gauges, setGauges] = useState<UserGauge[]>(initialGauges ?? []);
  const [newId, setNewId] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Explicit loading state — useTransition's isPending only tracks the
  // synchronous portion of a transition in React 18, which makes async
  // server-action calls feel unresponsive. Plain useState is more honest.
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const isGuest = initialGauges === null;
  const isEmptySignedIn = !isGuest && gauges.length === 0;

  // Sync local state when the parent re-supplies gauges (after a
  // router.refresh() cycles fresh data through the server component).
  useEffect(() => {
    if (initialGauges) setGauges(initialGauges);
  }, [initialGauges]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Reset transient state on close.
  useEffect(() => {
    if (open) return;
    setNewId("");
    setError(null);
    setEditingId(null);
    setEditingName("");
    setBusy(false);
  }, [open]);

  /** Apply a server-action result to local state. Returns true on success
   *  so callers can chain post-success behavior (e.g. clearing an input). */
  function applyResult(result: GaugeActionResult): boolean {
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return false;
    }
    setError(null);
    if (result.gauges) setGauges(result.gauges);
    // Force the page to re-render with the fresh gauge list so RiversTile
    // shows the changes without requiring a manual refresh.
    router.refresh();
    return true;
  }

  /** Wrap a server-action invocation so exceptions surface as visible
   *  error messages instead of disappearing into the void. */
  async function runAction(label: string, fn: () => Promise<GaugeActionResult>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      return applyResult(result);
    } catch (err) {
      console.error(`[gauges] ${label} threw:`, err);
      setError(err instanceof Error ? err.message : `${label} failed unexpectedly.`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newId.trim();
    if (!trimmed) return;
    const ok = await runAction("addGauge", () => addGauge(trimmed));
    if (ok) setNewId("");
  }

  async function handleRemove(id: string) {
    await runAction("removeGauge", () => removeGauge(id));
  }

  async function handleSeedDefaults() {
    await runAction("seedDefaultGauges", () => seedDefaultGauges());
  }

  async function handleMove(id: string, direction: -1 | 1) {
    const idx = gauges.findIndex((g) => g.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= gauges.length) return;
    // Optimistic swap so the UI feels instant.
    const swapped = [...gauges];
    [swapped[idx], swapped[newIdx]] = [swapped[newIdx], swapped[idx]];
    const previous = gauges;
    setGauges(swapped);
    const ok = await runAction("reorderGauges", () => reorderGauges(swapped.map((g) => g.id)));
    if (!ok) {
      // Revert on failure.
      setGauges(previous);
    }
  }

  function startEditName(g: UserGauge) {
    setEditingId(g.id);
    setEditingName(g.displayName ?? "");
    setError(null);
  }

  async function saveEditName() {
    if (editingId == null) return;
    const id = editingId;
    const name = editingName;
    setEditingId(null);
    setEditingName("");
    await runAction("updateGaugeName", () => updateGaugeName(id, name));
  }

  function cancelEditName() {
    setEditingId(null);
    setEditingName("");
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const gaugeCountLabel = isGuest
    ? `${fallbackIds.length} default gauges`
    : `${gauges.length} of ${MAX_GAUGES} saved`;

  // Which rows render in the list area. For signed-in users with saved
  // rows it's the real list. For guests OR signed-in-but-empty users it's
  // the fallback IDs projected into placeholder UserGauge shapes so the
  // same row component works.
  const showingFallbacks = isGuest || isEmptySignedIn;
  const listRows: UserGauge[] = showingFallbacks
    ? fallbackIds.map(idToFakeGauge)
    : gauges;

  return createPortal(
    <div onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="gauges-title" style={overlay}>
      <div onClick={(e) => e.stopPropagation()} style={sheet}>
        <div style={dragHandle} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
          <div>
            <h2 id="gauges-title" style={{ margin: 0, fontSize: 18 }}>River gauges</h2>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {gaugeCountLabel}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={closeBtn}>✕</button>
        </div>

        {isGuest && (
          <div style={notice}>
            Showing the default Lowcountry gauges.
            <span style={{ color: "var(--text-muted)" }}>{" "}Sign in to customize your list.</span>
          </div>
        )}

        {isEmptySignedIn && (
          <div style={notice}>
            <div style={{ fontWeight: 600 }}>Your saved list is empty.</div>
            <div style={{ color: "var(--text-muted)", marginTop: 4 }}>
              These default Lowcountry gauges are showing on your dashboard. Save them to
              your list, or add your own below.
            </div>
            <button
              type="button"
              onClick={handleSeedDefaults}
              disabled={busy}
              style={{ ...primaryBtn, marginTop: 10 }}
            >
              {busy ? "Saving…" : "Save these to my list"}
            </button>
          </div>
        )}

        {error && (
          <div style={{ ...notice, borderColor: "#c44", color: "#c44" }}>
            {error}
          </div>
        )}

        <div style={{ display: "grid", gap: 6 }}>
          {listRows.map((g, idx, arr) => (
            <GaugeRow
              key={g.id}
              gauge={g}
              isFirst={idx === 0}
              isLast={idx === arr.length - 1}
              readOnly={showingFallbacks}
              busy={busy}
              isEditingName={editingId === g.id}
              editingName={editingId === g.id ? editingName : ""}
              onEditNameChange={setEditingName}
              onStartEditName={() => startEditName(g)}
              onSaveEditName={saveEditName}
              onCancelEditName={cancelEditName}
              onMoveUp={() => handleMove(g.id, -1)}
              onMoveDown={() => handleMove(g.id, 1)}
              onRemove={() => handleRemove(g.id)}
            />
          ))}
        </div>

        {!isGuest && gauges.length < MAX_GAUGES && (
          <form onSubmit={handleAdd} style={{ marginTop: 16 }}>
            <div style={{
              fontSize: 12, color: "var(--text-muted)", marginBottom: 6,
              textTransform: "uppercase", letterSpacing: ".4px",
            }}>
              Add gauge by USGS site ID
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                inputMode="numeric"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
                placeholder="e.g. 02198690"
                disabled={busy}
                style={input}
              />
              <button
                type="submit"
                disabled={busy || !newId.trim()}
                style={primaryBtn}
              >
                {busy ? "Adding…" : "Add"}
              </button>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, lineHeight: 1.5 }}>
              Find site IDs on{" "}
              <a
                href="https://maps.waterdata.usgs.gov/mapper/index.html"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--accent)" }}
              >
                USGS Water Data Mapper
              </a>
              . The ID appears in the URL or popup of any gauge you click.
            </div>
          </form>
        )}

        {!isGuest && gauges.length >= MAX_GAUGES && (
          <div style={{ ...notice, marginTop: 16, color: "var(--text-muted)" }}>
            You&apos;ve hit the {MAX_GAUGES}-gauge cap. Remove one to add another.
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Single-row sub-component

interface RowProps {
  gauge: UserGauge;
  isFirst: boolean;
  isLast: boolean;
  readOnly: boolean;
  busy: boolean;
  isEditingName: boolean;
  editingName: string;
  onEditNameChange: (v: string) => void;
  onStartEditName: () => void;
  onSaveEditName: () => void;
  onCancelEditName: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}
function GaugeRow({
  gauge, isFirst, isLast, readOnly, busy,
  isEditingName, editingName, onEditNameChange,
  onStartEditName, onSaveEditName, onCancelEditName,
  onMoveUp, onMoveDown, onRemove,
}: RowProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: readOnly ? "1fr" : "auto 1fr auto",
      gap: 8, alignItems: "center",
      padding: "10px 12px",
      background: "var(--bg-elev-2)",
      border: "1px solid var(--border-soft)",
      borderRadius: 10,
    }}>
      {!readOnly && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={busy || isFirst}
            aria-label="Move up"
            title="Move up"
            style={arrowBtn(busy || isFirst)}
          >▲</button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={busy || isLast}
            aria-label="Move down"
            title="Move down"
            style={arrowBtn(busy || isLast)}
          >▼</button>
        </div>
      )}

      <div style={{ minWidth: 0 }}>
        {isEditingName ? (
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              value={editingName}
              onChange={(e) => onEditNameChange(e.target.value)}
              placeholder="Custom name (leave blank to reset)"
              autoFocus
              style={{ ...input, fontSize: 13, padding: "6px 8px" }}
              onKeyDown={(e) => {
                if (e.key === "Enter") onSaveEditName();
                if (e.key === "Escape") onCancelEditName();
              }}
            />
            <button type="button" onClick={onSaveEditName} disabled={busy} style={miniBtn}>Save</button>
            <button type="button" onClick={onCancelEditName} disabled={busy} style={miniBtn}>Cancel</button>
          </div>
        ) : (
          <>
            <div style={{
              fontWeight: 600, fontSize: 13,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {gauge.displayName ?? gauge.usgsSiteId}
            </div>
            <div className="num" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              USGS {gauge.usgsSiteId}
            </div>
          </>
        )}
      </div>

      {!readOnly && !isEditingName && (
        <div style={{ display: "flex", gap: 4 }}>
          <button type="button" onClick={onStartEditName} disabled={busy} style={miniBtn} title="Rename">✎</button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy}
            style={{ ...miniBtn, color: "#c44" }}
            title="Remove"
          >✕</button>
        </div>
      )}
    </div>
  );
}

/** Convert a guest site ID into a placeholder UserGauge so the row
 *  component can render it. The id field is the site ID itself, which
 *  is unique within the rendered list — no risk of React key collisions. */
function idToFakeGauge(id: string, idx: number): UserGauge {
  return {
    id,
    usgsSiteId: id,
    displayName: null,
    floodStageOverride: null,
    sortOrder: idx,
    createdAt: "",
  };
}

// ─── Styles

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 10000,
  background: "rgba(7,17,26,.55)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const sheet: React.CSSProperties = {
  background: "var(--bg-elev)",
  width: "100%", maxWidth: 480, maxHeight: "88vh",
  borderRadius: "22px 22px 0 0",
  padding: 18,
  paddingBottom: "calc(18px + env(safe-area-inset-bottom))",
  overflowY: "auto",
  animation: "phud-slideup .25s ease",
  color: "var(--text)",
};
const dragHandle: React.CSSProperties = {
  width: 40, height: 4, background: "var(--border)",
  borderRadius: 2, margin: "0 auto 14px",
};
const closeBtn: React.CSSProperties = {
  marginLeft: "auto",
  width: 32, height: 32,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: "50%",
  display: "grid", placeItems: "center",
  color: "var(--text)", cursor: "pointer", fontSize: 14,
};
const notice: React.CSSProperties = {
  padding: "10px 12px", marginBottom: 12,
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 13, color: "var(--text)",
};
const input: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  background: "var(--bg-elev-2)", color: "var(--text)",
  border: "1px solid var(--border-soft)", borderRadius: 10,
  fontSize: 14, fontFamily: "inherit",
  boxSizing: "border-box",
  minWidth: 0,
};
const primaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  background: "var(--accent)", color: "white",
  border: "none", borderRadius: 10, fontSize: 13, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
  flexShrink: 0,
};
const miniBtn: React.CSSProperties = {
  padding: "4px 8px",
  background: "var(--bg-elev)",
  color: "var(--text)",
  border: "1px solid var(--border-soft)",
  borderRadius: 6,
  fontSize: 12, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
};
function arrowBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 22, height: 22,
    padding: 0,
    background: "transparent",
    color: disabled ? "var(--text-faint)" : "var(--text-muted)",
    border: "1px solid var(--border-soft)",
    borderRadius: 4,
    fontSize: 9, lineHeight: 1,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
