# v4 — Cloudflare Deployment

## Overview

Migrate the production deployment target from a Node.js server (Docker Postgres/Redis/Minio) to Cloudflare Workers, using the OpenNext Cloudflare adapter. Local development stays exactly as it is today — this is an added deploy path, not a replacement of the dev workflow.

Two runtimes are supported side by side, selected by a new `RUNTIME_TARGET` env var (`node` — default, today's setup; `cloudflare` — new):

| Concern | `node` (unchanged) | `cloudflare` (new) |
|---|---|---|
| Compute | `next dev` / `next start` | Cloudflare Workers via `@opennextjs/cloudflare` |
| Postgres | Docker Postgres, direct `DATABASE_URL` | Neon, reached through a Cloudflare **Hyperdrive** binding |
| Cooldown store | Redis (`ioredis`) | Cloudflare **KV** binding |
| File storage | Minio (S3-compatible) | Backblaze B2 (S3-compatible) |
| Realtime / Auth | Ably / JWT — unchanged in both |

## Scope

**In scope:**
- Runtime-target abstraction for Postgres client construction and the AI-suggestion cooldown store (the only two things that actually need branching logic).
- Replacing `bcrypt` (native addon, cannot run on Workers under any compatibility flag) with a Web Crypto PBKDF2 implementation, in both runtimes — one code path, no npm dependency, no migration path needed (see Auth below).
- OpenNext/Wrangler build and deploy tooling additions.
- Env var / secrets documentation for the Cloudflare path.

**Out of scope:**
- CI/CD auto-deploy pipeline (deploys are manual `wrangler`/OpenNext commands for now).
- Any change to Ably, JWT, tRPC routers, or feature/business logic.
- Automated Workers-runtime tests in CI (a manual pre-deploy smoke test is the verification step instead).

## Why Postgres and the cooldown store need branching (and nothing else does)

Cloudflare Hyperdrive and KV are **bindings** — objects only reachable through the Workers request's `env`, accessed in Next.js via OpenNext's `getCloudflareContext()`. They are not plain connection strings sitting in `process.env` the way `DATABASE_URL`/`REDIS_URL` are today, so the code that constructs a Postgres client or a cooldown store needs to know, per request, which runtime it's in.

File storage, by contrast, is reached over a plain S3-compatible HTTPS API with access-key credentials — the exact same `@aws-sdk/client-s3` code already in `src/server/storage.ts` and consumed by `src/app/api/upload/route.ts` works unchanged; only the `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` env values differ between Minio (dev) and the production provider. No code branching needed there.

**Correction (storage provider swapped, and the bucket stays private):** R2's free tier requires a card on file just to enable the product, so this deploy uses Backblaze B2 instead — a genuinely free S3-compatible provider with no card required. B2's S3-compatible API also has no `PutBucketPolicy` support at all (confirmed against B2's own docs), so rather than chase per-provider public-read mechanisms, the design changed to never make the bucket public: `uploadMenuImage` returns an app-relative URL (`/api/images/<key>`), and a new route (`src/app/api/images/[key]/route.ts`) fetches the object from the bucket using the app's own credentials (`getMenuImage` in `storage.ts`) and streams it back. This works identically regardless of the bucket's public/private state or provider, so `S3_PUBLIC_URL` is gone entirely — only `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` remain.

**Correction (found during final review):** Postgres and the cooldown store were not, in fact, the only two things needing runtime branching. `report.ts`/`payment.ts`/`order.ts`'s Redis-backed daily-sales caching had the exact same problem — it called `ioredis` directly with no Cloudflare path. This was folded into the same design as a parallel `Cache` abstraction (`RedisCache`/`KvCache`/`noopCache`, in `src/server/cache.ts`), reusing the `KV` binding rather than provisioning a separate KV namespace. Unlike the cooldown store, a missing binding here degrades to a no-op (always miss, no-op set/invalidate) instead of throwing, since caching is a pure performance optimization with no correctness requirement — unlike the abuse-guard cooldown, which does.

## Component changes

### 1. `src/server/db.ts` — per-request-aware Postgres client

**Updated (Prisma dropped, raw SQL + Kysely adopted; see final review of the drop-Prisma migration):** the ORM is gone. `src/server/db.ts` exports a shared `buildDbWithClient()` helper (a thin wrapper `buildDb()` also exists for callers that only need the Kysely instance) that constructs a `postgres.js` `sql` client plus a `Kysely<DB>` instance over it. Both runtimes go through this one helper — no duplicated client-construction logic:

- `node`: `db.ts` caches a module-level singleton on `globalThis`, built once from `process.env.DATABASE_URL` at import time (long-lived process, no per-request isolation concerns).
- `cloudflare`: `src/server/trpc/context.ts`'s `getContextDb()` calls `buildDbWithClient()` fresh on every request, reading the connection string from `getCloudflareContext({ async: true }).env.HYPERDRIVE.connectionString` — a Kysely client built over a postgres.js socket is tied to the I/O context of whichever request constructed it, so it cannot be cached across requests on Workers. `getContextDb()` also registers `ctx.waitUntil(sql.end({ timeout: 5 }))` so the per-request connection is actually closed instead of leaking one TCP connection per request.

`buildDbWithClient()` also installs a custom postgres.js type parser for `timestamp`/`timestamptz` columns so naive `timestamp(3) without time zone` values round-trip as UTC on both runtimes (see the timestamp-round-trip fix in the final review of the drop-Prisma migration for why this was needed).

### 2. Cooldown store abstraction

`src/server/ai/cooldown.ts` currently calls `src/server/redis.ts`'s `ioredis` client directly. This becomes an interface with two implementations:

```ts
type CooldownStore = {
  checkAndSet(key: string, ttlSeconds: number): Promise<boolean>; // true = was NOT on cooldown, now is
  clear(key: string): Promise<void>;
};
```

- `RedisCooldownStore` — wraps the existing `ioredis` `SET key 1 NX EX ttl` logic verbatim.
- `KvCooldownStore` — wraps a Cloudflare KV namespace binding: `checkAndSet` does a `get` then a conditional `put(key, '1', { expirationTtl: ttlSeconds })`; `clear` does a `delete`. KV's eventual consistency is acceptable here — the cooldown only needs to deter rapid re-requests from the same table, not guarantee strict atomicity.

Selected once at tRPC context construction (`src/server/trpc/context.ts`) based on `RUNTIME_TARGET`, and passed down through `ctx` the same way `ctx.db` already is — so `cooldown.ts`'s callers don't need to know which backend is active.

### 3. Auth — drop `bcrypt`, use Web Crypto PBKDF2

`src/server/auth/pin.ts` currently hashes staff PINs with `bcrypt` (native addon — cannot load in a V8-isolate Workers runtime under any `nodejs_compat` setting, since it's compiled machine code, not a polyfillable JS API). Replace it with PBKDF2-HMAC-SHA256 via `globalThis.crypto.subtle`, which is a native Web Crypto API available in both Node (≥15) and Workers — no new npm dependency, single implementation, no runtime branching needed for this piece at all.

Format: `pbkdf2$<iterations>$<base64 salt>$<base64 hash>`, salt generated via `crypto.getRandomValues`.

Since there is no real user data to preserve (dev/demo PINs only), this is a straight swap: reseed `database/seed.ts` (relocated from `prisma/seed.ts` when Prisma was dropped — see the drop-Prisma migration) to hash the same demo PINs with the new function. No dual-verify/migration path.

### 4. Build & deploy tooling

- Add `@opennextjs/cloudflare` as a dev dependency.
- Add `wrangler.jsonc`: `compatibility_flags: ["nodejs_compat"]`, `compatibility_date` ≥ `2024-09-23`, a Hyperdrive binding (`HYPERDRIVE`) pointed at the Neon connection string, and a KV namespace binding (`KV`).
- New `package.json` scripts: `build:cf` (OpenNext Cloudflare build), `preview:cf` (local Workers-runtime preview via Wrangler), `deploy:cf` (`wrangler deploy`). Existing `dev`/`build`/`start`/`test` scripts are untouched.

## Env vars / secrets (Cloudflare path)

New/changed for `cloudflare`:
- `RUNTIME_TARGET=cloudflare`
- Hyperdrive binding configured in `wrangler.jsonc` (points at the Neon connection string — set via `wrangler secret put` or the binding's own config, not a plain env var)
- `KV` binding (KV namespace, configured in `wrangler.jsonc`)
- `S3_ENDPOINT`/`S3_ACCESS_KEY`/`S3_SECRET_KEY`/`S3_BUCKET` → Backblaze B2 values
- `JWT_SECRET`, `ABLY_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL` → set as Workers secrets via `wrangler secret put`, same values/semantics as today

Unchanged for `node`: everything as it is in `.env` today (`RUNTIME_TARGET` unset or `node`).

## Error handling

If `RUNTIME_TARGET=cloudflare` and a required binding (`HYPERDRIVE`, `KV`) is missing at request time, throw immediately at context construction with a clear message naming the missing binding. Never fall back to a Node-style client — a raw TCP/socket attempt would just hang or fail opaquely on Workers instead of surfacing the real misconfiguration.

## Testing

- Existing Vitest suite (Node path, local Postgres/Redis via explicit `DATABASE_URL`) runs unchanged — this migration adds a second runtime, it doesn't touch the first.
- New unit tests: `KvCooldownStore` against a mocked KV namespace object (`get`/`put`/`delete`), and the PBKDF2 hash/verify functions replacing the old bcrypt-based `pin.test.ts` cases.
- No automated Workers-runtime test in CI. Before an actual deploy, run `wrangler dev` (or OpenNext's local preview) as a manual smoke test against a real Hyperdrive/KV-bound preview environment.

## Migration steps at actual deploy time (not part of this code change)

**Smoke-test ordering note (flagged explicitly by the final review):** whatever order the steps below happen in, test PIN login *first* in the manual `wrangler dev`/preview smoke test, before anything else. There's an open question about whether Cloudflare Workers' `crypto.subtle.deriveBits` enforces a maximum PBKDF2 iteration count that `ITERATIONS = 100_000` in `src/server/auth/pin.ts` might sit at or near; if login fails with an opaque crypto error on Workers, that's the likely cause. `verifyPin` already parses the iteration count from the stored hash (not hardcoded), so lowering `ITERATIONS` in `hashPin` and reseeding is a safe, contained fix if needed.

1. Create the Neon Postgres project, then apply the schema and seed data against it (Prisma is gone — see the drop-Prisma migration; migrations are now plain SQL files applied by `database/migrate.sh`, and seeding is a `tsx` script, not `prisma/seed.ts`):
   ```bash
   DATABASE_URL="<neon-connection-string>" ./database/migrate.sh
   DATABASE_URL="<neon-connection-string>" npm run seed
   ```
   `migrate.sh` only shells out to `psql` (no Docker dependency), so it works identically against local Postgres or a remote connection string like Neon's — see the "Database migrations" section of `README.md` for the `psql` client prerequisite.
2. Create the Cloudflare KV namespace and Hyperdrive config, wire both into `wrangler.jsonc`.
3. Create the Backblaze B2 bucket (private is fine — the app never relies on public bucket URLs) and an application key; set `S3_*` secrets.
4. `wrangler secret put` for `JWT_SECRET`, `ABLY_API_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL`.
5. `npm run build:cf && npm run deploy:cf`.
