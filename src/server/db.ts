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
//
// idle_timeout: 20 below is also what bounds the lifetime of these
// per-request Cloudflare clients -- postgres.js's own idle-connection
// reaper closes a connection once it's been idle for 20s. (An earlier
// version of this code tried to close the connection explicitly via
// `ctx.waitUntil(sql.end(...))` in trpc/context.ts; that broke every real
// query on the Cloudflare path, since `.end()` starts rejecting new
// queries almost immediately, well before the request that just
// constructed the client gets a chance to use it. See the git history /
// final-review notes on trpc/context.ts's getContextDb() for the full
// story.)
//
// All 7 timestamp columns in the schema are `timestamp(3) without time
// zone` (see database/001_initial.sql). postgres.js's default parser for
// that type (OID 1114) does `new Date(x)` on the naive datetime string,
// which JS interprets as LOCAL time. But the write path serializes via
// `toISOString()` (UTC), and Postgres silently drops the offset info on a
// `without time zone` column -- so the UTC instant is what's actually
// stored, and reading it back through the default parser reinterprets that
// same wall-clock string as local time, shifting it by the host's UTC
// offset. This has no effect on the Cloudflare Workers deploy (Workers run
// UTC) but corrupts every timestamp read on a non-UTC Node host. Fix: parse
// (and serialize) OID 1114 -- along with 1082 (date) and 1184
// (timestamptz), for consistency -- as UTC explicitly.
const TIMESTAMP_TYPE = {
  to: 1184,
  from: [1082, 1114, 1184],
  serialize: (x: Date | string) => (x instanceof Date ? x : new Date(x)).toISOString(),
  parse: (x: string) => new Date(/[Zz]|[+-]\d{2}(:?\d{2})?$/.test(x) ? x : x + 'Z'),
};

export function buildDb(connectionString: string): Kysely<DB> {
  const sql = postgres(connectionString, {
    max: 5,
    connect_timeout: 10,
    idle_timeout: 20,
    types: { date: TIMESTAMP_TYPE },
  });
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
//
// The fallback string is a deliberately invalid connection string, not ''.
// postgres.js treats an empty string as "use my own defaults"
// (localhost:5432, OS-user database) rather than failing — on a dev box
// that happens to run local Postgres on 5432, a missing DATABASE_URL would
// silently connect to a real, different database instead of failing loud.
export const db = globalThis.__posAppDb ?? buildDb(process.env.DATABASE_URL ?? 'postgresql://invalid-no-database-url-set/invalid');

if (process.env.NODE_ENV !== 'production') {
  globalThis.__posAppDb = db;
}
