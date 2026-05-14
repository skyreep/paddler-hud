import { NextResponse } from "next/server";
import { fetchTropical } from "@/lib/nhc";
import { getStation } from "@/lib/stations";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const s = getStation(searchParams.get("station"));
  const finalLat = Number.isFinite(lat) ? lat : s.lat;
  const finalLon = Number.isFinite(lon) ? lon : s.lon;
  try {
    return NextResponse.json(await fetchTropical(finalLat, finalLon));
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 502 }
    );
  }
}
