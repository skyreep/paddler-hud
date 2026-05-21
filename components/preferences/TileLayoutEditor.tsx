"use client";
// Layout editor: per-tile up/down ordering + show/hide toggle.
//
// State model: editor maintains a local working list of EffectiveTile
// entries. Up/down arrows swap positions; the visibility toggle flips
// a flag on a single entry; the Reset button rebuilds the list from
// the canonical registry. On Save, the parent receives a normalized
// TileConfig with contiguous 0..N-1 orders.
//
// UI choices:
//   - Up/down arrow buttons, not drag handles. Mobile-reliable,
//     accessible by default (real <button>s), and the list is short
//     enough (~15 items) that arrow-tapping doesn't get tedious.
//   - First/last buttons get disabled rather than removed, so the
//     two columns of arrows always line up vertically — easier to
//     hit on touch screens.
//   - Hidden tiles get a "(hidden)" label and dimmed text so the
//     editor still shows their position in the canonical order, in
//     case the user wants to un-hide a tile they hid earlier.

import { useState } from "react";
import type { TileConfig } from "@/lib/types";
import {
  TILE_REGISTRY,
  effectiveTileOrder,
  tileConfigFromList,
  type EffectiveTile,
} from "@/lib/tile-registry";

interface Props {
  /** Current tileConfig from the user's preferences. */
  value: TileConfig | undefined;
  /** Called when the user clicks Save, with the new normalized
   *  TileConfig. The parent is responsible for persisting (server
   *  action for signed-in users, localStorage for guests). */
  onSave: (next: TileConfig) => void;
  /** Save in flight — disables buttons. */
  saving?: boolean;
  /** Optional save error to surface inline. */
  saveError?: string | null;
}

export default function TileLayoutEditor({ value, onSave, saving, saveError }: Props) {
  // Local working state — only flushed to the parent on Save. Letting
  // the user reorder + toggle without committing matches the rest of
  // the modal's pattern (changes apply when you tap a save button).
  const [items, setItems] = useState<EffectiveTile[]>(() =>
    effectiveTileOrder(value, TILE_REGISTRY),
  );
  const [dirty, setDirty] = useState(false);

  function move(idx: number, delta: -1 | 1) {
    const target = idx + delta;
    if (target < 0 || target >= items.length) return;
    const next = items.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    setItems(next);
    setDirty(true);
  }
  function toggleVisible(idx: number) {
    const next = items.slice();
    next[idx] = { ...next[idx], visible: !next[idx].visible };
    setItems(next);
    setDirty(true);
  }
  function reset() {
    setItems(effectiveTileOrder(undefined, TILE_REGISTRY));
    setDirty(true);
  }
  function save() {
    onSave(tileConfigFromList(items));
    setDirty(false);
  }

  const visibleCount = items.filter((t) => t.visible).length;

  return (
    <div>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        marginBottom: 8, gap: 12, flexWrap: "wrap",
      }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          {visibleCount} of {items.length} tiles visible.
          Use the arrows to reorder and the eye button to hide tiles you don&apos;t need.
        </div>
        <button
          type="button"
          onClick={reset}
          disabled={saving}
          style={resetBtn}
          title="Restore the default tile order and show all tiles"
        >
          Reset to default
        </button>
      </div>

      <ul style={listStyle}>
        {items.map((item, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === items.length - 1;
          return (
            <li key={item.entry.id} style={rowStyle(item.visible)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{
                  fontWeight: 600, fontSize: 14, color: "var(--text)",
                  opacity: item.visible ? 1 : 0.55,
                }}>
                  {item.entry.name}
                  {!item.visible && (
                    <span style={{
                      fontWeight: 400, fontSize: 11, color: "var(--text-faint)",
                      marginLeft: 8, letterSpacing: ".3px", textTransform: "uppercase",
                    }}>hidden</span>
                  )}
                </div>
                <div style={{
                  fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.4,
                  opacity: item.visible ? 1 : 0.55,
                }}>
                  {item.entry.description}
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => move(idx, -1)}
                  disabled={isFirst || saving}
                  aria-label={`Move ${item.entry.name} up`}
                  title="Move up"
                  style={arrowBtn(isFirst)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 14 12 8 18 14" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => move(idx, 1)}
                  disabled={isLast || saving}
                  aria-label={`Move ${item.entry.name} down`}
                  title="Move down"
                  style={arrowBtn(isLast)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 10 12 16 18 10" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => toggleVisible(idx)}
                  disabled={saving}
                  aria-label={`${item.visible ? "Hide" : "Show"} ${item.entry.name}`}
                  aria-pressed={!item.visible}
                  title={item.visible ? "Hide this tile" : "Show this tile"}
                  style={visBtn(item.visible)}
                >
                  {item.visible ? (
                    // open eye
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  ) : (
                    // crossed eye
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M17.94 17.94A10.06 10.06 0 0 1 12 19c-6 0-10-7-10-7a17.6 17.6 0 0 1 3.17-4.19" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6 0 10 7 10 7a17.66 17.66 0 0 1-2.16 3.07" />
                      <path d="M9 9a3 3 0 0 0 4.24 4.24" />
                      <line x1="2" y1="2" x2="22" y2="22" />
                    </svg>
                  )}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {saveError && (
        <div style={{
          padding: "8px 10px",
          marginTop: 10,
          background: "rgba(196, 68, 68, .08)",
          border: "1px solid rgba(196, 68, 68, .3)",
          borderRadius: 8,
          fontSize: 12, color: "#c44",
        }}>
          {saveError}
        </div>
      )}

      <div style={{ marginTop: 12, display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          style={saveBtn(dirty && !saving)}
        >
          {saving ? "Saving…" : dirty ? "Save layout" : "Saved"}
        </button>
      </div>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────

const listStyle: React.CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: 6,
};

function rowStyle(visible: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "10px 12px",
    background: "var(--bg-elev-2)",
    border: "1px solid var(--border-soft)",
    borderRadius: 10,
    opacity: visible ? 1 : 0.85,
  };
}

function arrowBtn(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32, height: 32,
    background: "var(--bg-elev)",
    color: "var(--text)",
    border: "1px solid var(--border-soft)",
    borderRadius: 8,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.35 : 1,
  };
}

function visBtn(visible: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32, height: 32,
    background: visible ? "var(--bg-elev)" : "rgba(196, 68, 68, .12)",
    color: visible ? "var(--text)" : "#c44",
    border: `1px solid ${visible ? "var(--border-soft)" : "rgba(196, 68, 68, .35)"}`,
    borderRadius: 8,
    cursor: "pointer",
  };
}

const resetBtn: React.CSSProperties = {
  background: "transparent",
  color: "var(--text-muted)",
  border: "1px solid var(--border-soft)",
  borderRadius: 8,
  padding: "6px 10px",
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

function saveBtn(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--accent)" : "var(--bg-elev-2)",
    color: active ? "#fff" : "var(--text-muted)",
    border: "1px solid " + (active ? "var(--accent)" : "var(--border-soft)"),
    borderRadius: 10,
    padding: "9px 16px",
    fontSize: 14,
    fontWeight: 600,
    cursor: active ? "pointer" : "default",
  };
}
