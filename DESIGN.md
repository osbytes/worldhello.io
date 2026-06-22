# worldhello.io — Design

> Single-page globe visualizing 6-degrees-of-separation referral chains. Anonymous, fingerprint-based, viral growth experiment.

## 1. Concept

Visitor lands → sees a living globe of human connections (arcs = who-brought-whom). Gets a personal **reach + depth score**, climbs a **leaderboard**, shares their link everywhere. When landing _from_ a referral, the referrer's stats are shown first as the hook ("Maya brought 1,247 people across 38 countries — continue the chain").

Goal = **viral growth**. Every UI decision optimizes for re-share.

## 2. Core mechanics

### Identity (anonymous-first, 3 layered signals)

Fingerprints drift — never rely on them alone. Store 3 independent IDs; resolve node by best available.

1. **localId** — random UUID generated client-side, stored in `localStorage` **+** cookie **+** mirrored in DB. Primary stable handle; survives fingerprint drift.
2. **fingerprint** — FingerprintJS visitorId. Fuzzy fallback to *re-link* a lost localId (cleared storage / new browser).
3. **accountId** — email-verified. Strongest. Merges multiple (localId, fingerprint) pairs cross-device.

**Resolution order on visit:** cookie/localStorage `localId` → else `fingerprint` match (re-issue localId, link to found node) → else create new node.

**Node tiers** (priority `verified > human > ephemeral > non-human`):
- **Incognito / private window** → detect (storage-quota probe, FS API). Node `ephemeral=true`. Banner: *"Private window — your chain won't reliably link back. Verify email to keep it."* Dimmed on globe until claimed.
- **Bot / crawler / link-inspector** → server classifies: UA + FingerprintJS Pro bot signal + Vercel BotID. `class ∈ {human, bot, crawler, preview}`. `preview` = Slack/Discord/WhatsApp unfurlers. Non-human nodes excluded from reach + leaderboard, dimmed or not created.
- **Verified (email)** → ranked higher, brighter, badge. Persistent UI nudge for cross-device linking (see §2 email nudge).

- **Optional magic-link email** (cross-device linking only). Email never shown publicly. The **account** becomes the identity; device nodes become its leaves (see §5.5 merge rules).
- Partner angle: FingerprintJS sponsorship/discount (Pro for server-side signals + bot resistance).

### Email-verification nudge (combined strategy)
Cross-device linking is the value prop → drive conversion via loss-aversion, but stay respectful:
- **Persistent subtle banner** always visible ("Link your devices · keep your chain forever").
- **Milestone hard-prompt** at reach milestones ("You reached 100! Verify to never lose this.").
- **Contextual urgent prompt** whenever link is actually at risk (incognito / ephemeral / cleared storage).

### Referral chain (the graph)
- Each node has a short code → share URL `worldhello.io/<code>`.
- Landing with `?ref=<code>` (or `/<code>`) sets **referrer edge on first node creation only**.
- **`referrer_id` is write-once. Never rewritten.** This is the invariant the whole 6-degrees integrity rests on.
- Self/loop/duplicate-IP-spam guarded (see §6).
- `depth` = distance from a root (no referrer). Max chain depth is the headline 6-degrees metric.

### Chain immutability & the loop case (referrer clicks referee's link)
Scenario: Alice refers Bob → Bob shares → Alice clicks **Bob's** link.

**Rule: chains are immutable. A referee never inherits its referrer's chain, and parentage is never re-written.** Inheritance/re-parenting would splice chains and make depth (the 6-degrees metric) meaningless.

- **Known node clicks any `?ref`** (Alice already exists via localId/fingerprint/account): **no new node, no re-parent.** Re-parenting Alice under Bob = cycle → rejected by ancestry guard.
  - UX (**recognize + celebrate**): *"You started this chain! Bob is in your tree (depth 2)."* Pull up Alice's own dashboard with Bob highlighted in her subtree. Reinforces ownership → re-share.
- **New device clicks `?ref`**: new node created under referrer. Normal join flow.
- The **only** edges that ever change are at **account merge** (§5.5) — and even then device `referrer_id` rows stay; only per-account metric aggregation changes.

### The hook (referral landing)
1. Land from referral → **referrer's stat card** front-and-center: avatar-glyph, reach, countries, depth, their position on globe pulsing.
2. CTA: "Join the chain" → creates your node under them.
3. Your own score panel appears + your share tools.

### Viral metrics (per node)
- **Reach** = total descendants (whole subtree size).
- **Direct** = immediate children.
- **Depth** = max depth of your subtree (how far your link traveled).
- **Countries** = distinct countries in subtree.
- **Rank** = global leaderboard position by reach.

