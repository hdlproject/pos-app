import { z } from 'zod';
import { cookies } from 'next/headers';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { verifyPin } from '../../auth/pin';
import { signSession } from '../../auth/session';

export const authRouter = router({
  login: publicProcedure.input(z.object({ pin: z.string().min(4).max(6) })).mutation(async ({ ctx, input }) => {
    try {
      const users = await ctx.db.user.findMany({ where: { active: true } });
      for (const user of users) {
        if (await verifyPin(input.pin, user.pinHash)) {
          const token = signSession({ userId: user.id, role: user.role, name: user.name });
          (await cookies()).set('session', token, {
            httpOnly: true,
            path: '/',
            maxAge: 43200,
            sameSite: 'lax',
          });
          return { name: user.name, role: user.role };
        }
      }
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'invalid PIN' });
    } catch (err) {
      if (err instanceof TRPCError) throw err;
      console.error('[debug] auth.login threw:', err instanceof Error ? err.stack : JSON.stringify(err));
      throw err;
    }
  }),

  logout: protectedProcedure.mutation(async () => {
    (await cookies()).delete('session');
    return { ok: true };
  }),

  me: protectedProcedure.query(({ ctx }) => ctx.user),
});
