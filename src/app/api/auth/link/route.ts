import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { linkTokens } from "@/db/schema";
import { newLinkCode } from "@/lib/codes";
import { LINK_TTL_MS } from "@/lib/token";
import { admitLinkCreate } from "@/lib/ratelimit";

export const runtime = "nodejs";

const COOKIE = "wh_lid";

/** Create a short-lived pairing code for cross-device linking. */
export async function POST(req: NextRequest) {
  const localId = req.cookies.get(COOKIE)?.value;
  if (!localId) {
    return NextResponse.json({ error: "no_device" }, { status: 401 });
  }

  const verdict = await admitLinkCreate(localId);
  if (!verdict.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
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
    } catch {
      code = newLinkCode();
      if (i === 3) {
        return NextResponse.json({ error: "unavailable" }, { status: 503 });
      }
    }
  }

  const base = process.env.NEXT_PUBLIC_BASE_URL || req.nextUrl.origin;
  const url = `${base}/?link=${code}`;

  return NextResponse.json({
    code,
    url,
    expiresIn: Math.floor(LINK_TTL_MS / 1000),
  });
}
