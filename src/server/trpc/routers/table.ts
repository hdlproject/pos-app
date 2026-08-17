import { z } from 'zod';
import { randomBytes } from 'crypto';
import { Prisma } from '@prisma/client';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';

function genToken() {
  return randomBytes(12).toString('hex');
}

function isUniqueLabelConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

export const tableRouter = router({
  list: roleProcedure('ADMIN', 'STAFF').query(({ ctx }) =>
    ctx.db.table.findMany({ orderBy: { label: 'asc' } })
  ),

  create: roleProcedure('ADMIN')
    .input(z.object({ label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.table.create({ data: { label: input.label, qrToken: genToken() } });
      } catch (err) {
        if (isUniqueLabelConflict(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use' });
        }
        throw err;
      }
    }),

  rename: roleProcedure('ADMIN')
    .input(z.object({ id: z.string(), label: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.db.table.update({ where: { id: input.id }, data: { label: input.label } });
      } catch (err) {
        if (isUniqueLabelConflict(err)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Table name already in use' });
        }
        throw err;
      }
    }),
});
