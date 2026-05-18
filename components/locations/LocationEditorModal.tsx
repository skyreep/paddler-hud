"use client";

// Editor modal for the user's saved paddling locations.
// Mirrors the gauge editor in shape:
//   - List of saved locations (signed-in users) OR read-only fallback (guests)
//   - Per-row: rename, set-primary, up/down reorder, remove
//   - "Add new" button opens the AddLocationWizard
//
// Cap is 6 (mirrored in the user_locations_limit DB trigger).
//
// Like the other modals, portal'd to document.body so the topbar's
// backdrop-filter doesn't clip the overlay.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import AddLocationWizard from "./AddLocationWizard";
import EditLocationSourcesModal from "./EditLocationSourcesModal";
import {
  removeLocation,
  reorderLocations,
  setPrimary,
  updateLocationName,
} from "@/app/locations/actions";
import type { LocationActionResult } from "@/lib/location-action-result";
import type { ResolvedLocation, UserLocation } from "@/lib/types";

const MAX_LOCATIONS = 6;

interface Props {
  open: boolean;
  onClose: () => void;
  /** Server-resolved user_locations rows. Null for guests — modal renders
   *  read-only with a "Sign in to customize" notice and shows the
   *  hardcoded STATIONS list (projected as ResolvedLocation) instead. */
  initialLocations: UserLocation[] | null;
  /** What the LocationPicker is currently rendering, projected to
   *  ResolvedLocation. Used for the guest read-only view. */
  fallbackLocations: ResolvedLocation[];
  /** The location key currently being viewed on the HUD. Drives the
   *  cyan row highlight so users opening the editor see "the one I'm
   *  looking at" instead of a generic primary highlight. For signed-in
   *  users this is a UserLocation UUID; for guests it's a slug from
   *  the hardcoded STATIONS list. */
  activeKey: string;
}

