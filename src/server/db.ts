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
