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
 * Merge two device nodes under one account (DESIGN §5.5).
 * Does not email-verify — only syncs stats/globe across devices. Unlink reverts this device.
 */
export async function linkDevices(
  sourceLocalId: string,
  targetLocalId: string,
): Promise<LinkDevicesResult> {
  if (sourceLocalId === targetLocalId) {
    return { ok: false, reason: "same_device" };
  }

  const source = (await db.execute(sql`
    SELECT id, account_id AS "accountId"
    FROM nodes
    WHERE local_id = ${sourceLocalId};
  `)) as unknown as { rows: { id: number; accountId: number | null }[] };

  const srcNode = source.rows?.[0];
  if (!srcNode) return { ok: false, reason: "source_missing" };

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

  const target = (await db.execute(sql`
    UPDATE nodes SET account_id = ${accountId}, ephemeral = false
    WHERE local_id = ${targetLocalId}
    RETURNING id;
  `)) as unknown as { rows: { id: number }[] };

  if (!target.rows?.[0]) return { ok: false, reason: "target_missing" };

  return { ok: true, accountId };
}
