import { sql } from "drizzle-orm";
import { db } from "@/db";

export type MagicVerifyResult = "ok" | "token_invalid" | "device_mismatch";
export type MagicTokenStatus = "valid" | "expired" | "absent";

/** Whether a nonce still exists and is unexpired (non-consuming). */
export async function magicTokenStatus(nonce: string): Promise<MagicTokenStatus> {
  const r = (await db.execute(sql`
    SELECT (expires_at > now()) AS "stillValid"
    FROM magic_tokens
    WHERE nonce = ${nonce}
    LIMIT 1;
  `)) as unknown as { rows: { stillValid: boolean }[] };

  const row = r.rows?.[0];
  if (!row) return "absent";
  return row.stillValid ? "valid" : "expired";
}

/**
 * Consume a magic-link token and attach the device group to its email account.
 * Single SQL round-trip: delete token → upsert email account → move verifying
 * device plus any already-linked siblings onto that account.
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
    pre AS (
      SELECT n.account_id AS old_account_id
      FROM nodes n
      WHERE n.local_id = (SELECT local_id FROM consumed LIMIT 1)
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
        verified = (n.local_id = (SELECT local_id FROM consumed LIMIT 1)),
        ephemeral = false
      WHERE EXISTS (SELECT 1 FROM consumed)
        AND EXISTS (SELECT 1 FROM acc)
        AND (
          n.local_id = (SELECT local_id FROM consumed LIMIT 1)
          OR (
            (SELECT old_account_id FROM pre LIMIT 1) IS NOT NULL
            AND n.account_id = (SELECT old_account_id FROM pre LIMIT 1)
          )
        )
      RETURNING n.id
    )
    SELECT
      (SELECT COUNT(*)::int FROM consumed) AS consumed,
      (SELECT COUNT(*)::int FROM linked) AS linked,
      (SELECT id FROM acc LIMIT 1) AS "accountId",
      (SELECT old_account_id FROM pre LIMIT 1) AS "oldAccountId";
  `)) as unknown as {
    rows: {
      consumed: number;
      linked: number;
      accountId: number | null;
      oldAccountId: number | null;
    }[];
  };

  const row = result.rows?.[0];
  if (!row || Number(row.consumed) === 0) return "token_invalid";
  if (row.accountId == null || Number(row.linked) === 0) {
    throw new Error("MAGIC_VERIFY_INCOMPLETE");
  }

  // The device's prior account (e.g. a synthetic device-link account keyed by
  // deviceAccountHash) just had all its nodes migrated onto the email account.
  // Drop it if it's now empty so we don't leak orphaned account rows. Separate
  // statement: a data-modifying CTE can't see the `linked` UPDATE's effect on the
  // same snapshot, and the FK (nodes.account_id → accounts.id) is RESTRICT.
  if (row.oldAccountId != null && row.oldAccountId !== row.accountId) {
    await db.execute(sql`
      DELETE FROM accounts a
      WHERE a.id = ${row.oldAccountId}
        AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.account_id = a.id);
    `);
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
