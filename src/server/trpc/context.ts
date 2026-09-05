import { cookies } from 'next/headers';
import type { PrismaClient, Role } from '@prisma/client';
import { db as nodeDb } from '../db';
import { verifySession } from '../auth/session';
import { getCloudflareDb } from '../db.cloudflare';
import { RedisCooldownStore, KvCooldownStore, type CooldownStore, type KvNamespaceLike } from '../cooldownStore';

export type Context = {
  db: PrismaClient;
  user: { userId: string; role: Role; name: string } | null;
  // Optional on the type (even though createContext() always sets it) so
  // the ~50 existing test call sites that do
  // `appRouter.createCaller({ db, user })` keep compiling without needing
  // to plumb a cooldown store through routers that never touch it.
  cooldownStore?: CooldownStore;
};

async function getContextDb(): Promise<PrismaClient> {
  if (process.env.RUNTIME_TARGET === 'cloudflare') {
    return getCloudflareDb();
  }
  return nodeDb;
}

async function getContextCooldownStore(): Promise<CooldownStore> {
  if (process.env.RUNTIME_TARGET === 'cloudflare') {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const { env } = await getCloudflareContext({ async: true });
    const kv = (env as Record<string, unknown>).COOLDOWN_KV as KvNamespaceLike | undefined;
    if (!kv) {
      throw new Error('RUNTIME_TARGET=cloudflare but the COOLDOWN_KV binding is missing');
    }
    return new KvCooldownStore(kv);
  }
  return new RedisCooldownStore();
}

export async function createContext(): Promise<Context> {
  const db = await getContextDb();
  const cooldownStore = await getContextCooldownStore();

  const token = (await cookies()).get('session')?.value;
  const payload = token ? await verifySession(token) : null;

  let user: Context['user'] = null;
  if (payload) {
    const dbUser = await db.user.findUnique({ where: { id: payload.userId } });
    if (dbUser && dbUser.active) {
      user = { userId: dbUser.id, role: dbUser.role, name: dbUser.name };
    }
  }

  return { db, user, cooldownStore };
}
