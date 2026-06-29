/**
 * Risk score. DESIGN §6.6 — IP is a velocity multiplier, never a gate.
 * Suspicious = high velocity AND same fingerprint AND same UA AND no localId variance.
 * v1 produces a 0–100 advisory score stored on node_signals; high scores can later
 * trigger step-up challenges or leaderboard dampening (not a hard block here).
 */
export type RiskInput = {
  baseRisk: number; // from resolveClass detector tier
  ephemeral: boolean; // incognito
  hasFingerprint: boolean;
  ipShared: boolean; // many distinct localIds on this IP recently (good signal!)
};

export function riskScore(i: RiskInput): number {
  let s = i.baseRisk;
  if (!i.hasFingerprint) s += 20;
  if (i.ephemeral) s += 10;
  // Shared IP with HIGH localId diversity = a crowd, LOWERS risk (DESIGN §6.6).
  if (i.ipShared) s -= 15;
  return Math.max(0, Math.min(100, s));
}
