# Drop Prisma, migrate to `postgres` + Kysely — Design

## Overview

Prisma's query engine cannot run on Cloudflare Workers with this app's stack, in any tested configuration. This was verified directly, not assumed:

- Prisma 7.9.1's WASM query compiler triggers `EvalError: Code generation from strings disallowed for this context` — Workers blocks dynamic WASM compilation the same way it blocks `eval`.
- Prisma 6.19.0 (the version this project downgraded to, believing it to be a confirmed workaround per an upstream GitHub issue) still defaults to the same query-compiler architecture. It hits `fs.readdir` (unenv's Workers polyfill doesn't implement it) trying to auto-detect engine binaries, and after setting `engineType = "client"` explicitly, hits `fs.readFileSync` instead, loading the WASM query compiler.
- `@prisma/client@6.19.0`'s own `package.json` references a `wasm.mjs` file for its ESM `"import"` condition that was never actually generated — a real packaging bug in this version. Forcing CommonJS resolution to the working `wasm.js` file (which does correctly use a static `import('./query_compiler_bg.wasm')` under the hood) instead triggers a genuine Turbopack internal crash: `TurbopackInternalError: NftJsonAsset: cannot handle filepath '[turbopack-wasm]/node/loadWasm.ts'`.

All three were reproduced against the real production bundle in a real local `workerd` instance (via `wrangler dev`), and the first was also confirmed against the actual deployed Worker via `wrangler tail`. This is not a Prisma-version problem fixable by picking a different version — it is Prisma's current architecture (any version with driver-adapter support) colliding with Workers' dynamic-code-generation restrictions, compounded by a real packaging bug and a real Turbopack bug.

The user's own `hdlproject/gym-app` already runs successfully on this exact stack (Next.js + `@opennextjs/cloudflare` + Hyperdrive) using the `postgres` npm package (porsager/postgres) directly, with zero ORM/query-engine layer. This spec adopts that proven pattern, with one addition: Kysely as a compile-time-checked SQL builder on top of `postgres`, to reduce risk across the large number of call sites being rewritten.

## Scope

