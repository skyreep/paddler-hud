import { NextResponse } from "next/server";
import { computeAstro } from "@/lib/astro";
import { getStation } from "@/lib/stations";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const lat = Number(searchParams.get("lat"));
  const lon = Number(searchParams.get("lon"));
  const station = getStation(searchParams.get("station"));
  const finalLat = Number.isFinite(lat) ? lat : station.lat;
  const finalLon = Number.isFinite(lon) ? lon : station.lon;
  return NextResponse.json(computeAstro(finalLat, finalLon));
}
