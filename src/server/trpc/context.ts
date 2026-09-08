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
