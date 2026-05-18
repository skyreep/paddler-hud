"use client";

// Tiny client wrapper so a server-rendered tile (RiversTile) can include
// the interactive "Edit" button + modal without itself becoming a client
// component. RiversTile renders <GaugeEditorTrigger initialGauges=... />
// inside its header; the button + modal live here.

import { useState } from "react";
import GaugeEditorModal from "./GaugeEditorModal";
import type { UserGauge } from "@/lib/types";

interface Props {
  /** Full DB rows for signed-in users, or null for guests. */
  initialGauges: UserGauge[] | null;
  /** Site IDs currently shown — used by the modal in guest read-only mode. */
  fallbackIds: string[];
}

export default function GaugeEditorTrigger({ initialGauges, fallbackIds }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit saved gauges"
        title={initialGauges === null ? "View / sign in to customize" : "Edit saved gauges"}
        style={triggerBtn}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        Edit
      </button>
      <GaugeEditorModal
        open={open}
        onClose={() => setOpen(false)}
        initialGauges={initialGauges}
        fallbackIds={fallbackIds}
      />
    </>
  );
}

const triggerBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  padding: "3px 8px",
  background: "var(--bg-elev-2)",
  border: "1px solid var(--border-soft)",
  borderRadius: 6,
  color: "var(--text-muted)",
  fontSize: 11, fontWeight: 600,
  fontFamily: "inherit", cursor: "pointer",
  lineHeight: 1,
};
