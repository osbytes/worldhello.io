import {
  bigint,
  bigserial,
  boolean,
  customType,
  doublePrecision,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Postgres `ltree` type. Drizzle has no native ltree, so we expose it as a
 * text-backed custom type. The actual column type + GiST index are created in
 * migrations/0001_ltree.sql (drizzle-kit cannot emit ltree DDL).
 *
 * A node's path is `<rootId>.<...>.<selfId>` using bigint ids as labels.
 */
export const ltree = customType<{ data: string; driverData: string }>({
  dataType() {
    return "ltree";
  },
});

/** Optional email-verified account. The ACCOUNT is the cross-device identity. */
export const accounts = pgTable("accounts", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  emailHash: text("email_hash").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One-time magic-link tokens. Email + localId held server-side (never in the URL).
 * Consumed (deleted) on first successful verify → single-use. Expired rows reaped.
 */
export const magicTokens = pgTable(
  "magic_tokens",
  {
    nonce: text("nonce").primaryKey(),
    emailHash: text("email_hash").notNull(),
    localId: text("local_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("magic_tokens_expires_idx").on(t.expiresAt)],
);

/**
 * Short-lived device-pairing codes. Source localId held server-side.
 * Consumed (deleted) on first successful accept → single-use. Expired rows reaped.
 */
export const linkTokens = pgTable(
  "link_tokens",
  {
    code: text("code").primaryKey(),
    sourceLocalId: text("source_local_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("link_tokens_expires_idx").on(t.expiresAt),
    index("link_tokens_source_idx").on(t.sourceLocalId),
  ],
);

/**
 * A node = one device/identity in the referral graph.
 * `referrer_id` is WRITE-ONCE (enforced in app layer + trigger). See DESIGN §2.
 */
export const nodes = pgTable(
  "nodes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    code: text("code").notNull().unique(), // short share code (nanoid)
    referrerId: bigint("referrer_id", { mode: "number" }), // FK nodes.id, write-once
    localId: text("local_id").notNull(), // client UUID (localStorage + cookie)
    fingerprint: text("fingerprint"), // hashed FingerprintJS visitorId
    accountId: bigint("account_id", { mode: "number" }), // FK accounts.id when linked
    class: text("class").notNull().default("human"), // human | bot | crawler | preview
    ephemeral: boolean("ephemeral").notNull().default(false), // incognito / unclaimed
    verified: boolean("verified").notNull().default(false), // belongs to verified account
    depth: integer("depth").notNull().default(0), // distance from root
    country: text("country"), // ISO-3166 alpha-2
    lat: doublePrecision("lat"),
    lng: doublePrecision("lng"),
    geoPrecise: boolean("geo_precise").notNull().default(false),
    path: ltree("path"), // materialized path; set after insert (needs own id)
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("nodes_local_id_uniq").on(t.localId), // one node per localId
    index("nodes_referrer_idx").on(t.referrerId),
    index("nodes_account_idx").on(t.accountId),
    index("nodes_fingerprint_idx").on(t.fingerprint),
    // GiST index on path created in 0001_ltree.sql.
  ],
);

/** Append-only audit / re-link signals. Many rows per node. Droppable/partitionable. */
export const nodeSignals = pgTable(
  "node_signals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    nodeId: bigint("node_id", { mode: "number" }).notNull(),
    fingerprint: text("fingerprint"),
    ipHash: text("ip_hash"),
    ua: text("ua"),
    botidVerdict: text("botid_verdict"),
    incognitoGuess: boolean("incognito_guess"),
    riskScore: integer("risk_score"),
    referer: text("referer"), // external HTTP Referer / document.referrer (where the click came from)
    src: text("src"), // explicit share-channel tag from the share link (?src=whatsapp etc.)
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("node_signals_node_idx").on(t.nodeId)],
);

/** Denormalized metrics cache, refreshed on subtree change. Per node. */
export const cachedMetrics = pgTable("cached_metrics", {
  nodeId: bigint("node_id", { mode: "number" }).primaryKey(),
  reach: integer("reach").notNull().default(0), // human-class descendants
  direct: integer("direct").notNull().default(0),
  maxDepth: integer("max_depth").notNull().default(0),
  countries: integer("countries").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Node = typeof nodes.$inferSelect;
export type NewNode = typeof nodes.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type CachedMetrics = typeof cachedMetrics.$inferSelect;
