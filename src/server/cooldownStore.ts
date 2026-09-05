import { redis } from './redis';

export type CooldownStore = {
  checkAndSet(key: string, ttlSeconds: number): Promise<boolean>;
  clear(key: string): Promise<void>;
};

// Wraps the same ioredis SET-NX-EX logic the old ai/cooldown.ts used --
// atomic on Redis, used for the `node` runtime target.
export class RedisCooldownStore implements CooldownStore {
  async checkAndSet(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return result === 'OK';
  }

  async clear(key: string): Promise<void> {
    await redis.del(key);
  }
}

// Minimal shape of a Cloudflare KV namespace binding -- avoids pulling in
// @cloudflare/workers-types just for this one interface.
export type KvNamespaceLike = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

// get-then-put is not atomic the way Redis's SET NX is -- KV's eventual
// consistency means a narrow race window under concurrent requests for the
// exact same key. Acceptable here: this only needs to deter rapid re-requests
// from the same table, not guarantee strict exactly-once semantics.
export class KvCooldownStore implements CooldownStore {
  constructor(private kv: KvNamespaceLike) {}

  async checkAndSet(key: string, ttlSeconds: number): Promise<boolean> {
    const existing = await this.kv.get(key);
    if (existing !== null) return false;
    await this.kv.put(key, '1', { expirationTtl: ttlSeconds });
    return true;
  }

  async clear(key: string): Promise<void> {
    await this.kv.delete(key);
  }
}
