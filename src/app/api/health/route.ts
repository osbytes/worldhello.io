import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { hasRedis, hasEmailProvider, validateProductionEnv } from "@/lib/env";
import { Redis } from "@upstash/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "error" | "skip";

/** Readiness probe — DB ping + optional Redis ping. Used by deploy pipelines / load balancers. */
export async function GET() {
  const checks: Record<string, CheckStatus> = {};
  let ok = true;

  try {
    await db.execute(sql`SELECT 1`);
    checks.db = "ok";
  } catch {
    checks.db = "error";
    ok = false;
  }

  if (hasRedis()) {
    try {
      const redis = Redis.fromEnv();
      await redis.ping();
      checks.redis = "ok";
    } catch {
      checks.redis = "error";
      ok = false;
    }
  } else {
    checks.redis = process.env.NODE_ENV === "production" ? "error" : "skip";
    if (process.env.NODE_ENV === "production") ok = false;
  }

  checks.email = hasEmailProvider()
    ? "ok"
    : process.env.NODE_ENV === "production"
      ? "error"
      : "skip";
  if (checks.email === "error") ok = false;

  try {
    validateProductionEnv();
    checks.env = "ok";
  } catch {
    checks.env = process.env.NODE_ENV === "production" ? "error" : "skip";
    if (checks.env === "error") ok = false;
  }

  return NextResponse.json({ ok, checks }, { status: ok ? 200 : 503 });
}
