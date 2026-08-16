import { z } from 'zod';
import { router, roleProcedure } from '../trpc';

export const stockBatchRouter = router({
  getPending: roleProcedure('ADMIN').query(({ ctx }) =>
    ctx.db.stockAdjustmentBatch.findFirst({
      where: { status: 'PENDING' },
      include: { lines: { include: { ingredient: true } } },
    })
  ),

  stageChange: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        let batch = await tx.stockAdjustmentBatch.findFirst({ where: { status: 'PENDING' } });
        if (!batch) {
          batch = await tx.stockAdjustmentBatch.create({
            data: { status: 'PENDING', createdById: ctx.user.userId },
          });
        }
        await tx.stockAdjustmentLine.upsert({
          where: { batchId_ingredientId: { batchId: batch.id, ingredientId: input.ingredientId } },
          create: {
            batchId: batch.id,
            ingredientId: input.ingredientId,
            delta: input.delta,
            reason: input.reason,
          },
          update: { delta: input.delta, reason: input.reason },
        });
      });
      return { ok: true };
    }),

  removeLine: roleProcedure('ADMIN')
    .input(z.object({ lineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        const line = await tx.stockAdjustmentLine.delete({ where: { id: input.lineId } });
        const remaining = await tx.stockAdjustmentLine.count({ where: { batchId: line.batchId } });
        if (remaining === 0) {
          await tx.stockAdjustmentBatch.delete({ where: { id: line.batchId } });
        }
      });
      return { ok: true };
    }),

  setNote: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string(), note: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.stockAdjustmentBatch.update({ where: { id: input.batchId }, data: { note: input.note } })
    ),
});
