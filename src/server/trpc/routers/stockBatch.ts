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
});
