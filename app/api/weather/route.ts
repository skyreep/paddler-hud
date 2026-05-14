import { NextResponse } from "next/server";
import { fetchWeather } from "@/lib/nws";
import { getStation } from "@/lib/stations";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    try { return NextResponse.json(await fetchWeather(lat, lon)); }
    catch (e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 }); }
  }
  const s = getStation(searchParams.get("station"));
  try { return NextResponse.json(await fetchWeather(s.lat, s.lon)); }
  catch (e: unknown) { return NextResponse.json({ error: e instanceof Error ? e.message : "unknown" }, { status: 502 }); }
}
