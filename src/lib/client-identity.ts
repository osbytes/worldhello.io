"use client";

import FingerprintJS from "@fingerprintjs/fingerprintjs";

const LID_KEY = "wh_lid";
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC-4122 v4 UUID. Works on plain HTTP LAN IPs where crypto.randomUUID is unavailable. */
function newLocalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch {
      /* non-secure context (e.g. http://192.168.x.x) — fall through */
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function readCookie(name: string): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

function persistLocalId(id: string): void {
  try {
    localStorage.setItem(LID_KEY, id);
  } catch {
    /* private mode may throw */
  }
  document.cookie = `${LID_KEY}=${id};path=/;max-age=${60 * 60 * 24 * 730};samesite=lax`;
}

/** Stable client UUID — localStorage primary, cookie mirror (DESIGN §2 identity layer 1). */
export function getLocalId(): string {
  let id = "";
  try {
    id = localStorage.getItem(LID_KEY) || "";
  } catch {
    /* private mode may throw */
  }
  if (!id) id = readCookie(LID_KEY);

  // Regenerate if missing or not a valid UUID (legacy fallback IDs fail server validation).
  if (!UUID_RE.test(id)) {
    id = newLocalId();
    persistLocalId(id);
  }
  return id;
}

let fpPromise: Promise<string | null> | null = null;
/** FingerprintJS visitorId (DESIGN §2 identity layer 2, fuzzy fallback). */
export function getFingerprint(): Promise<string | null> {
  if (!fpPromise) {
    fpPromise = FingerprintJS.load()
      .then((fp) => fp.get())
      .then((r) => r.visitorId)
      .catch(() => null);
  }
  return fpPromise;
}

/**
 * Best-effort incognito detection (DESIGN §2). Private windows give a tiny storage
 * quota. Not perfect, but enough to warn "chain won't link reliably."
 */
export async function detectIncognito(): Promise<boolean> {
  try {
    if (navigator.storage?.estimate) {
      const { quota } = await navigator.storage.estimate();
      if (quota && quota < 120 * 1024 * 1024) return true; // <120MB ≈ private
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Resolve a promise with a fallback if it doesn't settle in `ms` (private windows
 *  can make botd/fingerprint hang — must never block registration). */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Brave and similar browsers farble fingerprint APIs — report for server soft overrides. */
export function detectPrivacyBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { brave?: { isBrave?: () => boolean } };
  try {
    if (nav.brave?.isBrave?.()) return true;
  } catch {
    /* ignore */
  }
  return false;
}

let botdPromise: Promise<boolean> | null = null;
/** @fingerprintjs/botd headless/automation detection (client signal). */
async function detectBot(): Promise<boolean> {
  if (!botdPromise) {
    botdPromise = withTimeout(
      import("@fingerprintjs/botd")
        .then((m) => m.load())
        .then((botd) => botd.detect())
        .then((r) => r.bot === true)
        .catch(() => false),
      2500,
      false,
    );
  }
  return botdPromise;
}

export type NodeResponse = {
  code: string;
  isNew: boolean;
  clickedRef?: string | null;
  depth?: number;
  ephemeral?: boolean;
  metrics: { reach: number; direct: number; maxDepth: number; countries: number };
};

/** Register/resolve this device. Returns share code + metrics. */
export async function registerNode(ref: string | null): Promise<NodeResponse | null> {
  const localId = getLocalId();
  // None of these signals may block registration — cap each with a timeout.
  const [fingerprint, incognito, botd] = await Promise.all([
    withTimeout(getFingerprint(), 2500, null),
    withTimeout(detectIncognito(), 1000, false),
    detectBot(), // already timeout-wrapped
  ]);

  // Acquisition source: external referrer + explicit ?src share-channel tag.
  const referer = typeof document !== "undefined" ? document.referrer || undefined : undefined;
  const src =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search).get("src") || undefined
      : undefined;

  const payload = {
    localId,
    fingerprint: fingerprint || undefined,
    ref: ref && ref.length >= 4 ? ref : undefined,
    incognito,
    botd,
    privacyBrowser: detectPrivacyBrowser() || undefined,
    referer,
    src: src && src.length > 0 ? src : undefined,
  };

  let res: Response;
  try {
    res = await fetch("/api/node", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // Network/BotID-injection failure (can happen in private windows). Surface it.
    console.error("[worldhello] register fetch failed", e);
    return null;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`[worldhello] register rejected: HTTP ${res.status} ${body}`);
    return null;
  }
  return (await res.json()) as NodeResponse;
}
