import { sql } from "drizzle-orm";
import { db } from "@/db";
import { deviceAccountHash } from "@/lib/crypto";

export type LinkDevicesResult =
  | { ok: true; accountId: number }
  | { ok: false; reason: "same_device" | "source_missing" | "target_missing" };

export type UnlinkDeviceResult =
  | { ok: true }
  | { ok: false; reason: "not_linked" | "device_missing" };

export type DeviceLinkStatus = {
  /** True when this device completed email magic-link verification. */
  emailVerified: boolean;
  /** True when this device belongs to a multi-device account group. */
  devicesLinked: boolean;
  /** Other devices on the same account (excludes this device). */
  siblingCount: number;
};

/** True when this email has completed magic-link verification (any device). */
export async function emailHashVerified(hashed: string): Promise<boolean> {
  const r = (await db.execute(sql`
    SELECT 1 FROM accounts WHERE email_hash = ${hashed} LIMIT 1;
  `)) as unknown as { rows: unknown[] };
  return !!r.rows?.[0];
}

/** Email verification + device link status for the current device. */
export async function deviceLinkStatus(localId: string): Promise<DeviceLinkStatus | null> {
  const r = (await db.execute(sql`
    SELECT account_id AS "accountId", verified AS "emailVerified"
    FROM nodes
    WHERE local_id = ${localId};
  `)) as unknown as { rows: { accountId: number | null; emailVerified: boolean }[] };

  const row = r.rows?.[0];
  if (!row) return null;

  if (row.accountId == null) {
    return { emailVerified: row.emailVerified, devicesLinked: false, siblingCount: 0 };
  }

  const siblings = (await db.execute(sql`
    SELECT COUNT(*)::int AS n
    FROM nodes
    WHERE account_id = ${row.accountId} AND local_id <> ${localId};
  `)) as unknown as { rows: { n: number }[] };

  const siblingCount = siblings.rows?.[0]?.n ?? 0;
  return {
    emailVerified: row.emailVerified,
    devicesLinked: siblingCount > 0,
    siblingCount,
  };
}

/**
 * Detach this device from its linked account group. Other devices stay linked.
 * Stats and globe view revert to this device's own node. Email verification is kept.
 */
export async function unlinkDevice(localId: string): Promise<UnlinkDeviceResult> {
  const updated = (await db.execute(sql`
    UPDATE nodes SET account_id = NULL
    WHERE local_id = ${localId} AND account_id IS NOT NULL
    RETURNING id;
  `)) as unknown as { rows: { id: number }[] };

  if (updated.rows?.[0]) return { ok: true };

  const exists = (await db.execute(sql`
    SELECT 1 FROM nodes WHERE local_id = ${localId} LIMIT 1;
  `)) as unknown as { rows: unknown[] };

  if (!exists.rows?.[0]) return { ok: false, reason: "device_missing" };
  return { ok: false, reason: "not_linked" };
}

/**
 * Merge two device groups under the source account (DESIGN §5.5).
 * The accepting device's whole prior group moves together; only `account_id` changes
 * so unlink can still detach one device back to its own per-node stats.
 */
export async function linkDevices(
  sourceLocalId: string,
  targetLocalId: string,
): Promise<LinkDevicesResult> {
  if (sourceLocalId === targetLocalId) {
    return { ok: false, reason: "same_device" };
  }

  const nodes = (await db.execute(sql`
    SELECT local_id AS "localId", account_id AS "accountId"
    FROM nodes
    WHERE local_id IN (${sourceLocalId}, ${targetLocalId});
  `)) as unknown as { rows: { localId: string; accountId: number | null }[] };

  const srcNode = nodes.rows?.find((n) => n.localId === sourceLocalId);
  const tgtNode = nodes.rows?.find((n) => n.localId === targetLocalId);
  if (!srcNode) return { ok: false, reason: "source_missing" };
  if (!tgtNode) return { ok: false, reason: "target_missing" };

  let accountId = srcNode.accountId;

  if (accountId == null) {
    const hash = deviceAccountHash(sourceLocalId);
    const acc = (await db.execute(sql`
      INSERT INTO accounts (email_hash) VALUES (${hash})
      ON CONFLICT (email_hash) DO UPDATE SET email_hash = EXCLUDED.email_hash
      RETURNING id;
    `)) as unknown as { rows: { id: number }[] };
    accountId = acc.rows?.[0]?.id;
    if (accountId == null) return { ok: false, reason: "source_missing" };

    await db.execute(sql`
      UPDATE nodes SET account_id = ${accountId}, ephemeral = false
      WHERE local_id = ${sourceLocalId};
    `);
  }

  const targetOldAccountId = tgtNode.accountId;
  if (targetOldAccountId === accountId) {
    await db.execute(sql`
      UPDATE nodes SET ephemeral = false WHERE local_id = ${targetLocalId};
    `);
    return { ok: true, accountId };
  }

  if (targetOldAccountId != null) {
    await db.execute(sql`
      UPDATE nodes SET account_id = ${accountId}, ephemeral = false
      WHERE account_id = ${targetOldAccountId};
    `);
  } else {
    await db.execute(sql`
      UPDATE nodes SET account_id = ${accountId}, ephemeral = false
      WHERE local_id = ${targetLocalId};
    `);
  }

  return { ok: true, accountId };
}
