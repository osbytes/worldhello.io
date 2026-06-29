/**
 * Graph hot path. All ltree / materialized-path operations live here as raw SQL
 * (Drizzle has no ltree ops). DESIGN §5.
 *
 * Path convention: a node's `path` = "<rootId>.<...>.<selfId>", bigint ids as
 * ltree labels. Subtree(X) = `path <@ X.path`. Ancestors(X) = labels of X.path.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";
import { MAX_DEPTH } from "@/lib/codes";
import type { GlobeArc } from "./reads";

export type CreateNodeInput = {
  code: string;
  localId: string;
  fingerprint: string | null;
  referrerId: number | null;
  class: string;
  ephemeral: boolean;
  country: string | null;
  lat: number | null;
  lng: number | null;
};

export type CreatedNode = {
  id: number;
  code: string;
  depth: number;
  path: string;
  referrerId: number | null;
};

/**
 * Atomically create a node under an optional referrer and set its ltree path.
 *
 * Done in one SQL statement via CTEs so path/depth derive from the parent in a
 * single round-trip. Guards: depth cap, self-cycle (referrer can't be self —
 * impossible here since id is new, but referrer must exist + be within depth).
 *
 * The bounded ancestor metric bump is a SEPARATE single UPDATE (see bumpAncestors).
 */
export async function createNode(input: CreateNodeInput): Promise<CreatedNode> {
  // Depth cap guard (DESIGN §6.5). Reject before insert if parent is too deep or
  // a referrer was given but doesn't exist.
  if (input.referrerId != null) {
    const p = (await db.execute(sql`
      SELECT depth FROM nodes WHERE id = ${input.referrerId} LIMIT 1;
    `)) as unknown as { rows: { depth: number }[] };
    const parentDepth = p.rows?.[0]?.depth;
    if (parentDepth == null) throw new Error("NODE_CREATE_REJECTED"); // bad referrer
    if (parentDepth >= MAX_DEPTH) throw new Error("NODE_CREATE_REJECTED"); // depth cap
  }

  // path + depth are set by the BEFORE INSERT trigger (set_node_path) — a sibling
  // CTE cannot UPDATE a row another CTE just inserted (same snapshot).
  const rows = (await db.execute(sql`
    INSERT INTO nodes (code, local_id, fingerprint, referrer_id, class, ephemeral, country, lat, lng)
    VALUES (
      ${input.code}, ${input.localId}, ${input.fingerprint}, ${input.referrerId},
      ${input.class}, ${input.ephemeral}, ${input.country}, ${input.lat}, ${input.lng}
    )
    RETURNING id, code, depth, path::text AS path, referrer_id AS "referrerId";
  `)) as unknown as { rows: CreatedNode[] };

  const row = rows.rows?.[0];
  if (!row) throw new Error("NODE_CREATE_REJECTED");
  return row;
}

/**
 * Bounded fan-out metric bump. DESIGN §6.5: ONE UPDATE touching every ancestor,
 * not N queries. Increments reach for all ancestors of the new node, plus the
 * direct-child counter for the immediate parent.
 *
 * Only runs for human-class nodes (callers gate on this).
 */
