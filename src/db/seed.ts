/**
 * Seed a synthetic referral tree so the globe + leaderboard render in dev.
 * Run: pnpm db:seed   (after db:migrate)
 */
import { sql } from "drizzle-orm";
import { db } from "./index"; // driver auto-detected (neon vs node-postgres)
import { newCode } from "@/lib/codes";
import { createNode, bumpAncestors } from "./graph"; // reuse runtime path (single source of truth)

const COUNTRIES = ["US", "BR", "NG", "IN", "ID", "DE", "JP", "GB", "FR", "ZA", "MX", "EG"];
const CITY: Record<string, [number, number]> = {
  US: [37.7, -122.4], BR: [-23.5, -46.6], NG: [6.5, 3.4], IN: [19.0, 72.8],
  ID: [-6.2, 106.8], DE: [52.5, 13.4], JP: [35.6, 139.7], GB: [51.5, -0.1],
  FR: [48.8, 2.3], ZA: [-26.2, 28.0], MX: [19.4, -99.1], EG: [30.0, 31.2],
};

async function main() {
  const N = 500;
  const ids: number[] = [];
  console.log(`Seeding ${N} nodes…`);

  for (let i = 0; i < N; i++) {
    const country = COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)];
    const [blat, blng] = CITY[country];
    const lat = blat + (Math.random() - 0.5) * 6;
    const lng = blng + (Math.random() - 0.5) * 6;
    const referrerId = ids.length && Math.random() > 0.15 ? ids[Math.floor(Math.random() * ids.length)] : null;

    const node = await createNode({
      code: newCode(),
      localId: "seed-" + i,
      fingerprint: "fp-" + i,
      referrerId,
      class: "human",
      ephemeral: false,
      country,
      lat,
      lng,
    });
    ids.push(node.id);

    // Randomly mark some verified (badge + brighter globe render).
    if (Math.random() > 0.85) {
      await db.execute(sql`UPDATE nodes SET verified = true WHERE id = ${node.id};`);
    }

    await bumpAncestors(node, country);
  }
  console.log("Seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
