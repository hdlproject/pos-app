import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { hashPin } from '@/server/auth/pin';
import { appRouter } from '@/server/trpc/routers/_app';

// `next/headers`' `cookies()` requires Next's request-scoped async storage,
// which only exists inside a real HTTP request (e.g. the /api/trpc route
// handler in production). `appRouter.createCaller()` below calls the router
// directly with no HTTP request, so there is no request store and the real
// `cookies()` throws "called outside a request scope" unconditionally
// (verified in node_modules/next/dist/server/request/cookies.js — no env
// var or config bypasses this). This mock provides an in-memory cookie jar
// so the login mutation's `cookies().set(...)`/`.delete(...)` calls have
// somewhere to write; it does not change auth.ts's production logic.
vi.mock('next/headers', () => {
  const store = new Map<string, string>();
  return {
    cookies: async () => ({
      get: (name: string) => (store.has(name) ? { name, value: store.get(name)! } : undefined),
      set: (name: string, value: string) => {
        store.set(name, value);
      },
      delete: (name: string) => {
        store.delete(name);
      },
    }),
  };
});

describe('auth router', () => {
  beforeEach(resetDb);

  it('logs in with a valid PIN and rejects an invalid one', async () => {
    await db.user.create({ data: { name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    const caller = appRouter.createCaller({ db, user: null });

    const result = await caller.auth.login({ pin: '1234' });
    expect(result).toMatchObject({ name: 'Admin', role: 'ADMIN' });

    await expect(caller.auth.login({ pin: '0000' })).rejects.toThrow();
  });
});
