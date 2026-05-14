import { NextResponse } from "next/server";
import { fetchBuoy } from "@/lib/ndbc";
import { fetchMarine } from "@/lib/open-meteo";
import { getStation } from "@/lib/stations";

// Marine conditions endpoint. Prefers Open-Meteo Marine (modelled, always
// available); falls back to NDBC buoy data if the user explicitly requests
// it via ?source=ndbc (handy when a station has a working wave sensor).
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const station = getStation(searchParams.get("station"));
  const wantNdbc = searchParams.get("source") === "ndbc";
  try {
    if (wantNdbc) {
      const buoyId = searchParams.get("id") ?? station.buoyId;
      return NextResponse.json(await fetchBuoy(buoyId));
    }
    return NextResponse.json(await fetchMarine(station.lat, station.lon));
  } catch (e: unknown) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown" },
      { status: 502 }
    );
  }
}
