// Beaufort scale lookup. Input is knots; output is force + name.

export interface BeaufortBand { force: number; name: string; maxKt: number }

const BANDS: BeaufortBand[] = [
  { force: 0, name: "Calm",            maxKt: 1 },
  { force: 1, name: "Light Air",       maxKt: 3 },
  { force: 2, name: "Light Breeze",    maxKt: 6 },
  { force: 3, name: "Gentle Breeze",   maxKt: 10 },
  { force: 4, name: "Moderate Breeze", maxKt: 16 },
  { force: 5, name: "Fresh Breeze",    maxKt: 21 },
  { force: 6, name: "Strong Breeze",   maxKt: 27 },
  { force: 7, name: "Near Gale",       maxKt: 33 },
  { force: 8, name: "Gale",            maxKt: 40 },
  { force: 9, name: "Strong Gale",     maxKt: 47 },
  { force: 10, name: "Storm",          maxKt: 55 },
  { force: 11, name: "Violent Storm",  maxKt: 63 },
  { force: 12, name: "Hurricane Force",maxKt: 999 },
];

export function beaufort(kt: number): BeaufortBand {
  for (const b of BANDS) if (kt <= b.maxKt) return b;
  return BANDS[BANDS.length - 1];
}

export function cardinal(deg: number): string {
  const dirs = ["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSW","SW","WSW","W","WNW","NW","NNW"];
  return dirs[Math.round(((deg % 360) / 22.5)) % 16];
}

export function mphToKt(mph: number) { return mph * 0.868976; }
export function ktToMph(kt: number)  { return kt / 0.868976; }
