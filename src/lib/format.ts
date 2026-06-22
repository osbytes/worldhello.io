/**
 * Compact number formatting so big stats never overflow chips/cards.
 *  999 -> "999"  ·  1_200 -> "1.2K"  ·  1_500_000 -> "1.5M"  ·  2_000_000_000 -> "2B"
 * Uses Intl compact notation (locale-aware) with a tight cap on fraction digits.
 */
const compact = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function fmtCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return compact.format(n);
}

/** Full grouped number ("1,284") for places with room (e.g. body copy). */
const full = new Intl.NumberFormat("en");
export function fmtFull(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return full.format(n);
}

/** Rank like "#142", compacted for huge ranks ("#1.2M"). */
export function fmtRank(rank: number | null | undefined): string {
  if (rank == null || !Number.isFinite(rank)) return "#—";
  return `#${fmtCompact(rank)}`;
}
