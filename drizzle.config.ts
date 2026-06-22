import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    // Migrations run against the UNPOOLED endpoint (DDL + advisory locks).
    url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL!,
  },
  // ltree column type + GiST index are emitted via custom SQL (see migrations/0001_ltree.sql).
  verbose: true,
  strict: true,
});
