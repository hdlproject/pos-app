import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getContextCooldownStore, getContextCache } from '@/server/trpc/context';
import { KvCooldownStore } from '@/server/cooldownStore';
import { KvCache, noopCache } from '@/server/cache';
import type { KvNamespaceLike } from '@/server/cooldownStore';

const mockedGetCloudflareContext = vi.mocked(getCloudflareContext);

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

afterEach(() => {
  vi.unstubAllEnvs();
  mockedGetCloudflareContext.mockReset();
});

describe('RUNTIME_TARGET=cloudflare', () => {
  it('getContextCooldownStore() throws naming KV when the binding is missing', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'cloudflare');
    mockedGetCloudflareContext.mockResolvedValue({ env: {} } as never);

    await expect(getContextCooldownStore()).rejects.toThrow(/KV/);
  });

  it('getContextCooldownStore() returns a KvCooldownStore when KV is present', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'cloudflare');
    mockedGetCloudflareContext.mockResolvedValue({ env: { KV: fakeKv() } } as never);

    const store = await getContextCooldownStore();
    expect(store).toBeInstanceOf(KvCooldownStore);
  });

  it('getContextCache() returns noopCache (does NOT throw) when KV is missing', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'cloudflare');
    mockedGetCloudflareContext.mockResolvedValue({ env: {} } as never);

    const cache = await getContextCache();
    expect(cache).toBe(noopCache);
  });

  it('getContextCache() returns a KvCache when KV is present', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'cloudflare');
    mockedGetCloudflareContext.mockResolvedValue({ env: { KV: fakeKv() } } as never);

    const cache = await getContextCache();
    expect(cache).toBeInstanceOf(KvCache);
  });
});

describe('RUNTIME_TARGET unset or node', () => {
  it('getContextCooldownStore()/getContextCache() use the node-path implementations without ever consulting the Cloudflare mock', async () => {
    // Deliberately never configure mockedGetCloudflareContext's resolved
    // value here -- if either of these accidentally took the cloudflare
    // branch, awaiting the un-mocked resolved value (undefined) would
    // throw a destructuring error, not silently pass.
    vi.stubEnv('RUNTIME_TARGET', 'node');

    const cooldownStore = await getContextCooldownStore();
    const cache = await getContextCache();

    expect(cooldownStore).not.toBeInstanceOf(KvCooldownStore);
    expect(cache).not.toBeInstanceOf(KvCache);
    expect(cache).not.toBe(noopCache);
    expect(mockedGetCloudflareContext).not.toHaveBeenCalled();
  });

  it('also takes the node path when RUNTIME_TARGET is unset entirely', async () => {
    vi.stubEnv('RUNTIME_TARGET', undefined);

    await getContextCooldownStore();
    await getContextCache();

    expect(mockedGetCloudflareContext).not.toHaveBeenCalled();
  });
});
