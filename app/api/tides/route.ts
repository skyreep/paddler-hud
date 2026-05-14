import { NextResponse } from "next/server";
import { fetchTides } from "@/lib/noaa-coops";
import { getStation } from "@/lib/stations";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const stationKey = searchParams.get("station");
  const explicitId = searchParams.get("id");
  const stationId = explicitId ?? getStation(stationKey).tideStationId;
  try {
    const data = await fetchTides(stationId);
    return NextResponse.json(data);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 });
  }
}
