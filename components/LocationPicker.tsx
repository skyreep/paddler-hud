"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { STATIONS, DEFAULT_STATION_KEY } from "@/lib/stations";

interface Props {
  open: boolean;
  onClose: () => void;
  activeKey: string;
}

function urlForStation(key: string, baseParams: URLSearchParams): string {
  const params = new URLSearchParams(baseParams);
  if (key === DEFAULT_STATION_KEY) params.delete("station");
  else params.set("station", key);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export default function LocationPicker({ open, onClose, activeKey }: Props) {
  const router = useRouter();
  const search = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  // Prefetch every location the moment the picker opens, so a tap fires a
  // cached navigation instead of a cold render. This is the single biggest
  // perceived-responsiveness win: by the time the user picks, the destination
  // is usually already rendered.
  useEffect(() => {
    if (!open) return;
    const base = new URLSearchParams(search?.toString() ?? "");
    for (const key of Object.keys(STATIONS)) {
      router.prefetch(urlForStation(key, base));
    }
  }, [open, router, search]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Prevent body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  function selectStation(key: string) {
    if (key === activeKey) { onClose(); return; }
    const url = urlForStation(key, new URLSearchParams(search?.toString() ?? ""));
    setPendingKey(key);
    // Wrap in a transition so React knows this is non-urgent state work —
    // gives us isPending for a visual loading indicator and keeps the click
    // responsive instead of blocking the UI thread during navigation.
    startTransition(() => {
      router.push(url);
    });
    // Close the sheet immediately for snappy feel — even though page data
    // is still streaming in, the user sees the picker dismiss.
    onClose();
  }

  if (!open && !isPending) return null;
  if (!open) {
    // Picker closed but navigation still in flight — render a thin progress
    // bar at the very top so the user knows something is happening.
    return (
      <div
        aria-live="polite"
        style={{
          position: "fixed", top: 0, left: 0, right: 0, height: 3, zIndex: 10001,
          background: "var(--accent)",
          opacity: 0.85,
          animation: "phud-pending-bar 1.2s ease-in-out infinite",
        }}
      >
        <style>{`@keyframes phud-pending-bar {
          0% { transform: scaleX(0); transform-origin: left; }
          50% { transform: scaleX(1); transform-origin: left; }
          51% { transform: scaleX(1); transform-origin: right; }
          100% { transform: scaleX(0); transform-origin: right; }
        }`}</style>
      </div>
    );
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 10000,
        background: "rgba(7,17,26,.55)",
        backdropFilter: "blur(4px)",
        WebkitBackdropFilter: "blur(4px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-elev)",
          width: "100%", maxWidth: 520, maxHeight: "88vh",
          borderRadius: "22px 22px 0 0",
          padding: 18,
          paddingBottom: "calc(18px + env(safe-area-inset-bottom))",
          overflowY: "auto",
          animation: "phud-slideup .25s ease",
        }}
      >
        <div style={{
          width: 40, height: 4, background: "var(--border)",
          borderRadius: 2, margin: "0 auto 14px",
        }} />

        <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Your Locations</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              marginLeft: "auto",
              width: 32, height: 32,
              background: "var(--bg-elev-2)",
              border: "1px solid var(--border-soft)",
              borderRadius: "50%",
              display: "grid", placeItems: "center",
              color: "var(--text)", cursor: "pointer", fontSize: 14,
            }}
          >✕</button>
        </div>

        <p style={{ color: "var(--text-muted)", fontSize: 13, margin: "0 0 14px" }}>
          Tap to switch the HUD to a saved spot.
        </p>

        {Object.values(STATIONS).map((s) => {
          const selected = s.key === activeKey;
          const loading = pendingKey === s.key && isPending;
          return (
            <button
              key={s.key}
              onClick={() => selectStation(s.key)}
              disabled={isPending}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: 12, marginBottom: 6, width: "100%",
                background: selected || loading ? "var(--accent-soft)" : "var(--bg-elev-2)",
                borderRadius: 10,
                border: `1px solid ${selected || loading ? "var(--accent)" : "var(--border-soft)"}`,
                textAlign: "left", cursor: isPending ? "wait" : "pointer",
                color: "var(--text)",
                fontFamily: "inherit", fontSize: 14,
                opacity: isPending && !loading ? 0.5 : 1,
              }}
            >
              <div style={{
                width: 20, height: 20, borderRadius: "50%",
                background: selected ? "var(--accent)" : "transparent",
                border: `2px solid ${selected ? "var(--accent)" : "var(--border)"}`,
                flexShrink: 0, position: "relative",
              }}>
                {selected && (
                  <span style={{
                    color: "white", fontSize: 12, fontWeight: 700,
                    position: "absolute", inset: 0,
                    display: "grid", placeItems: "center",
                  }}>✓</span>
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {s.displayName}{s.key === DEFAULT_STATION_KEY && " · Primary"}
                </div>
                <div style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 2 }}>
                  Tide {s.tideStationId} · Buoy {s.buoyId} · {s.nwsZone}
                </div>
              </div>
            </button>
          );
        })}

        <div style={{
          marginTop: 10, padding: "10px 12px",
          background: "transparent",
          border: "1px dashed var(--border)",
          color: "var(--text-muted)",
          borderRadius: 12, fontSize: 12, textAlign: "center",
        }}>
          Custom locations and reordering arrive with the account feature.
        </div>

        <style>{`@keyframes phud-slideup { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }`}</style>
      </div>
    </div>
  );
}
