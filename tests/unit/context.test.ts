import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: vi.fn() }));

import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getContextDb, getContextCooldownStore, getContextCache } from '@/server/trpc/context';
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
  it('getContextDb() throws naming HYPERDRIVE when the binding is missing', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'cloudflare');
    mockedGetCloudflareContext.mockResolvedValue({ env: {} } as never);

    await expect(getContextDb()).rejects.toThrow(/HYPERDRIVE/);
  });

  it('getContextDb() builds a fresh Kysely client from the Hyperdrive connection string when the binding is present', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'cloudflare');
    const waitUntil = vi.fn();
    mockedGetCloudflareContext.mockResolvedValue({
      env: { HYPERDRIVE: { connectionString: 'postgresql://fake-host/fake-db' } },
      ctx: { waitUntil },
    } as never);

    const db = await getContextDb();
    // postgres.js connects lazily -- this resolves without ever touching a
    // real socket, so it's safe to assert shape here rather than behavior.
    expect(db).toHaveProperty('selectFrom');
    // Connection cleanup must be registered via ctx.waitUntil rather than
    // leaking the per-request postgres.js connection (see final review of
    // the drop-Prisma migration).
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('getContextDb() builds a DIFFERENT client instance on each call (no globalThis caching on the Cloudflare path)', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'cloudflare');
    mockedGetCloudflareContext.mockResolvedValue({
      env: { HYPERDRIVE: { connectionString: 'postgresql://fake-host/fake-db' } },
      ctx: { waitUntil: vi.fn() },
    } as never);

    const first = await getContextDb();
    const second = await getContextDb();
    expect(first).not.toBe(second);
  });

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
  it('getContextDb()/getContextCooldownStore()/getContextCache() use the node-path implementations without ever consulting the Cloudflare mock', async () => {
    // Deliberately never configure mockedGetCloudflareContext's resolved
    // value here -- if any of these accidentally took the cloudflare
    // branch, awaiting the un-mocked resolved value (undefined) would
    // throw a destructuring error, not silently pass.
    vi.stubEnv('RUNTIME_TARGET', 'node');

    const db = await getContextDb();
    const cooldownStore = await getContextCooldownStore();
    const cache = await getContextCache();

    expect(db).toBeDefined();
    expect(cooldownStore).not.toBeInstanceOf(KvCooldownStore);
    expect(cache).not.toBeInstanceOf(KvCache);
    expect(cache).not.toBe(noopCache);
    expect(mockedGetCloudflareContext).not.toHaveBeenCalled();
  });

  it('getContextDb() returns the SAME cached node singleton across calls (unlike the Cloudflare path)', async () => {
    vi.stubEnv('RUNTIME_TARGET', 'node');

    const first = await getContextDb();
    const second = await getContextDb();
    expect(first).toBe(second);
  });

  it('also takes the node path when RUNTIME_TARGET is unset entirely', async () => {
    vi.stubEnv('RUNTIME_TARGET', undefined);

    await getContextDb();
    await getContextCooldownStore();
    await getContextCache();

    expect(mockedGetCloudflareContext).not.toHaveBeenCalled();
  });
});
