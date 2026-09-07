# Drop Prisma, Migrate to postgres + Kysely — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Prisma entirely from pos-app (query engine cannot run on Cloudflare Workers with this stack — verified, not theoretical) and replace it with the `postgres` npm package + Kysely, following the proven pattern from `hdlproject/gym-app`.

**Architecture:** A transitional dual-client period: a new Kysely client (`src/server/db.kysely.ts`, exported as `kdb`) is added alongside the existing Prisma client (`src/server/db.ts`, exported as `db`) without touching the latter. `Context` gains an optional `kdb?: Kysely<DB>` field alongside its existing required `db: PrismaClient` field. Each router is converted one at a time — its procedures switch from `ctx.db.<model>.<method>` to `ctx.kdb!.<kysely-call>`, and its own test file's fixtures switch from `db.<model>.create(...)` to `kdb.insertInto(...)` — while every other router keeps working unchanged on the old Prisma path. Only in the final Cleanup task (after every router is converted) do we delete Prisma entirely, rename `kdb` → `db` everywhere, and rename `db.kysely.ts` → `db.ts`. This keeps the full test suite and `npm run build` green after every single task, never just at the end.

**Tech Stack:** `postgres` (porsager/postgres) 3.4.9, `kysely` 0.29.5, `kysely-postgres-js` 4.0.0, `@paralleldrive/cuid2` 3.3.0. Existing: Next.js 16 (Turbopack), tRPC v11, `@opennextjs/cloudflare`, Vitest.

## Global Constraints

- **DB safety**: every DB-touching command gets an explicit `DATABASE_URL` on that exact command line — never `source .env`. Dev: `postgresql://postgres:postgres@localhost:5433/pos_dev` (has real accumulated data — never truncate/reseed blindly). Test: `postgresql://postgres:postgres@localhost:5433/pos_test` (safe to wipe). Full test command: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test`.
- **No local `psql`/`pg_dump`**: confirmed via `which psql pg_dump` → not found on this machine. Postgres runs in Docker (`pos-app-postgres-1`, port 5433). For the one-off schema dump in Task 1, use `docker exec pos-app-postgres-1 pg_dump ...`. For `database/migrate.sh` itself (which must also run later against a remote Neon connection string in production, where there is no Docker container), install a real local `psql` client instead of hard-coding Docker into the script: `brew install libpq` then `export PATH="$(brew --prefix libpq)/bin:$PATH"` for the shell running migrate.sh. Never make `migrate.sh` depend on Docker.
- **Real table/column casing** (queried directly from `pos_dev` this session, not assumed): Prisma's `schema.prisma` has **no `@map`/`@@map` directives anywhere**, so every table name is the exact PascalCase model name, quoted (`"User"`, `"MenuItem"`, `"StockAdjustmentBatch"`, etc.) and every column is the exact camelCase field name (`pinHash`, `categoryId`, `outOfStockReason`, `createdAt`, etc.). Kysely double-quotes every identifier it generates, so `.selectFrom('MenuItem')` and `.select('categoryId')` hit the real columns with zero renaming needed. `db.types.ts` (Task 1) must use these exact names.
- **Verified Kysely + postgres.js behaviors** (confirmed by running real queries against `pos_test` this session, not assumed from docs):
  - `jsonb` columns round-trip plain JS objects/arrays with **no manual `JSON.stringify`** — insert a plain object, get a plain object back.
  - `numeric`/`decimal` columns come back as **strings** (e.g. `"12.500"`), matching every existing `Number(x.field)` call site already in the routers — no call-site changes needed for numeric handling.
  - `.set({ a: 'x', b: undefined })` **automatically drops** keys whose value is `undefined`, updating only `a` — this matches Prisma's `update()` semantics exactly, so spreading an all-optional input object into `.set(...)` is safe. (Edge case: if **every** key ends up `undefined`, Kysely emits an empty `SET` list and Postgres throws a syntax error — not exercised by any current test, not guarded against.)
  - `.onConflict((oc) => oc.columns([...]).doUpdateSet({...})).returningAll().executeTakeFirstOrThrow()` is a working upsert pattern.
  - `UpdateResult.numUpdatedRows` from `.executeTakeFirst()` on an update is a `bigint` — compare with `1n`/`0n`, not `1`/`0`.
  - `db.transaction().execute(async (trx) => { ...; throw ... })` rolls back correctly on a thrown error (including `TRPCError`).
  - A unique-violation from `postgres.js` surfaces as `err.code === '23505'` on the thrown error object (Postgres's `unique_violation` SQLSTATE) — this is the direct replacement for `Prisma.PrismaClientKnownRequestError` + `.code === 'P2002'`.
- **`ctx.kdb!` convention**: until the Cleanup task, every migrated router accesses the Kysely client via `ctx.kdb!` (non-null assertion) — `kdb` is optional on `Context` only so the ~50 pre-existing test call sites for *not-yet-migrated* routers keep compiling without change; `createContext()` always sets it for real, and every migrated router's own test file passes it explicitly to `createCaller(...)`.
- **Every task must end green**: `npm run build` clean, full test suite passing with the explicit test env line above, before commit. Commit messages end with `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`. Commit, then `git push` (remote: `github.com/hdlproject/pos-app`, branch `master`, no worktree).
- **Out of scope, do not touch**: `CooldownStore`/`Cache` (Redis/KV) abstractions, Ably, JWT/session signing, any business logic or behavior change. Every router's external behavior (inputs, outputs, error conditions, status codes) must stay byte-for-byte identical — this is a data-access-layer swap only.
- **IDs**: new rows get `createId()` from `src/server/id.ts` (wraps `@paralleldrive/cuid2`). Existing rows keep their Prisma-cuid IDs — never touch existing ID values. IDs are opaque strings everywhere in this app; nothing validates their format.

## File Structure

New files (Task 1): `src/server/db.kysely.ts` (Kysely client, temporary name), `src/server/db.types.ts` (hand-written Kysely table interfaces + enum types), `src/server/id.ts` (cuid2 wrapper), `database/001_initial.sql` (pg_dump baseline), `database/migrate.sh` (gym-app-style migration runner).

Modified across the whole plan: `src/server/trpc/context.ts` (adds `kdb`, later drops `db`/Prisma entirely), every file under `src/server/trpc/routers/`, `src/server/stock/availability.ts`, `src/server/stock/deduct.ts`, `tests/helpers/db.ts`, every file under `tests/integration/` that touches Prisma, `prisma/seed.ts` (relocated to `database/seed.ts`), `package.json`.

Deleted at Cleanup: `prisma/` (entire directory), `src/server/db.ts` (old Prisma client — replaced by the renamed `db.kysely.ts`), `src/server/db.cloudflare.ts`.

---

## Task 1: Foundation — schema baseline, migrate.sh, Kysely client, types, id helper

**Files:**
- Create: `database/001_initial.sql`
- Create: `database/migrate.sh`
- Create: `src/server/db.kysely.ts`
- Create: `src/server/db.types.ts`
- Create: `src/server/id.ts`
- Modify: `src/server/trpc/context.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `kdb` (named export from `src/server/db.kysely.ts`, type `Kysely<DB>`), `DB` type and per-table interfaces + `Role`/`OrderType`/`OrderSource`/`OrderStatus`/`ItemStatus`/`StockReason`/`StockBatchStatus` types (all from `src/server/db.types.ts`), `createId()` (named export from `src/server/id.ts`, returns `string`). `Context.kdb?: Kysely<DB>`, populated by `createContext()`.
- Consumes: nothing from earlier tasks (this is the first task).

- [ ] **Step 1: Confirm tooling before writing anything**

