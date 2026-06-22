import * as schema from "./schema";

// Lazy singleton — must not throw at import time (build collects page data with
// no DATABASE_URL). Driver is chosen by URL: Neon HTTP in prod, node-postgres for
// a local docker Postgres (the serverless HTTP driver can't reach plain Postgres).
type DrizzleDb =
  | import("drizzle-orm/neon-http").NeonHttpDatabase<typeof schema>
  | import("drizzle-orm/node-postgres").NodePgDatabase<typeof schema>;

let _db: DrizzleDb | null = null;

function isLocal(url: string): boolean {
  return /@(localhost|127\.0\.0\.1|db)[:/]/.test(url) || !url.includes("neon.tech");
}

function getDb(): DrizzleDb {
  if (_db) return _db;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  if (isLocal(url)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg") as typeof import("pg");
    const { drizzle } = require("drizzle-orm/node-postgres") as typeof import("drizzle-orm/node-postgres");
    _db = drizzle(new Pool({ connectionString: url }), { schema });
  } else {
    const { neon } = require("@neondatabase/serverless") as typeof import("@neondatabase/serverless");
    const { drizzle } = require("drizzle-orm/neon-http") as typeof import("drizzle-orm/neon-http");
    _db = drizzle(neon(url), { schema });
  }
  return _db;
}

// Proxy so `db.execute(...)` / `db.insert(...)` resolve the real client on first use.
export const db = new Proxy({} as DrizzleDb, {
  get(_t, prop) {
    const real = getDb();
    const v = (real as unknown as Record<string | symbol, unknown>)[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export { schema };
export type DB = DrizzleDb;
