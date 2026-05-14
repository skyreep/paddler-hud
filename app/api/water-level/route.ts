import { NextResponse } from "next/server";
import { fetchWaterLevel } from "@/lib/noaa-coops";
import { getStation } from "@/lib/stations";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const stationId = searchParams.get("id") ?? getStation(searchParams.get("station")).tideStationId;
  try {
    return NextResponse.json(await fetchWaterLevel(stationId));
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
