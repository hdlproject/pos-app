import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { recomputeAvailabilityForIngredient } from '../../stock/availability';

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
        const line = await tx.stockAdjustmentLine.findUniqueOrThrow({
          where: { id: input.lineId },
          include: { batch: true },
        });
        if (line.batch.status !== 'PENDING') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        await tx.stockAdjustmentLine.delete({ where: { id: input.lineId } });
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

  confirm: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        const { count } = await tx.stockAdjustmentBatch.updateMany({
          where: { id: input.batchId, status: 'PENDING' },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: ctx.user.userId },
        });
        if (count !== 1) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        const lines = await tx.stockAdjustmentLine.findMany({ where: { batchId: input.batchId } });
        for (const line of lines) {
          await tx.ingredient.update({
            where: { id: line.ingredientId },
            data: { stockQty: { increment: line.delta } },
          });
          await tx.stockMovement.create({
            data: {
              ingredientId: line.ingredientId,
              delta: line.delta,
              reason: line.reason,
              createdById: ctx.user.userId,
            },
          });
          await recomputeAvailabilityForIngredient(tx, line.ingredientId);
        }
      });
      return { ok: true };
    }),

  cancel: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const { count } = await tx.stockAdjustmentBatch.updateMany({
          where: { id: input.batchId, status: 'PENDING' },
          data: { status: 'CANCELLED' },
        });
        if (count !== 1) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        return tx.stockAdjustmentBatch.findUniqueOrThrow({ where: { id: input.batchId } });
      })
    ),

  listHistory: roleProcedure('ADMIN').query(({ ctx }) =>
    ctx.db.stockAdjustmentBatch.findMany({
      where: { status: { in: ['CONFIRMED', 'CANCELLED'] } },
      include: {
        lines: { include: { ingredient: true } },
        createdBy: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  ),
});
