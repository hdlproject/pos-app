import postgres from 'postgres';
import { Kysely } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import type { DB } from './db.types';

declare global {
  var __posAppDb: Kysely<DB> | undefined;
}

// Exported so the Cloudflare Workers request path (see
// trpc/context.ts's getContextDb()) can build a fresh client per request
// instead of caching one at module scope. On Workers, the postgres.js TCP
// socket is owned by the I/O context of whichever request constructed it —
// a later request runs in a different I/O context and any query issued
// against a client built by an earlier request never settles (workerd's
// hang detector eventually kills it). This mirrors the constraint the old
// Prisma-era db.cloudflare.ts documented for PrismaClient: build fresh per
// request on Cloudflare, never reuse a module-level singleton there.
export function buildDb(connectionString: string): Kysely<DB> {
  const sql = postgres(connectionString, { max: 5, connect_timeout: 10, idle_timeout: 20 });
  return new Kysely<DB>({ dialect: new PostgresJSDialect({ postgres: sql }) });
}

// Node singleton — used directly by local dev, tests, and any non-Cloudflare
// runtime target. Node's process model doesn't have Workers' per-request I/O
// context isolation, so caching one client for the process lifetime is safe
// and desirable here (avoids reconnecting on every request/test).
//
// Deliberately does NOT throw if DATABASE_URL is unset at import time —
// postgres.js connects lazily (confirmed: `postgres(undefined, opts)` does
// not throw synchronously), so this stays a no-op until actually queried.
// This matters because this module is still statically imported on the
// Cloudflare Workers path too (see trpc/context.ts's getContextDb(), which
// falls back to this export when not running on Cloudflare) — DATABASE_URL
// is never set in the deployed Workers env (only the HYPERDRIVE binding
// is), and an eager throw here would crash the worker at cold start even
// though this singleton is never actually used on that path.
export const db = globalThis.__posAppDb ?? buildDb(process.env.DATABASE_URL ?? '');

if (process.env.NODE_ENV !== 'production') {
  globalThis.__posAppDb = db;
}
