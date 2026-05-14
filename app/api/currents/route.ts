import { NextResponse } from "next/server";
import { fetchCurrents } from "@/lib/noaa-coops";
import { getStation } from "@/lib/stations";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const stationId = searchParams.get("id") ?? getStation(searchParams.get("station")).currentStationId;
  if (!stationId) return NextResponse.json({ error: "no current station for this location" }, { status: 404 });
  try {
    return NextResponse.json(await fetchCurrents(stationId));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
