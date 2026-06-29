/** Production environment validation. Called at server startup via instrumentation. */

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function hasRedis(): boolean {
  return !!(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

export function hasEmailProvider(): boolean {
  return !!(process.env.RESEND_API_KEY || process.env.SMTP_HOST);
}

/** Throws if required production env vars are missing. No-op in dev / during build. */
export function validateProductionEnv(): void {
  if (!isProduction()) return;
  if (process.env.SKIP_ENV_VALIDATION === "1") return;
  // `next build` imports server modules without runtime secrets — skip there.
  if (process.env.NEXT_PHASE === "phase-production-build") return;

  const missing: string[] = [];
  if (!process.env.DATABASE_URL) missing.push("DATABASE_URL");
  if (!hasRedis()) missing.push("UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN");
  if (!process.env.APP_SECRET) missing.push("APP_SECRET");
  if (!hasEmailProvider()) missing.push("RESEND_API_KEY or SMTP_HOST");
  if (!process.env.NEXT_PUBLIC_BASE_URL) missing.push("NEXT_PUBLIC_BASE_URL");

  if (missing.length > 0) {
    throw new Error(`Production environment validation failed — missing: ${missing.join(", ")}`);
  }
}
