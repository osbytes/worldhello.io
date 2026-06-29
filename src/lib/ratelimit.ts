/**
 * Admission control. DESIGN §6.5 / §6.6.
 *
 * Rate-limit by localId (primary), fingerprint (secondary), referrer_id (fan-out).
 * IP is NEVER a hard gate — only a very high global ceiling + a risk multiplier.
 *
 * Redis is the ONE v1 carve-out (DESIGN §7): counters here must not contend with
 * the primary Postgres under the exact attack we defend against. If Upstash creds
 * are absent (local dev), we degrade to allow-all (never block local work).
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const hasRedis =
  !!process.env.UPSTASH_REDIS_REST_URL && !!process.env.UPSTASH_REDIS_REST_TOKEN;

const redis = hasRedis ? Redis.fromEnv() : null;

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
const byLocal = limiter(8, "1 m"); // a human can't honestly create 8 nodes/min
const byFingerprint = limiter(20, "1 m"); // looser; fp shared across NAT siblings
const byReferrer = limiter(120, "1 h"); // farm-your-own-link fan-out cap
const byIpGlobal = limiter(600, "1 m"); // script-grade only; never trips a crowd
const byLinkCreate = limiter(12, "1 h"); // pairing codes per device
const byLinkAccept = limiter(20, "1 m"); // brute-force guard on 6-char codes

export type AdmitInput = {
  localId: string;
  fingerprint: string | null;
  referrerId: number | null;
  ipHash: string;
};

export type AdmitResult = { ok: true } | { ok: false; reason: string };

/** Returns ok=false when any non-IP limiter trips, or IP exceeds the script ceiling. */
export async function admit(i: AdmitInput): Promise<AdmitResult> {
  if (!redis) return { ok: true }; // local dev / no Redis configured

  const checks: Array<[ReturnType<typeof limiter>, string, string]> = [
    [byLocal, `local:${i.localId}`, "local_velocity"],
    [byFingerprint, i.fingerprint ? `fp:${i.fingerprint}` : "", "fingerprint_velocity"],
    [byReferrer, i.referrerId != null ? `ref:${i.referrerId}` : "", "referrer_fanout"],
    [byIpGlobal, `ip:${i.ipHash}`, "ip_script_ceiling"],
  ];

  for (const [lim, key, reason] of checks) {
    if (!lim || !key) continue;
    const { success } = await lim.limit(key);
    if (!success) return { ok: false, reason };
  }
  return { ok: true };
}

/** Rate-limit device-pairing code creation (per source localId). */
export async function admitLinkCreate(localId: string): Promise<AdmitResult> {
  if (!redis || !byLinkCreate) return { ok: true };
  const { success } = await byLinkCreate.limit(`link:create:${localId}`);
  return success ? { ok: true } : { ok: false, reason: "link_create_velocity" };
}

/** Rate-limit pairing-code guess attempts (per target localId). */
export async function admitLinkAccept(localId: string): Promise<AdmitResult> {
  if (!redis || !byLinkAccept) return { ok: true };
  const { success } = await byLinkAccept.limit(`link:accept:${localId}`);
  return success ? { ok: true } : { ok: false, reason: "link_accept_velocity" };
}
