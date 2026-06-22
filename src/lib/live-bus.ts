import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Live-join broadcaster. ONE shared DB poll loop per server instance fans out to
 * all SSE subscribers — instead of one poll loop per connection (which was O(conns)
 * queries/sec). DESIGN §7: at multi-instance scale this swaps to Redis pub/sub so a
 * join on instance A reaches subscribers on instance B; today each instance polls once.
 */
type Sub = (country: string | null) => void;

const subs = new Set<Sub>();
let lastId = 0;
let seeded = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function tick() {
  if (subs.size === 0) return; // nothing to do while idle
  try {
    if (!seeded) {
      const s = (await db.execute(sql`SELECT COALESCE(MAX(id),0) AS id FROM nodes;`)) as unknown as {
        rows: { id: number }[];
      };
      lastId = Number(s.rows?.[0]?.id ?? 0);
      seeded = true;
      return;
    }
    const r = (await db.execute(sql`
      SELECT id, country FROM nodes
      WHERE id > ${lastId} AND class = 'human' AND ephemeral = false
      ORDER BY id ASC LIMIT 50;
    `)) as unknown as { rows: { id: number; country: string | null }[] };
    for (const row of r.rows ?? []) {
      lastId = Math.max(lastId, Number(row.id));
      for (const fn of subs) fn(row.country);
    }
  } catch {
    /* resilience — swallow and retry next tick */
  }
}

function ensureLoop() {
  if (!timer) timer = setInterval(tick, 4000);
}

export function subscribe(fn: Sub): () => void {
  subs.add(fn);
  ensureLoop();
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}
