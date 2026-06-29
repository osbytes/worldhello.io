/** Read-side queries: leaderboard, globe points, referrer card. DESIGN §5/§3. */
import { sql } from "drizzle-orm";
import { db } from "./index";
import { metricsForNode, rankForNodeId, globeOverlayForNode } from "./graph";
import {
  GLOBE_RAW_NODE_THRESHOLD,
  GLOBE_RAW_POINT_LIMIT,
  GLOBE_BIN_LIMIT,
  GLOBE_ARC_LIMIT,
  binDegreesForNodeCount,
} from "@/lib/globe-lod";

export type LeaderRow = {
  code: string;
  reach: number;
  maxDepth: number;
  countries: number;
  verified: boolean;
  country: string | null;
};

/** Top-N by reach. Reads cached_metrics (indexed). Human nodes only. */
export async function leaderboard(limit = 20): Promise<LeaderRow[]> {
  const r = (await db.execute(sql`
    SELECT n.code, m.reach, m.max_depth AS "maxDepth", m.countries, n.verified, n.country
    FROM cached_metrics m
    JOIN nodes n ON n.id = m.node_id
    WHERE n.class = 'human'
    ORDER BY m.reach DESC, n.verified DESC
    LIMIT ${limit};
  `)) as unknown as { rows: LeaderRow[] };
  return r.rows ?? [];
}

/** A referrer's public card (the hook on ?ref landing). */
export async function referrerCard(code: string) {
  const r = (await db.execute(sql`
    SELECT n.code, n.country, n.lat, n.lng, n.verified,
           COALESCE(m.reach,0) AS reach,
           COALESCE(m.max_depth,0) AS "maxDepth",
           COALESCE(m.countries,0) AS countries
    FROM nodes n LEFT JOIN cached_metrics m ON m.node_id = n.id
    WHERE n.code = ${code} AND n.class = 'human'
    LIMIT 1;
  `)) as unknown as {
    rows: {
      code: string;
      country: string | null;
      lat: number | null;
      lng: number | null;
      verified: boolean;
      reach: number;
      maxDepth: number;
      countries: number;
    }[];
  };
  return r.rows?.[0] ?? null;
}

export type GlobePoint = { lat: number; lng: number; v: 0 | 1; n?: number };
export type GlobeArc = { sx: number; sy: number; ex: number; ey: number };

export type GlobeData = {
  mode: "raw" | "binned";
  points: GlobePoint[];
  arcs: GlobeArc[];
  total: number;
};

