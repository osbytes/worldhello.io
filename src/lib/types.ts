import type { GlobeArc } from "@/db/reads";

export type Metrics = { reach: number; direct: number; maxDepth: number; countries: number };

export type MeDetail = {
  you: { lat: number; lng: number } | null;
  incoming: GlobeArc[];
  outgoing: GlobeArc[];
  referrer: { lat: number | null; lng: number | null } | null;
  rank: { rank: number; percentile: number } | null;
  metrics: Metrics;
};