export default function LocationEditorModal({
  open, onClose, initialLocations, fallbackLocations, activeKey,
}: Props) {
  const router = useRouter();
  const [locations, setLocations] = useState<UserLocation[]>(initialLocations ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingSourcesFor, setEditingSourcesFor] = useState<UserLocation | null>(null);

  const isGuest = initialLocations === null;

  // Sync local state when parent re-supplies (after router.refresh()).
  useEffect(() => {
    if (initialLocations) setLocations(initialLocations);
  }, [initialLocations]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    if (open) return;
    setError(null);
    setEditingId(null);
    setEditingName("");
    setWizardOpen(false);
    setEditingSourcesFor(null);
    setBusy(false);
  }, [open]);

  function applyResult(result: LocationActionResult): boolean {
    if (!result.ok) {
      setError(result.error ?? "Something went wrong.");
      return false;
    }
    setError(null);
    if (result.locations) setLocations(result.locations);
    router.refresh();
    return true;
  }

  async function runAction(label: string, fn: () => Promise<LocationActionResult>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      const result = await fn();
      return applyResult(result);
    } catch (err) {
      console.error(`[locations] ${label} threw:`, err);
      setError(err instanceof Error ? err.message : `${label} failed unexpectedly.`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id: string) {
    await runAction("removeLocation", () => removeLocation(id));
  }
  async function handleSetPrimary(id: string) {
    await runAction("setPrimary", () => setPrimary(id));
  }
  async function handleMove(id: string, direction: -1 | 1) {
    const idx = locations.findIndex((l) => l.id === id);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= locations.length) return;
    const swapped = [...locations];
    [swapped[idx], swapped[newIdx]] = [swapped[newIdx], swapped[idx]];
    const previous = locations;
    setLocations(swapped);
    const ok = await runAction("reorderLocations", () =>
      reorderLocations(swapped.map((l) => l.id)),
    );
    if (!ok) setLocations(previous);
  }

  function startEditName(l: UserLocation) {
    setEditingId(l.id);
    setEditingName(l.displayName);
    setError(null);
  }
  async function saveEditName() {
    if (editingId == null) return;
    const id = editingId;
    const name = editingName;
    setEditingId(null);
    setEditingName("");
    await runAction("updateLocationName", () => updateLocationName(id, name));
  }
  function cancelEditName() {
    setEditingId(null);
    setEditingName("");
  }

  if (!open) return null;
  if (typeof document === "undefined") return null;

  const countLabel = isGuest
    ? `${fallbackLocations.length} default locations`
    : `${locations.length} of ${MAX_LOCATIONS} saved`;

  return createPortal(
    <>
      <div onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="locations-title" style={overlay}>
        <div onClick={(e) => e.stopPropagation()} style={sheet}>
          <div style={dragHandle} />

          <div style={{ display: "flex", alignItems: "center", marginBottom: 12 }}>
            <div>
              <h2 id="locations-title" style={{ margin: 0, fontSize: 18 }}>Locations</h2>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                {countLabel}
              </div>
            </div>
            <button onClick={onClose} aria-label="Close" style={closeBtn}>✕</button>
          </div>

          {isGuest && (
            <div style={notice}>
              Showing the default Lowcountry locations.
              <span style={{ color: "var(--text-muted)" }}>{" "}Sign in to customize your list.</span>
            </div>
          )}

          {error && (
            <div style={{ ...notice, borderColor: "#c44", color: "#c44" }}>
              {error}
            </div>
          )}

          <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
            {(isGuest ? fallbackLocations.map(fakeRow) : locations).map((l, idx, arr) => (
              <LocationRow
                key={l.id}
                location={l}
                isFirst={idx === 0}
                isLast={idx === arr.length - 1}
                isActive={l.id === activeKey}
                readOnly={isGuest}
                busy={busy}
                isEditingName={editingId === l.id}
                editingName={editingId === l.id ? editingName : ""}
                onEditNameChange={setEditingName}
                onStartEditName={() => startEditName(l)}
                onSaveEditName={saveEditName}
                onCancelEditName={cancelEditName}
                onMoveUp={() => handleMove(l.id, -1)}
                onMoveDown={() => handleMove(l.id, 1)}
                onSetPrimary={() => handleSetPrimary(l.id)}
                onEditSources={() => setEditingSourcesFor(l)}
                onRemove={() => handleRemove(l.id)}
                canRemove={!isGuest && locations.length > 1}
              />
            ))}
          </div>

          {!isGuest && locations.length < MAX_LOCATIONS && (
            <button type="button" onClick={() => setWizardOpen(true)} disabled={busy} style={primaryBtn}>
              + Add a new location
            </button>
          )}

          {!isGuest && locations.length >= MAX_LOCATIONS && (
            <div style={{ ...notice, color: "var(--text-muted)" }}>
              You&apos;ve hit the {MAX_LOCATIONS}-location cap. Remove one to add another.
            </div>
          )}
        </div>
      </div>

      <AddLocationWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onSaved={() => {
          // The parent's useEffect (initialLocations sync) catches the new
          // row once router.refresh() flows through. Nothing else to do.
        }}
      />

      <EditLocationSourcesModal
        open={editingSourcesFor !== null}
        onClose={() => setEditingSourcesFor(null)}
        location={editingSourcesFor}
      />
    </>,
    document.body,
  );
}

// ─── Row component ────────────────────────────────────────────────────────

