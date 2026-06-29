import { createHash, createHmac } from "node:crypto";

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (s) return s;
  // Never fall back to a known default in production — tokens/hashes would be forgeable.
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET must be set in production");
  }
  return "dev-only-change-me";
}

const SECRET = appSecret();

/** Stable keyed hash — used for fingerprints, IPs, emails. Never store raw PII. */
export function hashKeyed(value: string): string {
  return createHmac("sha256", SECRET).update(value).digest("hex");
}

/** Plain hash (non-secret, e.g. idempotency keys). */
export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Normalize email before hashing (lowercase, trim). */
export function emailHash(email: string): string {
  return hashKeyed(email.trim().toLowerCase());
}

/** Synthetic account key for device-only linking (no email). */
export function deviceAccountHash(sourceLocalId: string): string {
  return hashKeyed(`device:${sourceLocalId}`);
}
