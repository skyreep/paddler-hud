import { NextResponse } from "next/server";
import { fetchRiverGauge } from "@/lib/usgs";

// Comma-separated list of USGS site IDs, or a single id.
//   /api/rivers?ids=02198840,02202500,02226000
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const idsParam = searchParams.get("ids") ?? searchParams.get("id");
  if (!idsParam) return NextResponse.json({ error: "missing ids" }, { status: 400 });
  const ids = idsParam.split(",").map(s => s.trim()).filter(Boolean).slice(0, 5);
  try {
    const gauges = await Promise.all(ids.map(id => fetchRiverGauge(id).catch(err => ({ siteId: id, error: String(err) }))));
    return NextResponse.json({ gauges, fetchedAt: new Date().toISOString() });
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
