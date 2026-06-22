/**
 * Coarse geo. DESIGN §4: city-level from request headers, jittered. Never prompts.
 * On Vercel, geo comes from request headers (x-vercel-ip-*). Locally we fall back
 * to a random point, so the globe still renders in dev.
 */

export type Geo = {
  country: string | null;
  lat: number | null;
  lng: number | null;
  precise: boolean;
};

// Deterministic-ish jitter so the same city doesn't stack one pixel.
function jitter(v: number, km = 8): number {
  const deg = km / 111; // ~111 km per degree
  return v + (Math.random() - 0.5) * 2 * deg;
}

export function geoFromHeaders(h: Headers): Geo {
  const country = h.get("x-vercel-ip-country");
  const latRaw = h.get("x-vercel-ip-latitude");
  const lngRaw = h.get("x-vercel-ip-longitude");

  if (latRaw && lngRaw) {
    return {
      country: country ?? null,
      lat: jitter(parseFloat(latRaw)),
      lng: jitter(parseFloat(lngRaw)),
      precise: false,
    };
  }

  // Dev / unknown — random land-ish point so the globe isn't empty.
  return {
    country: country ?? null,
    lat: jitter((Math.random() - 0.5) * 140, 0),
    lng: jitter((Math.random() - 0.5) * 360, 0),
    precise: false,
  };
}

/** Best-effort client IP for rate-limiting/risk (never used as identity). */
export function clientIp(h: Headers): string {
  return (
    h.get("x-forwarded-for")?.split(",")[0].trim() ||
    h.get("x-real-ip") ||
    "0.0.0.0"
  );
}
