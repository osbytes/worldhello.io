import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { linkDevices, deviceLinkStatus } from "@/lib/account-link";
import { executeMagicVerify } from "@/lib/magic-verify";
import { deviceAccountHash, emailHash } from "@/lib/crypto";
import { db } from "@/db";

async function createNode(localId: string, code: string) {
  await db.execute(sql`
    INSERT INTO nodes (code, local_id, class, depth, path)
    VALUES (${code}, ${localId}, 'human', 0, '1')
  `);
}

async function accountExistsForHash(hash: string): Promise<boolean> {
  const r = (await db.execute(sql`
    SELECT 1 FROM accounts WHERE email_hash = ${hash} LIMIT 1;
  `)) as unknown as { rows: unknown[] };
  return !!r.rows?.[0];
}

async function cleanup(localIds: string[], nonce?: string) {
  if (nonce) {
    await db.execute(sql`DELETE FROM magic_tokens WHERE nonce = ${nonce}`);
  }
  const accountIds = new Set<number>();
  for (const localId of localIds) {
    const r = (await db.execute(sql`
      SELECT account_id AS "accountId" FROM nodes WHERE local_id = ${localId};
    `)) as unknown as { rows: { accountId: number | null }[] };
    const accountId = r.rows?.[0]?.accountId;
    if (accountId != null) accountIds.add(accountId);
    await db.execute(sql`DELETE FROM nodes WHERE local_id = ${localId}`);
  }
  for (const accountId of accountIds) {
    await db.execute(sql`
      DELETE FROM accounts a
      WHERE a.id = ${accountId}
        AND NOT EXISTS (SELECT 1 FROM nodes n WHERE n.account_id = a.id);
    `);
  }
}

describe("executeMagicVerify with linked devices", () => {
  it("keeps device links when verifying email on desktop after link", async () => {
    const desktop = randomUUID();
    const mobile = randomUUID();
    const nonce = `test-${randomUUID()}`;
    const email = `test-${randomUUID()}@example.com`;

    await createNode(desktop, `d${randomUUID().slice(0, 6)}`);
    await createNode(mobile, `m${randomUUID().slice(0, 6)}`);

    try {
      const linkResult = await linkDevices(desktop, mobile);
      expect(linkResult.ok).toBe(true);

      const afterLinkDesktop = await deviceLinkStatus(desktop);
      const afterLinkMobile = await deviceLinkStatus(mobile);
      expect(afterLinkDesktop?.devicesLinked).toBe(true);
      expect(afterLinkMobile?.devicesLinked).toBe(true);

      // linkDevices(desktop, …) minted a synthetic account keyed on the source.
      const syntheticHash = deviceAccountHash(desktop);
      expect(await accountExistsForHash(syntheticHash)).toBe(true);

      await db.execute(sql`
        INSERT INTO magic_tokens (nonce, email_hash, local_id, expires_at)
        VALUES (${nonce}, ${emailHash(email)}, ${desktop}, now() + interval '30 minutes')
      `);

      const verifyResult = await executeMagicVerify(nonce, desktop);
      expect(verifyResult).toBe("ok");

      const afterVerifyDesktop = await deviceLinkStatus(desktop);
      const afterVerifyMobile = await deviceLinkStatus(mobile);
      expect(afterVerifyDesktop?.emailVerified).toBe(true);
      expect(afterVerifyDesktop?.devicesLinked).toBe(true);
      expect(afterVerifyMobile?.devicesLinked).toBe(true);
      expect(afterVerifyDesktop?.siblingCount).toBe(1);
      expect(afterVerifyMobile?.siblingCount).toBe(1);

      // The now-empty synthetic account must be cleaned up (no orphan rows).
      expect(await accountExistsForHash(syntheticHash)).toBe(false);
      expect(await accountExistsForHash(emailHash(email))).toBe(true);
    } finally {
      await cleanup([desktop, mobile], nonce);
    }
  });

  it("keeps device links when magic token was issued before link", async () => {
    const desktop = randomUUID();
    const mobile = randomUUID();
    const nonce = `test-${randomUUID()}`;
    const email = `test-${randomUUID()}@example.com`;

    await createNode(desktop, `d${randomUUID().slice(0, 6)}`);
    await createNode(mobile, `m${randomUUID().slice(0, 6)}`);

    try {
      await db.execute(sql`
        INSERT INTO magic_tokens (nonce, email_hash, local_id, expires_at)
        VALUES (${nonce}, ${emailHash(email)}, ${desktop}, now() + interval '30 minutes')
      `);

      expect((await linkDevices(desktop, mobile)).ok).toBe(true);
      expect(await executeMagicVerify(nonce, desktop)).toBe("ok");

      expect((await deviceLinkStatus(desktop))?.devicesLinked).toBe(true);
      expect((await deviceLinkStatus(mobile))?.devicesLinked).toBe(true);
    } finally {
      await cleanup([desktop, mobile], nonce);
    }
  });

  it("keeps device links when mobile is link source and desktop verifies", async () => {
    const desktop = randomUUID();
    const mobile = randomUUID();
    const nonce = `test-${randomUUID()}`;
    const email = `test-${randomUUID()}@example.com`;

    await createNode(desktop, `d${randomUUID().slice(0, 6)}`);
    await createNode(mobile, `m${randomUUID().slice(0, 6)}`);

    try {
      expect((await linkDevices(mobile, desktop)).ok).toBe(true);

      await db.execute(sql`
        INSERT INTO magic_tokens (nonce, email_hash, local_id, expires_at)
        VALUES (${nonce}, ${emailHash(email)}, ${desktop}, now() + interval '30 minutes')
      `);

      expect(await executeMagicVerify(nonce, desktop)).toBe("ok");

      expect((await deviceLinkStatus(desktop))?.devicesLinked).toBe(true);
      expect((await deviceLinkStatus(mobile))?.devicesLinked).toBe(true);
    } finally {
      await cleanup([desktop, mobile], nonce);
    }
  });

  it("keeps device links when target device verifies after link", async () => {
    const desktop = randomUUID();
    const mobile = randomUUID();
    const nonce = `test-${randomUUID()}`;
    const email = `test-${randomUUID()}@example.com`;

    await createNode(desktop, `d${randomUUID().slice(0, 6)}`);
    await createNode(mobile, `m${randomUUID().slice(0, 6)}`);

    try {
      expect((await linkDevices(desktop, mobile)).ok).toBe(true);

      await db.execute(sql`
        INSERT INTO magic_tokens (nonce, email_hash, local_id, expires_at)
        VALUES (${nonce}, ${emailHash(email)}, ${mobile}, now() + interval '30 minutes')
      `);

      expect(await executeMagicVerify(nonce, mobile)).toBe("ok");

      expect((await deviceLinkStatus(desktop))?.devicesLinked).toBe(true);
      expect((await deviceLinkStatus(mobile))?.devicesLinked).toBe(true);
    } finally {
      await cleanup([desktop, mobile], nonce);
    }
  });
});