Run: `which psql pg_dump` — expect "not found" (confirmed this session). Run: `docker ps --filter name=pos-app-postgres-1 --format '{{.Names}}'` — expect `pos-app-postgres-1`. Install a local psql client for `migrate.sh` (needed later against Neon too, where there's no Docker container): `brew install libpq && export PATH="$(brew --prefix libpq)/bin:$PATH"`. Verify: `psql --version` now succeeds. Add the same `export PATH=...` line to your shell profile or re-run it in every subsequent shell for this plan — every later task's Docker-free `psql "$DATABASE_URL" ...` calls depend on it.

- [ ] **Step 2: Dump the real pos_dev schema as the baseline migration**

`psql` works for direct connections now, but for the one-off dump prefer running `pg_dump` from inside the container that owns the data (avoids any local libpq/server version mismatch):

```bash
docker exec pos-app-postgres-1 pg_dump -U postgres -d pos_dev \
  --schema-only --no-owner --no-privileges --exclude-table=_prisma_migrations \
  > database/001_initial.sql
```

Open `database/001_initial.sql` and confirm it contains `CREATE TABLE "User"`, `CREATE TABLE "MenuItem"`, etc. (14 tables minus `_prisma_migrations` = 13 `CREATE TABLE` statements), `CREATE TYPE "Role" AS ENUM (...)` and the other 6 enums, and the partial unique index `one_pending_stock_batch ON "StockAdjustmentBatch" (status) WHERE status = 'PENDING'` (a hand-added constraint not visible in `schema.prisma` — pg_dump is exactly why we dump the live DB instead of re-deriving from Prisma's schema file). Do **not** hand-edit this file — it must be an exact reflection of what's actually running.

- [ ] **Step 3: Write `database/migrate.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL must be set explicitly, e.g. DATABASE_URL=postgresql://... ./database/migrate.sh}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bootstrap: if the schema already exists (applied previously via Prisma
-- migrate before this repo switched to raw SQL), record 001_initial as
-- already applied WITHOUT running its CREATE TABLE statements against data
-- that already exists. A freshly created database (a wiped pos_test) has no
-- "User" table yet, so this is a no-op there and 001_initial.sql runs for
-- real in the loop below.
INSERT INTO schema_migrations (version)
SELECT '001_initial'
WHERE to_regclass('public."User"') IS NOT NULL
ON CONFLICT DO NOTHING;
SQL

for file in "$SCRIPT_DIR"/[0-9][0-9][0-9]_*.sql; do
  version="$(basename "$file" .sql)"
  already_applied="$(psql "$DATABASE_URL" -tAc "SELECT 1 FROM schema_migrations WHERE version = '$version'")"
  if [ "$already_applied" = "1" ]; then
    echo "skip $version (already applied)"
    continue
  fi
  echo "applying $version"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction \
    -f "$file" \
    -c "INSERT INTO schema_migrations (version) VALUES ('$version')"
done
```

Make it executable: `chmod +x database/migrate.sh`.

- [ ] **Step 4: Run migrate.sh against pos_test (fresh apply) and verify**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" ./database/migrate.sh
```

Expect output `applying 001_initial` (pos_test has no `"User"` table — the bootstrap `WHERE to_regclass(...) IS NOT NULL` is false there). Verify: `docker exec pos-app-postgres-1 psql -U postgres -d pos_test -c '\dt'` shows all 13 tables plus `schema_migrations`.

- [ ] **Step 5: Run migrate.sh against pos_dev (bootstrap-only) and verify zero data loss**

Before running, record row counts:
```bash
docker exec pos-app-postgres-1 psql -U postgres -d pos_dev -c \
  "SELECT (SELECT count(*) FROM \"User\") users, (SELECT count(*) FROM \"MenuItem\") menu_items, (SELECT count(*) FROM \"Order\") orders;"
```
(Baseline observed this session: 3 users, 63 menu_items, 106 orders — your counts may differ if the app has been used since; record whatever you see.)

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_dev" ./database/migrate.sh
```

Expect `skip 001_initial (already applied)` — NOT `applying`. Re-run the row-count query and confirm it matches exactly what you recorded before. If it says `applying` or counts changed, STOP — do not proceed; the bootstrap detection failed and this would have destructively replayed `CREATE TABLE` against a live database (it would actually fail loudly with "relation already exists" rather than silently succeed, but stop and investigate regardless).

- [ ] **Step 6: Add new dependencies to package.json (do not remove Prisma yet)**

```bash
npm install postgres@3.4.9 kysely@0.29.5 kysely-postgres-js@4.0.0 @paralleldrive/cuid2@3.3.0
```

If npm's script-allowlist blocks any transitive install script, re-approve: `npx --yes npm@latest approve-scripts --all`. Leave every existing `@prisma/*`/`prisma` entry in `package.json` untouched — they're still needed by every not-yet-converted router.

- [ ] **Step 7: Write `src/server/id.ts`**

```ts
import { createId } from '@paralleldrive/cuid2';

export { createId };
```

- [ ] **Step 8: Write `src/server/db.types.ts`**

Exact column names/types/nullability/defaults below were read directly from `pos_dev` via `\d "<table>"` this session — not re-derived from `schema.prisma`.

```ts
import type { ColumnType, Generated } from 'kysely';

export type Role = 'ADMIN' | 'STAFF' | 'KITCHEN';
export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type OrderSource = 'STAFF' | 'QR';
export type OrderStatus = 'OPEN' | 'SENT_TO_KITCHEN' | 'READY' | 'SERVED' | 'PAID' | 'CANCELLED';
export type ItemStatus = 'QUEUED' | 'PREPARING' | 'READY' | 'SERVED';
export type StockReason = 'SALE' | 'MANUAL_ADJUST' | 'RESTOCK' | 'VOID_REVERT';
export type StockBatchStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

// numeric/decimal columns: postgres.js returns them as strings (confirmed
// empirically this session — SELECT always yields a string), but every
// router/test call site inserts or updates these columns with a plain JS
// number literal (e.g. `stockQty: 1000`, `price: input.price`) — also
// confirmed empirically to work. ColumnType's three type parameters are
// (selected type, insert type, update type), so this is Select=string,
// Insert/Update=string|number — NOT a plain `string` alias, which would
// wrongly reject every numeric literal at every insert/update call site.
type Numeric = ColumnType<string, string | number, string | number>;

export interface StoreTable {
  id: string;
  name: string;
}

export interface UserTable {
  id: string;
  name: string;
  pinHash: string;
  role: Role;
  active: Generated<boolean>;
  createdAt: Generated<Date>;
}

export interface TableTable {
  id: string;
  label: string;
  qrToken: string;
  createdAt: Generated<Date>;
}

export interface CategoryTable {
  id: string;
  name: string;
  sortOrder: Generated<number>;
}

export interface MenuItemTable {
  id: string;
  name: string;
  price: Numeric;
  categoryId: string;
  available: Generated<boolean>;
  outOfStockReason: string | null;
  description: string | null;
  instructions: string | null;
  image: string | null;
  modifiers: unknown | null;
}

export interface IngredientTable {
  id: string;
  name: string;
  unit: string;
  stockQty: Numeric;
}

export interface RecipeTable {
  id: string;
  menuItemId: string;
  ingredientId: string;
  qtyPerUnit: Numeric;
}

export interface OrderTable {
  id: string;
  type: OrderType;
  tableId: string | null;
  status: Generated<OrderStatus>;
  source: OrderSource;
  cancelReason: string | null;
  createdById: string | null;
  total: Generated<Numeric>;
  createdAt: Generated<Date>;
  parentOrderId: string | null;
  isOpenTableSession: Generated<boolean>;
  sessionFinished: Generated<boolean>;
}

export interface OrderItemTable {
  id: string;
  orderId: string;
  menuItemId: string;
  qty: number;
  modifiers: unknown | null;
  unitPrice: Numeric;
  kitchenStatus: Generated<ItemStatus>;
}

export interface PaymentTable {
  id: string;
  orderId: string;
  amount: Numeric;
  method: Generated<string>;
  receivedById: string;
  createdAt: Generated<Date>;
}

export interface StockMovementTable {
  id: string;
  ingredientId: string;
  delta: Numeric;
  reason: StockReason;
  refOrderId: string | null;
  createdAt: Generated<Date>;
  createdById: string;
}

export interface StockAdjustmentBatchTable {
  id: string;
  status: Generated<StockBatchStatus>;
  note: string | null;
  createdAt: Generated<Date>;
  createdById: string;
  confirmedAt: Date | null;
  confirmedById: string | null;
}

export interface StockAdjustmentLineTable {
  id: string;
  batchId: string;
  ingredientId: string;
  delta: Numeric;
  reason: StockReason;
}

export interface DB {
  Store: StoreTable;
  User: UserTable;
  Table: TableTable;
  Category: CategoryTable;
  MenuItem: MenuItemTable;
  Ingredient: IngredientTable;
  Recipe: RecipeTable;
  Order: OrderTable;
  OrderItem: OrderItemTable;
  Payment: PaymentTable;
  StockMovement: StockMovementTable;
  StockAdjustmentBatch: StockAdjustmentBatchTable;
  StockAdjustmentLine: StockAdjustmentLineTable;
}
```

- [ ] **Step 9: Write `src/server/db.kysely.ts`**

```ts
import postgres from 'postgres';
import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { DB } from './db.types';

declare global {
  var __posAppKdb: Kysely<DB> | undefined;
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

function buildKdb(): Kysely<DB> {
  const sql = postgres(resolveConnectionString(), { max: 5, connect_timeout: 10, idle_timeout: 20 });
  return new Kysely<DB>({ dialect: new PostgresJSDialect({ postgres: sql }) });
}

export const kdb = globalThis.__posAppKdb ?? buildKdb();

if (process.env.NODE_ENV !== 'production') {
  globalThis.__posAppKdb = kdb;
}
```

This uses the **sync** `getCloudflareContext()` (matching gym-app), not the async `{ async: true }` form the existing `db.cloudflare.ts` uses — a plain Kysely/`postgres` client construction has no async requirement, unlike `PrismaClient` construction.

- [ ] **Step 10: Wire `kdb` into Context**

Read `src/server/trpc/context.ts` first (current content is a known ~65-line file with `getContextDb`/`getContextCooldownStore`/`getContextCache`/`createContext`). Add the import and field — do **not** remove or alter any existing Prisma-related code (`PrismaClient`, `getContextDb`, `getCloudflareDb` import, the `db` field) in this task:

```ts
import { kdb } from '../db.kysely';
import type { DB } from '../db.types';
```
(add near the top, alongside the other imports)

```ts
export type Context = {
  db: PrismaClient;
  kdb?: Kysely<DB>;
  user: { userId: string; role: Role; name: string } | null;
  cooldownStore?: CooldownStore;
  cache?: Cache;
};
```
(add `kdb?: Kysely<DB>;` as a new line right after `db: PrismaClient;`; add `import type { Kysely } from 'kysely';` to the imports)

In `createContext()`, add `kdb` to the returned object:
```ts
  return { db, kdb, user, cooldownStore, cache };
```
(was `return { db, user, cooldownStore, cache };`)

- [ ] **Step 11: Verify the build and full test suite are still green**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```
Both must be clean — nothing about the app's runtime behavior has changed yet, only new unused-by-anyone-yet infrastructure has been added.

- [ ] **Step 12: Commit**

```bash
git add database/001_initial.sql database/migrate.sh src/server/db.kysely.ts src/server/db.types.ts src/server/id.ts src/server/trpc/context.ts package.json package-lock.json
git commit -m "$(cat <<'EOF'
Add Kysely connection layer alongside Prisma (foundation for dropping Prisma)

Introduces the postgres+Kysely client, hand-written DB types, and a raw-SQL
migration baseline (dumped from pos_dev's real schema), without touching any
existing Prisma-based code path yet.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 2: Test helper — rewrite resetDb() on Kysely

**Files:**
- Modify: `tests/helpers/db.ts`

**Interfaces:**
- Consumes: `kdb` from `src/server/db.kysely.ts` (Task 1).
- Produces: `resetDb()` — same exported name and `(): Promise<void>` signature as before; every existing `beforeEach(resetDb)` call site across all test files keeps working unchanged. Works regardless of which client (Prisma or Kysely) later reads/writes the same tables — it's just clearing rows.

**Current file** (`tests/helpers/db.ts`, full content):
```ts
import { db } from '@/server/db';

export async function resetDb() {
  await db.$transaction([
    db.stockMovement.deleteMany(),
    db.stockAdjustmentLine.deleteMany(),
    db.stockAdjustmentBatch.deleteMany(),
    db.payment.deleteMany(),
    db.orderItem.deleteMany(),
    db.order.deleteMany(),
    db.recipe.deleteMany(),
    db.menuItem.deleteMany(),
    db.category.deleteMany(),
    db.ingredient.deleteMany(),
    db.table.deleteMany(),
    db.user.deleteMany(),
    db.store.deleteMany(),
  ]);
}
```

- [ ] **Step 1: Replace with the Kysely equivalent**

```ts
import { kdb } from '@/server/db.kysely';

export async function resetDb() {
  await kdb.transaction().execute(async (trx) => {
    await trx.deleteFrom('StockMovement').execute();
    await trx.deleteFrom('StockAdjustmentLine').execute();
    await trx.deleteFrom('StockAdjustmentBatch').execute();
    await trx.deleteFrom('Payment').execute();
    await trx.deleteFrom('OrderItem').execute();
    await trx.deleteFrom('Order').execute();
    await trx.deleteFrom('Recipe').execute();
    await trx.deleteFrom('MenuItem').execute();
    await trx.deleteFrom('Category').execute();
    await trx.deleteFrom('Ingredient').execute();
    await trx.deleteFrom('Table').execute();
    await trx.deleteFrom('User').execute();
    await trx.deleteFrom('Store').execute();
  });
}
```

Same FK-safe delete order as the original (children before parents).

- [ ] **Step 2: Run the full test suite**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```
Every existing test still passes — `resetDb()` deletes the same rows via a different client, and every not-yet-converted router/test still reads/writes via Prisma against the same physical tables. Also run `npm run build` (clean).

- [ ] **Step 3: Commit**

```bash
git add tests/helpers/db.ts
git commit -m "$(cat <<'EOF'
Rewrite resetDb() test helper on Kysely

Clears the same tables in the same FK-safe order as before; works
regardless of which client (Prisma or Kysely) a given test's router uses,
since it's just deleting rows from the same physical tables.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 3: Stock helpers — availability.ts and deduct.ts

**Files:**
- Modify: `src/server/stock/availability.ts`
- Modify: `src/server/stock/deduct.ts`

**Interfaces:**
- Consumes: `DB` type (Task 1's `db.types.ts`), `createId()` (Task 1's `id.ts`).
- Produces: `recomputeAvailabilityForIngredient(db: Kysely<DB> | Transaction<DB>, ingredientId: string): Promise<void>`, `recomputeAvailabilityForMenuItem(db: Kysely<DB> | Transaction<DB>, menuItemId: string): Promise<void>`, `deductStockForOrder(db: Kysely<DB> | Transaction<DB>, orderId: string, userId: string): Promise<void>`, `revertStockForOrder(db: Kysely<DB> | Transaction<DB>, orderId: string, userId: string): Promise<void>` — same names/call shapes as the current Prisma versions (just `Kysely<DB> | Transaction<DB>` instead of `Prisma.TransactionClient | PrismaClient` as the first parameter's type), so every router task below can call them identically to how routers already do today. **These two files are not yet wired into any router in this task** — routers still call the old Prisma-based versions until their own task converts them. This task only prepares the Kysely versions; Task 4 onward will switch imports over.

Because both the old (Prisma) and new (Kysely) versions must coexist until every caller has moved over, keep the **old file untouched under a new name** and put the new Kysely version at the original path:
- [ ] **Step 1: Preserve the current Prisma versions under `.prisma.ts` suffixes**

```bash
git mv src/server/stock/availability.ts src/server/stock/availability.prisma.ts
git mv src/server/stock/deduct.ts src/server/stock/deduct.prisma.ts
```

- [ ] **Step 2: Update every current importer of these two modules to import from the `.prisma` path**

Run: `grep -rln "stock/availability'\|stock/deduct'" src --include="*.ts"` — this lists every router/module currently importing these (as of Task 1's state: `ingredient.ts`, `stockBatch.ts`, `aiMenuSuggestion.ts` import from `availability`; `order.ts`, `payment.ts` import from `deduct`). For each, change the import path only (e.g. `'../../stock/availability'` → `'../../stock/availability.prisma'`, `'./availability'` → `'./availability.prisma'` inside deduct.prisma.ts's own import of availability). Do not change anything else in these files yet — they still call the Prisma-shaped functions, which now just live at the renamed path.

- [ ] **Step 3: Write the new Kysely `src/server/stock/availability.ts`**

```ts
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db.types';

export async function recomputeAvailabilityForMenuItem(
  db: Kysely<DB> | Transaction<DB>,
  menuItemId: string
): Promise<void> {
  const item = await db.selectFrom('MenuItem').selectAll().where('id', '=', menuItemId).executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom('Recipe')
    .innerJoin('Ingredient', 'Ingredient.id', 'Recipe.ingredientId')
    .select(['Ingredient.name as name', 'Ingredient.stockQty as stockQty'])
    .where('Recipe.menuItemId', '=', menuItemId)
    .orderBy('Ingredient.name', 'asc')
    .execute();

  const depletedNames = rows.filter((r) => Number(r.stockQty) <= 0).map((r) => r.name);
  const reason = depletedNames.length > 0 ? `Out of stock: ${depletedNames.join(', ')}` : null;

  if (item.outOfStockReason !== reason) {
    await db.updateTable('MenuItem').set({ outOfStockReason: reason }).where('id', '=', menuItemId).execute();
  }
}

// Scoped to every menu item that uses this ingredient — needed after a stock
// adjustment to that ingredient, since we don't know in advance which items
// are affected. Reuses recomputeAvailabilityForMenuItem's per-item logic
// exactly, one item at a time.
export async function recomputeAvailabilityForIngredient(
  db: Kysely<DB> | Transaction<DB>,
  ingredientId: string
): Promise<void> {
  const affected = await db
    .selectFrom('Recipe')
    .select('menuItemId')
    .distinct()
    .where('ingredientId', '=', ingredientId)
    .execute();
  for (const { menuItemId } of affected) {
    await recomputeAvailabilityForMenuItem(db, menuItemId);
  }
}
```

- [ ] **Step 4: Write the new Kysely `src/server/stock/deduct.ts`**

```ts
import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db.types';
import { createId } from '../id';
import { recomputeAvailabilityForIngredient } from './availability';

export async function deductStockForOrder(
  db: Kysely<DB> | Transaction<DB>,
  orderId: string,
  userId: string
): Promise<void> {
  const rows = await db
    .selectFrom('OrderItem')
    .innerJoin('Recipe', 'Recipe.menuItemId', 'OrderItem.menuItemId')
    .select(['OrderItem.qty as qty', 'Recipe.ingredientId as ingredientId', 'Recipe.qtyPerUnit as qtyPerUnit'])
    .where('OrderItem.orderId', '=', orderId)
    .execute();

  const deductions = new Map<string, number>();
  for (const r of rows) {
    const qty = Number(r.qtyPerUnit) * r.qty;
    deductions.set(r.ingredientId, (deductions.get(r.ingredientId) ?? 0) + qty);
  }

  for (const [ingredientId, qty] of deductions.entries()) {
    await db.updateTable('Ingredient').set((eb) => ({ stockQty: eb('stockQty', '-', qty) })).where('id', '=', ingredientId).execute();
    await db.insertInto('StockMovement')
      .values({ id: createId(), ingredientId, delta: -qty, reason: 'SALE', refOrderId: orderId, createdById: userId })
      .execute();
    await recomputeAvailabilityForIngredient(db, ingredientId);
  }
}

export async function revertStockForOrder(
  db: Kysely<DB> | Transaction<DB>,
  orderId: string,
  userId: string
): Promise<void> {
  const movements = await db.selectFrom('StockMovement').selectAll()
    .where('refOrderId', '=', orderId).where('reason', '=', 'SALE').execute();

  for (const m of movements) {
    const revertQty = Number(m.delta) * -1;
    await db.updateTable('Ingredient').set((eb) => ({ stockQty: eb('stockQty', '+', revertQty) })).where('id', '=', m.ingredientId).execute();
    await db.insertInto('StockMovement')
      .values({ id: createId(), ingredientId: m.ingredientId, delta: revertQty, reason: 'VOID_REVERT', refOrderId: orderId, createdById: userId })
      .execute();
    await recomputeAvailabilityForIngredient(db, m.ingredientId);
  }
}
```

- [ ] **Step 5: Write a new test file for the Kysely versions, keep the old one pointed at the Prisma versions**

Read `tests/integration/stock-availability.test.ts` and `tests/integration/stock-deduct.test.ts` in full (both already known from this session's exploration — 4 tests and 5 tests respectively, all using `db.<model>.create`/`findUniqueOrThrow` fixtures and asserting via `Number(x.field)`). Rename them:

```bash
git mv tests/integration/stock-availability.test.ts tests/integration/stock-availability.prisma.test.ts
git mv tests/integration/stock-deduct.test.ts tests/integration/stock-deduct.prisma.test.ts
```

In both renamed files, change only the imported function's source to keep testing the Prisma path (still exercised by not-yet-converted routers): `import { recomputeAvailabilityForIngredient } from '@/server/stock/availability.prisma';` (and the deduct equivalent, plus its own internal import of availability — check `deduct.prisma.ts`'s import path from Step 2 matches).

Now create `tests/integration/stock-availability.test.ts` (new, testing the Kysely version) by translating the original test file's fixtures to Kysely:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { kdb } from '@/server/db.kysely';
import { resetDb } from '../helpers/db';
import { createId } from '@/server/id';
import { recomputeAvailabilityForIngredient } from '@/server/stock/availability';

describe('recomputeAvailabilityForIngredient (Kysely)', () => {
  beforeEach(resetDb);

  it('sets a reason naming the ingredient when it hits zero', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();

    await recomputeAvailabilityForIngredient(kdb, milk.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('clears the reason once the ingredient is restocked', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, outOfStockReason: 'Out of stock: Milk' }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();

    await kdb.updateTable('Ingredient').set({ stockQty: 1000 }).where('id', '=', milk.id).execute();
    await recomputeAvailabilityForIngredient(kdb, milk.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBeNull();
  });

  it('names only the depleted ingredient when an item has more than one', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: beans.id, qtyPerUnit: 18 }).execute();

    await recomputeAvailabilityForIngredient(kdb, beans.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Coffee Beans');
  });

  it('does not touch the manual available flag', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, available: false }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();

    await recomputeAvailabilityForIngredient(kdb, milk.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.available).toBe(false);
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });
});
```

Create `tests/integration/stock-deduct.test.ts` (new, Kysely version):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { kdb } from '@/server/db.kysely';
import { resetDb } from '../helpers/db';
import { createId } from '@/server/id';
import { deductStockForOrder, revertStockForOrder } from '@/server/stock/deduct';

describe('stock deduction (Kysely)', () => {
  beforeEach(resetDb);

  async function seedOrder() {
    const admin = await kdb.insertInto('User').values({ id: createId(), name: 'Admin', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    const order = await kdb.insertInto('Order')
      .values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 9 })
      .returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();
    return { admin, milk, order, item };
  }

  it('deducts ingredient stock per recipe and records a StockMovement', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(kdb, order.id, admin.id);

    const afterDeduct = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(afterDeduct.stockQty)).toBe(600); // 1000 - (200 * 2)

    const movements = await kdb.selectFrom('StockMovement').selectAll().where('refOrderId', '=', order.id).execute();
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe('SALE');
  });

  it('allows stock to go negative rather than blocking', async () => {
    const { admin, milk, order } = await seedOrder();
    await kdb.updateTable('Ingredient').set({ stockQty: 100 }).where('id', '=', milk.id).execute();

    await deductStockForOrder(kdb, order.id, admin.id);
    const afterDeduct = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(afterDeduct.stockQty)).toBe(-300); // 100 - 400, allowed negative
  });

  it('reverts a deduction', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(kdb, order.id, admin.id);
    await revertStockForOrder(kdb, order.id, admin.id);

    const reverted = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(reverted.stockQty)).toBe(1000);
  });

  it('auto-marks the item out of stock when a deduction depletes its ingredient', async () => {
    const { admin, milk, order, item } = await seedOrder();
    await kdb.updateTable('Ingredient').set({ stockQty: 400 }).where('id', '=', milk.id).execute(); // exactly enough for this order

    await deductStockForOrder(kdb, order.id, admin.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('auto-clears the item when reverting a deduction restores enough stock', async () => {
    const { admin, milk, order, item } = await seedOrder();
    await kdb.updateTable('Ingredient').set({ stockQty: 400 }).where('id', '=', milk.id).execute();
    await deductStockForOrder(kdb, order.id, admin.id);

    await revertStockForOrder(kdb, order.id, admin.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBeNull();
  });
});
```

- [ ] **Step 6: Run the full test suite and build**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```
Both the new Kysely-based tests and the renamed `.prisma.test.ts` files (still exercising the Prisma versions used by not-yet-converted routers) must pass.

- [ ] **Step 7: Commit**

```bash
git add src/server/stock/ tests/integration/stock-availability.test.ts tests/integration/stock-availability.prisma.test.ts tests/integration/stock-deduct.test.ts tests/integration/stock-deduct.prisma.test.ts $(grep -rl "stock/availability'\|stock/deduct'" src --include="*.ts")
git commit -m "$(cat <<'EOF'
Add Kysely versions of stock availability/deduct helpers alongside Prisma

The Prisma versions move to *.prisma.ts and stay wired into not-yet-converted
routers; new Kysely versions land at the original paths, ready for router
tasks to switch over one at a time.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 4: menu router

**Files:**
- Modify: `src/server/trpc/routers/menu.ts`
- Modify: `tests/integration/menu-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!` (Context, Task 1), `createId()` (Task 1).
- Produces: no change to `menuRouter`'s exported shape or any procedure's input/output contract — `_app.ts` needs no change.

**Current `src/server/trpc/routers/menu.ts`** — read the file directly (100 lines, already fully known from this session: uses `Prisma.Decimal`/`Prisma.JsonValue`/`Prisma.InputJsonValue`/`Prisma.MenuItemUncheckedCreateInput`/`Prisma.MenuItemUncheckedUpdateInput` types, `findMany` with `include: { category: true }` and a two-key `orderBy`, plain `create`/`update`/`delete`).

- [ ] **Step 1: Replace the router with the Kysely version**

```ts
import { z } from 'zod';
import { router, publicProcedure, roleProcedure } from '../trpc';
import { createId } from '../../id';

const menuItemInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string(),
  available: z.boolean().default(true),
  image: z.string().nullable().optional(),
  modifiers: z.record(z.string(), z.any()).optional(),
});

// Deliberately NOT `menuItemInput.partial()`: `.partial()` only makes fields
// optional to provide, it does not remove `available`'s `.default(true)` —
// Zod still fills in `available: true` when the caller omits it, which would
// silently flip a sold-out item back to available on any update that isn't
// explicitly touching `available` (e.g. changing just the photo). This
// schema has no default on `available`, so it only changes when the caller
// explicitly includes it.
const updateItemInput = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  price: z.number().positive().optional(),
  categoryId: z.string().optional(),
  available: z.boolean().optional(),
  image: z.string().nullable().optional(),
  modifiers: z.record(z.string(), z.any()).optional(),
});

type MenuItemWithCategory = {
  id: string;
  name: string;
  price: string;
  categoryId: string;
  available: boolean;
  outOfStockReason: string | null;
  image: string | null;
  modifiers: unknown;
  category: {
    id: string;
    name: string;
    sortOrder: number;
  };
};

async function listMenuItems(kdb: import('kysely').Kysely<import('../../db.types').DB>, onlyAvailable: boolean): Promise<MenuItemWithCategory[]> {
  let query = kdb
    .selectFrom('MenuItem')
    .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
    .select([
      'MenuItem.id as id',
      'MenuItem.name as name',
      'MenuItem.price as price',
      'MenuItem.categoryId as categoryId',
      'MenuItem.available as available',
      'MenuItem.outOfStockReason as outOfStockReason',
      'MenuItem.image as image',
      'MenuItem.modifiers as modifiers',
      'Category.id as category_id',
      'Category.name as category_name',
      'Category.sortOrder as category_sortOrder',
    ]);
  if (onlyAvailable) {
    query = query.where('MenuItem.available', '=', true).where('MenuItem.outOfStockReason', 'is', null);
  }
  const rows = await query.orderBy('Category.sortOrder', 'asc').orderBy('MenuItem.name', 'asc').execute();
  return rows.map((r) => ({
    id: r.id, name: r.name, price: r.price, categoryId: r.categoryId, available: r.available,
    outOfStockReason: r.outOfStockReason, image: r.image, modifiers: r.modifiers,
    category: { id: r.category_id, name: r.category_name, sortOrder: r.category_sortOrder },
  }));
}

export const menuRouter = router({
  listAvailable: publicProcedure.query(({ ctx }) => listMenuItems(ctx.kdb!, true)),

  listAll: roleProcedure('ADMIN', 'STAFF').query(({ ctx }) => listMenuItems(ctx.kdb!, false)),

  listCategories: roleProcedure('ADMIN').query(({ ctx }) =>
    ctx.kdb!.selectFrom('Category').selectAll().orderBy('sortOrder', 'asc').execute()
  ),

  createCategory: roleProcedure('ADMIN')
    .input(z.object({ name: z.string().min(1), sortOrder: z.number().default(0) }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.insertInto('Category')
        .values({ id: createId(), name: input.name, sortOrder: input.sortOrder })
        .returningAll()
        .executeTakeFirstOrThrow()
    ),

  deleteCategory: roleProcedure('ADMIN')
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.deleteFrom('Category').where('id', '=', input.id).returningAll().executeTakeFirstOrThrow()
    ),

  createItem: roleProcedure('ADMIN')
    .input(menuItemInput)
    .mutation(({ ctx, input }) =>
      ctx.kdb!.insertInto('MenuItem')
        .values({
          id: createId(),
          name: input.name,
          price: input.price,
          categoryId: input.categoryId,
          available: input.available,
          image: input.image ?? null,
          modifiers: input.modifiers ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    ),

  updateItem: roleProcedure('ADMIN')
    .input(updateItemInput)
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      // Kysely's .set() automatically drops keys whose value is `undefined`
      // (verified this session), matching Prisma's update() semantics — a
      // field the caller omitted is left untouched, not set to NULL.
      return ctx.kdb!.updateTable('MenuItem').set(rest).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    }),
});
```

Move the inline `import('kysely').Kysely<...>` type usage to a proper top-level import for cleanliness: add `import type { Kysely } from 'kysely';` and `import type { DB } from '../../db.types';` to the top of the file, and change `listMenuItems`'s first parameter type to `Kysely<DB>`.

- [ ] **Step 2: Rewrite `tests/integration/menu-router.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('menu router', () => {
  beforeEach(resetDb);

  it('admin creates a category and item; public sees only available items', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const anon = appRouter.createCaller({ db, kdb, user: null });

    const category = await admin.menu.createCategory({ name: 'Coffee', sortOrder: 1 });
    const item = await admin.menu.createItem({
      name: 'Latte', price: 4.5, categoryId: category.id, available: true,
    });
    await admin.menu.createItem({
      name: 'Hidden', price: 1, categoryId: category.id, available: false,
    });

    const available = await anon.menu.listAvailable();
    expect(available.map((i) => i.id)).toEqual([item.id]);
  });

  it('rejects createItem from a non-admin role', async () => {
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u2', role: 'STAFF', name: 'C' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Tea', sortOrder: 2 }).returningAll().executeTakeFirstOrThrow();
    await expect(
      cashier.menu.createItem({ name: 'Green Tea', price: 3, categoryId: category.id, available: true })
    ).rejects.toThrow();
  });

  it('clears an item image by sending null', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem')
      .values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, image: 'http://example.com/old.jpg' })
      .returningAll().executeTakeFirstOrThrow();

    const updated = await admin.menu.updateItem({ id: item.id, image: null });
    expect(updated.image).toBeNull();
  });

  it('updating only the image does not silently flip available back to true', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem')
      .values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, available: false })
      .returningAll().executeTakeFirstOrThrow();

    const updated = await admin.menu.updateItem({
      id: item.id,
      image: 'http://example.com/new.jpg',
    });

    expect(updated.available).toBe(false);
    expect(updated.image).toBe('http://example.com/new.jpg');
  });

  it('toggleAvailable-style explicit available update still works', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem')
      .values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, available: true })
      .returningAll().executeTakeFirstOrThrow();

    const updated = await admin.menu.updateItem({ id: item.id, available: false });
    expect(updated.available).toBe(false);
  });

  it('excludes an auto-detected-out-of-stock item from listAvailable', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const anon = appRouter.createCaller({ db, kdb, user: null });
    const category = await admin.menu.createCategory({ name: 'Coffee', sortOrder: 1 });
    const item = await admin.menu.createItem({
      name: 'Latte', price: 4.5, categoryId: category.id, available: true,
    });
    await kdb.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Milk' }).where('id', '=', item.id).execute();

    const available = await anon.menu.listAvailable();
    expect(available.map((i) => i.id)).not.toContain(item.id);
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/menu.ts tests/integration/menu-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate menu router from Prisma to Kysely

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 5: table router

**Files:**
- Modify: `src/server/trpc/routers/table.ts`
- Modify: `tests/integration/table-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`, `createId()`.
- Produces: no change to `tableRouter`'s exported shape.

**Current `src/server/trpc/routers/table.ts`** — read directly (46 lines, uses `Prisma.PrismaClientKnownRequestError` + `.code === 'P2002'` to detect a duplicate `label`).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';

function genToken() {
  return randomBytes(12).toString('hex');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export const tableRouter = router({
  list: roleProcedure('ADMIN', 'STAFF').query(({ ctx }) =>
    ctx.kdb!.selectFrom('Table').selectAll().orderBy('label', 'asc').execute()
  ),

  create: roleProcedure('ADMIN')
    .input(z.object({ label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.kdb!
          .insertInto('Table')
          .values({ id: createId(), label: input.label, qrToken: genToken() })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use' });
        }
        throw err;
      }
    }),

  rename: roleProcedure('ADMIN')
    .input(z.object({ id: z.string(), label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.kdb!
          .updateTable('Table')
          .set({ label: input.label })
          .where('id', '=', input.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use' });
        }
        throw err;
      }
    }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/table-router.test.ts`** (no fixtures beyond the router calls themselves — only the `createCaller` calls need `kdb` added)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('table router', () => {
  beforeEach(resetDb);

  it('creates a table with a token', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const table = await admin.table.create({ label: 'T1' });
    expect(table.qrToken).toHaveLength(24);
  });

  it('rejects creating a table with a duplicate label', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    await admin.table.create({ label: 'T1' });

    await expect(admin.table.create({ label: 'T1' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('renames a table', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const table = await admin.table.create({ label: 'T1' });

    const renamed = await admin.table.rename({ id: table.id, label: 'T1-renamed' });

    expect(renamed.label).toBe('T1-renamed');
    expect(renamed.qrToken).toBe(table.qrToken);
  });

  it('rejects renaming a table to an already-used label', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const t1 = await admin.table.create({ label: 'T1' });
    await admin.table.create({ label: 'T2' });

    await expect(admin.table.rename({ id: t1.id, label: 'T2' })).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/table.ts tests/integration/table-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate table router from Prisma to Kysely

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 6: ingredient router

**Files:**
- Modify: `src/server/trpc/routers/ingredient.ts`
- Modify: `tests/integration/ingredient-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`, `createId()`, and — critically — **switches its import of `recomputeAvailabilityForIngredient`/`recomputeAvailabilityForMenuItem` from `'../../stock/availability.prisma'` back to `'../../stock/availability'`** (the Kysely version written in Task 3, sitting unused at that path since). Uses `.transaction()` for the two multi-step mutations (`adjustStock`, `setRecipe`, `removeRecipe`), passing the `trx` handle into the availability helpers exactly as the current code passes Prisma's `tx`.

**Current `src/server/trpc/routers/ingredient.ts`** — read directly (79 lines; currently imports `recomputeAvailabilityForIngredient`/`recomputeAvailabilityForMenuItem` from `'../../stock/availability.prisma'` per Task 3's Step 2 rename).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
import { recomputeAvailabilityForIngredient, recomputeAvailabilityForMenuItem } from '../../stock/availability';

export const ingredientRouter = router({
  list: roleProcedure('ADMIN').query(({ ctx }) => ctx.kdb!.selectFrom('Ingredient').selectAll().execute()),

  create: roleProcedure('ADMIN')
    .input(z.object({
      name: z.string().min(1),
      unit: z.string().min(1),
      stockQty: z.number().default(0),
    }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.insertInto('Ingredient')
        .values({ id: createId(), name: input.name, unit: input.unit, stockQty: input.stockQty })
        .returningAll()
        .executeTakeFirstOrThrow()
    ),

  adjustStock: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        await trx.updateTable('Ingredient')
          .set((eb) => ({ stockQty: eb('stockQty', '+', input.delta) }))
          .where('id', '=', input.ingredientId)
          .execute();
        await trx.insertInto('StockMovement')
          .values({
            id: createId(),
            ingredientId: input.ingredientId,
            delta: input.delta,
            reason: input.reason,
            createdById: ctx.user.userId,
          })
          .execute();
        await recomputeAvailabilityForIngredient(trx, input.ingredientId);
      });
      return { ok: true };
    }),

  setRecipe: roleProcedure('ADMIN')
    .input(z.object({
      menuItemId: z.string(),
      ingredientId: z.string(),
      qtyPerUnit: z.number().positive(),
    }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.transaction().execute(async (trx) => {
        const recipe = await trx.insertInto('Recipe')
          .values({ id: createId(), menuItemId: input.menuItemId, ingredientId: input.ingredientId, qtyPerUnit: input.qtyPerUnit })
          .onConflict((oc) =>
            oc.columns(['menuItemId', 'ingredientId']).doUpdateSet({ qtyPerUnit: input.qtyPerUnit })
          )
          .returningAll()
          .executeTakeFirstOrThrow();
        await recomputeAvailabilityForIngredient(trx, input.ingredientId);
        return recipe;
      })
    ),

  listRecipes: roleProcedure('ADMIN')
    .input(z.object({ menuItemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.kdb!
        .selectFrom('Recipe')
        .innerJoin('Ingredient', 'Ingredient.id', 'Recipe.ingredientId')
        .select([
          'Recipe.id as id',
          'Recipe.menuItemId as menuItemId',
          'Recipe.ingredientId as ingredientId',
          'Recipe.qtyPerUnit as qtyPerUnit',
          'Ingredient.id as ingredient_id',
          'Ingredient.name as ingredient_name',
          'Ingredient.unit as ingredient_unit',
          'Ingredient.stockQty as ingredient_stockQty',
        ])
        .where('Recipe.menuItemId', '=', input.menuItemId)
        .orderBy('Ingredient.name', 'asc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        menuItemId: r.menuItemId,
        ingredientId: r.ingredientId,
        qtyPerUnit: r.qtyPerUnit,
        ingredient: { id: r.ingredient_id, name: r.ingredient_name, unit: r.ingredient_unit, stockQty: r.ingredient_stockQty },
      }));
    }),

  removeRecipe: roleProcedure('ADMIN')
    .input(z.object({ recipeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const recipe = await trx.deleteFrom('Recipe').where('id', '=', input.recipeId).returningAll().executeTakeFirstOrThrow();
        await recomputeAvailabilityForMenuItem(trx, recipe.menuItemId);
      });
      return { ok: true };
    }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/ingredient-router.test.ts`**

Read the current file first (104 lines, 6 tests, each creates an `ADMIN` user via `db.user.create` then wraps `appRouter.createCaller`). Translate every `db.<model>.create/findMany/findUniqueOrThrow` fixture call to the Kysely equivalent, keep every `expect(...)` unchanged, and add `kdb` to every `createCaller({...})` call:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('ingredient router', () => {
  beforeEach(resetDb);

  it('creates an ingredient, adjusts stock, and attaches a recipe', async () => {
    await kdb.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();

    const milk = await admin.ingredient.create({ name: 'Milk', unit: 'ml', stockQty: 5000 });
    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -200, reason: 'MANUAL_ADJUST' });

    const afterAdjust = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(afterAdjust.stockQty)).toBe(4800);

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });
    const recipes = await kdb.selectFrom('Recipe').selectAll().where('menuItemId', '=', menuItem.id).execute();
    expect(recipes).toHaveLength(1);
  });

  it('auto-marks an item out of stock when adjustStock depletes its ingredient', async () => {
    await kdb.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 100 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 100 }).execute();

    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('auto-recomputes availability when setRecipe links an already-depleted ingredient', async () => {
    await kdb.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('lists recipes for a menu item', async () => {
    await kdb.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 5000 }).returningAll().executeTakeFirstOrThrow();
    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });

    const recipes = await admin.ingredient.listRecipes({ menuItemId: menuItem.id });
    expect(recipes).toHaveLength(1);
    expect(Number(recipes[0].qtyPerUnit)).toBe(200);
    expect(recipes[0].ingredient.name).toBe('Milk');
  });

  it('removing the only recipe for a depleted ingredient clears the item\'s out-of-stock reason', async () => {
    await kdb.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const recipe = await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 }).returningAll().executeTakeFirstOrThrow();

    await kdb.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Milk' }).where('id', '=', menuItem.id).execute();

    await admin.ingredient.removeRecipe({ recipeId: recipe.id });

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBeNull();
    const remaining = await kdb.selectFrom('Recipe').selectAll().where('menuItemId', '=', menuItem.id).execute();
    expect(remaining).toHaveLength(0);
  });

  it('removing one of several recipes keeps the item out of stock if another linked ingredient is still depleted', async () => {
    await kdb.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 5000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const milkRecipe = await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: beans.id, qtyPerUnit: 20 }).execute();
    await kdb.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Coffee Beans' }).where('id', '=', menuItem.id).execute();

    await admin.ingredient.removeRecipe({ recipeId: milkRecipe.id });

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Coffee Beans');
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/ingredient.ts tests/integration/ingredient-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate ingredient router from Prisma to Kysely

Switches to the Kysely versions of the stock availability helpers (Task 3),
the first router to do so.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 7: stockBatch router

**Files:**
- Modify: `src/server/trpc/routers/stockBatch.ts`
- Modify: `tests/integration/stock-batch-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`, `createId()`, `recomputeAvailabilityForIngredient` from `'../../stock/availability'` (Kysely version — switch this import from `.prisma` back to the plain path).

**Current `src/server/trpc/routers/stockBatch.ts`** — read directly (132 lines; `getPending` does a nested `findFirst` + `include: { lines: { include: { ingredient: true } } }`; `confirm`/`cancel` use `updateMany` as an atomic check-and-lock, checking `count !== 1`; `listHistory` joins `createdBy`/`confirmedBy` (`confirmedBy` nullable)).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
import { recomputeAvailabilityForIngredient } from '../../stock/availability';

export const stockBatchRouter = router({
  getPending: roleProcedure('ADMIN').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const batch = await kdb.selectFrom('StockAdjustmentBatch').selectAll().where('status', '=', 'PENDING').executeTakeFirst();
    if (!batch) return null;
    const lines = await kdb
      .selectFrom('StockAdjustmentLine')
      .innerJoin('Ingredient', 'Ingredient.id', 'StockAdjustmentLine.ingredientId')
      .select([
        'StockAdjustmentLine.id as id',
        'StockAdjustmentLine.batchId as batchId',
        'StockAdjustmentLine.ingredientId as ingredientId',
        'StockAdjustmentLine.delta as delta',
        'StockAdjustmentLine.reason as reason',
        'Ingredient.id as ingredient_id',
        'Ingredient.name as ingredient_name',
        'Ingredient.unit as ingredient_unit',
        'Ingredient.stockQty as ingredient_stockQty',
      ])
      .where('StockAdjustmentLine.batchId', '=', batch.id)
      .execute();
    return {
      ...batch,
      lines: lines.map((l) => ({
        id: l.id, batchId: l.batchId, ingredientId: l.ingredientId, delta: l.delta, reason: l.reason,
        ingredient: { id: l.ingredient_id, name: l.ingredient_name, unit: l.ingredient_unit, stockQty: l.ingredient_stockQty },
      })),
    };
  }),

  stageChange: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        let batch = await trx.selectFrom('StockAdjustmentBatch').selectAll().where('status', '=', 'PENDING').executeTakeFirst();
        if (!batch) {
          batch = await trx.insertInto('StockAdjustmentBatch')
            .values({ id: createId(), status: 'PENDING', createdById: ctx.user.userId })
            .returningAll()
            .executeTakeFirstOrThrow();
        }
        await trx.insertInto('StockAdjustmentLine')
          .values({ id: createId(), batchId: batch.id, ingredientId: input.ingredientId, delta: input.delta, reason: input.reason })
          .onConflict((oc) =>
            oc.columns(['batchId', 'ingredientId']).doUpdateSet({ delta: input.delta, reason: input.reason })
          )
          .execute();
      });
      return { ok: true };
    }),

  removeLine: roleProcedure('ADMIN')
    .input(z.object({ lineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const line = await trx
          .selectFrom('StockAdjustmentLine')
          .innerJoin('StockAdjustmentBatch', 'StockAdjustmentBatch.id', 'StockAdjustmentLine.batchId')
          .select(['StockAdjustmentLine.id as id', 'StockAdjustmentLine.batchId as batchId', 'StockAdjustmentBatch.status as batchStatus'])
          .where('StockAdjustmentLine.id', '=', input.lineId)
          .executeTakeFirstOrThrow();
        if (line.batchStatus !== 'PENDING') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        await trx.deleteFrom('StockAdjustmentLine').where('id', '=', input.lineId).execute();
        const { count } = await trx
          .selectFrom('StockAdjustmentLine')
          .select(({ fn }) => fn.countAll().as('count'))
          .where('batchId', '=', line.batchId)
          .executeTakeFirstOrThrow();
        if (Number(count) === 0) {
          await trx.deleteFrom('StockAdjustmentBatch').where('id', '=', line.batchId).execute();
        }
      });
      return { ok: true };
    }),

  setNote: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string(), note: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.updateTable('StockAdjustmentBatch').set({ note: input.note }).where('id', '=', input.batchId).returningAll().executeTakeFirstOrThrow()
    ),

  confirm: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const result = await trx.updateTable('StockAdjustmentBatch')
          .set({ status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: ctx.user.userId })
          .where('id', '=', input.batchId)
          .where('status', '=', 'PENDING')
          .executeTakeFirst();
        if (result.numUpdatedRows !== 1n) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        const lines = await trx.selectFrom('StockAdjustmentLine').selectAll().where('batchId', '=', input.batchId).execute();
        for (const line of lines) {
          await trx.updateTable('Ingredient')
            .set((eb) => ({ stockQty: eb('stockQty', '+', Number(line.delta)) }))
            .where('id', '=', line.ingredientId)
            .execute();
          await trx.insertInto('StockMovement')
            .values({ id: createId(), ingredientId: line.ingredientId, delta: line.delta, reason: line.reason, createdById: ctx.user.userId })
            .execute();
          await recomputeAvailabilityForIngredient(trx, line.ingredientId);
        }
      });
      return { ok: true };
    }),

  // Cancelled batches aren't kept for accounting review -- discard the
  // batch and its lines entirely rather than marking status CANCELLED.
  cancel: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const result = await trx.updateTable('StockAdjustmentBatch')
          .set({ status: 'PENDING' })
          .where('id', '=', input.batchId)
          .where('status', '=', 'PENDING')
          .executeTakeFirst();
        if (result.numUpdatedRows !== 1n) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        await trx.deleteFrom('StockAdjustmentLine').where('batchId', '=', input.batchId).execute();
        await trx.deleteFrom('StockAdjustmentBatch').where('id', '=', input.batchId).execute();
      });
      return { ok: true };
    }),

  listHistory: roleProcedure('ADMIN').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const batches = await kdb
      .selectFrom('StockAdjustmentBatch')
      .innerJoin('User as CreatedBy', 'CreatedBy.id', 'StockAdjustmentBatch.createdById')
      .leftJoin('User as ConfirmedBy', 'ConfirmedBy.id', 'StockAdjustmentBatch.confirmedById')
      .select([
        'StockAdjustmentBatch.id as id',
        'StockAdjustmentBatch.status as status',
        'StockAdjustmentBatch.note as note',
        'StockAdjustmentBatch.createdAt as createdAt',
        'StockAdjustmentBatch.createdById as createdById',
        'StockAdjustmentBatch.confirmedAt as confirmedAt',
        'StockAdjustmentBatch.confirmedById as confirmedById',
        'CreatedBy.id as createdBy_id',
        'CreatedBy.name as createdBy_name',
        'ConfirmedBy.id as confirmedBy_id',
        'ConfirmedBy.name as confirmedBy_name',
      ])
      .where('StockAdjustmentBatch.status', '=', 'CONFIRMED')
      .orderBy('StockAdjustmentBatch.createdAt', 'desc')
      .execute();

    const batchIds = batches.map((b) => b.id);
    const lines = batchIds.length === 0 ? [] : await kdb
      .selectFrom('StockAdjustmentLine')
      .innerJoin('Ingredient', 'Ingredient.id', 'StockAdjustmentLine.ingredientId')
      .select([
        'StockAdjustmentLine.id as id',
        'StockAdjustmentLine.batchId as batchId',
        'StockAdjustmentLine.ingredientId as ingredientId',
        'StockAdjustmentLine.delta as delta',
        'StockAdjustmentLine.reason as reason',
        'Ingredient.id as ingredient_id',
        'Ingredient.name as ingredient_name',
        'Ingredient.unit as ingredient_unit',
        'Ingredient.stockQty as ingredient_stockQty',
      ])
      .where('StockAdjustmentLine.batchId', 'in', batchIds)
      .execute();
    const linesByBatch = new Map<string, typeof lines>();
    for (const l of lines) {
      const list = linesByBatch.get(l.batchId) ?? [];
      list.push(l);
      linesByBatch.set(l.batchId, list);
    }

    return batches.map((b) => ({
      id: b.id, status: b.status, note: b.note, createdAt: b.createdAt, createdById: b.createdById,
      confirmedAt: b.confirmedAt, confirmedById: b.confirmedById,
      createdBy: { id: b.createdBy_id, name: b.createdBy_name },
      confirmedBy: b.confirmedBy_id ? { id: b.confirmedBy_id, name: b.confirmedBy_name } : null,
      lines: (linesByBatch.get(b.id) ?? []).map((l) => ({
        id: l.id, batchId: l.batchId, ingredientId: l.ingredientId, delta: l.delta, reason: l.reason,
        ingredient: { id: l.ingredient_id, name: l.ingredient_name, unit: l.ingredient_unit, stockQty: l.ingredient_stockQty },
      })),
    }));
  }),
});
```

Note: `confirm`/`cancel` use `result.numUpdatedRows !== 1n` (bigint literal) as the direct replacement for Prisma's `updateMany(...).count !== 1` — verified this session that `numUpdatedRows` is a real `bigint`.

- [ ] **Step 2: Rewrite `tests/integration/stock-batch-router.test.ts`**

Read the current file first (263 lines, 15 tests — the largest test file in this migration). Apply the same mechanical translation used in Task 6: every `db.<model>.create/findMany/findUnique(OrThrow)/findFirstOrThrow` fixture or assertion call becomes the Kysely equivalent against `kdb`, `createId()` replaces implicit Prisma-generated IDs wherever a fixture needs an explicit id to reference later, and every `appRouter.createCaller({ db, user })` becomes `appRouter.createCaller({ db, kdb, user })`. Two helper adaptations:
- `adminCaller()` currently does `db.user.create({ data: {...} })` then builds a caller from the returned user — becomes `kdb.insertInto('User').values({ id: createId(), name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).returningAll().executeTakeFirstOrThrow()`.
- The test `'confirm applies every line...'` calls `db.user.findFirstOrThrow({ where: { name: 'Admin' } })` — becomes `kdb.selectFrom('User').selectAll().where('name', '=', 'Admin').executeTakeFirstOrThrow()`.

Full rewritten file:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('stock batch router', () => {
  beforeEach(resetDb);

  async function adminCaller() {
    const user = await kdb.insertInto('User').values({ id: createId(), name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).returningAll().executeTakeFirstOrThrow();
    return appRouter.createCaller({ db, kdb, user: { userId: user.id, role: user.role, name: user.name } });
  }

  it('getPending returns null when there is no pending batch', async () => {
    const admin = await adminCaller();
    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('stageChange creates a pending batch with one line', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });

    const pending = await admin.stockBatch.getPending();
    expect(pending).not.toBeNull();
    expect(pending?.status).toBe('PENDING');
    expect(pending?.lines).toHaveLength(1);
    expect(pending?.lines[0].ingredientId).toBe(milk.id);
    expect(Number(pending?.lines[0].delta)).toBe(500);
  });

  it('a second stageChange for a different ingredient adds a second line to the same batch', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const firstBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const secondBatch = await admin.stockBatch.getPending();

    expect(secondBatch?.id).toBe(firstBatch?.id);
    expect(secondBatch?.lines).toHaveLength(2);
  });

  it('re-staging the same ingredient updates the existing line instead of duplicating it', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -50, reason: 'MANUAL_ADJUST' });

    const pending = await admin.stockBatch.getPending();
    expect(pending?.lines).toHaveLength(1);
    expect(Number(pending?.lines[0].delta)).toBe(-50);
    expect(pending?.lines[0].reason).toBe('MANUAL_ADJUST');
  });

  it('removeLine removes one line but keeps the batch when other lines remain', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    const milkLine = batch!.lines.find((l) => l.ingredientId === milk.id)!;

    await admin.stockBatch.removeLine({ lineId: milkLine.id });

    const afterRemove = await admin.stockBatch.getPending();
    expect(afterRemove?.status).toBe('PENDING');
    expect(afterRemove?.lines).toHaveLength(1);
    expect(afterRemove?.lines[0].ingredientId).toBe(beans.id);
  });

  it('removeLine on the last remaining line deletes the batch entirely', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.removeLine({ lineId: batch!.lines[0].id });

    const afterRemove = await admin.stockBatch.getPending();
    expect(afterRemove).toBeNull();
    const stillExists = await kdb.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirst();
    expect(stillExists).toBeUndefined();
  });

  it('setNote updates the batch note', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.setNote({ batchId: batch!.id, note: 'Weekly supplier delivery' });

    const updated = await admin.stockBatch.getPending();
    expect(updated?.note).toBe('Weekly supplier delivery');
  });

  it('confirm applies every line, writes StockMovement rows, and marks the batch CONFIRMED', async () => {
    const admin = await adminCaller();
    const adminUser = await kdb.selectFrom('User').selectAll().where('name', '=', 'Admin').executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: -50, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const milkAfter = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(milkAfter.stockQty)).toBe(1500);
    const beansAfter = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', beans.id).executeTakeFirstOrThrow();
    expect(Number(beansAfter.stockQty)).toBe(450);

    const movements = await kdb.selectFrom('StockMovement').selectAll().execute();
    expect(movements).toHaveLength(2);
    const beansMovement = movements.find((m) => m.ingredientId === beans.id)!;
    expect(beansMovement.reason).toBe('MANUAL_ADJUST');
    expect(Number(beansMovement.delta)).toBe(-50);

    const confirmedBatch = await kdb.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirstOrThrow();
    expect(confirmedBatch.status).toBe('CONFIRMED');
    expect(confirmedBatch.confirmedById).toBe(adminUser.id);
    expect(confirmedBatch.confirmedAt).not.toBeNull();
  });

  it('confirm removes the batch from getPending (it is no longer PENDING)', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('confirm calls the availability recompute for a depleted ingredient', async () => {
    const admin = await adminCaller();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 100 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const updatedItem = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updatedItem.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('cancel deletes the batch and its lines without applying any stock change', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.cancel({ batchId: batch!.id });

    const milkAfter = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(milkAfter.stockQty)).toBe(1000);
    const movements = await kdb.selectFrom('StockMovement').selectAll().execute();
    expect(movements).toHaveLength(0);
    const cancelledBatch = await kdb.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirst();
    expect(cancelledBatch).toBeUndefined();
    const cancelledLines = await kdb.selectFrom('StockAdjustmentLine').selectAll().where('batchId', '=', batch!.id).execute();
    expect(cancelledLines).toHaveLength(0);
  });

  it('confirming an already-CONFIRMED batch a second time throws CONFLICT and does not double-apply the delta', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    await expect(admin.stockBatch.confirm({ batchId: batch!.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const milkAfter = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(milkAfter.stockQty)).toBe(1500);
    const movements = await kdb.selectFrom('StockMovement').selectAll().execute();
    expect(movements).toHaveLength(1);
  });

  it('removeLine on a line belonging to an already-CONFIRMED batch throws CONFLICT and leaves the batch intact', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    const lineId = batch!.lines[0].id;

    await admin.stockBatch.confirm({ batchId: batch!.id });

    await expect(admin.stockBatch.removeLine({ lineId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const stillExists = await kdb.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirst();
    expect(stillExists).not.toBeUndefined();
    expect(stillExists?.status).toBe('CONFIRMED');
  });

  it('cancel on an already-CONFIRMED batch throws CONFLICT and leaves the batch intact', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    await expect(admin.stockBatch.cancel({ batchId: batch!.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const afterCancel = await kdb.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirstOrThrow();
    expect(afterCancel.status).toBe('CONFIRMED');
  });

  it('listHistory returns confirmed batches, never cancelled or pending ones', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const confirmedBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: confirmedBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const cancelledBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.cancel({ batchId: cancelledBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 10, reason: 'MANUAL_ADJUST' });

    const history = await admin.stockBatch.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('CONFIRMED');
    expect(history[0].id).toBe(confirmedBatch!.id);
  });

  it('listHistory never exposes pinHash on createdBy or confirmedBy', async () => {
    const admin = await adminCaller();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: batch!.id });

    const history = await admin.stockBatch.listHistory();
    expect(history[0].createdBy).not.toHaveProperty('pinHash');
    expect(history[0].confirmedBy).not.toHaveProperty('pinHash');
    expect(history[0].createdBy.name).toBe('Admin');
  });
});
```

Note the two `toBeNull()` → `toBeUndefined()` changes above (`stillExists`/`cancelledBatch` after a delete): Kysely's `.executeTakeFirst()` on zero rows returns `undefined`, not `null` (Prisma's `findUnique` returns `null`). This is a real, necessary behavior-surfacing change to the test file itself (not the router's observable behavior) — every other place in this file that expects "not found" already goes through `getPending()` (which the router explicitly normalizes to `return null` in its own code), so this only affects the two spots that query `kdb` directly in the test for verification.

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/stockBatch.ts tests/integration/stock-batch-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate stockBatch router from Prisma to Kysely

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 8: kitchen router

**Files:**
- Modify: `src/server/trpc/routers/kitchen.ts`
- Modify: `tests/integration/kitchen-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`.

**Current `src/server/trpc/routers/kitchen.ts`** — read directly (42 lines; no stock-helper dependency).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { publishOrderEvent } from '../../ably';

const ITEM_STATUSES = ['QUEUED', 'PREPARING', 'READY', 'SERVED'] as const;

export const kitchenRouter = router({
  updateItemStatus: roleProcedure('ADMIN', 'KITCHEN', 'STAFF')
    .input(z.object({ orderItemId: z.string(), status: z.enum(ITEM_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const item = await kdb
        .updateTable('OrderItem')
        .set({ kitchenStatus: input.status })
        .where('id', '=', input.orderItemId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const siblings = await kdb.selectFrom('OrderItem').selectAll().where('orderId', '=', item.orderId).execute();
      const allReady = siblings.every((s) => s.kitchenStatus === 'READY' || s.kitchenStatus === 'SERVED');
      if (allReady) {
        await kdb.updateTable('Order').set({ status: 'READY' }).where('id', '=', item.orderId).execute();
      }

      try {
        await publishOrderEvent('order.itemStatus', { orderId: item.orderId, orderItemId: item.id, status: item.kitchenStatus });
      } catch (err) {
        console.error('publishOrderEvent failed for order.itemStatus', err);
      }
      return item;
    }),

  markServed: roleProcedure('ADMIN', 'STAFF', 'KITCHEN')
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.kdb!
        .updateTable('Order')
        .set({ status: 'SERVED' })
        .where('id', '=', input.orderId)
        .returningAll()
        .executeTakeFirstOrThrow();
      try {
        await publishOrderEvent('order.served', { orderId: order.id });
      } catch (err) {
        console.error('publishOrderEvent failed for order.served', err);
      }
      return order;
    }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/kitchen-router.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('kitchen router', () => {
  beforeEach(resetDb);

  it('moves order to READY once all items are READY', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order')
      .values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 9 })
      .returningAll().executeTakeFirstOrThrow();
    const items = await kdb.insertInto('OrderItem')
      .values([
        { id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 },
        { id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 },
      ])
      .returningAll()
      .execute();

    const kitchen = appRouter.createCaller({ db, kdb, user: { userId: 'k1', role: 'KITCHEN', name: 'K' } });
    await kitchen.kitchen.updateItemStatus({ orderItemId: items[0].id, status: 'READY' });

    let refreshed = await kdb.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(refreshed.status).toBe('SENT_TO_KITCHEN');

    await kitchen.kitchen.updateItemStatus({ orderItemId: items[1].id, status: 'READY' });
    refreshed = await kdb.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(refreshed.status).toBe('READY');
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/kitchen.ts tests/integration/kitchen-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate kitchen router from Prisma to Kysely

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 9: payment router

**Files:**
- Modify: `src/server/trpc/routers/payment.ts`
- Modify: `tests/integration/payment-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`, `createId()`, and **switches its import of `deductStockForOrder` from `'../../stock/deduct.prisma'` back to `'../../stock/deduct'`** (the Kysely version from Task 3).

**Current `src/server/trpc/routers/payment.ts`** — read directly (48 lines; currently imports `deductStockForOrder` from `'../../stock/deduct.prisma'` per Task 3's rename).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
import { deductStockForOrder } from '../../stock/deduct';
import { publishOrderEvent } from '../../ably';
import { noopCache } from '../../cache';

export const paymentRouter = router({
  payCash: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string(), tendered: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb.selectFrom('Order').selectAll().where('id', '=', input.orderId).executeTakeFirstOrThrow();
      if (order.status === 'CANCELLED') throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is cancelled' });
      const existingPayment = await kdb.selectFrom('Payment').selectAll().where('orderId', '=', order.id).executeTakeFirst();
      if (existingPayment) throw new TRPCError({ code: 'BAD_REQUEST', message: 'order already paid' });

      const total = Number(order.total);
      if (input.tendered < total) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'tendered amount is less than total' });
      }
      const change = input.tendered - total;

      await kdb.transaction().execute(async (trx) => {
        await trx.insertInto('Payment')
          .values({ id: createId(), orderId: order.id, amount: total, method: 'ONLINE', receivedById: ctx.user.userId })
          .execute();
        // OPEN means the cart-side "Charge Cash" flow paid before dispatching to
        // the kitchen -- leave status as OPEN so it stays off the KDS board until
        // order.sendToKitchen confirms it. Every other flow pays after the order
        // is already SENT_TO_KITCHEN/READY/SERVED, where PAID is the correct
        // terminal status (unchanged from before).
        if (order.status !== 'OPEN') {
          await trx.updateTable('Order').set({ status: 'PAID' }).where('id', '=', order.id).execute();
        }
        await deductStockForOrder(trx, order.id, ctx.user.userId);
      });
      try {
        await publishOrderEvent('order.paid', { orderId: order.id });
      } catch (err) {
        console.error('publishOrderEvent failed for order.paid', err);
      }
      try {
        await (ctx.cache ?? noopCache).deleteByPrefix('report:dailySales:');
      } catch (err) {
        console.error('dailySales cache invalidation failed after payment.payCash', err);
      }

      return { change };
    }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/payment-router.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('payment router', () => {
  beforeEach(resetDb);

  async function seedOrder() {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    // Payment.receivedById and StockMovement.createdById are real FKs to User,
    // so the ctx.user id used by these tests must correspond to an actual row.
    await kdb.insertInto('User').values({ id: 'u1', name: 'C', role: 'STAFF', pinHash: await hashPin('1234') }).execute();
    const order = await kdb.insertInto('Order')
      .values({ id: createId(), type: 'TAKEAWAY', status: 'READY', source: 'STAFF', total: 9 })
      .returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();
    return order;
  }

  it('pays cash, records change, marks order paid, and deducts stock', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });

    const result = await cashier.payment.payCash({ orderId: order.id, tendered: 10 });
    expect(result.change).toBeCloseTo(1);

    const paid = await kdb.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(paid.status).toBe('PAID');

    const movements = await kdb.selectFrom('StockMovement').selectAll().where('refOrderId', '=', order.id).execute();
    expect(movements).toHaveLength(1);
  });

  it('rejects insufficient tendered amount', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });
    await expect(cashier.payment.payCash({ orderId: order.id, tendered: 5 })).rejects.toThrow();
  });

  it('rejects paying an already-paid order', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });
    await cashier.payment.payCash({ orderId: order.id, tendered: 10 });
    await expect(cashier.payment.payCash({ orderId: order.id, tendered: 10 })).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/payment.ts tests/integration/payment-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate payment router from Prisma to Kysely

Switches to the Kysely version of deductStockForOrder.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 10: report router

**Files:**
- Modify: `src/server/trpc/routers/report.ts`
- Modify: `tests/integration/report-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`. No stock-helper dependency.
- Note: `tests/integration/report-router.test.ts` also imports `redis` from `@/server/redis` directly and calls `redis.flushdb()` in `beforeEach` — this is the unrelated Redis cache layer (explicitly out of scope per Global Constraints) and must be left completely untouched.

**Current `src/server/trpc/routers/report.ts`** — read directly (99 lines; `bestSellers`/`inventoryUsage` use `groupBy` + `_sum`; `salesDetail` uses a `select` with nested `table`/`items.menuItem`; `shiftSummary` uses `include: { receivedBy: true }`).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { noopCache } from '../../cache';

const dateRangeInput = z.object({ from: z.string(), to: z.string() });

export const reportRouter = router({
  dailySales: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    const cache = ctx.cache ?? noopCache;
    const cacheKey = `report:dailySales:${input.from}:${input.to}`;
    const cached = await cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const payments = await ctx.kdb!
      .selectFrom('Payment')
      .selectAll()
      .where('createdAt', '>=', new Date(input.from))
      .where('createdAt', '<=', new Date(input.to))
      .execute();
    const totalRevenue = payments.reduce((s, p) => s + Number(p.amount), 0);
    const result = {
      totalRevenue,
      orderCount: payments.length,
      avgOrderValue: payments.length ? totalRevenue / payments.length : 0,
    };
    await cache.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }),

  bestSellers: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    const kdb = ctx.kdb!;
    // A paid charge-first order can still be status OPEN (awaiting kitchen
    // dispatch) rather than PAID -- payment existence is the real "counts
    // as a sale" signal, not the status literal.
    const rows = await kdb
      .selectFrom('OrderItem')
      .innerJoin('Order', 'Order.id', 'OrderItem.orderId')
      .where('Order.createdAt', '>=', new Date(input.from))
      .where('Order.createdAt', '<=', new Date(input.to))
      .where((eb) =>
        eb.exists(eb.selectFrom('Payment').select('Payment.id').whereRef('Payment.orderId', '=', 'Order.id'))
      )
      .groupBy('OrderItem.menuItemId')
      .select(['OrderItem.menuItemId as menuItemId', (eb) => eb.fn.sum('OrderItem.qty').as('qtySold')])
      .execute();

    const menuItemIds = rows.map((r) => r.menuItemId);
    const menuItems = menuItemIds.length === 0 ? [] : await kdb.selectFrom('MenuItem').selectAll().where('id', 'in', menuItemIds).execute();
    const byId = new Map(menuItems.map((m) => [m.id, m]));
    return rows
      .map((r) => ({ menuItem: byId.get(r.menuItemId), qtySold: Number(r.qtySold ?? 0) }))
      .sort((a, b) => b.qtySold - a.qtySold);
  }),

  salesDetail: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    const kdb = ctx.kdb!;
    const orders = await kdb
      .selectFrom('Order')
      .leftJoin('Table', 'Table.id', 'Order.tableId')
      .where('Order.createdAt', '>=', new Date(input.from))
      .where('Order.createdAt', '<=', new Date(input.to))
      .where((eb) =>
        eb.exists(eb.selectFrom('Payment').select('Payment.id').whereRef('Payment.orderId', '=', 'Order.id'))
      )
      .select([
        'Order.id as id', 'Order.type as type', 'Order.source as source', 'Order.total as total', 'Order.createdAt as createdAt',
        'Table.label as tableLabel',
      ])
      .orderBy('Order.createdAt', 'desc')
      .execute();

    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length === 0 ? [] : await kdb
      .selectFrom('OrderItem')
      .innerJoin('MenuItem', 'MenuItem.id', 'OrderItem.menuItemId')
      .select(['OrderItem.id as id', 'OrderItem.orderId as orderId', 'OrderItem.qty as qty', 'OrderItem.unitPrice as unitPrice', 'MenuItem.name as menuItemName'])
      .where('OrderItem.orderId', 'in', orderIds)
      .execute();
    const itemsByOrder = new Map<string, typeof items>();
    for (const i of items) {
      const list = itemsByOrder.get(i.orderId) ?? [];
      list.push(i);
      itemsByOrder.set(i.orderId, list);
    }

    return orders.map((o) => ({
      id: o.id, type: o.type, source: o.source, total: o.total, createdAt: o.createdAt,
      table: o.tableLabel ? { label: o.tableLabel } : null,
      items: (itemsByOrder.get(o.id) ?? []).map((i) => ({
        id: i.id, qty: i.qty, unitPrice: i.unitPrice, menuItem: { name: i.menuItemName },
      })),
    }));
  }),

  // Sales-driven depletion only -- restocks and manual adjustments aren't
  // sales activity, so they don't belong on the sales report. Summarized
  // per ingredient (one row per unique ingredient), not one row per
  // movement -- this is a summary, not a raw ledger.
  inventoryUsage: roleProcedure('ADMIN').input(dateRangeInput).query(async ({ ctx, input }) => {
    const kdb = ctx.kdb!;
    const rows = await kdb
      .selectFrom('StockMovement')
      .where('reason', '=', 'SALE')
      .where('createdAt', '>=', new Date(input.from))
      .where('createdAt', '<=', new Date(input.to))
      .groupBy('ingredientId')
      .select(['ingredientId', (eb) => eb.fn.sum('delta').as('totalDelta')])
      .execute();
    const ingredientIds = rows.map((r) => r.ingredientId);
    const ingredients = ingredientIds.length === 0 ? [] : await kdb.selectFrom('Ingredient').selectAll().where('id', 'in', ingredientIds).execute();
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const usage = rows
      .map((r) => ({ ingredientId: r.ingredientId, ingredient: byId.get(r.ingredientId), totalDelta: r.totalDelta ?? '0' }))
      .sort((a, b) => Number(a.totalDelta) - Number(b.totalDelta));
    return { usage };
  }),

  shiftSummary: roleProcedure('ADMIN').input(dateRangeInput).query(async ({ ctx, input }) => {
    const rows = await ctx.kdb!
      .selectFrom('Payment')
      .innerJoin('User', 'User.id', 'Payment.receivedById')
      .where('Payment.createdAt', '>=', new Date(input.from))
      .where('Payment.createdAt', '<=', new Date(input.to))
      .select(['Payment.receivedById as receivedById', 'Payment.amount as amount', 'User.name as name'])
      .execute();
    const byStaff = new Map<string, { name: string; orderCount: number; total: number }>();
    for (const p of rows) {
      const entry = byStaff.get(p.receivedById) ?? { name: p.name, orderCount: 0, total: 0 };
      entry.orderCount += 1;
      entry.total += Number(p.amount);
      byStaff.set(p.receivedById, entry);
    }
    return Array.from(byStaff.values());
  }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/report-router.test.ts`** (keep the `redis`/`flushdb()` line untouched)

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { redis } from '@/server/redis';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('report router', () => {
  beforeEach(async () => {
    await resetDb();
    await redis.flushdb();
  });

  it('computes daily sales, best sellers, inventory usage, and shift summary', async () => {
    const cashier = await kdb.insertInto('User').values({ id: createId(), name: 'Cashier', role: 'STAFF', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'PAID', source: 'STAFF', total: 9 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();
    await kdb.insertInto('Payment').values({ id: createId(), orderId: order.id, amount: 9, method: 'CASH', receivedById: cashier.id }).execute();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -400, reason: 'SALE', refOrderId: order.id, createdById: cashier.id }).execute();

    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const sales = await admin.report.dailySales(range);
    expect(sales.totalRevenue).toBe(9);
    expect(sales.orderCount).toBe(1);

    const best = await admin.report.bestSellers(range);
    expect(best[0]).toMatchObject({ qtySold: 2 });

    const usage = await admin.report.inventoryUsage(range);
    expect(usage.usage).toHaveLength(1);
    expect(usage.usage[0]).toMatchObject({ ingredient: { name: 'Milk' } });
    expect(Number(usage.usage[0].totalDelta)).toBe(-400);

    const shift = await admin.report.shiftSummary(range);
    expect(shift[0]).toMatchObject({ name: 'Cashier', orderCount: 1, total: 9 });

    const detail = await admin.report.salesDetail(range);
    expect(detail).toHaveLength(1);
    expect(Number(detail[0].total)).toBe(9);
    expect(detail[0].items).toHaveLength(1);
    expect(detail[0].items[0]).toMatchObject({ qty: 2, menuItem: { name: 'Latte' } });
  });

  it('inventoryUsage excludes restocks and manual adjustments, keeping only sales', async () => {
    const admin2 = await kdb.insertInto('User').values({ id: createId(), name: 'Admin2', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -100, reason: 'SALE', createdById: admin2.id }).execute();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: 200, reason: 'RESTOCK', createdById: admin2.id }).execute();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -50, reason: 'MANUAL_ADJUST', createdById: admin2.id }).execute();

    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const usage = await admin.report.inventoryUsage(range);
    expect(usage.usage).toHaveLength(1);
    expect(Number(usage.usage[0].totalDelta)).toBe(-100);
  });

  it('inventoryUsage summarizes multiple sales of the same ingredient into one row', async () => {
    const admin2 = await kdb.insertInto('User').values({ id: createId(), name: 'Admin2', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -100, reason: 'SALE', createdById: admin2.id }).execute();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -50, reason: 'SALE', createdById: admin2.id }).execute();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: beans.id, delta: -18, reason: 'SALE', createdById: admin2.id }).execute();

    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const usage = await admin.report.inventoryUsage(range);
    expect(usage.usage).toHaveLength(2);
    const milkRow = usage.usage.find((u) => u.ingredient?.name === 'Milk');
    expect(Number(milkRow!.totalDelta)).toBe(-150);
  });

  it('salesDetail excludes unpaid orders', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'OPEN', source: 'STAFF', total: 9 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();

    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const detail = await admin.report.salesDetail(range);
    expect(detail).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/report.ts tests/integration/report-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate report router from Prisma to Kysely

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 11: auth router

**Files:**
- Modify: `src/server/trpc/routers/auth.ts`
- Modify: `tests/integration/auth-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`.
- This task also removes the leftover debug `try/catch`/`console.error('[debug] auth.login threw:', ...)` logging added during the earlier Cloudflare-deployment debugging saga (see `prd/v4_cloudflare_deployment.md`) — it was left in place pending this router's rewrite.

**Current `src/server/trpc/routers/auth.ts`** — read directly (38 lines; `login` currently wraps its body in `try { ... } catch (err) { if (err instanceof TRPCError) throw err; console.error('[debug] auth.login threw:', ...); throw err; }` — this whole wrapper is debug-only and must be removed, not translated).

- [ ] **Step 1: Replace with the Kysely version (and drop the debug wrapper)**

```ts
import { z } from 'zod';
import { cookies } from 'next/headers';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { verifyPin } from '../../auth/pin';
import { signSession } from '../../auth/session';

export const authRouter = router({
  login: publicProcedure.input(z.object({ pin: z.string().min(4).max(6) })).mutation(async ({ ctx, input }) => {
    const users = await ctx.kdb!.selectFrom('User').selectAll().where('active', '=', true).execute();
    for (const user of users) {
      if (await verifyPin(input.pin, user.pinHash)) {
        const token = signSession({ userId: user.id, role: user.role, name: user.name });
        (await cookies()).set('session', token, {
          httpOnly: true,
          path: '/',
          maxAge: 43200,
          sameSite: 'lax',
        });
        return { name: user.name, role: user.role };
      }
    }
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid PIN' });
  }),

  logout: protectedProcedure.mutation(async () => {
    (await cookies()).delete('session');
    return { ok: true };
  }),

  me: protectedProcedure.query(({ ctx }) => ctx.user),
});
```

- [ ] **Step 2: Rewrite `tests/integration/auth-router.test.ts`** (keep the `next/headers` cookie-jar mock exactly as-is — unrelated to Prisma)

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { hashPin } from '@/server/auth/pin';
import { appRouter } from '@/server/trpc/routers/_app';

// `next/headers`' `cookies()` requires Next's request-scoped async storage,
// which only exists inside a real HTTP request (e.g. the /api/trpc route
// handler in production). `appRouter.createCaller()` below calls the router
// directly with no HTTP request, so there is no request store and the real
// `cookies()` throws "called outside a request scope" unconditionally
// (verified in node_modules/next/dist/server/request/cookies.js — no env
// var or config bypasses this). This mock provides an in-memory cookie jar
// so the login mutation's `cookies().set(...)`/`.delete(...)` calls have
// somewhere to write; it does not change auth.ts's production logic.
vi.mock('next/headers', () => {
  const store = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => {
        store.set(name, value);
      },
      delete: (name: string) => {
        store.delete(name);
      },
    }),
  };
});

