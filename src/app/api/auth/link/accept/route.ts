import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { linkDevices } from "@/lib/account-link";
import { logApiReject, zodIssueSummary } from "@/lib/api-log";
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
    logApiReject("auth/link/accept", "bad_request", {
      bodyValid: parsed.success,
      hasCookie: !!targetLocalId,
      ...(parsed.success ? {} : zodIssueSummary(parsed.error.issues)),
    });
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }

  const verdict = await admitLinkAccept(targetLocalId);
  if (!verdict.ok) {
    logApiReject("auth/link/accept", "rate_limited", { reason: verdict.reason });
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const code = parsed.data.code;

  const pending = (await db.execute(sql`
    SELECT source_local_id AS "sourceLocalId"
    FROM link_tokens
    WHERE code = ${code} AND expires_at > now()
    LIMIT 1;
  `)) as unknown as { rows: { sourceLocalId: string }[] };

  const pendingRow = pending.rows?.[0];
  if (!pendingRow) {
    logApiReject("auth/link/accept", "invalid_code", { codeLen: code.length });
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const sourceExists = (await db.execute(sql`
    SELECT 1 FROM nodes WHERE local_id = ${pendingRow.sourceLocalId} LIMIT 1;
  `)) as unknown as { rows: unknown[] };
  if (!sourceExists.rows?.[0]) {
    logApiReject("auth/link/accept", "source_missing", {
      sourcePresent: false,
      targetPresent: true,
    });
    return NextResponse.json({ error: "source_missing" }, { status: 400 });
  }

  const consumed = (await db.execute(sql`
    DELETE FROM link_tokens
    WHERE code = ${code} AND expires_at > now()
    RETURNING source_local_id AS "sourceLocalId";
  `)) as unknown as { rows: { sourceLocalId: string }[] };

  const row = consumed.rows?.[0];
  if (!row) {
    logApiReject("auth/link/accept", "invalid_code", { codeLen: code.length });
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const result = await linkDevices(row.sourceLocalId, targetLocalId);
  if (!result.ok) {
    const status =
      result.reason === "same_device" ? 409 : result.reason === "target_missing" ? 404 : 400;
    logApiReject("auth/link/accept", result.reason, {
      sourcePresent: result.reason !== "source_missing",
      targetPresent: result.reason !== "target_missing",
    });
    return NextResponse.json({ error: result.reason }, { status });
  }

  return NextResponse.json({ ok: true });
}
