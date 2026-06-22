/**
 * Seed a referral web *under your own browser node* so your real session shows
 * populated globe arcs, reach, direct, depth, countries and rank.
 *
 * Usage:
 *   pnpm db:seed:me <your-localId>
 *
 * Find <your-localId> in the browser: DevTools → Application → Local Storage →
 * key `wh_lid` (or the `wh_lid` cookie). Reload the page after seeding.
 */
import { sql } from "drizzle-orm";
import { db } from "./index";
import { newCode } from "@/lib/codes";
import { createNode, bumpAncestors, resolveNode } from "./graph";

const COUNTRIES = ["US", "BR", "NG", "IN", "ID", "DE", "JP", "GB", "FR", "ZA", "MX", "EG", "CA", "AU"];
const CITY: Record<string, [number, number]> = {
  US: [37.7, -122.4], BR: [-23.5, -46.6], NG: [6.5, 3.4], IN: [19.0, 72.8],
  ID: [-6.2, 106.8], DE: [52.5, 13.4], JP: [35.6, 139.7], GB: [51.5, -0.1],
  FR: [48.8, 2.3], ZA: [-26.2, 28.0], MX: [19.4, -99.1], EG: [30.0, 31.2],
  CA: [43.65, -79.38], AU: [-33.87, 151.2],
};

function place() {
  const c = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
  const [blat, blng] = CITY[c];
  return { country: c, lat: blat + (Math.random() - 0.5) * 6, lng: blng + (Math.random() - 0.5) * 6 };
}

/**
 * Ensure your node exists AND has a referrer above it, so the globe draws the
 * BLUE incoming arc (who brought you). If your node already exists as a root
 * (referrer_id IS NULL), we can't re-parent it (write-once) — so we report that
 * and you should re-seed against a fresh localId, or clear `wh_lid` and reload.
 */
async function ensureNode(localId: string): Promise<{ id: number; code: string; hasReferrer: boolean }> {
  const existing = await resolveNode(localId, null);
  if (existing) {
    const r = (await db.execute(sql`
      SELECT referrer_id AS "refId" FROM nodes WHERE id = ${existing.id};
    `)) as unknown as { rows: { refId: number | null }[] };
    return { id: existing.id, code: existing.code, hasReferrer: r.rows?.[0]?.refId != null };
  }

  // Fresh localId → build a short lineage ABOVE you (a referrer with their own
  // referrer) so blue arc + chain depth look real.
  let parentId: number | null = null;
  for (let d = 0; d < 2; d++) {
    const p = place();
    const anc = await createNode({
      code: newCode(),
      localId: `seedme-anc-${newCode()}`,
      fingerprint: null,
      referrerId: parentId,
      class: "human",
      ephemeral: false,
      country: p.country,
      lat: p.lat,
      lng: p.lng,
    });
    await bumpAncestors(anc);
    parentId = anc.id;
  }

  const p = place();
  const you = await createNode({
    code: newCode(),
    localId,
    fingerprint: null,
    referrerId: parentId, // ← your referrer (drives the blue arc)
    class: "human",
    ephemeral: false,
    country: p.country,
    lat: p.lat,
    lng: p.lng,
  });
  await bumpAncestors(you);
  return { id: you.id, code: you.code, hasReferrer: true };
}

// Unique per run so the script is safe to re-run (avoids unique(local_id) collisions).
const RUN = newCode();

async function spawnChild(referrerId: number, tag: string) {
  const p = place();
  const node = await createNode({
    code: newCode(),
    localId: `seedme-${RUN}-${tag}`,
    fingerprint: null,
    referrerId,
    class: "human",
    ephemeral: false,
    country: p.country,
    lat: p.lat,
    lng: p.lng,
  });
  if (Math.random() > 0.8) {
    await db.execute(sql`UPDATE nodes SET verified = true WHERE id = ${node.id};`);
  }
  await bumpAncestors(node);
  return node;
}

async function main() {
  const localId = process.argv[2];
  if (!localId) {
    console.error("Usage: pnpm db:seed:me <your-localId>  (from localStorage key `wh_lid`)");
    process.exit(1);
  }

  const root = await ensureNode(localId);
  console.log(`Your node: id=${root.id} code=${root.code}`);
  if (!root.hasReferrer) {
    console.warn(
      "⚠ Your node already exists as a ROOT (no referrer) — referrer_id is write-once,\n" +
        "  so the BLUE 'who brought you' arc can't be added. To see it: clear the `wh_lid`\n" +
        "  localStorage key in your browser, reload to mint a fresh node, then re-run this\n" +
        "  with the NEW localId.",
    );
  }

  // ~6 direct children (your "you shared with"), each growing a subtree → reach + depth.
  const DIRECT = 6;
  let total = 0;
  let frontier: number[] = [];

  for (let i = 0; i < DIRECT; i++) {
    const c = await spawnChild(root.id, `d${i}`);
    frontier.push(c.id);
    total++;
  }

  // Grow downstream a few levels so depth + reach look real (branching, decaying).
  let level = 1;
  while (frontier.length && level < 6) {
    const next: number[] = [];
    for (const parent of frontier) {
      const kids = Math.floor(Math.random() * 3); // 0–2 children each
      for (let k = 0; k < kids; k++) {
        const c = await spawnChild(parent, `l${level}-${total}`);
        next.push(c.id);
        total++;
      }
    }
    frontier = next;
    level++;
  }

  // Backfill the `countries` metric for every node in your subtree (bumpAncestors
  // tracks reach/direct/depth but not distinct countries — recompute via ltree).
  await db.execute(sql`
    WITH me AS (SELECT path FROM nodes WHERE id = ${root.id})
    UPDATE cached_metrics cm SET countries = sub.cnt
    FROM (
      SELECT a.id, COUNT(DISTINCT d.country) FILTER (WHERE d.country IS NOT NULL) AS cnt
      FROM nodes a
      JOIN nodes d ON d.path <@ a.path AND d.class = 'human'
      WHERE a.path <@ (SELECT path FROM me)
      GROUP BY a.id
    ) sub
    WHERE cm.node_id = sub.id;
  `);

  console.log(`Seeded ${total} descendants under your node across up to ${level} degrees.`);
  console.log("Reload http://localhost:3000 — your globe + stats should now be populated.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
