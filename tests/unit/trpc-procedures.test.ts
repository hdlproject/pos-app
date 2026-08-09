import { describe, it, expect } from 'vitest';
import { initTRPC, TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure, roleProcedure } from '@/server/trpc/trpc';

function callerFor(
  user: { userId: string; role: 'ADMIN' | 'CASHIER' | 'WAITER' | 'KITCHEN'; name: string } | null
) {
  const testRouter = router({
    open: publicProcedure.query(() => 'ok'),
    needsAuth: protectedProcedure.query(() => 'ok'),
    adminOnly: roleProcedure('ADMIN').query(() => 'ok'),
  });
  return testRouter.createCaller({ db: {} as any, user });
}

describe('trpc procedures', () => {
  it('publicProcedure allows anonymous callers', async () => {
    await expect(callerFor(null).open()).resolves.toBe('ok');
  });

  it('protectedProcedure rejects anonymous callers', async () => {
    await expect(callerFor(null).needsAuth()).rejects.toThrow(TRPCError);
  });

  it('roleProcedure rejects the wrong role', async () => {
    await expect(
      callerFor({ userId: 'u1', role: 'CASHIER', name: 'C' }).adminOnly()
    ).rejects.toThrow(TRPCError);
  });

  it('roleProcedure allows the right role', async () => {
    await expect(
      callerFor({ userId: 'u1', role: 'ADMIN', name: 'A' }).adminOnly()
    ).resolves.toBe('ok');
  });
});