export async function bumpAncestors(
  newNode: CreatedNode,
  country: string | null,
): Promise<void> {
  // Ancestor ids = every label in the path except self.
  await db.execute(sql`
    WITH ancestors AS (
      SELECT (regexp_split_to_table(${newNode.path}, '\\.'))::bigint AS id
    ),
    real_ancestors AS (
      SELECT id FROM ancestors WHERE id <> ${newNode.id}
    )
    INSERT INTO cached_metrics (node_id, reach, direct, max_depth, countries, updated_at)
    SELECT
      ra.id,
      1,
      CASE WHEN ra.id = ${newNode.referrerId} THEN 1 ELSE 0 END,
      ${newNode.depth},
      CASE WHEN ${country}::text IS NOT NULL THEN 1 ELSE 0 END,
      now()
    FROM real_ancestors ra
    ON CONFLICT (node_id) DO UPDATE SET
      reach = cached_metrics.reach + 1,
      direct = cached_metrics.direct + (CASE WHEN cached_metrics.node_id = ${newNode.referrerId} THEN 1 ELSE 0 END),
      max_depth = GREATEST(cached_metrics.max_depth, ${newNode.depth}),
      countries = cached_metrics.countries + (
        CASE
          WHEN ${country}::text IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM nodes n2
            INNER JOIN nodes anc ON anc.id = cached_metrics.node_id
            WHERE n2.path <@ anc.path
              AND n2.id <> ${newNode.id}
              AND n2.class = 'human'
              AND n2.country = ${country}
          ) THEN 1
          ELSE 0
        END
      ),
      updated_at = now();
  `);

  const selfCountries = country != null ? 1 : 0;
  await db.execute(sql`
    INSERT INTO cached_metrics (node_id, reach, direct, max_depth, countries)
    VALUES (${newNode.id}, 0, 0, ${newNode.depth}, ${selfCountries})
    ON CONFLICT (node_id) DO NOTHING;
  `);
}

type ResolvedNode = { id: number; code: string; referrerId: number | null; localId: string };

/** Resolve an existing node by localId (primary) then fingerprint (fallback). */
export async function resolveNode(
  localId: string,
  fingerprint: string | null,
): Promise<ResolvedNode | null> {
  const byLocal = (await db.execute(sql`
    SELECT id, code, referrer_id AS "referrerId", local_id AS "localId"
    FROM nodes WHERE local_id = ${localId} LIMIT 1;
  `)) as unknown as { rows: ResolvedNode[] };
  if (byLocal.rows?.[0]) return byLocal.rows[0];

  if (fingerprint) {
    const byFp = (await db.execute(sql`
      SELECT id, code, referrer_id AS "referrerId", local_id AS "localId"
      FROM nodes
      WHERE fingerprint = ${fingerprint} AND class = 'human'
      ORDER BY created_at ASC LIMIT 1;
    `)) as unknown as { rows: ResolvedNode[] };
    if (byFp.rows?.[0]) return byFp.rows[0];
  }
  return null;
}

/**
 * Move a node onto a freshly issued client localId (DESIGN §2 fingerprint re-link).
 * Cookie and DB must agree so auth routes can resolve the node by wh_lid alone.
 */
export async function relinkNodeLocalId(nodeId: number, newLocalId: string): Promise<boolean> {
  const updated = (await db.execute(sql`
    UPDATE nodes SET local_id = ${newLocalId}
    WHERE id = ${nodeId}
      AND local_id <> ${newLocalId}
      AND NOT EXISTS (SELECT 1 FROM nodes WHERE local_id = ${newLocalId})
    RETURNING id;
  `)) as unknown as { rows: { id: number }[] };
  return !!updated.rows?.[0];
}

/** Look up a node id by its share code (the ?ref target). */
export async function nodeByCode(
  code: string,
): Promise<{ id: number; depth: number } | null> {
  const r = (await db.execute(sql`
    SELECT id, depth FROM nodes WHERE code = ${code} LIMIT 1;
  `)) as unknown as { rows: { id: number; depth: number }[] };
  return r.rows?.[0] ?? null;
}

export type Metrics = {
  reach: number;
  direct: number;
  maxDepth: number;
  countries: number;
};

/**
 * Live subtree metrics for a node via ltree `<@`. Counts only human nodes.
 * Used for the score panel + referrer hook card.
 */
export async function subtreeMetrics(nodeId: number): Promise<Metrics> {
  const r = (await db.execute(sql`
    WITH me AS (SELECT path, depth FROM nodes WHERE id = ${nodeId})
    SELECT
      COUNT(*) FILTER (WHERE n.id <> ${nodeId})                          AS reach,
      COUNT(*) FILTER (WHERE n.referrer_id = ${nodeId})                  AS direct,
      COALESCE(MAX(n.depth) - (SELECT depth FROM me), 0)                 AS "maxDepth",
      COUNT(DISTINCT n.country) FILTER (WHERE n.country IS NOT NULL)     AS countries
    FROM nodes n, me
    WHERE n.path <@ me.path AND n.class = 'human';
  `)) as unknown as { rows: Metrics[] };
  const row = r.rows?.[0];
  return {
    reach: Number(row?.reach ?? 0),
    direct: Number(row?.direct ?? 0),
    maxDepth: Number(row?.maxDepth ?? 0),
    countries: Number(row?.countries ?? 0),
  };
}

