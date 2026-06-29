/** Globe LOD thresholds and bin sizing (DESIGN §3). */

/** Below this count, return individual node points (capped). Above, return density bins. */
export const GLOBE_RAW_NODE_THRESHOLD = 5_000;

export const GLOBE_RAW_POINT_LIMIT = 2_000;
export const GLOBE_BIN_LIMIT = 2_000;
export const GLOBE_ARC_LIMIT = 300;

/** Lat/lng grid step (degrees) — coarser as the dataset grows. */
export function binDegreesForNodeCount(total: number): { binLat: number; binLng: number } {
  if (total > 100_000) return { binLat: 10, binLng: 15 };
  if (total > 50_000) return { binLat: 8, binLng: 12 };
  if (total > 20_000) return { binLat: 6, binLng: 9 };
  return { binLat: 4, binLng: 6 };
}

/** Instanced dot scale from a raw point or density bin. */
export function globeDotScale(p: { v: 0 | 1; n?: number }): number {
  if (p.n != null && p.n > 1) {
    return Math.min(1 + Math.log2(p.n) * 0.35, 3.2);
  }
  return p.v ? 1.6 : 1;
}