async function humanGlobeNodeCount(): Promise<number> {
  const r = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM nodes
    WHERE class = 'human' AND ephemeral = false AND lat IS NOT NULL;
  `)) as unknown as { rows: { n: number }[] };
  return Number(r.rows?.[0]?.n ?? 0);
}

async function globeDataArcs(): Promise<GlobeArc[]> {
  const arcs = (await db.execute(sql`
    SELECT c.lat AS sy, c.lng AS sx, p.lat AS ey, p.lng AS ex
    FROM nodes c JOIN nodes p ON p.id = c.referrer_id
    WHERE c.class = 'human' AND c.lat IS NOT NULL AND p.lat IS NOT NULL
    ORDER BY c.created_at DESC
    LIMIT ${GLOBE_ARC_LIMIT};
  `)) as unknown as { rows: GlobeArc[] };

  return (arcs.rows ?? []).map((a) => ({
    sx: Number(a.sx),
    sy: Number(a.sy),
    ex: Number(a.ex),
    ey: Number(a.ey),
  }));
}

/** Individual node positions — used below GLOBE_RAW_NODE_THRESHOLD. */
async function globeDataRaw(limit: number): Promise<GlobePoint[]> {
  const pts = (await db.execute(sql`
    SELECT lat, lng, (verified)::int AS v
    FROM nodes
    WHERE class = 'human' AND ephemeral = false AND lat IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ${limit};
  `)) as unknown as { rows: GlobePoint[] };

  return (pts.rows ?? []).map((p) => ({
    lat: Number(p.lat),
    lng: Number(p.lng),
    v: (p.v ? 1 : 0) as 0 | 1,
  }));
}

/**
 * Lat/lng grid density bins — used at scale instead of shipping millions of points.
 * Each point is a bin centroid; `n` is the node count in that cell.
 */
async function globeDataBinned(limit: number, total: number): Promise<GlobePoint[]> {
  const { binLat, binLng } = binDegreesForNodeCount(total);

  const pts = (await db.execute(sql`
    SELECT
      AVG(lat)::float8 AS lat,
      AVG(lng)::float8 AS lng,
      COUNT(*)::int AS n,
      MAX(CASE WHEN verified THEN 1 ELSE 0 END)::int AS v
    FROM nodes
    WHERE class = 'human' AND ephemeral = false AND lat IS NOT NULL
    GROUP BY FLOOR(lat / ${binLat}), FLOOR(lng / ${binLng})
    ORDER BY n DESC
    LIMIT ${limit};
  `)) as unknown as { rows: { lat: number; lng: number; n: number; v: number }[] };

  return (pts.rows ?? []).map((p) => ({
    lat: Number(p.lat),
    lng: Number(p.lng),
    v: (p.v ? 1 : 0) as 0 | 1,
    n: Number(p.n),
  }));
}

/**
 * Globe payload. DESIGN §3 LOD: raw human points below threshold; binned density
 * tiles above. Arcs are always a sampled stream of recent joins.
 */
export async function globeData(): Promise<GlobeData> {
  const [total, arcs] = await Promise.all([humanGlobeNodeCount(), globeDataArcs()]);

  if (total <= GLOBE_RAW_NODE_THRESHOLD) {
    const points = await globeDataRaw(GLOBE_RAW_POINT_LIMIT);
    return { mode: "raw", points, arcs, total };
  }

  const points = await globeDataBinned(GLOBE_BIN_LIMIT, total);
  return { mode: "binned", points, arcs, total };
}

/**
 * Per-device detail for the dashboard + globe overlay: your position, the arc
 * that reached you (incoming, blue), arcs to people you brought (outgoing, purple).
 */
export async function meDetail(code: string): Promise<{
  you: { lat: number; lng: number } | null;
  incoming: GlobeArc[];
  outgoing: GlobeArc[];
  referrer: { lat: number | null; lng: number | null } | null;
} | null> {
  const meR = (await db.execute(sql`
    SELECT id, referrer_id AS "referrerId", lat, lng FROM nodes WHERE code = ${code} LIMIT 1;
  `)) as unknown as { rows: { id: number; referrerId: number | null; lat: number | null; lng: number | null }[] };
  const me = meR.rows?.[0];
  if (!me) return null;

  const you = me.lat != null && me.lng != null ? { lat: me.lat, lng: me.lng } : null;

  // Incoming: parent → you (blue).
  let incoming: GlobeArc[] = [];
  let referrer: { lat: number | null; lng: number | null } | null = null;
  if (me.referrerId != null) {
    const p = (await db.execute(sql`
      SELECT lat, lng FROM nodes WHERE id = ${me.referrerId} LIMIT 1;
    `)) as unknown as { rows: { lat: number | null; lng: number | null }[] };
    const par = p.rows?.[0];
    if (par && par.lat != null && par.lng != null && you) {
      referrer = par;
      incoming = [{ sx: par.lng, sy: par.lat, ex: you.lng, ey: you.lat }];
    }
  }

  // Outgoing: you → direct children (purple), capped.
  const ch = (await db.execute(sql`
    SELECT lat, lng FROM nodes
    WHERE referrer_id = ${me.id} AND class = 'human' AND lat IS NOT NULL
    ORDER BY created_at DESC LIMIT 40;
  `)) as unknown as { rows: { lat: number; lng: number }[] };
  const outgoing: GlobeArc[] =
    you == null
      ? []
      : (ch.rows ?? []).map((c) => ({ sx: you.lng, sy: you.lat, ex: Number(c.lng), ey: Number(c.lat) }));

  return { you, incoming, outgoing, referrer };
}

/**
 * Bundle for /api/me: globe overlay + metrics + rank.
 * Unlinked devices read denormalized cached_metrics; multi-device accounts use live union.
 * Rank always uses this node's cached reach (consistent with leaderboard).
 */
export async function meBundle(code: string): Promise<{
  you: { lat: number; lng: number } | null;
  devices: { lat: number; lng: number }[];
  incoming: GlobeArc[];
  outgoing: GlobeArc[];
  referrer: { lat: number | null; lng: number | null } | null;
  metrics: { reach: number; direct: number; maxDepth: number; countries: number };
  rank: { rank: number; percentile: number } | null;
} | null> {
  const nodeR = (await db.execute(sql`
    SELECT id FROM nodes WHERE code = ${code} LIMIT 1;
  `)) as unknown as { rows: { id: number }[] };
  const node = nodeR.rows?.[0];
  if (!node) return null;

  const metrics = await metricsForNode(node.id);
  const [rank, globe] = await Promise.all([
    rankForNodeId(node.id),
    globeOverlayForNode(node.id),
  ]);
  if (!globe) return null;

  return {
    you: globe.you,
    devices: globe.devices,
    incoming: globe.incoming,
    outgoing: globe.outgoing,
    referrer: globe.referrer,
    metrics,
    rank,
  };
}

/** Global rank + percentile for a node (anti-hopeless, DESIGN §2 leaderboard). */
export async function rankOf(code: string): Promise<{ rank: number; percentile: number } | null> {
  const r = (await db.execute(sql`
    WITH me AS (
      SELECT m.reach FROM cached_metrics m JOIN nodes n ON n.id = m.node_id WHERE n.code = ${code}
    ),
    counts AS (
      SELECT
        (SELECT COUNT(*) FROM cached_metrics m JOIN nodes n ON n.id=m.node_id
           WHERE n.class='human' AND m.reach > (SELECT reach FROM me)) AS above,
        (SELECT COUNT(*) FROM nodes WHERE class='human') AS total
    )
    SELECT above + 1 AS rank, total FROM counts;
  `)) as unknown as { rows: { rank: number; total: number }[] };
  const row = r.rows?.[0];
  if (!row) return null;
  const total = Number(row.total) || 1;
  const rank = Number(row.rank);
  return { rank, percentile: Math.round((1 - rank / total) * 100) };
}
