import { redis } from './redis';
import type { KvNamespaceLike } from './cooldownStore';

export type Cache = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  deleteByPrefix(prefix: string): Promise<void>;
};

// Wraps the same ioredis GET / SET-EX / KEYS+DEL logic the report/payment/order
// routers used directly before this abstraction existed -- same semantics,
// used for the `node` runtime target.
export class RedisCache implements Cache {
  async get(key: string): Promise<string | null> {
    return redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await redis.set(key, value, 'EX', ttlSeconds);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
  }
}

// KV's `list` is eventually consistent and paginated -- fine here, cache
// invalidation racing a fraction behind just means a stale entry survives a
// little longer until its TTL expires, not a correctness problem.
export class KvCache implements Cache {
  constructor(private kv: KvNamespaceLike) {}

  async get(key: string): Promise<string | null> {
    return this.kv.get(key);
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.kv.put(key, value, { expirationTtl: ttlSeconds });
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    const { keys } = await this.kv.list({ prefix });
    await Promise.all(keys.map((k) => this.kv.delete(k.name)));
  }
}

// Caching is a pure performance optimization here, never a correctness
// requirement the way the cooldown guard is -- if no cache backend is
// configured, the correct behavior is to always recompute fresh, not throw.
export const noopCache: Cache = {
  async get() {
    return null;
  },
  async set() {},
  async deleteByPrefix() {},
};