describe('auth router', () => {
  beforeEach(resetDb);

  it('logs in with a valid PIN and rejects an invalid one', async () => {
    await kdb.insertInto('User').values({ id: createId(), name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const caller = appRouter.createCaller({ db, kdb, user: null });

    const result = await caller.auth.login({ pin: '1234' });
    expect(result).toMatchObject({ name: 'Admin', role: 'ADMIN' });

    await expect(caller.auth.login({ pin: '0000' })).rejects.toThrow();
  });

  it('logs out an authenticated user and rejects an unauthenticated logout', async () => {
    const user = await kdb.insertInto('User').values({ id: createId(), name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).returningAll().executeTakeFirstOrThrow();

    const authedCaller = appRouter.createCaller({ db, kdb, user: { userId: user.id, role: user.role, name: user.name } });
    const result = await authedCaller.auth.logout();
    expect(result).toEqual({ ok: true });

    const anonCaller = appRouter.createCaller({ db, kdb, user: null });
    await expect(anonCaller.auth.logout()).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/auth.ts tests/integration/auth-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate auth router from Prisma to Kysely

Also removes the temporary debug logging added during the Cloudflare
deployment investigation, now that the real root cause (Ably's msgpack
eval crash, then Prisma's WASM query compiler) is understood and this
router no longer needs it.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 12: aiSuggestion router

**Files:**
- Modify: `src/server/trpc/routers/aiSuggestion.ts`
- Modify: `tests/integration/ai-suggestion-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`. No stock-helper dependency.

**Current `src/server/trpc/routers/aiSuggestion.ts`** — read directly (126 lines; `getSuggestion` does `table.findUnique` then `menuItem.findMany({ include: { category: true } })`, casting the result via `as unknown as SuggestionMenuRow[]` — a pre-existing TS2589-workaround pattern from before this migration, not Prisma-specific, so the cast disappears entirely once the query itself returns a flat joined row shape).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure } from '../trpc';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '../../../lib/suggestionOptions';
import { buildSuggestionMessages, parseSuggestionResponse, SuggestionParseError } from '../../ai/suggestion';
import { fetchChatCompletion } from '../../ai/openaiClient';

const requestInput = z.object({
  type: z.string().min(1).max(60),
  taste: z.array(z.enum(TASTE_OPTIONS)).max(TASTE_OPTIONS.length),
  aroma: z.array(z.enum(AROMA_OPTIONS)).max(AROMA_OPTIONS.length),
  texture: z.array(z.enum(TEXTURE_OPTIONS)).max(TEXTURE_OPTIONS.length),
  notes: z.string().max(200).optional(),
});

// One or more per-type requests, submitted together as a single bulk call --
// all of them share one cooldown check rather than each burning its own,
// which is what firing N separate publicProcedure calls concurrently for
// the same tableToken would otherwise race against (the cooldown key is
// per table, not per type).
const suggestionInput = z.object({
  tableToken: z.string(),
  requests: z.array(requestInput).min(1).max(10),
});

const COOLDOWN_SECONDS = 30;

function cooldownKey(tableToken: string): string {
  return `ai-suggest-cooldown:${tableToken}`;
}

type SuggestionCard = {
  menuItemId: string;
  name: string;
  price: string;
  image: string | null;
  categoryName: string;
  reason: string;
};

export const aiSuggestionRouter = router({
  getSuggestion: publicProcedure.input(suggestionInput).mutation(async ({ ctx, input }) => {
    const cooldownStore = ctx.cooldownStore;
    if (!cooldownStore) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'cooldown store not configured' });
    }
    const kdb = ctx.kdb!;

    const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
    if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

    const allowed = await cooldownStore.checkAndSet(cooldownKey(input.tableToken), COOLDOWN_SECONDS);
    if (!allowed) {
      throw new TRPCError({
        code: 'TOO_MANY_REQUESTS',
        message: 'Please wait a moment before requesting more suggestions.',
      });
    }

    const rows = await kdb
      .selectFrom('MenuItem')
      .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
      .select(['MenuItem.id as id', 'MenuItem.name as name', 'MenuItem.price as price', 'MenuItem.image as image', 'Category.name as categoryName'])
      .where('MenuItem.available', '=', true)
      .where('MenuItem.outOfStockReason', 'is', null)
      .execute();

    if (rows.length === 0) {
      await cooldownStore.clear(cooldownKey(input.tableToken));
      return { results: input.requests.map((r) => ({ type: r.type, suggestions: [] as SuggestionCard[] })) };
    }

    const menuForAi = rows.map((i) => ({ id: i.id, name: i.name, category: i.categoryName, price: Number(i.price) }));
    const byId = new Map(rows.map((i) => [i.id, i]));

    try {
      // Every sub-request goes out at once (Promise.all), not one after
      // another -- "sent to AI at the same time" -- and any single failure
      // (network, malformed response) fails the whole batch the same way a
      // single-request failure always has, rather than returning partial
      // results the customer would have to sort out which page succeeded.
      const results = await Promise.all(
        input.requests.map(async (r) => {
          const messages = buildSuggestionMessages(
            { taste: r.taste, aroma: r.aroma, texture: r.texture, type: [r.type], notes: r.notes },
            menuForAi
          );
          const raw = await fetchChatCompletion(messages);
          const parsed = parseSuggestionResponse(raw, menuForAi);
          const suggestions = parsed
            .map((p): SuggestionCard | null => {
              const item = byId.get(p.menuItemId);
              if (!item) return null;
              return {
                menuItemId: item.id,
                name: item.name,
                price: String(item.price),
                image: item.image,
                categoryName: item.categoryName,
                reason: p.reason,
              };
            })
            .filter((s): s is SuggestionCard => s !== null);
          return { type: r.type, suggestions };
        })
      );
      return { results };
    } catch (err) {
      if (err instanceof SuggestionParseError) {
        console.error('OpenAI suggestion response malformed', err);
      } else {
        console.error('OpenAI suggestion call failed', err);
      }
      await cooldownStore.clear(cooldownKey(input.tableToken));
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get suggestions, try again." });
    }
  }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/ai-suggestion-router.test.ts`**

Read the current file first (150 lines, 7 tests, uses `RedisCooldownStore` directly — unrelated to Prisma, keep unchanged). Translate every `db.table.create`/`db.menuItem.create` fixture to `kdb.insertInto(...)`, add `kdb` to `createCaller(...)`.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { redis } from '@/server/redis';
import { RedisCooldownStore } from '@/server/cooldownStore';
import { resetDb } from '../helpers/db';

vi.mock('@/server/ai/openaiClient', () => ({
  fetchChatCompletion: vi.fn(),
}));

import { fetchChatCompletion } from '@/server/ai/openaiClient';
import { appRouter } from '@/server/trpc/routers/_app';

const mockedFetch = vi.mocked(fetchChatCompletion);

describe('aiSuggestion router', () => {
  beforeEach(async () => {
    await resetDb();
    await redis.flushdb();
    mockedFetch.mockReset();
  });

  it('returns validated suggestions built from the available menu', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T1', qrToken: 'tok-1' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 28000, categoryId: category.id, available: true }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Hidden', price: 10000, categoryId: category.id, available: false }).execute();
    mockedFetch.mockResolvedValue(
      JSON.stringify({ suggestions: [{ menuItemId: item.id, name: 'Latte', reason: 'Sweet and creamy' }] })
    );

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      requests: [{ type: 'Coffee', taste: ['Sweet'], aroma: [], texture: ['Creamy'] }],
    });

    expect(result.results).toEqual([
      {
        type: 'Coffee',
        suggestions: [
          {
            menuItemId: item.id,
            name: 'Latte',
            price: '28000',
            image: null,
            categoryName: 'Coffee',
            reason: 'Sweet and creamy',
          },
        ],
      },
    ]);
    // the unavailable "Hidden" item must never reach the prompt
    const promptText = mockedFetch.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(promptText).not.toContain('Hidden');
  });

  it('sends every request in the batch together and preserves result order', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T-bulk', qrToken: 'tok-bulk' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const latte = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 28000, categoryId: category.id, available: true }).returningAll().executeTakeFirstOrThrow();
    const tea = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Chamomile', price: 17000, categoryId: category.id, available: true }).returningAll().executeTakeFirstOrThrow();
    mockedFetch
      .mockResolvedValueOnce(JSON.stringify({ suggestions: [{ menuItemId: latte.id, name: 'Latte', reason: 'Bold' }] }))
      .mockResolvedValueOnce(
        JSON.stringify({ suggestions: [{ menuItemId: tea.id, name: 'Chamomile', reason: 'Soothing' }] })
      );

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      requests: [
        { type: 'Coffee', taste: [], aroma: [], texture: [] },
        { type: 'Tea', taste: [], aroma: [], texture: [] },
      ],
    });

    // one OpenAI call per request, dispatched together (not gated behind
    // each other resolving first) -- Promise.all, not sequential awaits.
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(result.results).toEqual([
      { type: 'Coffee', suggestions: [expect.objectContaining({ menuItemId: latte.id })] },
      { type: 'Tea', suggestions: [expect.objectContaining({ menuItemId: tea.id })] },
    ]);
  });

  it('rejects an empty requests array', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T-empty', qrToken: 'tok-empty' }).returningAll().executeTakeFirstOrThrow();
    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    await expect(
      anon.aiSuggestion.getSuggestion({ tableToken: table.qrToken, requests: [] })
    ).rejects.toThrow();
  });

  it('rejects an invalid table token', async () => {
    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    await expect(
      anon.aiSuggestion.getSuggestion({
        tableToken: 'not-a-real-token',
        requests: [{ type: 'Coffee', taste: [], aroma: [], texture: [] }],
      })
    ).rejects.toThrow();
  });

  it('enforces the per-table cooldown on a second immediate request, even across a whole batch', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T2', qrToken: 'tok-2' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Tea', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Chamomile', price: 17000, categoryId: category.id, available: true }).execute();
    mockedFetch.mockResolvedValue(JSON.stringify({ suggestions: [] }));

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const input = { tableToken: table.qrToken, requests: [{ type: 'Tea', taste: [], aroma: [], texture: [] }] };
    await anon.aiSuggestion.getSuggestion(input);
    await expect(anon.aiSuggestion.getSuggestion(input)).rejects.toThrow();
  });

  it('returns no suggestions without calling OpenAI when the menu is empty', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T3', qrToken: 'tok-3' }).returningAll().executeTakeFirstOrThrow();
    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    const result = await anon.aiSuggestion.getSuggestion({
      tableToken: table.qrToken,
      requests: [{ type: 'Coffee', taste: [], aroma: [], texture: [] }],
    });
    expect(result.results).toEqual([{ type: 'Coffee', suggestions: [] }]);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('surfaces a clear error when any request in the batch fails', async () => {
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T4', qrToken: 'tok-4' }).returningAll().executeTakeFirstOrThrow();
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 28000, categoryId: category.id, available: true }).execute();
    mockedFetch.mockRejectedValue(new Error('network down'));

    const anon = appRouter.createCaller({ db, kdb, user: null, cooldownStore: new RedisCooldownStore() });
    await expect(
      anon.aiSuggestion.getSuggestion({
        tableToken: table.qrToken,
        requests: [{ type: 'Coffee', taste: [], aroma: [], texture: [] }],
      })
    ).rejects.toThrow(/couldn.t get suggestions/i);
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/aiSuggestion.ts tests/integration/ai-suggestion-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate aiSuggestion router from Prisma to Kysely

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

## Task 13: aiMenuSuggestion router

**Files:**
- Modify: `src/server/trpc/routers/aiMenuSuggestion.ts`
- Modify: `tests/integration/ai-menu-suggestion-router.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`, `createId()`, and **switches its import of `recomputeAvailabilityForMenuItem` from `'../../stock/availability.prisma'` back to `'../../stock/availability'`**.

**Current `src/server/trpc/routers/aiMenuSuggestion.ts`** — read directly (167 lines; `suggestNewItem` does two `groupBy`-style aggregations plus a nested `select` for category counts; `createFromSuggestion` runs a multi-step `$transaction` creating a category/ingredients/menu item/recipes).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
import { fetchChatCompletion } from '../../ai/openaiClient';
import {
  buildMenuSuggestionMessages,
  parseMenuSuggestionResponse,
  MenuSuggestionParseError,
  type StockIngredient,
} from '../../ai/menuSuggestion';
import { recomputeAvailabilityForMenuItem } from '../../stock/availability';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '../../../lib/suggestionOptions';

const CUISINE_OPTIONS = ['Indonesian', 'Italian', 'Korean', 'Japanese', 'Western', 'Fusion'] as const;

const suggestInput = z.object({
  cuisine: z.array(z.enum(CUISINE_OPTIONS)).max(CUISINE_OPTIONS.length).default([]),
  taste: z.array(z.enum(TASTE_OPTIONS)).max(TASTE_OPTIONS.length).default([]),
  aroma: z.array(z.enum(AROMA_OPTIONS)).max(AROMA_OPTIONS.length).default([]),
  texture: z.array(z.enum(TEXTURE_OPTIONS)).max(TEXTURE_OPTIONS.length).default([]),
  categoryHint: z.string().max(60).optional(),
  notes: z.string().max(200).optional(),
});

const createInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string().optional(),
  newCategoryName: z.string().min(1).optional(),
  description: z.string(),
  instructions: z.string(),
  ingredients: z
    .array(
      z.object({
        existingIngredientId: z.string().optional(),
        name: z.string().min(1),
        unit: z.string().min(1),
        qtyPerUnit: z.number().positive(),
      })
    )
    .min(1),
});

export const aiMenuSuggestionRouter = router({
  suggestNewItem: roleProcedure('ADMIN')
    .input(suggestInput)
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const bestSellerRows = await kdb
        .selectFrom('OrderItem')
        .innerJoin('Order', 'Order.id', 'OrderItem.orderId')
        .innerJoin('MenuItem', 'MenuItem.id', 'OrderItem.menuItemId')
        .where('Order.createdAt', '>=', since)
        .where((eb) =>
          eb.exists(eb.selectFrom('Payment').select('Payment.id').whereRef('Payment.orderId', '=', 'Order.id'))
        )
        .groupBy(['OrderItem.menuItemId', 'MenuItem.name'])
        .select(['MenuItem.name as name', (eb) => eb.fn.sum('OrderItem.qty').as('qtySold')])
        .execute();
      const soldItems = bestSellerRows.map((r) => ({ name: r.name, qtySold: Number(r.qtySold ?? 0) }));
      const bestSellers = [...soldItems].sort((a, b) => b.qtySold - a.qtySold).slice(0, 10);
      const worstSellers = [...soldItems].sort((a, b) => a.qtySold - b.qtySold).slice(0, 5);

      const ingredientRows = await kdb.selectFrom('Ingredient').selectAll().orderBy('stockQty', 'asc').execute();
      const ingredients: StockIngredient[] = ingredientRows.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        stockQty: Number(i.stockQty),
      }));

      const existingItems = await kdb
        .selectFrom('MenuItem')
        .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
        .select(['MenuItem.name as name', 'Category.name as categoryName'])
        .execute();

      const categoryCountMap = new Map<string, number>();
      for (const item of existingItems) {
        categoryCountMap.set(item.categoryName, (categoryCountMap.get(item.categoryName) ?? 0) + 1);
      }
      const categoryCounts = Array.from(categoryCountMap.entries()).map(([name, count]) => ({ name, count }));

      const messages = buildMenuSuggestionMessages({
        bestSellers,
        worstSellers,
        ingredients,
        existingItemNames: existingItems.map((i) => i.name),
        categoryCounts,
        cuisine: input.cuisine,
        taste: input.taste,
        aroma: input.aroma,
        texture: input.texture,
        categoryHint: input.categoryHint,
        notes: input.notes,
      });

      let raw: string;
      try {
        raw = await fetchChatCompletion(messages, { maxTokens: 1000 });
      } catch (err) {
        console.error('OpenAI menu suggestion call failed', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get a suggestion, try again." });
      }

      try {
        return parseMenuSuggestionResponse(raw, ingredients);
      } catch (err) {
        if (err instanceof MenuSuggestionParseError) {
          console.error('OpenAI menu suggestion response malformed', err);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get a suggestion, try again." });
        }
        throw err;
      }
    }),

  createFromSuggestion: roleProcedure('ADMIN')
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      if (!input.categoryId && !input.newCategoryName) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'category is required' });
      }
      const kdb = ctx.kdb!;

      const menuItemId = await kdb.transaction().execute(async (trx) => {
        let categoryId = input.categoryId;
        if (!categoryId) {
          const maxSort = await trx.selectFrom('Category').select(({ fn }) => fn.max('sortOrder').as('maxSortOrder')).executeTakeFirst();
          const category = await trx.insertInto('Category')
            .values({ id: createId(), name: input.newCategoryName as string, sortOrder: Number(maxSort?.maxSortOrder ?? 0) + 1 })
            .returningAll()
            .executeTakeFirstOrThrow();
          categoryId = category.id;
        }

        const recipeInputs: { ingredientId: string; qtyPerUnit: number }[] = [];
        for (const ing of input.ingredients) {
          const ingredientId =
            ing.existingIngredientId ??
            (await trx.insertInto('Ingredient').values({ id: createId(), name: ing.name, unit: ing.unit, stockQty: 0 }).returningAll().executeTakeFirstOrThrow()).id;
          recipeInputs.push({ ingredientId, qtyPerUnit: ing.qtyPerUnit });
        }

        const created = await trx.insertInto('MenuItem')
          .values({
            id: createId(),
            name: input.name,
            price: input.price,
            categoryId,
            description: input.description,
            instructions: input.instructions,
            available: true,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        if (recipeInputs.length > 0) {
          await trx.insertInto('Recipe')
            .values(recipeInputs.map((r) => ({ id: createId(), menuItemId: created.id, ingredientId: r.ingredientId, qtyPerUnit: r.qtyPerUnit })))
            .execute();
        }

        await recomputeAvailabilityForMenuItem(trx, created.id);
        return created.id;
      });

      const item = await kdb
        .selectFrom('MenuItem')
        .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
        .selectAll('MenuItem')
        .select(['Category.id as category_id', 'Category.name as category_name', 'Category.sortOrder as category_sortOrder'])
        .where('MenuItem.id', '=', menuItemId)
        .executeTakeFirstOrThrow();
      return { ...item, category: { id: item.category_id, name: item.category_name, sortOrder: item.category_sortOrder } };
    }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/ai-menu-suggestion-router.test.ts`**

Read the current file first (162 lines, 7 tests). Translate every fixture; `db.ingredient.count()` becomes `kdb.selectFrom('Ingredient').select(({fn}) => fn.countAll().as('count')).executeTakeFirstOrThrow()` then `Number(count)`.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';

vi.mock('@/server/ai/openaiClient', () => ({
  fetchChatCompletion: vi.fn(),
}));

import { fetchChatCompletion } from '@/server/ai/openaiClient';
import { appRouter } from '@/server/trpc/routers/_app';

const mockedFetch = vi.mocked(fetchChatCompletion);

describe('aiMenuSuggestion router', () => {
  beforeEach(async () => {
    await resetDb();
    mockedFetch.mockReset();
  });

  it('suggestNewItem returns candidates with existing ingredients tagged by real id', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Food', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const rice = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 50 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Nasi Goreng', price: 30000, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const cashier = await kdb.insertInto('User').values({ id: createId(), name: 'Cashier', role: 'STAFF', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', source: 'STAFF', status: 'PAID', total: 30000 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 5, unitPrice: 30000 }).execute();
    await kdb.insertInto('Payment').values({ id: createId(), orderId: order.id, amount: 30000, method: 'CASH', receivedById: cashier.id }).execute();

    mockedFetch.mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            name: 'Rice Bowl',
            price: 35000,
            category: 'Food',
            description: 'A simple rice bowl.',
            instructions: 'Cook rice, serve.',
            ingredients: [{ name: 'rice', unit: 'g', qtyPerUnit: 150 }],
            reasoning: 'Uses low-stock rice; Nasi Goreng sells well.',
          },
        ],
      })
    );

    const result = await admin.aiMenuSuggestion.suggestNewItem({ cuisine: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].name).toBe('Rice Bowl');
      expect(result.candidates[0].ingredients).toEqual([
        { name: 'Rice', unit: 'g', qtyPerUnit: 150, existingIngredientId: rice.id },
      ]);
    }
    const promptText = mockedFetch.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(promptText).toContain('Nasi Goreng');
    expect(promptText).toContain('Rice');
  });

  it('rejects a non-admin caller', async () => {
    const staff = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'S' } });
    await expect(staff.aiMenuSuggestion.suggestNewItem({ cuisine: [] })).rejects.toThrow();
  });

  it('surfaces a clear error when the AI call fails', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    mockedFetch.mockRejectedValue(new Error('network down'));
    await expect(admin.aiMenuSuggestion.suggestNewItem({ cuisine: [] })).rejects.toThrow(/couldn.t get a suggestion/i);
  });

  it('returns ok:false when the AI reports no sensible suggestion, without throwing', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    mockedFetch.mockResolvedValue(JSON.stringify({ error: 'No usable data yet.' }));
    const result = await admin.aiMenuSuggestion.suggestNewItem({ cuisine: [] });
    expect(result).toEqual({ ok: false, reason: 'No usable data yet.' });
  });

  it('createFromSuggestion creates the item using only existing ingredients', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Food', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const rice = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    const created = await admin.aiMenuSuggestion.createFromSuggestion({
      name: 'Rice Bowl',
      price: 35000,
      categoryId: category.id,
      description: 'A simple rice bowl.',
      instructions: 'Cook rice, serve.',
      ingredients: [{ existingIngredientId: rice.id, name: 'Rice', unit: 'g', qtyPerUnit: 150 }],
    });

    expect(created.name).toBe('Rice Bowl');
    expect(created.description).toBe('A simple rice bowl.');
    expect(created.instructions).toBe('Cook rice, serve.');
    expect(created.outOfStockReason).toBeNull();

    const recipes = await kdb.selectFrom('Recipe').selectAll().where('menuItemId', '=', created.id).execute();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].ingredientId).toBe(rice.id);

    const ingredientCountAfter = await kdb.selectFrom('Ingredient').select(({ fn }) => fn.countAll().as('count')).executeTakeFirstOrThrow();
    expect(Number(ingredientCountAfter.count)).toBe(1);
  });

  it('createFromSuggestion creates a new ingredient at 0 stock and marks the item out of stock', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Snacks', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();

    const created = await admin.aiMenuSuggestion.createFromSuggestion({
      name: 'Truffle Fries',
      price: 30000,
      categoryId: category.id,
      description: 'Fries with truffle oil.',
      instructions: 'Fry, toss in oil.',
      ingredients: [{ name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10 }],
    });

    expect(created.outOfStockReason).toContain('Truffle Oil');

    const newIngredient = await kdb.selectFrom('Ingredient').selectAll().where('name', '=', 'Truffle Oil').executeTakeFirst();
    expect(newIngredient).not.toBeUndefined();
    expect(Number(newIngredient!.stockQty)).toBe(0);
  });

  it('createFromSuggestion creates a new category when newCategoryName is given', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const rice = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    const created = await admin.aiMenuSuggestion.createFromSuggestion({
      name: 'Rice Bowl',
      price: 35000,
      newCategoryName: 'Bowls',
      description: 'd',
      instructions: 'i',
      ingredients: [{ existingIngredientId: rice.id, name: 'Rice', unit: 'g', qtyPerUnit: 150 }],
    });

    const category = await kdb.selectFrom('Category').selectAll().where('id', '=', created.categoryId).executeTakeFirstOrThrow();
    expect(category.name).toBe('Bowls');
  });

  it('createFromSuggestion rejects when neither categoryId nor newCategoryName is given', async () => {
    const admin = appRouter.createCaller({ db, kdb, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const rice = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await expect(
      admin.aiMenuSuggestion.createFromSuggestion({
        name: 'Rice Bowl',
        price: 35000,
        description: 'd',
        instructions: 'i',
        ingredients: [{ existingIngredientId: rice.id, name: 'Rice', unit: 'g', qtyPerUnit: 150 }],
      })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

- [ ] **Step 4: Commit**

```bash
git add src/server/trpc/routers/aiMenuSuggestion.ts tests/integration/ai-menu-suggestion-router.test.ts
git commit -m "$(cat <<'EOF'
Migrate aiMenuSuggestion router from Prisma to Kysely

Switches to the Kysely version of recomputeAvailabilityForMenuItem.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 14: order router (heaviest — nested includes, multi-step transactions, self-relation, atomic increments)

**Files:**
- Modify: `src/server/trpc/routers/order.ts`
- Modify: `tests/integration/order-router.test.ts`
- Modify: `tests/integration/order-cancel.test.ts`

**Interfaces:**
- Consumes: `ctx.kdb!`, `createId()`, and **switches its import of `deductStockForOrder`/`revertStockForOrder` from `'../../stock/deduct.prisma'` back to `'../../stock/deduct'`**.
- Produces: no change to any procedure's input/output contract.

**Current `src/server/trpc/routers/order.ts`** — read directly (448 lines — the largest and most Prisma-feature-heavy router: nested `include`s up to 3 levels deep (`getOpenOrderByTableToken`'s `children.items.menuItem`), `$transaction`, the `Order` self-relation (`parentOrderId`/`parent`/`children`) for open-table sessions, `total: { increment: ... }`, and `_count: { select: { children: true } }`).

- [ ] **Step 1: Replace with the Kysely version**

```ts
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { Kysely, Transaction } from 'kysely';
import { router, protectedProcedure, publicProcedure, roleProcedure } from '../trpc';
import { publishOrderEvent } from '../../ably';
import { deductStockForOrder, revertStockForOrder } from '../../stock/deduct';
import { noopCache } from '../../cache';
import { createId } from '../../id';
import type { DB } from '../../db.types';

const orderItemInput = z.object({
  menuItemId: z.string(),
  qty: z.number().int().positive(),
  modifiers: z.record(z.string(), z.any()).optional(),
});

const createOrderInput = z.object({
  type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
  tableId: z.string().optional(),
  items: z.array(orderItemInput).min(1),
});

type BuiltOrderItem = { id: string; menuItemId: string; qty: number; modifiers: unknown; unitPrice: string };

async function buildOrderItems(
  db: Kysely<DB> | Transaction<DB>,
  items: z.infer<typeof orderItemInput>[]
): Promise<BuiltOrderItem[]> {
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await db.selectFrom('MenuItem').selectAll().where('id', 'in', menuItemIds).execute();
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  return items.map((i) => {
    const menuItem = byId.get(i.menuItemId);
    if (!menuItem) throw new TRPCError({ code: 'NOT_FOUND', message: `menu item ${i.menuItemId} not found` });
    if (!menuItem.available || menuItem.outOfStockReason) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `menu item ${menuItem.name} is not available` });
    }
    return {
      id: createId(),
      menuItemId: i.menuItemId,
      qty: i.qty,
      modifiers: i.modifiers ?? {},
      unitPrice: menuItem.price,
    };
  });
}

function calcTotal(items: { qty: number; unitPrice: unknown }[]): number {
  return items.reduce((sum, i) => sum + i.qty * Number(i.unitPrice), 0);
}

type OrderItemWithMenuItem = {
  id: string; orderId: string; menuItemId: string; qty: number; modifiers: unknown; unitPrice: string; kitchenStatus: string;
  menuItem: { id: string; name: string; price: string; image: string | null };
};

async function loadItemsWithMenuItem(db: Kysely<DB> | Transaction<DB>, orderIds: string[]): Promise<Map<string, OrderItemWithMenuItem[]>> {
  const map = new Map<string, OrderItemWithMenuItem[]>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .selectFrom('OrderItem')
    .innerJoin('MenuItem', 'MenuItem.id', 'OrderItem.menuItemId')
    .select([
      'OrderItem.id as id', 'OrderItem.orderId as orderId', 'OrderItem.menuItemId as menuItemId',
      'OrderItem.qty as qty', 'OrderItem.modifiers as modifiers', 'OrderItem.unitPrice as unitPrice',
      'OrderItem.kitchenStatus as kitchenStatus',
      'MenuItem.id as menuItem_id', 'MenuItem.name as menuItem_name', 'MenuItem.price as menuItem_price', 'MenuItem.image as menuItem_image',
    ])
    .where('OrderItem.orderId', 'in', orderIds)
    .execute();
  for (const r of rows) {
    const item: OrderItemWithMenuItem = {
      id: r.id, orderId: r.orderId, menuItemId: r.menuItemId, qty: r.qty, modifiers: r.modifiers,
      unitPrice: r.unitPrice, kitchenStatus: r.kitchenStatus,
      menuItem: { id: r.menuItem_id, name: r.menuItem_name, price: r.menuItem_price, image: r.menuItem_image },
    };
    const list = map.get(r.orderId) ?? [];
    list.push(item);
    map.set(r.orderId, list);
  }
  return map;
}

export const orderRouter = router({
  createStaff: roleProcedure('ADMIN', 'STAFF')
    .input(createOrderInput)
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const builtItems = await buildOrderItems(kdb, input.items);
      const order = await kdb.transaction().execute(async (trx) => {
        const created = await trx.insertInto('Order')
          .values({
            id: createId(), type: input.type, tableId: input.tableId ?? null, status: 'SENT_TO_KITCHEN',
            source: 'STAFF', createdById: ctx.user.userId, total: calcTotal(builtItems),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.insertInto('OrderItem')
          .values(builtItems.map((i) => ({ ...i, orderId: created.id })))
          .execute();
        return created;
      });
      const items = (await loadItemsWithMenuItem(kdb, [order.id])).get(order.id) ?? [];
      const result = { ...order, items };
      try {
        await publishOrderEvent('order.created', result);
      } catch (err) {
        console.error('publishOrderEvent failed for order.created', err);
      }
      return result;
    }),

  // The charge-first cart flow: creates the order (OPEN, paid before
  // dispatch) and charges it in one transaction. Order creation and
  // payment used to be two separate calls (create, then payment.payCash)
  // -- a failure between them left an OPEN order with no payment, which
  // sendToKitchen's payment-existence guard would then reject forever with
  // no way to recover except cancelling it. Atomic here: either both
  // happen or neither does.
  createAndCharge: roleProcedure('ADMIN', 'STAFF')
    .input(createOrderInput)
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const builtItems = await buildOrderItems(kdb, input.items);
      const total = calcTotal(builtItems);
      const order = await kdb.transaction().execute(async (trx) => {
        const created = await trx.insertInto('Order')
          .values({
            id: createId(), type: input.type, tableId: input.tableId ?? null, status: 'OPEN',
            source: 'STAFF', createdById: ctx.user.userId, total,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.insertInto('OrderItem').values(builtItems.map((i) => ({ ...i, orderId: created.id }))).execute();
        await trx.insertInto('Payment')
          .values({ id: createId(), orderId: created.id, amount: total, method: 'ONLINE', receivedById: ctx.user.userId })
          .execute();
        await deductStockForOrder(trx, created.id, ctx.user.userId);
        return created;
      });
      // Not kitchen-relevant yet -- sendToKitchen publishes the dispatch
      // event once someone actually confirms it from Pending Purchases.
      return order;
    }),

  // The one staff action for every pending order, but it means something
  // different depending on what the order is:
  // - Open-table parent: has no items of its own, only reachable once the
  //   customer finished the session. This is the "Confirm payment" action
  //   -- charges the sum of every child round's total in one Payment and
  //   closes the session (PAID). Never dispatches (nothing to dispatch).
  // - Open-table child (one round): dispatch only, no payment -- the
  //   parent settles the whole bill once the session ends.
  // - Ordinary order (staff charge-first or customer QR, no session):
  //   charges it if unpaid (customer QR orders never pre-pay), then
  //   dispatches. Unchanged from before parent/child orders existed.
  sendToKitchen: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb.selectFrom('Order').selectAll().where('id', '=', input.orderId).executeTakeFirstOrThrow();
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is not pending dispatch' });
      }

      if (order.isOpenTableSession) {
        if (!order.sessionFinished) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'table has not been finished by the customer yet' });
        }
        // Only rounds actually sent to the kitchen are billable -- a round
        // still sitting undispatched was never cooked, and a cancelled
        // round was voided outright, so neither belongs in the total. A
        // still-OPEN round has to be resolved (dispatched or cancelled)
        // first, or paying now strands it forever: still undispatched,
        // parentless in every sense that matters, and invisible on this
        // same queue since it's excluded once the parent isn't OPEN.
        const children = await kdb.selectFrom('Order').selectAll().where('parentOrderId', '=', order.id).execute();
        if (children.some((c) => c.status === 'OPEN')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'every round must be sent to the kitchen or cancelled before confirming payment' });
        }
        const processed = children.filter((c) => c.status !== 'CANCELLED');
        const total = processed.reduce((sum, c) => sum + Number(c.total), 0);
        return kdb.transaction().execute(async (trx) => {
          await trx.insertInto('Payment')
            .values({ id: createId(), orderId: order.id, amount: total, method: 'CASH', receivedById: ctx.user.userId })
            .execute();
          return trx.updateTable('Order').set({ status: 'PAID', total }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
        });
      }

      if (order.parentOrderId) {
        const updated = await kdb.transaction().execute(async (trx) => {
          await deductStockForOrder(trx, order.id, ctx.user.userId);
          return trx.updateTable('Order').set({ status: 'SENT_TO_KITCHEN' }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
        });
        try {
          await publishOrderEvent('order.dispatched', updated);
        } catch (err) {
          console.error('publishOrderEvent failed for order.dispatched', err);
        }
        return updated;
      }

      const payment = await kdb.selectFrom('Payment').selectAll().where('orderId', '=', order.id).executeTakeFirst();
      const updated = await kdb.transaction().execute(async (trx) => {
        if (!payment) {
          await trx.insertInto('Payment')
            .values({ id: createId(), orderId: order.id, amount: order.total, method: 'CASH', receivedById: ctx.user.userId })
            .execute();
          await deductStockForOrder(trx, order.id, ctx.user.userId);
        }
        return trx.updateTable('Order').set({ status: 'SENT_TO_KITCHEN' }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
      });
      try {
        await publishOrderEvent('order.dispatched', updated);
      } catch (err) {
        console.error('publishOrderEvent failed for order.dispatched', err);
      }
      return updated;
    }),

  // Ordinary orders, open-table rounds (children), and finished open-table
  // sessions (parents, ready for their one closing payment) -- everything
  // a staff member might need to act on from this one queue. A parent
  // that isn't finished yet is deliberately excluded: nothing to do with
  // it until the customer ends the session.
  // The parent row is included whenever it has at least one round -- not
  // only once finished -- so the client can group an in-progress table's
  // rounds under it too, not just a closed-out bill awaiting payment.
  listPendingDispatch: roleProcedure('ADMIN', 'STAFF').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const orders = await kdb
      .selectFrom('Order')
      .leftJoin('Table', 'Table.id', 'Order.tableId')
      .where('Order.status', '=', 'OPEN')
      .where((eb) =>
        eb.or([
          eb.and([eb('Order.isOpenTableSession', '=', false), eb('Order.parentOrderId', 'is', null)]),
          eb('Order.parentOrderId', 'is not', null),
          eb.and([
            eb('Order.isOpenTableSession', '=', true),
            eb.exists(eb.selectFrom('Order as Child').select('Child.id').whereRef('Child.parentOrderId', '=', 'Order.id')),
          ]),
        ])
      )
      .selectAll('Order')
      .select(['Table.id as table_id', 'Table.label as table_label', 'Table.qrToken as table_qrToken'])
      .orderBy('Order.createdAt', 'asc')
      .execute();

    const orderIds = orders.map((o) => o.id);
    const [itemsByOrder, payments, children] = await Promise.all([
      loadItemsWithMenuItem(kdb, orderIds),
      orderIds.length ? kdb.selectFrom('Payment').selectAll().where('orderId', 'in', orderIds).execute() : Promise.resolve([]),
      orderIds.length ? kdb.selectFrom('Order').selectAll().where('parentOrderId', 'in', orderIds).execute() : Promise.resolve([]),
    ]);
    const paymentsByOrder = new Map<string, typeof payments>();
    for (const p of payments) {
      const list = paymentsByOrder.get(p.orderId) ?? [];
      list.push(p);
      paymentsByOrder.set(p.orderId, list);
    }
    const childrenByOrder = new Map<string, typeof children>();
    for (const c of children) {
      const list = childrenByOrder.get(c.parentOrderId!) ?? [];
      list.push(c);
      childrenByOrder.set(c.parentOrderId!, list);
    }

    return orders.map((o) => ({
      ...o,
      table: o.table_id ? { id: o.table_id, label: o.table_label, qrToken: o.table_qrToken } : null,
      items: itemsByOrder.get(o.id) ?? [],
      payments: paymentsByOrder.get(o.id) ?? [],
      children: childrenByOrder.get(o.id) ?? [],
    }));
  }),

  // Starts an open-table session: a parent order with no items of its own,
  // anchoring every round the customer submits from here on. Reuses an
  // already-active session for the table instead of creating a duplicate
  // (e.g. a reload racing the recovery query).
  startTableSession: publicProcedure
    .input(z.object({ tableToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const existing = await kdb.selectFrom('Order').selectAll()
        .where('tableId', '=', table.id).where('source', '=', 'QR').where('isOpenTableSession', '=', true)
        .where('status', '=', 'OPEN').where('sessionFinished', '=', false)
        .executeTakeFirst();
      if (existing) return existing;

      return kdb.insertInto('Order')
        .values({ id: createId(), type: 'DINE_IN', tableId: table.id, status: 'OPEN', source: 'QR', isOpenTableSession: true, total: 0 })
        .returningAll()
        .executeTakeFirstOrThrow();
    }),

  // Customer-initiated: "I'm done ordering, bring the bill." Doesn't charge
  // anything itself (a customer has no business authorizing their own
  // charge) -- just flags the session so Pending Purchases swaps that
  // parent's action from nothing to Confirm payment. A session nobody ever
  // ordered a round on has nothing to bill -- cancel it outright instead
  // of flagging it finished, so it never shows up asking staff to confirm
  // a Rp 0 payment.
  finishTableSession: publicProcedure
    .input(z.object({ tableToken: z.string(), orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb
        .selectFrom('Order')
        .leftJoin('Table', 'Table.id', 'Order.tableId')
        .selectAll('Order')
        .select(['Table.qrToken as table_qrToken'])
        .where('Order.id', '=', input.orderId)
        .executeTakeFirst();
      if (!order || !order.isOpenTableSession) throw new TRPCError({ code: 'NOT_FOUND' });
      if (order.table_qrToken !== input.tableToken) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'table token mismatch' });
      }
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'session is already closed' });
      }
      const childCount = await kdb.selectFrom('Order').select(({ fn }) => fn.countAll().as('count')).where('parentOrderId', '=', order.id).executeTakeFirstOrThrow();
      if (Number(childCount.count) === 0) {
        return kdb.updateTable('Order')
          .set({ status: 'CANCELLED', cancelReason: 'table finished with no orders placed' })
          .where('id', '=', order.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }
      return kdb.updateTable('Order').set({ sessionFinished: true }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
    }),

  // Same charge-first shape as the staff cart's createAndCharge, minus the
  // payment: a customer submitting via QR doesn't pay through this app,
  // staff collects it in person and confirms from Pending Purchases
  // (sendToKitchen), which is what actually dispatches to the kitchen.
  //
  // With parentOrderId, this instead creates one round of an open-table
  // session -- a plain child order (still dispatched + no payment exactly
  // like above), just linked to the session so its total counts toward
  // the parent's eventual one-time bill.
  createByTable: publicProcedure
    .input(z.object({ tableToken: z.string(), items: z.array(orderItemInput).min(1), parentOrderId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      if (input.parentOrderId) {
        const parent = await kdb.selectFrom('Order').selectAll().where('id', '=', input.parentOrderId).executeTakeFirst();
        if (!parent || !parent.isOpenTableSession || parent.tableId !== table.id) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table session' });
        }
        if (parent.status !== 'OPEN' || parent.sessionFinished) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'table session is closed' });
        }
      }

      const builtItems = await buildOrderItems(kdb, input.items);
      const order = await kdb.transaction().execute(async (trx) => {
        const created = await trx.insertInto('Order')
          .values({
            id: createId(), type: 'DINE_IN', tableId: table.id, status: 'OPEN', source: 'QR',
            parentOrderId: input.parentOrderId ?? null, total: calcTotal(builtItems),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.insertInto('OrderItem').values(builtItems.map((i) => ({ ...i, orderId: created.id }))).execute();
        return created;
      });
      const items = (await loadItemsWithMenuItem(kdb, [order.id])).get(order.id) ?? [];
      return { ...order, items };
    }),

  // Only for a still-OPEN (not yet confirmed) ordinary order -- adding
  // more before staff has dispatched/charged it. Open-table rounds never
  // call this; each round is its own child order via createByTable.
  appendItems: publicProcedure
    .input(z.object({ orderId: z.string(), items: z.array(orderItemInput).min(1), tableToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb
        .selectFrom('Order')
        .leftJoin('Table', 'Table.id', 'Order.tableId')
        .selectAll('Order')
        .select(['Table.qrToken as table_qrToken'])
        .where('Order.id', '=', input.orderId)
        .executeTakeFirst();
      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });
      // status !== OPEN alone covers every "closed" case now (cancelled,
      // dispatched, paid) -- payment and dispatch always happen together
      // in the same transaction, so there's no longer a state where an
      // order is OPEN but already charged.
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is closed' });
      }
      if (order.table_qrToken !== input.tableToken) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'table token mismatch' });
      }

      const newItems = await buildOrderItems(kdb, input.items);
      const updated = await kdb.transaction().execute(async (trx) => {
        await trx.insertInto('OrderItem').values(newItems.map((i) => ({ ...i, orderId: order.id }))).execute();
        return trx.updateTable('Order')
          .set((eb) => ({ total: eb('total', '+', calcTotal(newItems)) }))
          .where('id', '=', order.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      });
      // Still OPEN (unconfirmed) -- not kitchen-relevant yet, so no publish.
      const items = (await loadItemsWithMenuItem(kdb, [updated.id])).get(updated.id) ?? [];
      return { ...updated, items };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb
        .selectFrom('Order')
        .leftJoin('Table', 'Table.id', 'Order.tableId')
        .selectAll('Order')
        .select(['Table.id as table_id', 'Table.label as table_label', 'Table.qrToken as table_qrToken'])
        .where('Order.id', '=', input.id)
        .executeTakeFirstOrThrow();
      const items = (await loadItemsWithMenuItem(kdb, [order.id])).get(order.id) ?? [];
      return {
        ...order,
        table: order.table_id ? { id: order.table_id, label: order.table_label, qrToken: order.table_qrToken } : null,
        items,
      };
    }),

  // Only a still-active open-table session is ever recovered here -- it's
  // a real ongoing tab, meant to survive a reload/re-scan. A one-time
  // (ordinary) order is deliberately fire-and-forget: once placed, it's
  // done from the customer's side, so leaving and coming back always
  // starts fresh at the mode choice rather than resuming or silently
  // appending to it. A *finished* session is fire-and-forget too, the
  // moment the customer hits Done -- it lingers server-side, OPEN, purely
  // so staff can still confirm payment on it (see listPendingDispatch),
  // but the customer is done with it and must get the fresh mode choice
  // on their next visit, same as an ordinary order.
  getOpenOrderByTableToken: publicProcedure
    .input(z.object({ tableToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const session = await kdb.selectFrom('Order').selectAll()
        .where('tableId', '=', table.id).where('source', '=', 'QR').where('isOpenTableSession', '=', true)
        .where('status', '=', 'OPEN').where('sessionFinished', '=', false)
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      if (!session) return null;

      const children = await kdb.selectFrom('Order').selectAll().where('parentOrderId', '=', session.id).orderBy('createdAt', 'asc').execute();
      const childIds = children.map((c) => c.id);
      const itemsByOrder = await loadItemsWithMenuItem(kdb, childIds);
      return {
        mode: 'OPEN_TABLE' as const,
        session: { ...session, children: children.map((c) => ({ ...c, items: itemsByOrder.get(c.id) ?? [] })) },
      };
    }),

  // OPEN is excluded on purpose: a charge-first order sits at OPEN until
  // sendToKitchen confirms it, and shouldn't be kitchen-visible before
  // that. SERVED (bumped/delivered) is included but bounded to the last
  // few hours -- the KDS's Delivered/All filters need some recent history,
  // but a full unbounded log would grow forever over a day's service.
  listOpen: roleProcedure('ADMIN', 'STAFF', 'KITCHEN').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const orders = await kdb
      .selectFrom('Order')
      .leftJoin('Table', 'Table.id', 'Order.tableId')
      .where((eb) =>
        eb.or([
          eb('Order.status', 'in', ['SENT_TO_KITCHEN', 'READY']),
          eb.and([eb('Order.status', '=', 'SERVED'), eb('Order.createdAt', '>=', new Date(Date.now() - 4 * 60 * 60 * 1000))]),
        ])
      )
      .selectAll('Order')
      .select(['Table.id as table_id', 'Table.label as table_label', 'Table.qrToken as table_qrToken'])
      .orderBy('Order.createdAt', 'asc')
      .execute();
    const itemsByOrder = await loadItemsWithMenuItem(kdb, orders.map((o) => o.id));
    return orders.map((o) => ({
      ...o,
      table: o.table_id ? { id: o.table_id, label: o.table_label, qrToken: o.table_qrToken } : null,
      items: itemsByOrder.get(o.id) ?? [],
    }));
  }),

  // STAFF may only cancel a still-OPEN (pending, not yet dispatched) order
  // -- e.g. from the Pending Purchases list. Cancelling anything already
  // dispatched/served/paid is a refund-level decision and stays ADMIN-only.
  cancel: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb.selectFrom('Order').selectAll().where('id', '=', input.orderId).executeTakeFirstOrThrow();
      if (order.status === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order already cancelled' });
      }
      if (ctx.user.role === 'STAFF' && order.status !== 'OPEN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only an admin can cancel an order that has already been dispatched' });
      }

      // Cancelling a parent takes every still-live round with it -- there's
      // no such thing as a bill for a session that no longer exists. Each
      // round is cancelled individually (its own stock revert, its own
      // dispatch event) rather than left dangling under a cancelled parent.
      const children = order.isOpenTableSession
        ? await kdb.selectFrom('Order').selectAll().where('parentOrderId', '=', order.id).where('status', '!=', 'CANCELLED').execute()
        : [];
      if (ctx.user.role === 'STAFF' && children.some((c) => c.status !== 'OPEN')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only an admin can cancel a table with rounds already dispatched' });
      }
      const ordersToCancel = [order, ...children];
      const ordersToCancelIds = ordersToCancel.map((o) => o.id);

      // Whether stock needs reverting depends on whether it was actually
      // deducted, not on payment existence -- those used to always happen
      // together, but an open-table child order deducts stock at dispatch
      // with no payment of its own (the parent settles the bill later), so
      // payment-existence alone would miss it. StockMovement is the direct
      // signal either way.
      const deductedIds = new Set(
        (
          await kdb.selectFrom('StockMovement').select('refOrderId')
            .where('refOrderId', 'in', ordersToCancelIds).where('reason', '=', 'SALE').execute()
        ).map((m) => m.refOrderId)
      );
      await kdb.transaction().execute(async (trx) => {
        for (const o of ordersToCancel) {
          await trx.updateTable('Order').set({ status: 'CANCELLED', cancelReason: input.reason }).where('id', '=', o.id).execute();
          if (deductedIds.has(o.id)) {
            await revertStockForOrder(trx, o.id, ctx.user.userId);
          }
        }
      });
      try {
        for (const o of ordersToCancel) {
          await publishOrderEvent('order.cancelled', { orderId: o.id, reason: input.reason });
        }
      } catch (err) {
        console.error('publishOrderEvent failed for order.cancelled', err);
      }
      try {
        await (ctx.cache ?? noopCache).deleteByPrefix('report:dailySales:');
      } catch (err) {
        console.error('dailySales cache invalidation failed after order.cancel', err);
      }
      return { ok: true };
    }),
});
```

- [ ] **Step 2: Rewrite `tests/integration/order-router.test.ts`**

Read the current file first (92 lines, 5 tests). `Order.createdById` is a real FK to `User`, unlike `Category`/`MenuItem`/`Table`, so the `ctx.user` id must correspond to an actual row.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('order router', () => {
  beforeEach(resetDb);

  async function seedMenu() {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    return kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
  }

  it('staff creates a dine-in order with items and a computed total', async () => {
    const item = await seedMenu();
    await kdb.insertInto('User').values({ id: 'u1', name: 'C', role: 'STAFF', pinHash: await hashPin('1234') }).execute();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });

    const order = await cashier.order.createStaff({
      type: 'DINE_IN',
      items: [{ menuItemId: item.id, qty: 2 }],
    });

    expect(Number(order.total)).toBe(9);
    expect(order.status).toBe('SENT_TO_KITCHEN');
    expect(order.source).toBe('STAFF');
  });

  it('rejects order creation for an item that is auto-out-of-stock even though the manual flag is still available', async () => {
    const item = await seedMenu();
    await kdb.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Milk' }).where('id', '=', item.id).execute();
    const refreshed = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(refreshed.available).toBe(true);

    await kdb.insertInto('User').values({ id: 'u1', name: 'C', role: 'STAFF', pinHash: await hashPin('1234') }).execute();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });

    await expect(
      cashier.order.createStaff({
        type: 'DINE_IN',
        items: [{ menuItemId: item.id, qty: 1 }],
      })
    ).rejects.toThrow();
  });

  it('QR customer creates an order by table token and can append items', async () => {
    const item = await seedMenu();
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T1', qrToken: 'tok-1' }).returningAll().executeTakeFirstOrThrow();
    const anon = appRouter.createCaller({ db, kdb, user: null });

    const order = await anon.order.createByTable({
      tableToken: 'tok-1',
      items: [{ menuItemId: item.id, qty: 1 }],
    });
    expect(order.source).toBe('QR');
    expect(order.tableId).toBe(table.id);

    const updated = await anon.order.appendItems({
      orderId: order.id,
      tableToken: 'tok-1',
      items: [{ menuItemId: item.id, qty: 1 }],
    });
    expect(Number(updated.total)).toBe(9);
  });

  it('rejects an append with the wrong table token', async () => {
    const item = await seedMenu();
    await kdb.insertInto('Table').values({ id: createId(), label: 'T1', qrToken: 'tok-1' }).execute();
    const anon = appRouter.createCaller({ db, kdb, user: null });
    const order = await anon.order.createByTable({ tableToken: 'tok-1', items: [{ menuItemId: item.id, qty: 1 }] });

    await expect(
      anon.order.appendItems({ orderId: order.id, tableToken: 'wrong-token', items: [{ menuItemId: item.id, qty: 1 }] })
    ).rejects.toThrow();
  });

  it('rejects order creation for an invalid table token', async () => {
    const item = await seedMenu();
    const anon = appRouter.createCaller({ db, kdb, user: null });
    await expect(
      anon.order.createByTable({ tableToken: 'does-not-exist', items: [{ menuItemId: item.id, qty: 1 }] })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Rewrite `tests/integration/order-cancel.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('order cancel', () => {
  beforeEach(resetDb);

  it('cancels an open order without touching stock', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const adminUser = await kdb.insertInto('User').values({ id: createId(), name: 'A1', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 4.5 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 }).execute();

    const admin = appRouter.createCaller({ db, kdb, user: { userId: adminUser.id, role: 'ADMIN', name: 'A1' } });
    await admin.order.cancel({ orderId: order.id, reason: 'customer changed mind' });

    const cancelled = await kdb.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('reverts stock when cancelling a paid order', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 800 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    const adminUser = await kdb.insertInto('User').values({ id: createId(), name: 'A2', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'PAID', source: 'STAFF', total: 4.5 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 }).execute();
    await kdb.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -200, reason: 'SALE', refOrderId: order.id, createdById: adminUser.id }).execute();
    await kdb.insertInto('Payment').values({ id: createId(), orderId: order.id, amount: 4.5, method: 'CASH', receivedById: adminUser.id }).execute();

    const admin = appRouter.createCaller({ db, kdb, user: { userId: adminUser.id, role: 'ADMIN', name: 'A2' } });
    await admin.order.cancel({ orderId: order.id, reason: 'refund' });

    const restocked = await kdb.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(restocked.stockQty)).toBe(1000);
  });

  it('rejects cancel from a non-admin role', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 4.5 }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 }).execute();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });
    await expect(cashier.order.cancel({ orderId: order.id, reason: 'x' })).rejects.toThrow();
  });
});
```

- [ ] **Step 4: Verify**

```bash
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```

This is the largest single task in the plan — if `npm run build` surfaces Kysely type friction around the dynamic table alias (`'Order as Child'`) or the `.selectAll('Order')` + extra `.select([...])` combination used for the `Table` left-joins, resolve it by adjusting the query construction (e.g. explicit column lists instead of `selectAll('Order')`) while preserving the exact same returned shape — do not change what any procedure returns to its caller.

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/order.ts tests/integration/order-router.test.ts tests/integration/order-cancel.test.ts
git commit -m "$(cat <<'EOF'
Migrate order router from Prisma to Kysely

The heaviest router in this migration: nested includes replaced with
explicit joins/second queries + in-memory merges, $transaction replaced
with db.transaction().execute(), and the self-relation (parent/child
open-table sessions) handled via plain parentOrderId queries. Switches to
the Kysely versions of deductStockForOrder/revertStockForOrder.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 15: seed script — relocate and rewrite on Kysely

**Files:**
- Create: `database/seed.ts`
- Delete: `prisma/seed.ts` (after the new one is verified working)
- Modify: `package.json` (seed script entry)

**Interfaces:**
- Consumes: `kdb` (Task 1), `createId()` (Task 1), `hashPin` from `src/server/auth/pin.ts` (unchanged).

**Current `prisma/seed.ts`** — read directly (386 lines: creates 1 store, 3 users via `createManyAndReturn`, 8 categories, 45 ingredients, 40 menu items, ~70 recipes, 10 tables, then a loop of 14 backdated sample orders each with items + one payment, plus matching backdated `StockMovement` rows). All literal data (names, prices, quantities) must be preserved exactly — this is real, curated seed content, not placeholder data.

- [ ] **Step 1: Write `database/seed.ts`**

Read the full current `prisma/seed.ts` content first and carry over every literal array verbatim (ingredient names/units/quantities, menu item names/prices/categories, recipe qty-per-unit values, table labels/tokens, the 14 `orderSpecs` entries) — only the insertion mechanics change, shown below with the exact transformation pattern applied to the first few entries of each list; apply the identical pattern to every remaining entry in each array without changing any literal value:

```ts
// database/seed.ts
import { kdb } from '../src/server/db.kysely';
import { createId } from '../src/server/id';
import { hashPin } from '../src/server/auth/pin';

