/**
 * Migration runner. Local docker Postgres → node-postgres; Neon → HTTP migrator.
 * Run: pnpm db:migrate
 */
async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL_UNPOOLED / DATABASE_URL not set");

  const local = !url.includes("neon.tech");
  console.log(`Running migrations (${local ? "node-postgres" : "neon"})…`);

  if (local) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
    await pool.end();
  } else {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const { migrate } = await import("drizzle-orm/neon-http/migrator");
    const db = drizzle(neon(url));
    await migrate(db, { migrationsFolder: "./src/db/migrations" });
  }

  console.log("Migrations complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