interface RowProps {
  location: UserLocation;
  isFirst: boolean;
  isLast: boolean;
  /** Currently rendered on the HUD — drives the cyan row highlight.
   *  Distinct from isPrimary (Primary = URL default, Active = currently
   *  viewed). A row can be active and not primary, or vice versa. */
  isActive: boolean;
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
  onSetPrimary: () => void;
  onEditSources: () => void;
  onRemove: () => void;
  /** Disables the remove button on the last remaining row so users
   *  can't end up with zero locations. */
  canRemove: boolean;
}
function LocationRow({
  location, isFirst, isLast, isActive, readOnly, busy,
  isEditingName, editingName, onEditNameChange,
  onStartEditName, onSaveEditName, onCancelEditName,
  onMoveUp, onMoveDown, onSetPrimary, onEditSources, onRemove, canRemove,
}: RowProps) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: readOnly ? "1fr" : "auto 1fr auto",
      gap: 8, alignItems: "center",
      padding: "10px 12px",
      background: isActive ? "var(--accent-soft)" : "var(--bg-elev-2)",
      border: `1px solid ${isActive ? "var(--accent)" : "var(--border-soft)"}`,
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
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {location.displayName}
              {location.isPrimary && (
                <span style={primaryBadge}>Primary</span>
              )}
            </div>
            <div className="num" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              {location.lat.toFixed(3)}, {location.lon.toFixed(3)} · Tide {location.tideStationId}
              {location.buoyId && <> · Buoy {location.buoyId}</>}
            </div>
          </>
        )}
      </div>

      {!readOnly && !isEditingName && (
        <div style={{ display: "flex", gap: 4 }}>
          {!location.isPrimary && (
            <button
              type="button"
              onClick={onSetPrimary}
              disabled={busy}
              style={miniBtn}
              title="Set as primary"
            >★</button>
          )}
          <button type="button" onClick={onStartEditName} disabled={busy} style={miniBtn} title="Rename">✎</button>
          <button
            type="button"
            onClick={onEditSources}
            disabled={busy}
            style={miniBtn}
            title="Change data sources (tide / observation / buoy / marine zone)"
          >⚙</button>
          <button
            type="button"
            onClick={onRemove}
            disabled={busy || !canRemove}
            style={{ ...miniBtn, color: canRemove ? "#c44" : "var(--text-faint)" }}
            title={canRemove ? "Remove" : "Can't remove your last location"}
          >✕</button>
        </div>
      )}
    </div>
  );
}

/** Project a ResolvedLocation (from STATIONS, for guests) into a
 *  UserLocation-shaped object so the row component can render it. */
function fakeRow(loc: ResolvedLocation): UserLocation {
  return {
    id: loc.key,
    displayName: loc.displayName,
    lat: loc.lat,
    lon: loc.lon,
    tideStationId: loc.tideStationId,
    tideStationNote: loc.tideStationNote ?? null,
    observationStationId: loc.observationStationId,
    windStations: loc.windStations ?? [],
    buoyId: loc.buoyId,
    nwsZone: loc.nwsZone,
    marineZone: loc.marineZone,
    sortOrder: 0,
    isPrimary: loc.isPrimary,
    createdAt: "",
  };
}

// ─── Styles ──────────────────────────────────────────────────────────────

const overlay: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 10000,
  background: "rgba(7,17,26,.55)",
  backdropFilter: "blur(4px)",
  WebkitBackdropFilter: "blur(4px)",
  display: "flex", alignItems: "flex-end", justifyContent: "center",
};
const sheet: React.CSSProperties = {
  background: "var(--bg-elev)",
  width: "100%", maxWidth: 520, maxHeight: "88vh",
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
  display: "block", width: "100%", padding: "12px 16px",
  background: "var(--accent)", color: "white",
  border: "none", borderRadius: 10,
  fontSize: 14, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
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
const primaryBadge: React.CSSProperties = {
  fontSize: 10, fontWeight: 700,
  letterSpacing: ".4px", textTransform: "uppercase",
  background: "var(--accent)", color: "white",
  padding: "2px 6px", borderRadius: 4,
};
function arrowBtn(disabled: boolean): React.CSSProperties {
  return {
    width: 22, height: 22, padding: 0,
    background: "transparent",
    color: disabled ? "var(--text-faint)" : "var(--text-muted)",
    border: "1px solid var(--border-soft)",
    borderRadius: 4,
    fontSize: 9, lineHeight: 1,
    fontFamily: "inherit",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
