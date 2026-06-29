import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { linkDevices } from "@/lib/account-link";
import { admitLinkAccept } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Body = z.object({
  code: z
    .string()
    .min(6)
    .max(6)
    .regex(/^[23456789abcdefghjkmnpqrstuvwxyz]+$/),
});
const COOKIE = "wh_lid";

/** Consume a pairing code and link this device to the source account. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  const targetLocalId = req.cookies.get(COOKIE)?.value;

  if (!parsed.success || !targetLocalId) {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const verdict = await admitLinkAccept(targetLocalId);
  if (!verdict.ok) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const code = parsed.data.code;
  const consumed = (await db.execute(sql`
    DELETE FROM link_tokens
    WHERE code = ${code} AND expires_at > now()
    RETURNING source_local_id AS "sourceLocalId";
  `)) as unknown as { rows: { sourceLocalId: string }[] };

  const row = consumed.rows?.[0];
  if (!row) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const result = await linkDevices(row.sourceLocalId, targetLocalId);
  if (!result.ok) {
    const status =
      result.reason === "same_device" ? 409 : result.reason === "target_missing" ? 404 : 400;
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
