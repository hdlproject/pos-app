import { describe, it, expect, beforeEach, vi } from 'vitest';
import { redis } from '@/server/redis';
import { RedisCache, KvCache, noopCache } from '@/server/cache';
import type { KvNamespaceLike } from '@/server/cooldownStore';

describe('RedisCache', () => {
  const cache = new RedisCache();

  beforeEach(async () => {
    await redis.flushdb();
  });

  it('returns null for a missing key', async () => {
    await expect(cache.get('report:dailySales:missing')).resolves.toBeNull();
  });

  it('round-trips a value through set then get', async () => {
    await cache.set('report:dailySales:a', JSON.stringify({ total: 1 }), 300);
    await expect(cache.get('report:dailySales:a')).resolves.toBe(JSON.stringify({ total: 1 }));
  });

  it('deleteByPrefix removes only matching keys', async () => {
    await cache.set('report:dailySales:a', 'x', 300);
    await cache.set('other:prefix:b', 'y', 300);
    await cache.deleteByPrefix('report:dailySales:');
    await expect(cache.get('report:dailySales:a')).resolves.toBeNull();
    await expect(cache.get('other:prefix:b')).resolves.toBe('y');
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
    list: async ({ prefix }) => ({
      keys: Array.from(data.keys())
        .filter((k) => k.startsWith(prefix))
        .map((name) => ({ name })),
    }),
  };
}

describe('KvCache', () => {
  it('returns null for a missing key', async () => {
    const cache = new KvCache(fakeKv());
    await expect(cache.get('report:dailySales:missing')).resolves.toBeNull();
  });

  it('round-trips a value through set then get', async () => {
    const cache = new KvCache(fakeKv());
    await cache.set('report:dailySales:a', JSON.stringify({ total: 1 }), 300);
    await expect(cache.get('report:dailySales:a')).resolves.toBe(JSON.stringify({ total: 1 }));
  });

  it('deleteByPrefix removes only matching keys', async () => {
    const cache = new KvCache(fakeKv());
    await cache.set('report:dailySales:a', 'x', 300);
    await cache.set('other:prefix:b', 'y', 300);
    await cache.deleteByPrefix('report:dailySales:');
    await expect(cache.get('report:dailySales:a')).resolves.toBeNull();
    await expect(cache.get('other:prefix:b')).resolves.toBe('y');
  });

  it('passes the TTL through to the fake KV put call', async () => {
    const kv = fakeKv();
    const putSpy = vi.spyOn(kv, 'put');
    const cache = new KvCache(kv);
    await cache.set('report:dailySales:a', 'x', 300);
    expect(putSpy).toHaveBeenCalledWith('report:dailySales:a', 'x', { expirationTtl: 300 });
  });
});

describe('noopCache', () => {
  it('get always resolves null', async () => {
    await expect(noopCache.get('anything')).resolves.toBeNull();
  });

  it('set resolves without throwing', async () => {
    await expect(noopCache.set('anything', 'value', 300)).resolves.toBeUndefined();
  });

  it('deleteByPrefix resolves without throwing', async () => {
    await expect(noopCache.deleteByPrefix('anything')).resolves.toBeUndefined();
  });
});
