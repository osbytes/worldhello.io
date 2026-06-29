/** Read-side queries: leaderboard, globe points, referrer card. DESIGN §5/§3. */
import { sql } from "drizzle-orm";
import { db } from "./index";
import { metricsForNode, rankForReach, globeOverlayForNode } from "./graph";

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

export type GlobePoint = { lat: number; lng: number; v: 0 | 1 }; // v=verified
export type GlobeArc = { sx: number; sy: number; ex: number; ey: number };

/**
 * Globe payload. DESIGN §3 LOD: at small scale return raw human points; arcs only
 * for recent joins (sampled). At large scale this swaps to binned density tiles
 * (TODO when node count crosses threshold). Human nodes only.
 */
export async function globeData(limit = 2000): Promise<{ points: GlobePoint[]; arcs: GlobeArc[] }> {
  const pts = (await db.execute(sql`
    SELECT lat, lng, (verified)::int AS v
    FROM nodes
    WHERE class = 'human' AND ephemeral = false AND lat IS NOT NULL
    ORDER BY created_at DESC
    LIMIT ${limit};
  `)) as unknown as { rows: GlobePoint[] };

  // Recent referral arcs (child → parent), sampled.
  const arcs = (await db.execute(sql`
    SELECT c.lat AS sy, c.lng AS sx, p.lat AS ey, p.lng AS ex
    FROM nodes c JOIN nodes p ON p.id = c.referrer_id
    WHERE c.class = 'human' AND c.lat IS NOT NULL AND p.lat IS NOT NULL
    ORDER BY c.created_at DESC
    LIMIT 300;
  `)) as unknown as { rows: GlobeArc[] };

  return {
    points: (pts.rows ?? []).map((p) => ({ lat: Number(p.lat), lng: Number(p.lng), v: (p.v ? 1 : 0) as 0 | 1 })),
    arcs: (arcs.rows ?? []).map((a) => ({
      sx: Number(a.sx), sy: Number(a.sy), ex: Number(a.ex), ey: Number(a.ey),
    })),
  };
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
 * Single-query bundle for /api/me: node geo, referrer geo, capped children, cached
 * metrics, and rank — collapsing what used to be ~5 sequential round-trips per poll.
 * Metrics come from cached_metrics (denormalized) instead of a live subtree scan.
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
    rankForReach(metrics.reach),
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
