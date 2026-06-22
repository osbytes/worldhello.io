import * as THREE from "three";

export const GLOBE_RADIUS = 1.6;

/** lat/lng (deg) → point on sphere. */
export function latLngToVec3(lat: number, lng: number, radius = GLOBE_RADIUS): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

/** Great-circle arc points between two lat/lng, bowed above the surface. */
export function arcPoints(
  sLat: number, sLng: number, eLat: number, eLng: number, segments = 40,
): THREE.Vector3[] {
  const start = latLngToVec3(sLat, sLng);
  const end = latLngToVec3(eLat, eLng);
  const dist = start.distanceTo(end);
  // Bow height grows with arc length but is clamped so long arcs hug the sphere
  // instead of flying far past its silhouette (and getting clipped by the canvas).
  const lift = GLOBE_RADIUS + Math.min(dist * 0.22, GLOBE_RADIUS * 0.35);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const p = new THREE.Vector3().lerpVectors(start, end, t).normalize();
    const altitude = GLOBE_RADIUS + Math.sin(Math.PI * t) * (lift - GLOBE_RADIUS);
    pts.push(p.multiplyScalar(altitude));
  }
  return pts;
}
