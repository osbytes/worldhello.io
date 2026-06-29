/**
 * Admission control. DESIGN §6.5 / §6.6.
 *
 * Rate-limit by localId (primary), fingerprint (secondary), referrer_id (fan-out).
 * IP is NEVER a hard gate — only a very high global ceiling + a risk multiplier.
 *
 * Redis is the ONE v1 carve-out (DESIGN §7): counters here must not contend with
 * the primary Postgres under the exact attack we defend against. In production,
 * Redis is required (enforced via src/lib/env.ts); local dev degrades to allow-all.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { hasRedis, isProduction } from "@/lib/env";

const redis = hasRedis() ? Redis.fromEnv() : null;

function limiter(tokens: number, window: `${number} ${"s" | "m" | "h"}`) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(tokens, window),
    prefix: "wh:rl",
    analytics: false,
  });
}

// Tuned generous on purpose — shared-IP audiences (conference wifi, CGNAT) are
// the viral target, not the threat. The threat is single-identity velocity.
const byLocal = limiter(8, "1 m");
const byFingerprint = limiter(20, "1 m");
const byReferrer = limiter(120, "1 h");
const byIpGlobal = limiter(600, "1 m");
const byLinkCreate = limiter(12, "1 h");
const byLinkAccept = limiter(20, "1 m");
const byMagicIp = limiter(5, "1 m");
const byMagicEmail = limiter(3, "1 h");

export type AdmitInput = {
  localId: string;
  fingerprint: string | null;
  referrerId: number | null;
  ipHash: string;
};

export type AdmitResult = { ok: true } | { ok: false; reason: string };

async function checkLimit(
  lim: ReturnType<typeof limiter>,
  key: string,
  reason: string,
): Promise<AdmitResult | null> {
  if (!lim || !key) return null;
  try {
    const { success } = await lim.limit(key);
    if (!success) return { ok: false, reason };
  } catch (err) {
    console.error("[ratelimit] Redis error — failing open:", err);
    return { ok: true };
  }
  return null;
}

function redisRequired(): AdmitResult | null {
  if (redis) return null;
  if (isProduction()) return { ok: false, reason: "redis_unavailable" };
  return { ok: true };
}

/** Returns ok=false when any non-IP limiter trips, or IP exceeds the script ceiling. */
export async function admit(i: AdmitInput): Promise<AdmitResult> {
  const noRedis = redisRequired();
  if (noRedis) {
    if (noRedis.ok === false) return noRedis;
    return { ok: true };
  }

  const checks: Array<[ReturnType<typeof limiter>, string, string]> = [
    [byLocal, `local:${i.localId}`, "local_velocity"],
    [byFingerprint, i.fingerprint ? `fp:${i.fingerprint}` : "", "fingerprint_velocity"],
    [byReferrer, i.referrerId != null ? `ref:${i.referrerId}` : "", "referrer_fanout"],
    [byIpGlobal, `ip:${i.ipHash}`, "ip_script_ceiling"],
  ];

  for (const [lim, key, reason] of checks) {
    const verdict = await checkLimit(lim, key, reason);
    if (verdict) return verdict;
  }
  return { ok: true };
}

/** Rate-limit magic-link requests (per IP + per email hash). */
export async function admitMagic(ipHash: string, emailHash: string): Promise<AdmitResult> {
  const noRedis = redisRequired();
  if (noRedis) {
    if (noRedis.ok === false) return noRedis;
    return { ok: true };
  }

  for (const [lim, key, reason] of [
    [byMagicIp, `magic:ip:${ipHash}`, "magic_ip_velocity"],
    [byMagicEmail, `magic:email:${emailHash}`, "magic_email_velocity"],
  ] as const) {
    const verdict = await checkLimit(lim, key, reason);
    if (verdict) return verdict;
  }
  return { ok: true };
}

/** Rate-limit device-pairing code creation (per source localId). */
export async function admitLinkCreate(localId: string): Promise<AdmitResult> {
  const noRedis = redisRequired();
  if (noRedis) {
    if (noRedis.ok === false) return noRedis;
    return { ok: true };
  }
  const verdict = await checkLimit(byLinkCreate, `link:create:${localId}`, "link_create_velocity");
  return verdict ?? { ok: true };
}

/** Rate-limit pairing-code guess attempts (per target localId). */
export async function admitLinkAccept(localId: string): Promise<AdmitResult> {
  const noRedis = redisRequired();
  if (noRedis) {
    if (noRedis.ok === false) return noRedis;
    return { ok: true };
  }
  const verdict = await checkLimit(byLinkAccept, `link:accept:${localId}`, "link_accept_velocity");
  return verdict ?? { ok: true };
}