async function main() {
  await kdb.insertInto('Store').values({ id: createId(), name: 'Main Store' }).execute();

  const userSpecs = [
    { name: 'Admin', role: 'ADMIN' as const, pin: '1234' },
    { name: 'Staff', role: 'STAFF' as const, pin: '2345' },
    { name: 'Kitchen', role: 'KITCHEN' as const, pin: '4567' },
  ];
  const users = await kdb.insertInto('User')
    .values(await Promise.all(userSpecs.map(async (u) => ({ id: createId(), name: u.name, role: u.role, pinHash: await hashPin(u.pin) }))))
    .returningAll()
    .execute();
  const userId = (name: string) => users.find((u) => u.name === name)!.id;

  const categorySpecs = [
    { name: 'Coffee', sortOrder: 1 },
    { name: 'Tea', sortOrder: 2 },
    { name: 'Food', sortOrder: 3 },
    { name: 'Pastry', sortOrder: 4 },
    { name: 'Snacks', sortOrder: 5 },
    { name: 'Steak', sortOrder: 6 },
    { name: 'Italian', sortOrder: 7 },
    { name: 'Korean', sortOrder: 8 },
  ];
  const categories = await kdb.insertInto('Category')
    .values(categorySpecs.map((c) => ({ id: createId(), ...c })))
    .returningAll()
    .execute();
  const categoryId = (name: string) => categories.find((c) => c.name === name)!.id;

  // Carry over prisma/seed.ts's full 45-entry ingredientSpecs array verbatim
  // (Milk, Coffee Beans, Palm Sugar Syrup, ... Sesame Oil) -- every
  // { name, unit, stockQty } literal unchanged, only the wrapping insert
  // mechanics differ from the original.
  const ingredientSpecs = [
    { name: 'Milk', unit: 'ml', stockQty: 5000 },
    { name: 'Coffee Beans', unit: 'g', stockQty: 2000 },
    { name: 'Palm Sugar Syrup', unit: 'ml', stockQty: 750 },
    { name: 'Black Tea Leaves', unit: 'g', stockQty: 200 },
    { name: 'Matcha Powder', unit: 'g', stockQty: 250 },
    { name: 'Chamomile Tea Bag', unit: 'pcs', stockQty: 100 },
    { name: 'Lemon', unit: 'pcs', stockQty: 30 },
    { name: 'Rice', unit: 'g', stockQty: 5000 },
    { name: 'Egg', unit: 'pcs', stockQty: 100 },
    { name: 'Chicken Breast', unit: 'g', stockQty: 3000 },
    { name: 'Egg Noodles', unit: 'g', stockQty: 3750 },
    { name: 'Beef Chuck', unit: 'g', stockQty: 3750 },
    { name: 'Coconut Milk', unit: 'ml', stockQty: 2500 },
    { name: 'Rendang Spice Paste', unit: 'g', stockQty: 1000 },
    { name: 'Romaine Lettuce', unit: 'g', stockQty: 2500 },
    { name: 'Parmesan Cheese', unit: 'g', stockQty: 500 },
    { name: 'Sandwich Bread', unit: 'pcs', stockQty: 150 },
    { name: 'Bacon', unit: 'g', stockQty: 1000 },
    { name: 'Croissant Dough', unit: 'pcs', stockQty: 50 },
    { name: 'Pain au Chocolat Dough', unit: 'pcs', stockQty: 50 },
    { name: 'Cinnamon Roll Dough', unit: 'pcs', stockQty: 50 },
    { name: 'Cheesecake Slice (pre-made)', unit: 'pcs', stockQty: 50 },
    { name: 'Potato', unit: 'g', stockQty: 4500 },
    { name: 'Onion Rings (frozen, bulk)', unit: 'g', stockQty: 3750 },
    { name: 'Chicken Wings', unit: 'g', stockQty: 6250 },
    { name: 'Ribeye Cut', unit: 'g', stockQty: 5000 },
    { name: 'Sirloin Cut', unit: 'g', stockQty: 4400 },
    { name: 'Tenderloin Cut', unit: 'g', stockQty: 4000 },
    { name: 'T-Bone Cut', unit: 'g', stockQty: 6000 },
    { name: 'Wagyu Striploin Cut', unit: 'g', stockQty: 2000 },
    { name: 'Butter', unit: 'g', stockQty: 3000 },
    { name: 'Spaghetti', unit: 'g', stockQty: 3600 },
    { name: 'Fettuccine', unit: 'g', stockQty: 3600 },
    { name: 'Pizza Dough', unit: 'pcs', stockQty: 40 },
    { name: 'Mozzarella Cheese', unit: 'g', stockQty: 2000 },
    { name: 'Tomato Sauce', unit: 'ml', stockQty: 3000 },
    { name: 'Lasagna Sheets', unit: 'g', stockQty: 1500 },
    { name: 'Arborio Rice', unit: 'g', stockQty: 1800 },
    { name: 'Mushroom', unit: 'g', stockQty: 1500 },
    { name: 'Breadcrumbs', unit: 'g', stockQty: 1000 },
    { name: 'Gochujang', unit: 'g', stockQty: 1200 },
    { name: 'Kimchi', unit: 'g', stockQty: 1500 },
    { name: 'Rice Cake (Tteok)', unit: 'g', stockQty: 2000 },
    { name: 'Glass Noodles (Dangmyeon)', unit: 'g', stockQty: 1500 },
    { name: 'Sesame Oil', unit: 'ml', stockQty: 1000 },
  ];
  const ingredients = await kdb.insertInto('Ingredient')
    .values(ingredientSpecs.map((i) => ({ id: createId(), ...i })))
    .returningAll()
    .execute();
  const ingredientId = (name: string) => ingredients.find((i) => i.name === name)!.id;

  // Carry over prisma/seed.ts's full 40-entry itemSpecs array verbatim
  // (Espresso through Japchae) -- every { name, price, categoryName,
  // available } literal unchanged.
  const itemSpecs = [
    { name: 'Espresso', price: 18000, categoryName: 'Coffee' },
    { name: 'Kopi Susu Gula Aren', price: 22000, categoryName: 'Coffee' },
    { name: 'Cappuccino', price: 25000, categoryName: 'Coffee' },
    { name: 'Caffè Latte', price: 27000, categoryName: 'Coffee' },
    { name: 'Americano', price: 20000, categoryName: 'Coffee' },
    { name: 'Cold Brew', price: 24000, categoryName: 'Coffee' },
    { name: 'Teh Tarik', price: 20000, categoryName: 'Tea' },
    { name: 'Matcha Latte', price: 28000, categoryName: 'Tea' },
    { name: 'Lemon Tea', price: 18000, categoryName: 'Tea' },
    { name: 'Chamomile', price: 17000, categoryName: 'Tea' },
    { name: 'Nasi Goreng Spesial', price: 32000, categoryName: 'Food' },
    { name: 'Mie Ayam', price: 30000, categoryName: 'Food' },
    { name: 'Chicken Katsu Rice', price: 35000, categoryName: 'Food' },
    { name: 'Beef Rendang Rice', price: 58000, categoryName: 'Food' },
    { name: 'Caesar Salad', price: 34000, categoryName: 'Food' },
    { name: 'Club Sandwich', price: 36000, categoryName: 'Food' },
    { name: 'Butter Croissant', price: 19000, categoryName: 'Pastry' },
    { name: 'Pain au Chocolat', price: 21000, categoryName: 'Pastry' },
    { name: 'Cinnamon Roll', price: 23000, categoryName: 'Pastry' },
    { name: 'Cheesecake Slice', price: 29000, categoryName: 'Pastry' },
    { name: 'French Fries', price: 18000, categoryName: 'Snacks' },
    { name: 'Onion Rings', price: 20000, categoryName: 'Snacks' },
    { name: 'Chicken Wings', price: 28000, categoryName: 'Snacks' },
    { name: 'Sirloin Steak', price: 145000, categoryName: 'Steak' },
    { name: 'T-Bone Steak', price: 165000, categoryName: 'Steak' },
    { name: 'Tenderloin Steak', price: 175000, categoryName: 'Steak' },
    { name: 'Ribeye Steak', price: 185000, categoryName: 'Steak' },
    { name: 'Wagyu Striploin', price: 285000, categoryName: 'Steak' },
    { name: 'Spaghetti Carbonara', price: 48000, categoryName: 'Italian' },
    { name: 'Fettuccine Alfredo', price: 46000, categoryName: 'Italian' },
    { name: 'Margherita Pizza', price: 52000, categoryName: 'Italian' },
    { name: 'Lasagna al Forno', price: 55000, categoryName: 'Italian' },
    { name: 'Chicken Parmigiana', price: 58000, categoryName: 'Italian' },
    { name: 'Risotto ai Funghi', price: 50000, categoryName: 'Italian' },
    { name: 'Bibimbap', price: 42000, categoryName: 'Korean' },
    { name: 'Bulgogi Beef', price: 55000, categoryName: 'Korean' },
    { name: 'Korean Fried Chicken', price: 45000, categoryName: 'Korean' },
    { name: 'Kimchi Fried Rice', price: 38000, categoryName: 'Korean' },
    { name: 'Tteokbokki', price: 32000, categoryName: 'Korean' },
    { name: 'Japchae', price: 36000, categoryName: 'Korean' },
  ];
  const items = await kdb.insertInto('MenuItem')
    .values(itemSpecs.map((i) => ({ id: createId(), name: i.name, price: i.price, categoryId: categoryId(i.categoryName), available: true })))
    .returningAll()
    .execute();
  const itemId = (name: string) => items.find((i) => i.name === name)!.id;

  // Carry over prisma/seed.ts's full recipe list verbatim (Espresso through
  // Japchae's ingredient links) -- every { menuItemName, ingredientName,
  // qtyPerUnit } literal unchanged.
  const recipeSpecs = [
    { menuItemName: 'Espresso', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Kopi Susu Gula Aren', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Kopi Susu Gula Aren', ingredientName: 'Milk', qtyPerUnit: 150 },
    { menuItemName: 'Kopi Susu Gula Aren', ingredientName: 'Palm Sugar Syrup', qtyPerUnit: 30 },
    { menuItemName: 'Cappuccino', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Cappuccino', ingredientName: 'Milk', qtyPerUnit: 150 },
    { menuItemName: 'Caffè Latte', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Caffè Latte', ingredientName: 'Milk', qtyPerUnit: 200 },
    { menuItemName: 'Americano', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Cold Brew', ingredientName: 'Coffee Beans', qtyPerUnit: 25 },
    { menuItemName: 'Teh Tarik', ingredientName: 'Black Tea Leaves', qtyPerUnit: 8 },
    { menuItemName: 'Teh Tarik', ingredientName: 'Milk', qtyPerUnit: 150 },
    { menuItemName: 'Matcha Latte', ingredientName: 'Matcha Powder', qtyPerUnit: 10 },
    { menuItemName: 'Matcha Latte', ingredientName: 'Milk', qtyPerUnit: 180 },
    { menuItemName: 'Lemon Tea', ingredientName: 'Black Tea Leaves', qtyPerUnit: 8 },
    { menuItemName: 'Lemon Tea', ingredientName: 'Lemon', qtyPerUnit: 0.5 },
    { menuItemName: 'Chamomile', ingredientName: 'Chamomile Tea Bag', qtyPerUnit: 1 },
    { menuItemName: 'Nasi Goreng Spesial', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Nasi Goreng Spesial', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Nasi Goreng Spesial', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Mie Ayam', ingredientName: 'Egg Noodles', qtyPerUnit: 150 },
    { menuItemName: 'Mie Ayam', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Chicken Katsu Rice', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Chicken Katsu Rice', ingredientName: 'Chicken Breast', qtyPerUnit: 150 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Beef Chuck', qtyPerUnit: 150 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Coconut Milk', qtyPerUnit: 100 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Rendang Spice Paste', qtyPerUnit: 40 },
    { menuItemName: 'Caesar Salad', ingredientName: 'Romaine Lettuce', qtyPerUnit: 100 },
    { menuItemName: 'Caesar Salad', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Caesar Salad', ingredientName: 'Parmesan Cheese', qtyPerUnit: 20 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Sandwich Bread', qtyPerUnit: 3 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Bacon', qtyPerUnit: 40 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Butter Croissant', ingredientName: 'Croissant Dough', qtyPerUnit: 1 },
    { menuItemName: 'Pain au Chocolat', ingredientName: 'Pain au Chocolat Dough', qtyPerUnit: 1 },
    { menuItemName: 'Cinnamon Roll', ingredientName: 'Cinnamon Roll Dough', qtyPerUnit: 1 },
    { menuItemName: 'Cheesecake Slice', ingredientName: 'Cheesecake Slice (pre-made)', qtyPerUnit: 1 },
    { menuItemName: 'French Fries', ingredientName: 'Potato', qtyPerUnit: 180 },
    { menuItemName: 'Onion Rings', ingredientName: 'Onion Rings (frozen, bulk)', qtyPerUnit: 150 },
    { menuItemName: 'Chicken Wings', ingredientName: 'Chicken Wings', qtyPerUnit: 250 },
    { menuItemName: 'Sirloin Steak', ingredientName: 'Sirloin Cut', qtyPerUnit: 220 },
    { menuItemName: 'Sirloin Steak', ingredientName: 'Butter', qtyPerUnit: 15 },
    { menuItemName: 'T-Bone Steak', ingredientName: 'T-Bone Cut', qtyPerUnit: 300 },
    { menuItemName: 'T-Bone Steak', ingredientName: 'Butter', qtyPerUnit: 20 },
    { menuItemName: 'Tenderloin Steak', ingredientName: 'Tenderloin Cut', qtyPerUnit: 200 },
    { menuItemName: 'Tenderloin Steak', ingredientName: 'Butter', qtyPerUnit: 15 },
    { menuItemName: 'Ribeye Steak', ingredientName: 'Ribeye Cut', qtyPerUnit: 250 },
    { menuItemName: 'Ribeye Steak', ingredientName: 'Butter', qtyPerUnit: 20 },
    { menuItemName: 'Wagyu Striploin', ingredientName: 'Wagyu Striploin Cut', qtyPerUnit: 200 },
    { menuItemName: 'Wagyu Striploin', ingredientName: 'Butter', qtyPerUnit: 25 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Spaghetti', qtyPerUnit: 180 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Egg', qtyPerUnit: 2 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Bacon', qtyPerUnit: 60 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Parmesan Cheese', qtyPerUnit: 30 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Fettuccine', qtyPerUnit: 180 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Butter', qtyPerUnit: 30 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Parmesan Cheese', qtyPerUnit: 40 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Milk', qtyPerUnit: 100 },
    { menuItemName: 'Margherita Pizza', ingredientName: 'Pizza Dough', qtyPerUnit: 1 },
    { menuItemName: 'Margherita Pizza', ingredientName: 'Tomato Sauce', qtyPerUnit: 80 },
    { menuItemName: 'Margherita Pizza', ingredientName: 'Mozzarella Cheese', qtyPerUnit: 120 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Lasagna Sheets', qtyPerUnit: 150 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Beef Chuck', qtyPerUnit: 150 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Tomato Sauce', qtyPerUnit: 100 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Mozzarella Cheese', qtyPerUnit: 80 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Chicken Breast', qtyPerUnit: 180 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Breadcrumbs', qtyPerUnit: 50 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Tomato Sauce', qtyPerUnit: 80 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Mozzarella Cheese', qtyPerUnit: 60 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Arborio Rice', qtyPerUnit: 180 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Mushroom', qtyPerUnit: 100 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Parmesan Cheese', qtyPerUnit: 30 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Butter', qtyPerUnit: 20 },
    { menuItemName: 'Bibimbap', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Bibimbap', ingredientName: 'Beef Chuck', qtyPerUnit: 100 },
    { menuItemName: 'Bibimbap', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Bibimbap', ingredientName: 'Kimchi', qtyPerUnit: 50 },
    { menuItemName: 'Bibimbap', ingredientName: 'Sesame Oil', qtyPerUnit: 10 },
    { menuItemName: 'Bulgogi Beef', ingredientName: 'Beef Chuck', qtyPerUnit: 200 },
    { menuItemName: 'Bulgogi Beef', ingredientName: 'Sesame Oil', qtyPerUnit: 15 },
    { menuItemName: 'Bulgogi Beef', ingredientName: 'Rice', qtyPerUnit: 150 },
    { menuItemName: 'Korean Fried Chicken', ingredientName: 'Chicken Wings', qtyPerUnit: 300 },
    { menuItemName: 'Korean Fried Chicken', ingredientName: 'Gochujang', qtyPerUnit: 30 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Kimchi', qtyPerUnit: 100 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Sesame Oil', qtyPerUnit: 10 },
    { menuItemName: 'Tteokbokki', ingredientName: 'Rice Cake (Tteok)', qtyPerUnit: 200 },
    { menuItemName: 'Tteokbokki', ingredientName: 'Gochujang', qtyPerUnit: 40 },
    { menuItemName: 'Japchae', ingredientName: 'Glass Noodles (Dangmyeon)', qtyPerUnit: 150 },
    { menuItemName: 'Japchae', ingredientName: 'Beef Chuck', qtyPerUnit: 80 },
    { menuItemName: 'Japchae', ingredientName: 'Sesame Oil', qtyPerUnit: 10 },
    { menuItemName: 'Japchae', ingredientName: 'Egg', qtyPerUnit: 1 },
  ];
  await kdb.insertInto('Recipe')
    .values(recipeSpecs.map((r) => ({ id: createId(), menuItemId: itemId(r.menuItemName), ingredientId: ingredientId(r.ingredientName), qtyPerUnit: r.qtyPerUnit })))
    .execute();

  const tableSpecs = [
    { label: 'T1', qrToken: 'seed-table-1-token' },
    { label: 'T2', qrToken: 'seed-table-2-token' },
    { label: 'T3', qrToken: 'seed-table-3-token' },
    { label: 'T4', qrToken: 'seed-table-4-token' },
    { label: 'T5', qrToken: 'seed-table-5-token' },
    { label: 'T6', qrToken: 'seed-table-6-token' },
    { label: 'Bar 1', qrToken: 'seed-table-bar1-token' },
    { label: 'Bar 2', qrToken: 'seed-table-bar2-token' },
    { label: 'Patio 1', qrToken: 'seed-table-patio1-token' },
    { label: 'Patio 2', qrToken: 'seed-table-patio2-token' },
  ];
  const tables = await kdb.insertInto('Table')
    .values(tableSpecs.map((t) => ({ id: createId(), ...t })))
    .returningAll()
    .execute();
  const tableId = (label: string) => tables.find((t) => t.label === label)!.id;

  // Sample completed sales spread across the last week, so Reports (revenue,
  // best sellers, shift summary) has real data instead of an empty state.
  const daysAgo = (n: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  const orderSpecs: {
    daysAgo: number;
    hour: number;
    type: 'DINE_IN' | 'TAKEAWAY';
    source: 'STAFF' | 'QR';
    table?: string;
    cashier: string;
    lines: { item: string; qty: number }[];
  }[] = [
    { daysAgo: 6, hour: 8, type: 'DINE_IN', source: 'QR', table: 'T1', cashier: 'Staff', lines: [{ item: 'Espresso', qty: 2 }, { item: 'Butter Croissant', qty: 2 }] },
    { daysAgo: 6, hour: 12, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Nasi Goreng Spesial', qty: 1 }, { item: 'Lemon Tea', qty: 1 }] },
    { daysAgo: 5, hour: 9, type: 'DINE_IN', source: 'QR', table: 'T3', cashier: 'Staff', lines: [{ item: 'Caffè Latte', qty: 1 }, { item: 'Cinnamon Roll', qty: 1 }] },
    { daysAgo: 5, hour: 13, type: 'DINE_IN', source: 'QR', table: 'Bar 1', cashier: 'Admin', lines: [{ item: 'Chicken Katsu Rice', qty: 2 }] },
    { daysAgo: 4, hour: 10, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Kopi Susu Gula Aren', qty: 3 }] },
    { daysAgo: 4, hour: 18, type: 'DINE_IN', source: 'QR', table: 'T5', cashier: 'Staff', lines: [{ item: 'Beef Rendang Rice', qty: 1 }, { item: 'Chamomile', qty: 1 }] },
    { daysAgo: 3, hour: 8, type: 'DINE_IN', source: 'QR', table: 'Patio 1', cashier: 'Admin', lines: [{ item: 'Cappuccino', qty: 2 }, { item: 'Pain au Chocolat', qty: 2 }] },
    { daysAgo: 3, hour: 19, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Mie Ayam', qty: 2 }, { item: 'French Fries', qty: 1 }] },
    { daysAgo: 2, hour: 11, type: 'DINE_IN', source: 'QR', table: 'T2', cashier: 'Staff', lines: [{ item: 'Americano', qty: 1 }, { item: 'Club Sandwich', qty: 1 }] },
    { daysAgo: 2, hour: 17, type: 'DINE_IN', source: 'QR', table: 'Bar 2', cashier: 'Admin', lines: [{ item: 'Matcha Latte', qty: 2 }, { item: 'Cheesecake Slice', qty: 1 }] },
    { daysAgo: 1, hour: 9, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Cold Brew', qty: 2 }] },
    { daysAgo: 1, hour: 14, type: 'DINE_IN', source: 'QR', table: 'T4', cashier: 'Staff', lines: [{ item: 'Caesar Salad', qty: 1 }, { item: 'Onion Rings', qty: 1 }] },
    { daysAgo: 0, hour: 8, type: 'DINE_IN', source: 'QR', table: 'T1', cashier: 'Staff', lines: [{ item: 'Espresso', qty: 1 }, { item: 'Kopi Susu Gula Aren', qty: 1 }] },
    { daysAgo: 0, hour: 11, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Admin', lines: [{ item: 'Chicken Wings', qty: 1 }, { item: 'Teh Tarik', qty: 1 }] },
  ];

  const itemPrice = new Map(items.map((i) => [i.name, Number(i.price)]));

  const allRecipes = await kdb.selectFrom('Recipe').selectAll().execute();
  const recipesByItem = new Map<string, { ingredientId: string; qtyPerUnit: number }[]>();
  for (const r of allRecipes) {
    const list = recipesByItem.get(r.menuItemId) ?? [];
    list.push({ ingredientId: r.ingredientId, qtyPerUnit: Number(r.qtyPerUnit) });
    recipesByItem.set(r.menuItemId, list);
  }

  for (const spec of orderSpecs) {
    const createdAt = daysAgo(spec.daysAgo, spec.hour);
    const total = spec.lines.reduce((sum, l) => sum + itemPrice.get(l.item)! * l.qty, 0);
    const cashierId = userId(spec.cashier);

    const order = await kdb.transaction().execute(async (trx) => {
      const created = await trx.insertInto('Order')
        .values({
          id: createId(), type: spec.type, source: spec.source, status: 'PAID',
          tableId: spec.table ? tableId(spec.table) : null,
          createdById: spec.source === 'STAFF' ? cashierId : null,
          total, createdAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.insertInto('OrderItem')
        .values(spec.lines.map((l) => ({
          id: createId(), orderId: created.id, menuItemId: itemId(l.item), qty: l.qty,
          unitPrice: itemPrice.get(l.item)!, kitchenStatus: 'SERVED' as const,
        })))
        .execute();
      await trx.insertInto('Payment')
        .values({ id: createId(), orderId: created.id, amount: total, method: 'CASH', receivedById: cashierId, createdAt })
        .execute();
      return created;
    });

    // Deduct ingredient stock for this sale, mirroring
    // deductStockForOrder's effect (src/server/stock/deduct.ts), but with
    // createdAt backdated to match the order instead of "now".
    const deductions = new Map<string, number>();
    for (const line of spec.lines) {
      for (const recipe of recipesByItem.get(itemId(line.item)) ?? []) {
        const qty = recipe.qtyPerUnit * line.qty;
        deductions.set(recipe.ingredientId, (deductions.get(recipe.ingredientId) ?? 0) + qty);
      }
    }
    for (const [ingId, qty] of deductions.entries()) {
      await kdb.updateTable('Ingredient').set((eb) => ({ stockQty: eb('stockQty', '-', qty) })).where('id', '=', ingId).execute();
      await kdb.insertInto('StockMovement')
        .values({ id: createId(), ingredientId: ingId, delta: -qty, reason: 'SALE', refOrderId: order.id, createdById: cashierId, createdAt })
        .execute();
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Update `package.json`'s seed reference**

Remove the `"prisma": { "seed": "tsx prisma/seed.ts" }` config block and update whatever script invokes it (there is currently no dedicated `npm run seed` script — seeding is invoked via `npx prisma db seed`, which reads that config block). Add a plain script instead:

```json
"scripts": {
  ...
  "seed": "tsx database/seed.ts"
}
```

- [ ] **Step 3: Run the seed script against pos_test and verify**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npm run seed
```
Expect it completes with no errors (exit code 0). Verify: `docker exec pos-app-postgres-1 psql -U postgres -d pos_test -c "SELECT count(*) FROM \"MenuItem\";"` shows `40`. Then reset pos_test back to empty for the rest of the suite: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test` (the suite's own `beforeEach(resetDb)` wipes it before the first test runs, so no separate wipe step is actually needed — just confirm the full suite still passes after having just run the seed script against the same database).

- [ ] **Step 4: Delete the old `prisma/seed.ts`**

```bash
git rm prisma/seed.ts
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

- [ ] **Step 6: Commit**

```bash
git add database/seed.ts package.json
git commit -m "$(cat <<'EOF'
Relocate and rewrite seed script from prisma/seed.ts to database/seed.ts

Same curated seed data (users, categories, ingredients, menu items,
recipes, tables, 14 backdated sample orders), now inserted via Kysely
instead of Prisma's createManyAndReturn.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

## Task 16: Cleanup — remove Prisma entirely, rename kdb → db

**Files:**
- Delete: `prisma/` (entire directory: `schema.prisma`, `migrations/`)
- Delete: `src/server/db.cloudflare.ts`
- Delete: `src/server/stock/availability.prisma.ts`, `src/server/stock/deduct.prisma.ts`
- Delete: `tests/integration/stock-availability.prisma.test.ts`, `tests/integration/stock-deduct.prisma.test.ts`
- Rename: `src/server/db.kysely.ts` → `src/server/db.ts` (replacing the old Prisma-based file)
- Modify: `src/server/trpc/context.ts`
- Modify: every router under `src/server/trpc/routers/` (rename `ctx.kdb!` → `ctx.db`)
- Modify: every already-converted test file (merge `db`+`kdb` imports/usages back into one `db`)
- Modify: `tests/helpers/db.ts`, `tests/integration/db.test.ts`
- Modify: `package.json` (remove all `@prisma/*`/`prisma` entries, `postinstall`, `allowScripts` entries; remove `pg`/`@types/pg` — confirmed unused by anything except the Prisma code being deleted)
- Modify: `next.config.ts` (remove the now-unnecessary `pg-cloudflare` tracing include — it existed only for `@prisma/adapter-pg`'s use of `pg` on Cloudflare Workers)
- Modify: `.env.example`, `README.md` (remove Prisma-specific tooling references, if any remain)

**Interfaces:** This task has no new interfaces — it finalizes the ones already in use, removing the transitional dual-client scaffolding.

- [ ] **Step 1: Confirm every router is already converted (no more `ctx.db.<model>.<prismaMethod>` calls)**

```bash
grep -rln "ctx\.db\.\(user\|order\|menuItem\|category\|ingredient\|recipe\|table\|payment\|stockMovement\|stockAdjustmentBatch\|stockAdjustmentLine\|store\)\." src/server/trpc/routers/
```
Expect **no output** — every router should already be using `ctx.kdb!` exclusively (Tasks 4–14 converted all 11 routers). If this finds anything, stop and investigate before proceeding — a router was missed.

- [ ] **Step 2: Delete the Prisma schema/migrations directory and the `.prisma.ts`/`.prisma.test.ts` scaffolding from Task 3**

```bash
git rm -r prisma/
git rm src/server/db.cloudflare.ts
git rm src/server/stock/availability.prisma.ts src/server/stock/deduct.prisma.ts
git rm tests/integration/stock-availability.prisma.test.ts tests/integration/stock-deduct.prisma.test.ts
```

- [ ] **Step 3: Rename the Kysely client file, delete the old Prisma one**

```bash
git rm src/server/db.ts
git mv src/server/db.kysely.ts src/server/db.ts
```

Edit the newly-renamed `src/server/db.ts`: rename the exported `kdb` to `db`, and rename the global cache variable for clarity:

```ts
import postgres from 'postgres';
import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import { getCloudflareContext } from '@opennextjs/cloudflare';
import type { DB } from './db.types';

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

if (process.env.NODE_ENV !== 'production') {
  globalThis.__posAppDb = db;
}
```

- [ ] **Step 4: Rewrite `src/server/trpc/context.ts` — drop Prisma entirely**

```ts
import { cookies } from 'next/headers';
import type { Kysely } from 'kysely';
import { db } from '../db';
import type { DB, Role } from '../db.types';
import { verifySession } from '../auth/session';
import { RedisCooldownStore, KvCooldownStore, type CooldownStore, type KvNamespaceLike } from '../cooldownStore';
import { RedisCache, KvCache, noopCache, type Cache } from '../cache';

export type Context = {
  db: Kysely<DB>;
  user: { userId: string; role: Role; name: string } | null;
  // Optional on the type (even though createContext() always sets it) so
  // the ~50 existing test call sites that do
  // `appRouter.createCaller({ db, user })` keep compiling without needing
  // to plumb a cooldown store through routers that never touch it.
  cooldownStore?: CooldownStore;
  cache?: Cache;
};

export async function getContextCooldownStore(): Promise<CooldownStore> {
  if (process.env.RUNTIME_TARGET === 'cloudflare') {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const kv = (env as Record<string, unknown>).KV as KvNamespaceLike | undefined;
    if (!kv) {
      throw new Error('RUNTIME_TARGET=cloudflare but the KV binding is missing');
    }
    return new KvCooldownStore(kv);
  }
  return new RedisCooldownStore();
}

export async function getContextCache(): Promise<Cache> {
  if (process.env.RUNTIME_TARGET === 'cloudflare') {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const kv = (env as Record<string, unknown>).KV as KvNamespaceLike | undefined;
    // Unlike the cooldown store, a missing binding here degrades to a
    // no-op instead of throwing -- caching has no correctness requirement.
    return kv ? new KvCache(kv) : noopCache;
  }
  return new RedisCache();
}

export async function createContext(): Promise<Context> {
  const cooldownStore = await getContextCooldownStore();
  const cache = await getContextCache();

  const token = (await cookies()).get('session')?.value;
  const payload = token ? await verifySession(token) : null;

  let user: Context['user'] = null;
  if (payload) {
    const dbUser = await db.selectFrom('User').selectAll().where('id', '=', payload.userId).executeTakeFirst();
    if (dbUser && dbUser.active) {
      user = { userId: dbUser.id, role: dbUser.role, name: dbUser.name };
    }
  }

  return { db, user, cooldownStore, cache };
}
```

Note `Role` now comes from `../db.types` (defined in Task 1 as `'ADMIN' | 'STAFF' | 'KITCHEN'`) instead of `@prisma/client`. `RUNTIME_TARGET`-based branching is gone entirely from the DB-connection path (the new `db.ts` tries Hyperdrive first, falls back to `DATABASE_URL`, with no env var needed) — `RUNTIME_TARGET` is still used by `getContextCooldownStore`/`getContextCache` for the unrelated KV/Redis branching, untouched.

- [ ] **Step 5: Rename `ctx.kdb!` → `ctx.db` across every router**

```bash
grep -rl "ctx\.kdb!" src/server/trpc/routers/ | xargs sed -i '' 's/ctx\.kdb!/ctx.db/g'
grep -rl "const kdb = ctx\.kdb!;" src/server/trpc/routers/ | xargs sed -i '' 's/const kdb = ctx\.kdb!;/const kdb = ctx.db;/g'
```
(macOS `sed -i ''` syntax — the second command catches the `const kdb = ctx.kdb!;` local-alias pattern used inside several routers; the local variable name `kdb` itself is left as-is throughout each router's body — only the right-hand-side source of that variable changes. This is intentional: renaming every in-body `kdb` local variable to `db` too would collide with each router's own already-imported `db`-named things in a few files and isn't necessary for correctness.)

Verify no `ctx.kdb` references remain: `grep -rn "ctx\.kdb" src/` → expect no output.

- [ ] **Step 6: Merge `db`+`kdb` back into one `db` import across every already-converted file**

Every router file and every already-converted test file currently has both `import { db } from '@/server/db';` (or a relative path) and `import { kdb } from '@/server/db.kysely';` (test files) or just uses `ctx.db`/`ctx.kdb!` (router files, handled in Step 5). For **test files**, run:

```bash
FILES=$(grep -rl "from '@/server/db.kysely'" tests/)
for f in $FILES; do
  # Drop the old Prisma db import line entirely
  sed -i '' "/import { db } from '@\/server\/db';/d" "$f"
  # Repoint the kdb import at the renamed db.ts, importing it as `db`
  sed -i '' "s/import { kdb } from '@\/server\/db.kysely';/import { db } from '@\/server\/db';/" "$f"
  # Every remaining bare `kdb` identifier becomes `db`
  sed -i '' 's/\bkdb\b/db/g' "$f"
  # createCaller({ db, db, user ... }) -> createCaller({ db, user ... }) (the
  # sed above can produce a duplicate `db,` where the call used to read
  # `db, kdb,` -- collapse it)
  sed -i '' 's/{ db, db,/{ db,/g' "$f"
done
```

After running this, read a couple of the affected files (e.g. `tests/integration/menu-router.test.ts`, `tests/integration/order-router.test.ts`) to confirm the substitution produced valid, sensible code — in particular confirm no file ended up with two `import { db } ...` lines or a leftover `db, db` anywhere. Fix any file the script mangled by hand.

Also update `tests/helpers/db.ts`: it currently does `import { kdb } from '@/server/db.kysely';` — change to `import { db } from '@/server/db';` and rename every `kdb.` inside the function body to `db.`.

Also rewrite `tests/integration/db.test.ts` (the generic connectivity smoke test, never assigned to a router task since it doesn't go through `appRouter` at all):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';

describe('db client', () => {
  beforeEach(resetDb);

  it('creates and reads a Category', async () => {
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const found = await db.selectFrom('Category').selectAll().where('id', '=', category.id).executeTakeFirst();
    expect(found?.name).toBe('Coffee');
  });
});
```

- [ ] **Step 7: Remove Prisma from `package.json`**

Remove:
- The `"postinstall": "prisma generate"` script line entirely.
- The whole `"prisma": { "seed": "tsx prisma/seed.ts" }` config block (already superseded by the plain `"seed": "tsx database/seed.ts"` script from Task 15).
- Dependencies: `"@prisma/adapter-pg"`, `"@prisma/client"`, `"pg"`.
- devDependencies: `"prisma"`, `"@types/pg"`.
- `allowScripts` entries: `"@prisma/client@6.19.0"`, `"@prisma/engines@6.19.0"`, `"prisma@6.19.0"`.

Then:
```bash
npm install
```
(refreshes `package-lock.json` to drop the removed packages' transitive dependencies, including `pg-cloudflare`).

- [ ] **Step 8: Remove the now-unnecessary `pg-cloudflare` tracing include from `next.config.ts`**

This existed only because `@prisma/adapter-pg` pulled in `pg`, which needed `pg-cloudflare`'s WASM shim traced into the Cloudflare bundle. `postgres` (porsager/postgres) has no such native/WASM dependency, so this becomes dead configuration. Read `next.config.ts` first, then replace its content with:

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

- [ ] **Step 9: Update `.env.example` and `README.md`**

Read both files and remove any remaining Prisma-specific instructions (e.g. `npx prisma migrate`, `npx prisma generate`, `npx prisma db seed` references) — replace with the `database/migrate.sh` and `npm run seed` equivalents established in Tasks 1 and 15. Do not touch anything unrelated (S3/Ably/JWT/Cloudflare sections stay as-is).

- [ ] **Step 10: Re-approve npm scripts if needed and run the full verification**

```bash
npx --yes npm@latest approve-scripts --all
npm run build
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test
```
Both must be fully clean. At this point `grep -rn "@prisma\|PrismaClient\|prisma" src/ package.json --include="*.ts"` (excluding this plan/spec's own markdown files) should show no remaining references except perhaps comments narrating the migration's history (e.g. code comments explaining *why* something is shaped a certain way) — those are fine to keep.

- [ ] **Step 11: Final Cloudflare Workers bundle verification**

This is the one point in the whole migration where the Workers bundle itself gets re-verified (not needed after every individual router task — see Global Constraints):

```bash
npm run build:cf
```
Must succeed with no Prisma-related errors (there should be nothing Prisma-related left to error on). Then confirm no Prisma artifacts leaked into the bundle:
```bash
grep -c "PrismaClient\|@prisma/client" .open-next/worker.js
```
Expect `0`. If time and Hyperdrive-local-connection-string setup permit, run one real `wrangler dev` smoke test against the production bundle (`CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE="postgresql://postgres:postgres@localhost:5433/pos_dev"`) and exercise a login + one query end-to-end, matching the rigor used earlier this session to diagnose the original Prisma-on-Workers failures — this is the test that will finally confirm the whole point of this migration: the app can now actually serve a real request on Cloudflare Workers.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
Remove Prisma entirely; rename Kysely client to db.ts

Drops @prisma/client, @prisma/adapter-pg, prisma, pg, and the entire
prisma/ directory. src/server/db.kysely.ts becomes src/server/db.ts (the
one and only DB client now); Context.kdb is gone, Context.db is now the
Kysely client. This completes the migration off Prisma — Prisma's query
engine could not run on Cloudflare Workers with this app's stack in any
configuration (see docs/superpowers/specs/2026-09-07-drop-prisma-raw-sql-design.md
for the full investigation); postgres + Kysely has none of that engine
layer and is confirmed working via wrangler dev against the real
production bundle.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
git push
```

---

This completes the plan. After Task 16, the app has zero Prisma dependency, uses `postgres` + Kysely uniformly across Node and Cloudflare Workers targets via the unified `src/server/db.ts`, and the original blocker for real Cloudflare Workers deployment (Prisma's query engine) is gone.

