"use client";

import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { registerNode, type NodeResponse } from "./client-identity";
import type { MeDetail } from "./types";
import type { GlobePoint, GlobeArc, LeaderRow } from "@/db/reads";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code?: string,
  ) {
    super(code ?? `HTTP ${status}`);
    this.name = "ApiError";
  }
}

export type AccountStatus = {
  emailVerified: boolean;
  devicesLinked: boolean;
  siblingCount: number;
};

export type LinkSession = { code: string; url: string; expiresIn: number };

async function json<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json() as Promise<T>;
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const err = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(r.status, err?.error);
  }
  return r.json() as Promise<T>;
}

/** Refetch dashboard data after a device link / unlink / email verify. */
export function invalidateAfterLinkChange(queryClient: QueryClient, nodeCode?: string) {
  if (nodeCode) {
    void queryClient.invalidateQueries({ queryKey: ["me", nodeCode] });
  }
  void queryClient.invalidateQueries({ queryKey: ["account"] });
  void queryClient.invalidateQueries({ queryKey: ["register"] });
  void queryClient.invalidateQueries({ queryKey: ["globe"] });
  void queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
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

/** Email verification + device link status for the current browser. */
export function useAccount() {
  return useQuery<AccountStatus | null>({
    queryKey: ["account"],
    queryFn: async () => {
      const r = await fetch("/api/auth/account");
      if (!r.ok) return null;
      return r.json() as Promise<AccountStatus>;
    },
    staleTime: 30_000,
  });
}

export function useCreateLinkSession() {
  return useMutation({
    mutationFn: () => postJson<LinkSession>("/api/auth/link"),
    retry: false,
  });
}

export function useAcceptLinkCode() {
  return useMutation({
    mutationFn: (code: string) =>
      postJson<{ ok: true }>("/api/auth/link/accept", { code: code.trim().toLowerCase() }),
    retry: false,
  });
}

export function useUnlinkDevice() {
  return useMutation({
    mutationFn: () => postJson<{ ok: true }>("/api/auth/unlink"),
    retry: false,
  });
}

export function useSendMagicEmail() {
  return useMutation({
    mutationFn: (email: string) => postJson<{ ok: true }>("/api/auth/magic", { email }),
    retry: false,
  });
}

/** Accept a ?link= code after registration; strips the param on success. */
export async function acceptLinkFromUrl(code: string): Promise<boolean> {
  const normalized = code.trim().toLowerCase();
  if (normalized.length !== 6) return false;

  try {
    await postJson<{ ok: true }>("/api/auth/link/accept", { code: normalized });
  } catch {
    return false;
  }

  if (typeof window !== "undefined") {
    const url = new URL(window.location.href);
    url.searchParams.delete("link");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  }
  return true;
}
