"use client";

import { useQuery } from "@tanstack/react-query";
import { registerNode, type NodeResponse } from "./client-identity";
import type { MeDetail } from "./types";
import type { GlobePoint, GlobeArc, LeaderRow } from "@/db/reads";

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

/**
 * Register/resolve this device. Runs once (keyed by refCode); the result is the
 * cached node that every other query depends on. Identity work (fingerprint, botd)
 * happens inside registerNode.
 */
export function useRegister(refCode: string | null) {
  return useQuery<NodeResponse | null>({
    queryKey: ["register", refCode],
    queryFn: () => registerNode(refCode),
    staleTime: Infinity, // never re-register within a session
    gcTime: Infinity,
    refetchOnMount: false,
    refetchOnReconnect: false,
  });
}

/** Per-device detail (globe lineage + rank + LIVE metrics). Polls so the referrer
 *  view reflects new descendants joining. Depends on having a code. */
export function useMe(code: string | undefined) {
  return useQuery<MeDetail | null>({
    queryKey: ["me", code],
    queryFn: () => json<MeDetail>(`/api/me/${code}`),
    enabled: !!code,
    staleTime: 25_000,
    // 30s: balances "feels live" against N-users × queries/min on the DB (audit fix).
    refetchInterval: 30_000,
    refetchIntervalInBackground: false, // pause polling on hidden tabs
  });
}

/** Ambient globe points + arcs. Polls. */
export function useGlobe() {
  return useQuery<{ points: GlobePoint[]; arcs: GlobeArc[] }>({
    queryKey: ["globe"],
    queryFn: () => json("/api/globe"),
    staleTime: 25_000, // cache between refetches (was 0 → refetched constantly)
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    placeholderData: { points: [], arcs: [] },
  });
}

/** Leaderboard top-N. Polls. */
export function useLeaderboard() {
  return useQuery<{ rows: LeaderRow[] }>({
    queryKey: ["leaderboard"],
    queryFn: () => json("/api/leaderboard"),
    staleTime: 50_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    placeholderData: { rows: [] },
  });
}