**In scope:**
- Remove `@prisma/client`, `@prisma/adapter-pg`, `prisma` (CLI), `@prisma/engines` and all `Prisma`/`PrismaClient` type usage from the codebase.
- Add `postgres`, `kysely`, `kysely-postgres-js` (dialect adapter), `@paralleldrive/cuid2` as dependencies.
- Convert the Prisma migration history to raw numbered `.sql` files under a new `database/` directory, with a `migrate.sh` script, following `gym-app`'s exact mechanism (a `schema_migrations` bookkeeping table + a bootstrap step that detects already-existing schema and backfills bookkeeping rows without re-running SQL against it).
- Rewrite every router (`menu`, `table`, `ingredient`, `stockBatch`, `kitchen`, `payment`, `report`, `auth`, `order`, `aiSuggestion`, `aiMenuSuggestion`), `src/server/stock/availability.ts`, `src/server/stock/deduct.ts`, and `prisma/seed.ts` (relocated) to use Kysely instead of Prisma Client.
- Rewrite `tests/helpers/db.ts` and every integration test file that constructs fixtures via Prisma calls (~17 files).
- Collapse `src/server/db.ts` + `src/server/db.cloudflare.ts` into one unified connection module.
- Remove `RUNTIME_TARGET`-based branching specifically for DB connection construction (the new unified module doesn't need it — it tries Hyperdrive first, falls back to `DATABASE_URL`). `RUNTIME_TARGET` branching elsewhere (the `CooldownStore`/`Cache` abstractions) is unaffected and stays as-is.

**Out of scope:**
- Any change to the `CooldownStore`/`Cache` (Redis/KV) abstractions, Ably, JWT, or any business logic/behavior. This is purely a data-access-layer swap — every router's external behavior (inputs, outputs, error conditions) must stay identical.
- Re-attempting Prisma on Workers in any form. This decision is final for this spec's purposes.
- Changing existing row IDs. New rows get `@paralleldrive/cuid2`-generated IDs; existing rows keep whatever cuid format Prisma already gave them. IDs are opaque unique strings everywhere in this app — nothing parses or validates their shape, so mixing formats is safe.

## Architecture

**Connection layer** (`src/server/db.ts`, replacing both `db.ts` and `db.cloudflare.ts`):

```ts
import postgres from 'postgres';
import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { DB } from './db.types'; // hand-written Kysely table interfaces, see below

declare global {
  var __posAppDb: Kysely<DB> | undefined;
}

function resolveConnectionString(): string {
  try {
    const hyperdrive = (getCloudflareContext().env as Record<string, unknown>).HYPERDRIVE as
      | { connectionString: string }
      | undefined;
    if (hyperdrive) return hyperdrive.connectionString;
  } catch {
    // Not running on Cloudflare (local dev, tests) — fall through to DATABASE_URL.
  }
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required (no Hyperdrive binding and no DATABASE_URL env var)');
  return url;
}

function buildDb(): Kysely<DB> {
  const sql = postgres(resolveConnectionString(), { max: 5, connect_timeout: 10, idle_timeout: 20 });
  return new Kysely<DB>({ dialect: new PostgresJSDialect({ postgres: sql }) });
}

export const db = globalThis.__posAppDb ?? buildDb();
if (process.env.NODE_ENV !== 'production') globalThis.__posAppDb = db;
```

This uses the **sync** `getCloudflareContext()` (matching gym-app), not the async `{ async: true }` form the current `db.cloudflare.ts` uses. The async form was needed because `PrismaClient` construction had to happen inside an `async function` anyway; a plain Kysely/`postgres` client construction has no such requirement, so the simpler sync form works and matches the proven reference exactly.

**`db.types.ts`** — hand-written Kysely table interfaces (one `interface` per table, matching the raw SQL schema exactly: column names, nullability, `Generated<T>` for defaulted columns). This is Kysely's equivalent of Prisma's generated types, but hand-maintained since there's no schema file to generate from anymore. Written once during the foundation task, updated whenever a future `.sql` migration changes a table shape.

**ID generation** — a small `src/server/id.ts`:
```ts
import { createId } from '@paralleldrive/cuid2';
export { createId };
```
Called explicitly at every insert call site that previously relied on Prisma's `@default(cuid())`.

## Migration history conversion

1. Dump `pos_dev`'s actual current schema: `pg_dump --schema-only --no-owner --no-privileges postgresql://... > database/001_initial.sql`. This captures what's actually applied today, not a re-derivation from `schema.prisma` that could have drifted.
2. `database/migrate.sh` (matching gym-app's mechanism exactly):
   - Creates `schema_migrations (version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW())` if missing.
   - Bootstrap step: `INSERT INTO schema_migrations SELECT '001_initial' WHERE to_regclass('public.users') IS NOT NULL ON CONFLICT DO NOTHING` — if the `users` table already exists (true for `pos_dev`), `001_initial` is marked applied without ever running its `CREATE TABLE` statements against a database that already has them (and already has real data).
   - Then a loop over `database/[0-9][0-9][0-9]_*.sql` in order, applying (in a transaction) any migration not yet recorded in `schema_migrations`.
3. Run this once against `pos_dev` (bootstraps cleanly, zero data touched — verified by checking `schema_migrations` afterward and confirming existing rows in `users`/`menu_items`/etc. are untouched) and once against `pos_test` (same script; since `to_regclass('public.users')` is null on a wiped `pos_test`, `001_initial.sql` actually runs and creates everything fresh — matches how `pos_test` is already treated as disposable today).
4. `prisma/migrations/` and `prisma/schema.prisma` are deleted once the conversion is verified against both databases.

## Query rewrite patterns

Reference table for translating each Prisma pattern encountered in the current routers — established once here so each router-rewrite task applies a known mapping rather than re-deriving it:

| Prisma | Kysely |
|---|---|
| `db.model.findMany({ where, orderBy })` | `.selectFrom('table').selectAll().where(...).orderBy(...).execute()` |
| `...include: { relation: true }` | Either a `.leftJoin(...)` when the shape is simple, or a second `.selectFrom(...).where('id', 'in', ids).execute()` + in-memory `Map` merge when nesting is deep (several routers already do the latter manually, e.g. `report.ts`'s `bestSellers`/`inventoryUsage` — this pattern extends naturally) |
| `db.model.findUniqueOrThrow(...)` | `.selectFrom(...).where(...).executeTakeFirstOrThrow()` |
| `db.$transaction(async (tx) => {...})` | `db.transaction().execute(async (trx) => {...})` |
| Helpers typed `Prisma.TransactionClient \| PrismaClient` (`availability.ts`, `deduct.ts`) | Typed `Transaction<DB> \| Kysely<DB>` — same "runs standalone or inside an ambient transaction" contract carries over unchanged |
| `data: { field: { increment: x } }` / `{ decrement: x }` | `.set((eb) => ({ field: eb('field', '+', x) }))` / `eb('field', '-', x)` |
| `upsert({ where, create, update })` | `.insertInto(...).values(...).onConflict((oc) => oc.columns([...]).doUpdateSet({...})).returningAll().executeTakeFirstOrThrow()` |
| `updateMany(...)` used as an atomic check-and-lock (return value's count checked) | Kysely `UpdateResult.numUpdatedRows` (a `bigint`, compare with `=== 1n`/`=== 0n`) |
| `groupBy({ by, _sum })` | `.groupBy('col').select((eb) => [eb.fn.sum('col2').as('total')])` |
| `Prisma.PrismaClientKnownRequestError` + `.code === 'P2002'` (unique violation, `table.ts`) | Raw driver error: `(err as { code?: string }).code === '23505'` (Postgres's `unique_violation` SQLSTATE) |
| `Decimal`-typed columns (`price`, `stockQty`, `total`, `amount`, `delta`, `qtyPerUnit`) | `postgres` returns `NUMERIC` as strings by default — every existing `Number(x.field)` call site (there are many) already converts from Prisma's `Decimal` the same way, via `.toString()` internally; no call-site change needed |
| `Json?` columns (`modifiers`) | `postgres` auto-parses `json`/`jsonb` to plain JS values, same as Prisma — no call-site change needed |
| `@default(cuid())` | Explicit `createId()` from `src/server/id.ts` at every insert |

## Testing

- `tests/helpers/db.ts`'s `resetDb()`: rewrite the `$transaction([...deleteMany])` array to a Kysely transaction issuing `DELETE FROM` statements in the same FK-safe order already established (stock movements/lines → payments/order items → orders → recipes → menu items/categories/ingredients → tables → users → store).
- Every integration test file's fixture setup (`db.user.create({data: {...}})`-style calls, ~17 files) becomes the Kysely equivalent (`db.insertInto('users').values({...}).returningAll().executeTakeFirstOrThrow()`). Mechanical, same shapes, no behavioral change — but real volume.
- Test *assertions* should not need to change (they check response shapes from routers, not the query layer directly) except where a router's return shape genuinely changes because of how a join/nested-include was restructured — any such case must be caught and treated as a real behavior change to flag, not silently accepted.
- The existing DB safety rule (explicit `DATABASE_URL` on every command, never `source .env`) is unchanged and applies identically to the new `postgres`-based connections.

## Task sequencing (one plan, subagent-driven-development)

1. **Foundation**: `database/001_initial.sql` (via `pg_dump`) + `migrate.sh`, run against both `pos_dev` (bootstrap-only) and `pos_test` (fresh apply) with verification that `pos_dev` data is untouched. New connection layer (`src/server/db.ts`, `db.types.ts`, `src/server/id.ts`). Dependencies added/removed in `package.json`.
2. **Test helper**: `tests/helpers/db.ts` rewrite — needed before any router task can be verified against real behavior.
3. **Stock helpers**: `src/server/stock/availability.ts` + `deduct.ts` — needed by several routers below, done early.
4. **Router tasks**, roughly simplest-to-most-complex, each rewriting its router file + its own test file(s) together: `menu`, `table`, `ingredient`, `stockBatch`, `kitchen`, `payment`, `report`, `auth`, `aiSuggestion`, `aiMenuSuggestion`, then `order` last (heaviest: nested includes, multi-step transactions, self-relations, atomic increments).
5. **Seed script**: `prisma/seed.ts` → relocated (e.g. `database/seed.ts`), rewritten against the new connection layer.
6. **Cleanup**: remove `@prisma/*`/`prisma` from `package.json` (including `allowScripts` entries and the `postinstall` script), delete `prisma/` directory, update `.env.example`/README references to Prisma-specific tooling.

Each task is independently buildable and testable — the full suite must pass after every task, not just at the end, so a partially-completed migration never leaves the app in a broken state for longer than one task.
