import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { linkTokens } from "@/db/schema";
import { newLinkCode } from "@/lib/codes";
import { logApiError, logApiReject } from "@/lib/api-log";
import { LINK_TTL_MS } from "@/lib/token";
import { admitLinkCreate } from "@/lib/ratelimit";
import { siteBaseUrl } from "@/lib/site";

export const runtime = "nodejs";

const COOKIE = "wh_lid";

/** Create a short-lived pairing code for cross-device linking. */
export async function POST(req: NextRequest) {
  const localId = req.cookies.get(COOKIE)?.value;
  if (!localId) {
    logApiReject("auth/link", "no_device", { hasCookie: false });
    return NextResponse.json({ error: "no_device" }, { status: 401 });
  }

  const verdict = await admitLinkCreate(localId);
  if (!verdict.ok) {
    logApiReject("auth/link", "rate_limited", { reason: verdict.reason });
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const registered = (await db.execute(sql`
    SELECT 1 FROM nodes WHERE local_id = ${localId} LIMIT 1;
  `)) as unknown as { rows: unknown[] };
  if (!registered.rows?.[0]) {
    logApiReject("auth/link", "not_registered", { hasCookie: true });
    return NextResponse.json({ error: "not_registered" }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + LINK_TTL_MS);
  let code = newLinkCode();

  // Collision retry (extremely unlikely with 32^6 space).
  for (let i = 0; i < 4; i++) {
    try {
      await db.insert(linkTokens).values({
        code,
        sourceLocalId: localId,
        expiresAt,
      });
      break;
    } catch (err) {
      code = newLinkCode();
      if (i === 3) {
        logApiError("auth/link", "code insert failed after retries", err);
        return NextResponse.json({ error: "unavailable" }, { status: 503 });
      }
    }
  }

  const base = siteBaseUrl(req.nextUrl.origin);
  const url = `${base}/?link=${code}`;

  return NextResponse.json({
    code,
    url,
    expiresIn: Math.floor(LINK_TTL_MS / 1000),
  });
}