### Leaderboard
- Global top-N by reach. Also "rising" (most growth last 24h).
- Anti-hopeless design: show your local rank + percentile even if not top-N, and a "biggest single chain you started" stat so late joiners still have a win.

## 3. Globe (rendering)

**Tech: react-three-fiber + three.js**, custom shaders. Chosen for art-quality arcs/particles + full LOD control to scale to millions of nodes.

- **Nodes** = points on sphere at geo position (coarse IP geo, jittered).
- **Edges** = great-circle arcs (referrer → referee), animated draw-on.
- **LOD / aggregation**: at scale, server returns **binned/clustered** node density per viewport zoom (H3 or geohash buckets), not raw millions. Individual arcs only rendered for: your lineage, the active referrer chain, and a sampled "live" stream of recent joins.
- **Your path highlighted**: trace root→you lit up; your subtree glows.
- **Live joins**: websocket/SSE stream of new nodes → arc animates in ("someone in Lagos just joined").
- Perf budget: instanced meshes for points, merged geometry for arcs, GPU picking. Mobile fallback = reduced particle count + lower-res sphere.

## 4. Geo

- **Default: coarse IP geo**, city-level, jittered ±few km. Server-side (Vercel request geo / IP lookup). **Never prompts.**
- **Opt-in precise**: browser geolocation, only if user explicitly clicks "pin me precisely." Never asked by default.
- Country-level fallback when IP geo unavailable (random point in country).

## 5. Data model

**Start: Neon Postgres only.** Recursive CTE for subtree/ancestry. Redis added later when counters get hot (§7).

```sql
-- nodes
id            bigint PK
code          text unique            -- short share code
referrer_id   bigint null FK nodes(id)  -- WRITE-ONCE, never updated
local_id      text                   -- client UUID (localStorage+cookie), indexed, primary stable handle
fingerprint   text                   -- FingerprintJS visitorId (hashed), fuzzy re-link fallback
account_id    bigint null FK accounts(id)  -- set if email-linked
class         text default 'human'   -- human|bot|crawler|preview
ephemeral     boolean default false  -- incognito / unclaimed private-window
verified      boolean default false  -- node belongs to a verified account
country       text                   -- ISO
lat, lng      double precision       -- jittered display coords
geo_precise   boolean default false
created_at    timestamptz
path          ltree                  -- materialized path (root.../id) for fast subtree

-- accounts (optional magic-link)
id            bigint PK
email_hash    text unique
created_at    timestamptz

-- node_signals (audit + re-link history; many per node)
node_id       bigint FK
fingerprint   text
ip_hash       text
ua            text
botid_verdict text
incognito_guess boolean
seen_at       timestamptz

-- cached_metrics  (denormalized, refreshed; per node AND per account)
node_id       bigint PK FK
reach         int     -- subtree count (human-class only)
direct        int
max_depth     int
countries     int
updated_at    timestamptz
```

### Key queries
- **Subtree (reach/descendants)**: `ltree` `path <@ :myPath` — O(subtree), indexed GiST. Avoids deep recursive CTE cost.
- **Ancestry (your path to root)**: parse `path` segments → single `WHERE id = ANY(...)`.
- **Leaderboard**: `ORDER BY cached_metrics.reach DESC LIMIT N`, indexed.
- **Metric updates**: on new node insert, increment ancestors' `reach` (walk `path` ids, single UPDATE ... WHERE id = ANY). Cheap because path is materialized.

### Why ltree over pure recursive CTE
Materialized path = O(1) ancestor list + index-only subtree scan. Recursive CTE kept as fallback/verification but ltree is the hot path. Both available.

### Metric eligibility
- **Reach / leaderboard count only `class='human'` nodes.** Bot/crawler/preview excluded.
- **Ephemeral nodes** count toward their referrer's reach but render dimmed on globe until claimed (verified).
- **Verified nodes** get a leaderboard rank boost + brighter globe render.

### 5.5 Account merge (the only edge-affecting operation)
When a verified email proves two device-nodes are one person (e.g. Alice-laptop + Alice-phone):
- **Device `referrer_id` rows are NOT rewritten.** The **account** becomes the identity; nodes become its devices.
- Per-account reach/depth = **union of its nodes' subtrees, deduped**, with **internal edges removed** (if Alice-phone was referred by Alice-laptop, that self-edge doesn't count as reach).
- **Cycle-safety:** if a merge would make the account an ancestor of itself, the internal edge is **dropped from metrics only** (row stays for audit). Graph stays a DAG-of-accounts.
- Result: device nodes are immutable leaves of truth; the account aggregates. Sidesteps every re-parenting paradox.

## 6. Anti-abuse (viral = abuse magnet)