/**
 * Union of all device subtrees for a linked account, deduped (DESIGN §5.5).
 * Account devices and internal sibling edges are excluded from reach/direct.
 */
export async function accountMetrics(accountId: number): Promise<Metrics> {
  const r = (await db.execute(sql`
    WITH account_nodes AS (
      SELECT id, path, depth FROM nodes
      WHERE account_id = ${accountId} AND class = 'human'
    ),
    device_ids AS (
      SELECT id FROM account_nodes
    ),
    union_nodes AS (
      SELECT DISTINCT n.id, n.country, n.depth, n.referrer_id
      FROM nodes n
      INNER JOIN account_nodes an ON n.path <@ an.path
      WHERE n.class = 'human'
    ),
    min_depth AS (
      SELECT MIN(depth) AS d FROM account_nodes
    )
    SELECT
      (SELECT COUNT(*)::int FROM union_nodes u
        WHERE u.id NOT IN (SELECT id FROM device_ids)) AS reach,
      (SELECT COUNT(*)::int FROM union_nodes u
        WHERE u.referrer_id IN (SELECT id FROM device_ids)
          AND u.id NOT IN (SELECT id FROM device_ids)) AS direct,
      (SELECT COALESCE(MAX(u.depth) - (SELECT d FROM min_depth), 0)::int
        FROM union_nodes u) AS "maxDepth",
      (SELECT COUNT(DISTINCT u.country)::int FROM union_nodes u
        WHERE u.country IS NOT NULL) AS countries;
  `)) as unknown as { rows: Metrics[] };
  const row = r.rows?.[0];
  return {
    reach: Number(row?.reach ?? 0),
    direct: Number(row?.direct ?? 0),
    maxDepth: Number(row?.maxDepth ?? 0),
    countries: Number(row?.countries ?? 0),
  };
}

/** Read denormalized per-node metrics (fast path for polls and leaderboard). */
export async function cachedMetricsForNode(nodeId: number): Promise<Metrics | null> {
  const r = (await db.execute(sql`
    SELECT reach, direct, max_depth AS "maxDepth", countries
    FROM cached_metrics
    WHERE node_id = ${nodeId}
    LIMIT 1;
  `)) as unknown as { rows: Metrics[] };
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    reach: Number(row.reach ?? 0),
    direct: Number(row.direct ?? 0),
    maxDepth: Number(row.maxDepth ?? 0),
    countries: Number(row.countries ?? 0),
  };
}

