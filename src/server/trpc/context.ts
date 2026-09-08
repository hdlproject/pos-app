import { cookies } from 'next/headers';
import type { Kysely } from 'kysely';
import { db as nodeDb, buildDb } from '../db';
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

// On Cloudflare Workers, a Kysely client built over a postgres.js socket is
// tied to the I/O context of whichever request constructed it -- a second
// request running in a fresh I/O context will see any query against that
// client hang forever (workerd's hang detector eventually kills it; see the
// module-scope comment on `buildDb` in `../db` for the full explanation).
// So on the Cloudflare path we build a brand new client on every single
// request -- no caching, no globalThis stash, unlike the Node path below.
// This mirrors the old (pre-Kysely, Prisma-era) getContextDb()/
// getCloudflareDb() split, which had the identical constraint for the same
// reason (see git history: src/server/db.cloudflare.ts, deleted when Prisma
// was removed).
export async function getContextDb(): Promise<Kysely<DB>> {
  if (process.env.RUNTIME_TARGET === 'cloudflare') {
    // The ASYNC form of getCloudflareContext is required here, not the sync
    // form -- the sync form only reliably resolves request-scoped bindings
    // (like HYPERDRIVE) when called synchronously within specific points of
    // Next's request lifecycle, which this general-purpose context builder
    // cannot guarantee. The async form properly awaits the request-scoped
    // context instead of racing it.
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const hyperdrive = (env as Record<string, unknown>).HYPERDRIVE as { connectionString: string } | undefined;
    if (!hyperdrive) {
      throw new Error('RUNTIME_TARGET=cloudflare but the HYPERDRIVE binding is missing');
    }
    // NOTE (connection cleanup): an earlier version of this code called
    // `ctx.waitUntil(sql.end({ timeout: 5 }))` here to close the
    // per-request postgres.js connection instead of leaking it. That was
    // ITSELF a bug, caught by a scoped re-review: `sql.end()` flips
    // postgres.js's internal `ending` flag within about one microtask of
    // being called, and every query issued after that -- including the
    // queries THIS SAME request is about to run via the returned `db` --
    // gets rejected with CONNECTION_ENDED. `ctx.waitUntil` only keeps the
    // isolate alive until the promise settles; it does NOT delay when
    // `.end()` starts executing, so calling it eagerly here breaks every
    // real query on the Cloudflare path. Verified against real Postgres
    // with multiple gap timings (immediate / microtask / macrotask / 5ms) --
    // all failed identically.
    //
    // Instead, rely on `idle_timeout: 20` (set in buildDb() in ../db) --
    // postgres.js's own idle-connection reaper closes a connection once
    // it's been genuinely idle for 20s, which only starts counting after
    // this request's queries actually finish, not synchronously at
    // construction time. This bounds connection accumulation without
    // racing in-flight queries.
    return buildDb(hyperdrive.connectionString);
  }
  return nodeDb;
}

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
  const db = await getContextDb();
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
