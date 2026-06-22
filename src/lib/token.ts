import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_SECRET must be set in production");
  }
  return "dev-only-change-me";
}
const SECRET = appSecret();

export const MAGIC_TTL_MS = 1000 * 60 * 30; // 30 min

/**
 * Magic-link token = base64url(nonce).sig. The nonce is a random id; the email +
 * localId live server-side in a one-time `magic_tokens` row (see auth routes), so:
 *  - the email is never embedded in the URL (no leakage via history/referer/previews)
 *  - the token is single-use (the row is consumed on verify)
 * The HMAC signature stops an attacker forging a valid nonce for someone else's row.
 */
export function newNonce(): string {
  return randomBytes(18).toString("base64url");
}

export function signNonce(nonce: string): string {
  const sig = createHmac("sha256", SECRET).update(nonce).digest("base64url");
  return `${nonce}.${sig}`;
}

export function verifyNonce(token: string): string | null {
  const [nonce, sig] = token.split(".");
  if (!nonce || !sig) return null;
  const expected = createHmac("sha256", SECRET).update(nonce).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return nonce;
}