/** Per-node metrics from cache, or account-aggregated live scan when multi-device linked. */
export async function metricsForNode(nodeId: number): Promise<Metrics> {
  const acc = (await db.execute(sql`
    SELECT account_id AS "accountId" FROM nodes WHERE id = ${nodeId} LIMIT 1;
  `)) as unknown as { rows: { accountId: number | null }[] };
  const accountId = acc.rows?.[0]?.accountId;
  if (accountId != null) {
    const siblings = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM nodes
      WHERE account_id = ${accountId} AND id <> ${nodeId};
    `)) as unknown as { rows: { n: number }[] };
    if ((siblings.rows?.[0]?.n ?? 0) > 0) return accountMetrics(accountId);
  }

  const cached = await cachedMetricsForNode(nodeId);
  if (cached) return cached;
  return subtreeMetrics(nodeId);
}

/** Rank from effective reach (account-union when linked, else cached per-node). */
export async function rankForNodeId(
  nodeId: number,
): Promise<{ rank: number; percentile: number } | null> {
  const metrics = await metricsForNode(nodeId);
  return rankForReach(metrics.reach);
}

/**
 * Rank a reach score against all identities: solo nodes use cached reach;
 * multi-device accounts use one union reach (DESIGN §5.5).
 */
export async function rankForReach(
  reach: number,
): Promise<{ rank: number; percentile: number } | null> {
  const r = (await db.execute(sql`
    WITH linked AS (
      SELECT account_id
      FROM nodes
      WHERE account_id IS NOT NULL AND class = 'human'
      GROUP BY account_id
      HAVING COUNT(*) > 1
    ),
    account_nodes AS (
      SELECT n.account_id, n.id, n.path, n.depth
      FROM nodes n
      INNER JOIN linked l ON l.account_id = n.account_id
      WHERE n.class = 'human'
    ),
    union_nodes AS (
      SELECT DISTINCT an.account_id, n.id, n.depth
      FROM account_nodes an
      INNER JOIN nodes n ON n.path <@ an.path AND n.class = 'human'
    ),
    device_ids AS (
      SELECT account_id, id FROM account_nodes
    ),
    min_depth AS (
      SELECT account_id, MIN(depth) AS d FROM account_nodes GROUP BY account_id
    ),
    account_scores AS (
      SELECT
        u.account_id,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM device_ids d
          WHERE d.account_id = u.account_id AND d.id = u.id
        ))::int AS reach
      FROM union_nodes u
      GROUP BY u.account_id
    ),
    solo_scores AS (
      SELECT m.reach::int AS reach
      FROM cached_metrics m
      INNER JOIN nodes n ON n.id = m.node_id
      WHERE n.class = 'human'
        AND (
          n.account_id IS NULL
          OR n.account_id NOT IN (SELECT account_id FROM linked)
        )
    ),
    all_scores AS (
      SELECT reach FROM solo_scores
      UNION ALL
      SELECT reach FROM account_scores
    )
    SELECT
      (SELECT COUNT(*)::int FROM all_scores WHERE reach > ${reach}) + 1 AS rank,
      (SELECT COUNT(*)::int FROM all_scores) AS total;
  `)) as unknown as { rows: { rank: number; total: number }[] };
  const row = r.rows?.[0];
  if (!row) return null;
  const total = Number(row.total) || 1;
  const rank = Number(row.rank);
  return { rank, percentile: Math.round((1 - rank / total) * 100) };
}

export type LeaderIdentityRow = {
  code: string;
  reach: number;
  maxDepth: number;
  countries: number;
  verified: boolean;
  country: string | null;
};

/** One leaderboard row per multi-device account (union reach + representative node). */
export async function linkedAccountLeaderRows(): Promise<LeaderIdentityRow[]> {
  const r = (await db.execute(sql`
    WITH linked AS (
      SELECT account_id
      FROM nodes
      WHERE account_id IS NOT NULL AND class = 'human'
      GROUP BY account_id
      HAVING COUNT(*) > 1
    ),
    account_nodes AS (
      SELECT n.account_id, n.id, n.path, n.depth
      FROM nodes n
      INNER JOIN linked l ON l.account_id = n.account_id
      WHERE n.class = 'human'
    ),
    union_nodes AS (
      SELECT DISTINCT an.account_id, n.id, n.country, n.depth
      FROM account_nodes an
      INNER JOIN nodes n ON n.path <@ an.path AND n.class = 'human'
    ),
    device_ids AS (
      SELECT account_id, id FROM account_nodes
    ),
    min_depth AS (
      SELECT account_id, MIN(depth) AS d FROM account_nodes GROUP BY account_id
    ),
    agg AS (
      SELECT
        u.account_id,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM device_ids d
          WHERE d.account_id = u.account_id AND d.id = u.id
        ))::int AS reach,
        COALESCE(MAX(u.depth) - md.d, 0)::int AS "maxDepth",
        COUNT(DISTINCT u.country) FILTER (WHERE u.country IS NOT NULL)::int AS countries
      FROM union_nodes u
      INNER JOIN min_depth md ON md.account_id = u.account_id
      GROUP BY u.account_id, md.d
    ),
    rep AS (
      SELECT DISTINCT ON (account_id)
        account_id AS "accountId", code, verified, country
      FROM nodes
      WHERE account_id IN (SELECT account_id FROM linked) AND class = 'human'
      ORDER BY account_id, verified DESC, id ASC
    )
    SELECT rep.code, a.reach, a."maxDepth", a.countries, rep.verified, rep.country
    FROM agg a
    INNER JOIN rep ON rep."accountId" = a.account_id;
  `)) as unknown as { rows: LeaderIdentityRow[] };
  return (r.rows ?? []).map((row) => ({
    code: row.code,
    reach: Number(row.reach ?? 0),
    maxDepth: Number(row.maxDepth ?? 0),
    countries: Number(row.countries ?? 0),
    verified: row.verified,
    country: row.country,
  }));
}

/** Leaderboard rows for solo devices (no linked siblings on the account). */
export async function soloLeaderRows(): Promise<LeaderIdentityRow[]> {
  const r = (await db.execute(sql`
    SELECT n.code, m.reach, m.max_depth AS "maxDepth", m.countries, n.verified, n.country
    FROM cached_metrics m
    INNER JOIN nodes n ON n.id = m.node_id
    WHERE n.class = 'human'
      AND (
        n.account_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM nodes n2
          WHERE n2.account_id = n.account_id AND n2.id <> n.id AND n2.class = 'human'
        )
      );
  `)) as unknown as { rows: LeaderIdentityRow[] };
  return (r.rows ?? []).map((row) => ({
    code: row.code,
    reach: Number(row.reach ?? 0),
    maxDepth: Number(row.maxDepth ?? 0),
    countries: Number(row.countries ?? 0),
    verified: row.verified,
    country: row.country,
  }));
}

export type GlobeOverlay = {
  you: { lat: number; lng: number } | null;
  devices: { lat: number; lng: number }[];
  incoming: GlobeArc[];
  outgoing: GlobeArc[];
  referrer: { lat: number | null; lng: number | null } | null;
};

function dedupeArcs(arcs: GlobeArc[]): GlobeArc[] {
  const seen = new Set<string>();
  return arcs.filter((a) => {
    const k = `${a.sx},${a.sy}->${a.ex},${a.ey}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Per-node globe arcs (single device, no account group). */
