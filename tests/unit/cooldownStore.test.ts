import { describe, it, expect, beforeEach, vi } from 'vitest';
import { redis } from '@/server/redis';
import { RedisCooldownStore, KvCooldownStore, type KvNamespaceLike } from '@/server/cooldownStore';

describe('RedisCooldownStore', () => {
  const store = new RedisCooldownStore();

  beforeEach(async () => {
    await redis.flushdb();
  });

  it('allows the first request for a key', async () => {
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(true);
  });

  it('blocks a second request for the same key within the ttl', async () => {
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(false);
  });

  it('tracks cooldowns independently per key', async () => {
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-b', 30)).resolves.toBe(true);
  });

  it('releases the cooldown so a subsequent request is allowed again', async () => {
    await store.checkAndSet('table-x', 30);
    await store.clear('table-x');
    await expect(store.checkAndSet('table-x', 30)).resolves.toBe(true);
  });
});

function fakeKv(): KvNamespaceLike {
  const data = new Map<string, string>();
  return {
    get: async (key) => data.get(key) ?? null,
    put: async (key, value) => {
      data.set(key, value);
    },
    delete: async (key) => {
      data.delete(key);
    },
    list: async () => ({ keys: [] }),
  };
}

describe('KvCooldownStore', () => {
  it('allows the first request for a key', async () => {
    const store = new KvCooldownStore(fakeKv());
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(true);
  });

  it('passes the TTL through to the fake KV put call', async () => {
    const kv = fakeKv();
    const putSpy = vi.spyOn(kv, 'put');
    const store = new KvCooldownStore(kv);
    await store.checkAndSet('table-a', 30);
    expect(putSpy).toHaveBeenCalledWith('table-a', '1', { expirationTtl: 30 });
  });

  it('blocks a second request for the same key', async () => {
    const store = new KvCooldownStore(fakeKv());
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-a', 30)).resolves.toBe(false);
  });

  it('tracks cooldowns independently per key', async () => {
    const store = new KvCooldownStore(fakeKv());
    await store.checkAndSet('table-a', 30);
    await expect(store.checkAndSet('table-b', 30)).resolves.toBe(true);
  });

  it('releases the cooldown so a subsequent request is allowed again', async () => {
    const store = new KvCooldownStore(fakeKv());
    await store.checkAndSet('table-x', 30);
    await store.clear('table-x');
    await expect(store.checkAndSet('table-x', 30)).resolves.toBe(true);
  });
});
