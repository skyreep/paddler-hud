// Shared result shape for gauge server actions. Lives in its own file
// because app/gauges/actions.ts has the "use server" directive — files
// with that directive can only export async functions, so interfaces
// have to be hosted elsewhere.

import type { UserGauge } from "@/lib/types";

export interface GaugeActionResult {
  ok: boolean;
  /** Refreshed list of the user's saved gauges, sorted by sort_order.
   *  Returned on every successful action so the client can sync local
   *  state without a separate fetch. */
  gauges?: UserGauge[];
  error?: string;
}
