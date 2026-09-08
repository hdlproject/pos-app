import { z } from 'zod';
import { cookies } from 'next/headers';
import { TRPCError } from '@trpc/server';
import { router, publicProcedure, protectedProcedure } from '../trpc';
import { verifyPin } from '../../auth/pin';
import { signSession } from '../../auth/session';

export const authRouter = router({
  login: publicProcedure.input(z.object({ pin: z.string().min(4).max(6) })).mutation(async ({ ctx, input }) => {
    const users = await ctx.kdb!.selectFrom('User').selectAll().where('active', '=', true).execute();
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
  }),

  logout: protectedProcedure.mutation(async () => {
    (await cookies()).delete('session');
    return { ok: true };
  }),

  me: protectedProcedure.query(({ ctx }) => ctx.user),
});
