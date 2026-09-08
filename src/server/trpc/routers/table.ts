import { z } from 'zod';
import { randomBytes } from 'crypto';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';

function genToken() {
  return randomBytes(12).toString('hex');
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

export const tableRouter = router({
  list: roleProcedure('ADMIN', 'STAFF').query(({ ctx }) =>
    ctx.db.selectFrom('Table').selectAll().orderBy('label', 'asc').execute()
  ),

  create: roleProcedure('ADMIN')
    .input(z.object({ label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db
          .insertInto('Table')
          .values({ id: createId(), label: input.label, qrToken: genToken() })
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use' });
        }
        throw err;
      }
    }),

  rename: roleProcedure('ADMIN')
    .input(z.object({ id: z.string(), label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db
          .updateTable('Table')
          .set({ label: input.label })
          .where('id', '=', input.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use' });
        }
        throw err;
      }
    }),
});