async function nodeGlobeOverlay(nodeId: number): Promise<GlobeOverlay> {
  const nodeR = (await db.execute(sql`
    SELECT lat, lng, referrer_id AS "referrerId"
    FROM nodes WHERE id = ${nodeId} LIMIT 1;
  `)) as unknown as {
    rows: { lat: number | null; lng: number | null; referrerId: number | null }[];
  };
  const node = nodeR.rows?.[0];
  const you =
    node?.lat != null && node?.lng != null ? { lat: node.lat, lng: node.lng } : null;

  let incoming: GlobeArc[] = [];
  let referrer: { lat: number | null; lng: number | null } | null = null;
  if (node?.referrerId != null) {
    const p = (await db.execute(sql`
      SELECT lat, lng FROM nodes WHERE id = ${node.referrerId} LIMIT 1;
    `)) as unknown as { rows: { lat: number | null; lng: number | null }[] };
    const par = p.rows?.[0];
    if (par && par.lat != null && par.lng != null && you) {
      referrer = par;
      incoming = [{ sx: par.lng, sy: par.lat, ex: you.lng, ey: you.lat }];
    }
  }

  const ch = (await db.execute(sql`
    SELECT lat, lng FROM nodes
    WHERE referrer_id = ${nodeId} AND class = 'human' AND lat IS NOT NULL
    ORDER BY created_at DESC LIMIT 40;
  `)) as unknown as { rows: { lat: number; lng: number }[] };
  const outgoing: GlobeArc[] =
    you == null
      ? []
      : (ch.rows ?? []).map((c) => ({ sx: you.lng, sy: you.lat, ex: Number(c.lng), ey: Number(c.lat) }));

  return { you, devices: you ? [you] : [], incoming, outgoing, referrer };
}

