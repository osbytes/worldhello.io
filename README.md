# worldhello.io

Single-page globe visualizing 6-degrees-of-separation referral chains. Anonymous, device-fingerprint based, viral-growth experiment. See [DESIGN.md](./DESIGN.md) for the full architecture.

## Stack
- Next.js 16 (App Router) · Vercel Fluid Compute
- react-three-fiber + three.js (globe)
- Neon Postgres + **ltree** materialized paths (Drizzle hybrid: typed schema + raw SQL for graph hot path)
- Upstash Redis (rate-limit counters only — the one v1 carve-out)
- FingerprintJS (client identity layer)
- Resend (magic-link email)

## Setup

```bash
pnpm install
cp .env.example .env.local   # fill DATABASE_URL (+ optional Redis/Resend)
pnpm db:migrate              # ltree ext, tables, GiST index, write-once trigger
pnpm db:seed                 # optional: 500 synthetic nodes so the globe renders
pnpm dev
```

Open http://localhost:3000. Append `?ref=<code>` (or visit `/<code>`) to simulate a referral landing.

> Without Redis configured, rate-limiting degrades to allow-all (dev only).
> Without Resend, magic-link URLs are logged to the server console.

## Architecture map
| Concern | File |
|---|---|
| Schema (Drizzle) | `src/db/schema.ts` |
| ltree graph hot path (create / bump / subtree / ancestry) | `src/db/graph.ts` |
| Read queries (leaderboard / globe / referrer card) | `src/db/reads.ts` |
| Node-create API (identity resolve, classify, admit, create) | `src/app/api/node/route.ts` |
| Rate-limit / admission control | `src/lib/ratelimit.ts` |
| Client identity (localId + fingerprint + incognito) | `src/lib/client-identity.ts` |
| Globe (r3f) | `src/components/Globe.tsx` |
| Magic-link auth + account merge | `src/app/api/auth/*` |
| SSE live joins | `src/app/api/live/route.ts` |

## Key invariants (DESIGN §2)
- `referrer_id` is **write-once** (DB trigger enforces).
- Identity = localId → fingerprint → account. **IP is never an identity key** (DESIGN §6.6).
- Only `class='human'` nodes count toward reach / leaderboard.

## Build
```bash
pnpm build
```
