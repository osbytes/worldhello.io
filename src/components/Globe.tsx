"use client";

import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line } from "@react-three/drei";
import * as THREE from "three";
import { GLOBE_RADIUS, latLngToVec3, arcPoints } from "@/lib/sphere";
import { globeDotScale } from "@/lib/globe-lod";
import { useGlobe } from "@/lib/queries";
import type { GlobePoint, GlobeArc, GlobeData } from "@/db/reads";

const PURPLE = "#a78bfa"; // people you brought (outgoing)
const BLUE = "#5b9dff"; // who brought you (incoming)

/** Faint wireframe lat/lng grid + a translucent shell. */
function Wireframe() {
  return (
    <group>
      <mesh>
        <sphereGeometry args={[GLOBE_RADIUS, 48, 48]} />
        <meshBasicMaterial color="#0e0e1a" transparent opacity={0.7} />
      </mesh>
      <lineSegments>
        <wireframeGeometry args={[new THREE.SphereGeometry(GLOBE_RADIUS + 0.002, 40, 26)]} />
        <lineBasicMaterial color="#8a8ad0" transparent opacity={0.12} />
      </lineSegments>
      {/* outer glow rim */}
      <mesh scale={1.02}>
        <sphereGeometry args={[GLOBE_RADIUS, 32, 32]} />
        <meshBasicMaterial color={PURPLE} transparent opacity={0.04} side={THREE.BackSide} />
      </mesh>
    </group>
  );
}

/** Ambient node dots (the rest of humanity). */
function Dots({ points }: { points: GlobePoint[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    points.forEach((p, i) => {
      dummy.position.copy(latLngToVec3(p.lat, p.lng, GLOBE_RADIUS + 0.004));
      dummy.scale.setScalar(globeDotScale(p));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [points, dummy]);

  if (!points.length) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, points.length]}>
      <sphereGeometry args={[0.009, 6, 6]} />
      <meshBasicMaterial color="#cfd2ff" transparent opacity={0.5} toneMapped={false} />
    </instancedMesh>
  );
}

/** Faint background arcs (ambient web). */
function AmbientArcs({ arcs }: { arcs: GlobeArc[] }) {
  const geo = useMemo(() => buildArcGeometry(arcs, 28), [arcs]);
  if (!arcs.length) return null;
  return (
    <lineSegments geometry={geo}>
      <lineBasicMaterial color="#ffffff" transparent opacity={0.06} toneMapped={false} />
    </lineSegments>
  );
}

/** A single glowing, animated draw-on arc (your lineage / your spread). */
function HeroArc({ arc, color }: { arc: GlobeArc; color: string }) {
  const points = useMemo(
    () => arcPoints(arc.sy, arc.sx, arc.ey, arc.ex, 64).map((p) => [p.x, p.y, p.z] as [number, number, number]),
    [arc],
  );
  const ref = useRef<{ material: THREE.ShaderMaterial & { uniforms: Record<string, { value: number }> } }>(null);

  // travelling highlight along the arc via dashed offset
  useFrame((s) => {
    const m = ref.current?.material as unknown as { dashOffset?: number };
    if (m && "dashOffset" in m) m.dashOffset = -((s.clock.elapsedTime * 0.25) % 1);
  });

  return (
    <Line
      ref={ref as never}
      points={points}
      color={color}
      lineWidth={2}
      transparent
      opacity={0.95}
      dashed
      dashSize={0.5}
      gapSize={0.18}
      toneMapped={false}
    />
  );
}

/** Glowing marker at an account device. Primary = this browser's device. */
function YouPulse({ lat, lng, primary = false }: { lat: number; lng: number; primary?: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => latLngToVec3(lat, lng, GLOBE_RADIUS + 0.01), [lat, lng]);
  useFrame((s) => {
    if (ref.current) {
      const k = 1 + Math.sin(s.clock.elapsedTime * 2.5) * (primary ? 0.25 : 0.12);
      ref.current.scale.setScalar(k);
    }
  });
  const core = primary ? "#ffffff" : BLUE;
  const glow = primary ? PURPLE : BLUE;
  return (
    <group position={pos}>
      <mesh ref={ref}>
        <sphereGeometry args={[primary ? 0.03 : 0.022, 16, 16]} />
        <meshBasicMaterial color={core} toneMapped={false} />
      </mesh>
      <mesh scale={primary ? 2.2 : 1.6}>
        <sphereGeometry args={[primary ? 0.03 : 0.022, 16, 16]} />
        <meshBasicMaterial color={glow} transparent opacity={primary ? 0.25 : 0.18} toneMapped={false} />
      </mesh>
    </group>
  );
}

function Scene({
  data,
  you,
  devices,
  incoming,
  outgoing,
}: {
  data: GlobeData;
  you?: { lat: number; lng: number } | null;
  devices?: { lat: number; lng: number }[];
  incoming?: GlobeArc[];
  outgoing?: GlobeArc[];
}) {
  const markers = devices?.length ? devices : you ? [you] : [];
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.03;
  });
  return (
    <group ref={group}>
      <Wireframe />
      <Dots points={data.points} />
      <AmbientArcs arcs={data.arcs} />
      {(incoming ?? []).map((a, i) => (
        <HeroArc key={`in-${i}`} arc={a} color={BLUE} />
      ))}
      {(outgoing ?? []).map((a, i) => (
        <HeroArc key={`out-${i}`} arc={a} color={PURPLE} />
      ))}
      {markers.map((d, i) => (
        <YouPulse
          key={`dev-${i}`}
          lat={d.lat}
          lng={d.lng}
          primary={!!you && d.lat === you.lat && d.lng === you.lng}
        />
      ))}
    </group>
  );
}

export default function Globe({
  you,
  devices,
  incoming,
  outgoing,
}: {
  you?: { lat: number; lng: number } | null;
  devices?: { lat: number; lng: number }[];
  incoming?: GlobeArc[];
  outgoing?: GlobeArc[];
}) {
  const { data } = useGlobe();
  const scene: GlobeData = data ?? { mode: "raw", points: [], arcs: [], total: 0 };

  return (
    <Canvas camera={{ position: [0, 0, 5.6], fov: 42 }} dpr={[1, 2]} className="!absolute inset-0">
      <ambientLight intensity={0.8} />
      <Scene data={scene} you={you} devices={devices} incoming={incoming} outgoing={outgoing} />
      <OrbitControls
        enablePan={false}
        enableZoom={false}
        autoRotate={false}
        rotateSpeed={0.5}
        minPolarAngle={Math.PI * 0.2}
        maxPolarAngle={Math.PI * 0.8}
      />
    </Canvas>
  );
}

// ── helpers ──
function buildArcGeometry(arcs: GlobeArc[], segments: number): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const a of arcs) {
    const pts = arcPoints(a.sy, a.sx, a.ey, a.ex, segments);
    for (let i = 0; i < pts.length - 1; i++) {
      positions.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return g;
}