- **Identity layering** (localId + fingerprint + account) hardens node resolution against fingerprint drift and spoofing.
- **Rate-limit by `localId` (primary), `fingerprint` (secondary), `referrer_id` (fan-out).** NOT by IP as a hard gate — see §6.6.
- Self-referral / cycle rejection (referrer can't be in your ancestry) — also blocks the referrer-clicks-referee loop re-parent.
- **Node classification** at create time: UA + FingerprintJS Pro bot signal + Vercel BotID → `human|bot|crawler|preview`. Non-human excluded from metrics, dimmed/uncreated. Link-unfurlers (`preview`) never mint human nodes.
- **Incognito detection** → `ephemeral`, deprioritized until verified.
- Bot resistance via FingerprintJS Pro server signals (the sponsorship angle pays off here).
- Suspicious-velocity dampening: a referrer minting 1000s of identical-fingerprint children gets their reach discounted in leaderboard.
- Vercel BotID on the create-node endpoint.

## 6.5 DoS / DDoS & write-amplification defense

Viral site = write-amplification target. Each malicious node insert also walks ancestors to bump metrics → one insert fans out. **Block before the row exists.** Defend in layers, cheapest/earliest first.

### Layer 0 — never let the request reach the DB
- **Vercel WAF rate limiting** on `POST /api/node` — per-IP request cap, generous (see §6.6). Rejects at edge, zero DB hit.
- **Vercel BotID** on create endpoint — kills headless/automated traffic pre-insert.
- **Vercel Firewall Attack Mode** toggle for active assault.
- **Turnstile / proof-of-work** before node creation — invisible challenge, steps up to interactive under load. Mass minting becomes CPU-expensive for attacker, free for real users.

### Layer 1 — admission control (app, pre-insert)
- **Layered rate-limit counters** — localId, fingerprint, referrer_id (+ IP only as a velocity multiplier, §6.6). **Redis pulled forward to v1 for this** (§7) — Postgres rate state contends under the exact attack being defended.
- **Per-referrer mint cap** — one referrer can't spawn >N children/hour. Caps the farm-your-own-link fan-out attack.
- **Global circuit breaker** — system-wide inserts/sec over threshold → flip to challenge-everyone / queue mode. Protects DB from total write saturation regardless of source.
- **Async write queue (defer)** — node creation enqueues; worker drains at bounded rate. Caps DB write throughput to a survivable ceiling; attacker just fills a shed-able queue.

### Layer 2 — database hardening (assume some get through)
- **Neon pooled endpoint (PgBouncer)** — hard connection cap so a flood can't exhaust the pool and starve legit reads. Mandatory on serverless (fns × concurrency = connection storm).
- **`statement_timeout`** — no single query hangs a connection.
- **Bounded fan-out write** — metric bump = ONE `UPDATE ... WHERE id = ANY(path_ids)`, not N queries. One insert stays O(1) round-trips regardless of depth.
- **Cap chain depth** (e.g. 50) — stops pathological linear chains inflating `ltree` paths + ancestor-walk cost. 6-degrees → real depth is small anyway.
- **Partial indexes** (`WHERE class='human'`) — bot rows cheap to insert, never bloat hot indexes.
- **Unique constraints + idempotency key** — `unique(local_id)`, `unique(referrer_id, fingerprint)`, client idempotency key → retries/dupes collapse to upsert no-ops, not new rows. DB-level idempotency.

### Layer 3 — storage growth / cost containment
- **Don't persist non-human nodes as real rows** — bot/crawler/preview dropped or written to cheap append-only `suspect_events`, never `nodes`. Hot table stays small.
- **Ephemeral TTL reaper** — incognito/unclaimed nodes that never verify + never refer → reaped after N days.
- **Row-size discipline** — `nodes` narrow; UA/IP/audit pushed to `node_signals` (append-only, time-partitioned, droppable).
- **Neon autoscaling + spend cap** — compute ceiling so an attack can't run an unbounded bill (cost-DoS is the real serverless-DB risk). Alarm on insert-rate + storage-growth anomalies.

### Layer 4 — degrade, don't die
- **Shed, don't crash** — under breaker return "join queued / try later". Site stays up, attacker gets nothing persisted.
- **Reads off cache** — globe/leaderboard served from snapshot tiles, so write-side flooding never degrades the read experience.
- **Async/batched metric bumps** — reach updates eventually-consistent; removes per-insert synchronous ancestor-write under load.

### v1 priority (don't build all 4 layers day one)
| Must-have v1 | Defer until scale/attack |
|---|---|
| WAF per-IP rate limit | async write queue |
| BotID on create | global circuit breaker |
| Redis rate-counters | challenge step-up |
| Neon pooled conn + `statement_timeout` | ephemeral TTL reaper |
| Single bounded ancestor-UPDATE | partitioned signals table |
| Depth cap + unique/idempotency guards | Neon spend cap alarms |

**Cheapest wins, biggest payoff:** WAF per-IP rate-limit (zero code) + idempotency unique constraint (DB refuses dupes for free). Start there.

## 6.6 IP is a signal, NOT a gate

Many real users share one IP — **IP ≠ user**:
- **Home/office NAT** — whole household/company on one public IP.
- **Carrier-grade NAT (CGNAT)** — mobile carriers put **thousands** of phone users behind one IP. Huge on mobile.
- **Corporate / university** — entire campus egresses one IP.
- **Public wifi** — café, airport, conference: many distinct people, one IP. **This is the in-person viral-share scenario — your target audience.**
- **VPN / proxy / Tor** — many users funneled through shared exit IPs.

**Rules:**
- **Never use IP as an identity key.** localId / fingerprint / account are identity. Collapsing users by IP = catastrophic.
- **Never hard-block on per-IP node count.** A conference room or CGNAT'd city block of real joiners would get killed — exactly the viral moment you want.
- **IP = velocity multiplier in a risk score**, plus a very high global per-IP ceiling that only trips on script-grade volume.
- **Suspicious = high velocity AND same fingerprint AND same UA AND no localId variance.** One IP + 500 *distinct* fingerprints = conference (good). One IP + 1 fingerprint + 500 inserts = script (bad).
- **Per-/24 subnet limits even looser** than per-IP (CGNAT spreads users across ranges).
- Real abuse gates = fingerprint + BotID + PoW + localId velocity. IP only nudges confidence.

## 7. Scaling path (Redis: one carve-out in v1, rest deferred)

**v1 exception — rate-limit counters use Upstash Redis from day one.** Postgres rate state contends under exactly the DoS attack §6.5 defends against; a fixed-window counter in Redis is O(1) and keeps rate-limiting off the primary DB. This is the *only* Redis use at launch.

Everything else stays Postgres-only until a trigger fires (leaderboard reads hot / live-join fanout heavy / metric writes contend):
- Redis **sorted set** for leaderboard (ZADD reach) → O(log n) rank, no table scan.
- Redis **counters** for reach (write-through, Postgres = source of truth).
- Redis **pub/sub** for live-join SSE fanout.
- Globe density tiles **cached** (Vercel Runtime Cache / Redis) per zoom bucket.

v1 ships Postgres-for-graph + Redis-for-rate-counters; code isolates metric reads behind a `metrics` service interface so the rest of Redis drops in without touching callers.

## 8. Stack

- **Next.js (App Router)** on Vercel, Fluid Compute.
- **react-three-fiber + three.js + drei** globe.
- **Neon Postgres** (Vercel Marketplace) + ltree.
- **FingerprintJS** client SDK (+ Pro server signals later).
- **SSE** (Vercel Functions streaming) for live joins; swap to Redis pub/sub at scale.
- **Tailwind + shadcn/ui** for panels/cards.
- Share: Web Share API + per-platform intent links (X, WhatsApp, Telegram, FB, LinkedIn, copy, QR).

## 9. Page layout (single page)

```
┌─────────────────────────────────────────────┐
│  [worldhello.io]            [globe controls]  │
│                                               │
│            ╭──────────────────╮               │
│            │   3D GLOBE        │  ← arcs,      │
│            │   (fullscreen bg) │    your path  │
│            ╰──────────────────╯    glowing     │
│                                               │
│  ┌── referrer hook card (if ?ref) ──┐         │
│  │ Maya · reach 1,247 · 38 countries │         │
│  └───────────────────────────────────┘         │
│                                               │
│  ┌── YOUR SCORE ──┐  ┌── SHARE ──┐  ┌─LEADER─┐ │
│  │ reach depth ct │  │ X WA TG…  │  │ top 10 │ │
│  └────────────────┘  └───────────┘  └────────┘ │
│            "someone in Lagos joined" ticker     │
└─────────────────────────────────────────────┘
```

## 10. v1 build order

1. Next.js + Neon + schema (ltree) + node-create API (`?ref` handling).
2. FingerprintJS identity + node resolution.
3. Globe (r3f) with seeded data → nodes + your-path arcs + LOD density.
4. Score panel + metrics queries (ltree subtree).
5. Share tools (Web Share + intents + QR).
6. Referrer hook card on referral landing.
7. Leaderboard (Postgres ORDER BY).
8. Live-join SSE ticker.
9. Magic-link email (cross-device merge).
10. Anti-abuse (BotID, rate limit, cycle guard, velocity dampening).

## Open questions
- Domain/short-code length (collision vs. brevity).
- Email provider for magic link (Resend on Vercel).
- Privacy/legal copy for fingerprinting (consent banner? GDPR posture given anonymity).
