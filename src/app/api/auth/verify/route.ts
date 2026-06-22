import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { verifyNonce } from "@/lib/token";

export const runtime = "nodejs";

/**
 * Magic-link verify → account merge (DESIGN §5.5).
 *  - token carries only a signed nonce; email/localId live in the magic_tokens row
 *  - the row is consumed atomically (DELETE ... RETURNING) → single-use, replay-safe
 *  - ONLY the device that requested the link is verified (no bulk sibling upgrade)
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const nonce = token ? verifyNonce(token) : null;
  if (!nonce) return fail(req);

  // Atomically consume the token (delete + return) and reject if expired.
  const consumed = (await db.execute(sql`
    DELETE FROM magic_tokens
    WHERE nonce = ${nonce} AND expires_at > now()
    RETURNING email_hash AS "emailHash", local_id AS "localId";
  `)) as unknown as { rows: { emailHash: string; localId: string }[] };

  const row = consumed.rows?.[0];
  if (!row) return fail(req); // unknown, already-used, or expired

  // Upsert account by email hash.
  const acc = (await db.execute(sql`
    INSERT INTO accounts (email_hash) VALUES (${row.emailHash})
    ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
    RETURNING id;
  `)) as unknown as { rows: { id: number }[] };
  const accountId = acc.rows?.[0]?.id;

  // Link + verify ONLY the requesting device. referrer_id untouched (write-once).
  await db.execute(sql`
    UPDATE nodes SET account_id = ${accountId}, verified = true, ephemeral = false
    WHERE local_id = ${row.localId};
  `);

  return NextResponse.redirect(new URL("/?verified=1", req.nextUrl.origin));
}

function fail(req: NextRequest) {
  return NextResponse.redirect(new URL("/?verify=failed", req.nextUrl.origin));
}
