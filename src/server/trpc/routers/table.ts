import { z } from 'zod';
import { randomBytes } from 'crypto';
import { router, roleProcedure } from '../trpc';

function genToken() {
  return randomBytes(12).toString('hex');
}

export const tableRouter = router({
  list: roleProcedure('ADMIN', 'CASHIER', 'WAITER').query(({ ctx }) => ctx.db.table.findMany()),

  create: roleProcedure('ADMIN')
    .input(z.object({ label: z.string().min(1) }))
    .mutation(({ ctx, input }) => ctx.db.table.create({ data: { label: input.label, qrToken: genToken() } })),

  rotateToken: roleProcedure('ADMIN')
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => ctx.db.table.update({ where: { id: input.id }, data: { qrToken: genToken() } })),
});
