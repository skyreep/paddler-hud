import { NextResponse } from "next/server";
import { fetchAlerts } from "@/lib/nws";
import { getStation } from "@/lib/stations";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const zones = searchParams.get("zones");
  let zoneList: string[];
  if (zones) {
    zoneList = zones.split(",").map(z => z.trim()).filter(Boolean);
  } else {
    const s = getStation(searchParams.get("station"));
    zoneList = [s.nwsZone, s.marineZone];
  }
  try { return NextResponse.json(await fetchAlerts(zoneList)); }
  catch (e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 }); }
}
