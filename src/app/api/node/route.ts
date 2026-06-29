import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { nodeSignals } from "@/db/schema";
import {
  createNode,
  resolveNode,
  relinkNodeLocalId,
  nodeByCode,
  metricsForNode,
  bumpAncestors,
  type CreatedNode,
} from "@/db/graph";
import { newCode } from "@/lib/codes";
import { classify, isHuman } from "@/lib/classify";
import { geoFromHeaders, clientIp } from "@/lib/geo";
import { hashKeyed } from "@/lib/crypto";
import { logApiError, logApiReject, zodIssueSummary } from "@/lib/api-log";
import { admit } from "@/lib/ratelimit";
import { riskScore } from "@/lib/risk";
import { checkBotId } from "botid/server";

export const runtime = "nodejs";

const Body = z.object({
  localId: z.string().uuid(),
  fingerprint: z.string().min(8).max(128).optional(),
  ref: z.string().min(4).max(16).optional(), // referrer share code
  incognito: z.boolean().optional(),
  botd: z.boolean().optional(), // @fingerprintjs/botd client verdict
  referer: z.string().max(512).optional(), // document.referrer (client-observed)
  src: z.string().max(64).optional(), // share-channel tag from ?src=
});

const COOKIE = "wh_lid";

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    logApiReject("node", "bad_request", zodIssueSummary(parsed.error.issues));
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const cookieLocalId = req.cookies.get(COOKIE)?.value;
  if (cookieLocalId && cookieLocalId !== parsed.data.localId) {
    logApiReject("node", "identity_mismatch", { hasCookie: true });
    return NextResponse.json({ error: "identity_mismatch" }, { status: 403 });
  }

  const { localId, fingerprint, ref, incognito, botd, src } = parsed.data;

  const h = req.headers;
  const ua = h.get("user-agent");
  // External source the click came from: prefer server Referer, fall back to client-observed.
  const referer = h.get("referer") ?? parsed.data.referer ?? null;

  // Authoritative server bot verdict (immune to UA spoofing). Best-effort — never
  // let a detector outage block real users. Only active in production (BotID needs
  // Vercel infra; in dev it returns HUMAN / can error).
  let botIdIsBot = false;
  if (process.env.NODE_ENV === "production") {
    try {
      const v = await checkBotId();
      botIdIsBot = v.isBot;
    } catch {
      /* detector unavailable — fall through to UA/botd */
    }
  }
  const nodeClass = classify({ ua, botdDetected: botd, botIdIsBot });
  const fpHash = fingerprint ? hashKeyed(fingerprint) : null;
  const ipHash = hashKeyed(clientIp(h));

  // ── Resolve referrer code → id (write-once edge source). ──
  let referrerId: number | null = null;
  if (ref) {
    const r = await nodeByCode(ref);
    if (r) referrerId = r.id;
  }

  // ── Existing identity? localId → fingerprint fallback. No new node, no re-parent. ──
  const existing = await resolveNode(localId, fpHash);
  if (existing) {
    if (existing.localId !== localId) {
      await relinkNodeLocalId(existing.id, localId);
    }
    const metrics = await metricsForNode(existing.id);
    const res = NextResponse.json({
      code: existing.code,
      isNew: false,
      // referrer-clicks-referee "recognize + celebrate" handled client-side from `ref`.
      clickedRef: ref ?? null,
      metrics,
    });
    setCookie(res, localId);
    return res;
  }

  // ── Admission control (Redis counters; allow-all if no Redis in dev). ──
  const verdict = await admit({ localId, fingerprint: fpHash, referrerId, ipHash });
  if (!verdict.ok) {
    logApiReject("node", "rate_limited", { reason: verdict.reason });
    return NextResponse.json({ error: "rate_limited", reason: verdict.reason }, { status: 429 });
  }

  const geo = geoFromHeaders(h);
  const ephemeral = !!incognito;

  // ── Create node (single-statement ltree path + depth + cycle/depth guard). ──
  let created: CreatedNode;
  try {
    created = await createNode({
      code: newCode(),
      localId,
      fingerprint: fpHash,
      referrerId,
      class: nodeClass,
      ephemeral,
      country: geo.country,
      lat: geo.lat,
      lng: geo.lng,
    });
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "NODE_CREATE_REJECTED") {
      logApiReject("node", "rejected");
      return NextResponse.json({ error: "rejected" }, { status: 409 });
    }
    // unique(local_id) race → treat as existing
    const retry = await resolveNode(localId, fpHash);
    if (retry) {
      if (retry.localId !== localId) {
        await relinkNodeLocalId(retry.id, localId);
      }
      const metrics = await metricsForNode(retry.id);
      const res = NextResponse.json({ code: retry.code, isNew: false, metrics });
      setCookie(res, localId);
      return res;
    }
    logApiError("node", "create failed", e);
    throw e;
  }
  if (isHuman(nodeClass)) {
    await bumpAncestors(created, geo.country);
  }

  // ── Audit signal (append-only; risk advisory + acquisition source). ──
  await db.insert(nodeSignals).values({
    nodeId: created.id,
    fingerprint: fpHash,
    ipHash,
    ua: ua ?? null,
    incognitoGuess: ephemeral,
    referer: refererHost(referer), // origin only — never store full URL/query (privacy)
    src: src ?? null,
    riskScore: riskScore({
      class: nodeClass,
      ephemeral,
      hasFingerprint: !!fpHash,
      ipShared: false,
    }),
  });

  const metrics = await metricsForNode(created.id);
  const res = NextResponse.json({
    code: created.code,
    isNew: true,
    depth: created.depth,
    class: nodeClass,
    ephemeral,
    metrics,
  });
  setCookie(res, localId);
  return res;
}

function setCookie(res: NextResponse, localId: string) {
  res.cookies.set(COOKIE, localId, {
    httpOnly: false, // client also reads it to reconcile with localStorage
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production", // HTTPS-only in prod
    maxAge: 60 * 60 * 24 * 365 * 2,
    path: "/",
  });
}

/** Reduce a referer URL to just its host (drop path/query — privacy). Skips self. */
function refererHost(referer: string | null): string | null {
  if (!referer) return null;
  try {
    const host = new URL(referer).hostname;
    return host || null;
  } catch {
    return null;
  }
}