/** Union of all account devices' arcs on the globe (DESIGN §5.5). */
async function accountGlobeOverlay(nodeId: number, accountId: number): Promise<GlobeOverlay> {
  const base = await nodeGlobeOverlay(nodeId);

  const devicesR = (await db.execute(sql`
    SELECT lat, lng FROM nodes
    WHERE account_id = ${accountId} AND class = 'human' AND lat IS NOT NULL;
  `)) as unknown as { rows: { lat: number; lng: number }[] };

  const incomingR = (await db.execute(sql`
    WITH account_devices AS (
      SELECT id, lat, lng, referrer_id FROM nodes
      WHERE account_id = ${accountId} AND class = 'human'
    )
    SELECT par.lng AS sx, par.lat AS sy, an.lng AS ex, an.lat AS ey
    FROM account_devices an
    JOIN nodes par ON par.id = an.referrer_id
    WHERE par.lat IS NOT NULL AND an.lat IS NOT NULL;
  `)) as unknown as { rows: GlobeArc[] };

  const outgoingR = (await db.execute(sql`
    WITH account_devices AS (
      SELECT id, lat, lng FROM nodes
      WHERE account_id = ${accountId} AND class = 'human' AND lat IS NOT NULL
    )
    SELECT p.lng AS sx, p.lat AS sy, c.lng AS ex, c.lat AS ey
    FROM nodes c
    JOIN account_devices p ON c.referrer_id = p.id
    WHERE c.class = 'human' AND c.lat IS NOT NULL
      AND c.id NOT IN (SELECT id FROM account_devices)
    ORDER BY c.created_at DESC
    LIMIT 80;
  `)) as unknown as { rows: GlobeArc[] };

  const devices = (devicesR.rows ?? []).map((d) => ({ lat: Number(d.lat), lng: Number(d.lng) }));

  return {
    you: base.you,
    devices,
    incoming: dedupeArcs(
      (incomingR.rows ?? []).map((a) => ({
        sx: Number(a.sx),
        sy: Number(a.sy),
        ex: Number(a.ex),
        ey: Number(a.ey),
      })),
    ),
    outgoing: dedupeArcs(
      (outgoingR.rows ?? []).map((a) => ({
        sx: Number(a.sx),
        sy: Number(a.sy),
        ex: Number(a.ex),
        ey: Number(a.ey),
      })),
    ),
    referrer: base.referrer,
  };
}

/** Globe overlay for a node — account-aggregated when linked, otherwise per-device. */
export async function globeOverlayForNode(nodeId: number): Promise<GlobeOverlay | null> {
  const r = (await db.execute(sql`
    SELECT account_id AS "accountId" FROM nodes WHERE id = ${nodeId} LIMIT 1;
  `)) as unknown as { rows: { accountId: number | null }[] };
  const accountId = r.rows?.[0]?.accountId;
  if (accountId != null) {
    const siblings = (await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM nodes
      WHERE account_id = ${accountId} AND id <> ${nodeId};
    `)) as unknown as { rows: { n: number }[] };
    if ((siblings.rows?.[0]?.n ?? 0) > 0) {
      return accountGlobeOverlay(nodeId, accountId);
    }
  }
  return nodeGlobeOverlay(nodeId);
}

/** Ancestry root→node, for highlighting the user's lineage on the globe. */
export async function ancestry(
  nodeId: number,
): Promise<{ id: number; lat: number | null; lng: number | null }[]> {
  const r = (await db.execute(sql`
    WITH me AS (SELECT path FROM nodes WHERE id = ${nodeId}),
    ids AS (
      SELECT (regexp_split_to_table((SELECT path::text FROM me), '\\.'))::bigint AS id
    )
    SELECT n.id, n.lat, n.lng
    FROM nodes n JOIN ids ON ids.id = n.id
    ORDER BY n.depth ASC;
  `)) as unknown as { rows: { id: number; lat: number | null; lng: number | null }[] };
  return r.rows ?? [];
}
