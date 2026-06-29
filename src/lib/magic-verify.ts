import { sql } from "drizzle-orm";
import { db } from "@/db";

export type MagicVerifyResult = "ok" | "token_invalid" | "device_mismatch";

/**
 * Consume a magic-link token and link the requesting device to its email account.
 * Single SQL round-trip: delete token → upsert account → update node.
 * Caller must confirm `deviceLocalId` matches the cookie on the requesting device.
 */
export async function executeMagicVerify(
  nonce: string,
  deviceLocalId: string,
): Promise<MagicVerifyResult> {
  const peek = (await db.execute(sql`
    SELECT local_id AS "localId"
    FROM magic_tokens
    WHERE nonce = ${nonce} AND expires_at > now()
    LIMIT 1;
  `)) as unknown as { rows: { localId: string }[] };

  const expected = peek.rows?.[0]?.localId;
  if (!expected) return "token_invalid";
  if (expected !== deviceLocalId) return "device_mismatch";

  const result = (await db.execute(sql`
    WITH consumed AS (
      DELETE FROM magic_tokens
      WHERE nonce = ${nonce}
        AND expires_at > now()
        AND local_id = ${deviceLocalId}
      RETURNING email_hash, local_id
    ),
    acc AS (
      INSERT INTO accounts (email_hash)
      SELECT email_hash FROM consumed
      ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
      RETURNING id
    ),
    linked AS (
      UPDATE nodes n
      SET
        account_id = (SELECT id FROM acc LIMIT 1),
        verified = true,
        ephemeral = false
      WHERE n.local_id = (SELECT local_id FROM consumed LIMIT 1)
        AND EXISTS (SELECT 1 FROM consumed)
        AND EXISTS (SELECT 1 FROM acc)
      RETURNING n.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM consumed) AS consumed,
      (SELECT COUNT(*)::int FROM linked) AS linked,
      (SELECT id FROM acc LIMIT 1) AS "accountId";
  `)) as unknown as { rows: { consumed: number; linked: number; accountId: number | null }[] };

  const row = result.rows?.[0];
  if (!row || Number(row.consumed) === 0) return "token_invalid";
  if (row.accountId == null || Number(row.linked) === 0) {
    throw new Error("MAGIC_VERIFY_INCOMPLETE");
  }
  return "ok";
}

/** Non-consuming check that a signed token still exists and is unexpired. */
export async function peekMagicToken(nonce: string): Promise<boolean> {
  const r = (await db.execute(sql`
    SELECT 1 FROM magic_tokens
    WHERE nonce = ${nonce} AND expires_at > now()
    LIMIT 1;
  `)) as unknown as { rows: unknown[] };
  return !!r.rows?.[0];
}
