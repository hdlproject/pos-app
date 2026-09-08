import { z } from 'zod';
import { sql } from 'kysely';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
import { recomputeAvailabilityForIngredient } from '../../stock/availability';

export const stockBatchRouter = router({
  getPending: roleProcedure('ADMIN').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const batch = await kdb.selectFrom('StockAdjustmentBatch').selectAll().where('status', '=', 'PENDING').executeTakeFirst();
    if (!batch) return null;
    const lines = await kdb
      .selectFrom('StockAdjustmentLine')
      .innerJoin('Ingredient', 'Ingredient.id', 'StockAdjustmentLine.ingredientId')
      .select([
        'StockAdjustmentLine.id as id',
        'StockAdjustmentLine.batchId as batchId',
        'StockAdjustmentLine.ingredientId as ingredientId',
        'StockAdjustmentLine.delta as delta',
        'StockAdjustmentLine.reason as reason',
        'Ingredient.id as ingredient_id',
        'Ingredient.name as ingredient_name',
        'Ingredient.unit as ingredient_unit',
        'Ingredient.stockQty as ingredient_stockQty',
      ])
      .where('StockAdjustmentLine.batchId', '=', batch.id)
      .execute();
    return {
      ...batch,
      lines: lines.map((l) => ({
        id: l.id, batchId: l.batchId, ingredientId: l.ingredientId, delta: l.delta, reason: l.reason,
        ingredient: { id: l.ingredient_id, name: l.ingredient_name, unit: l.ingredient_unit, stockQty: l.ingredient_stockQty },
      })),
    };
  }),

  stageChange: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        let batch = await trx.selectFrom('StockAdjustmentBatch').selectAll().where('status', '=', 'PENDING').executeTakeFirst();
        if (!batch) {
          batch = await trx.insertInto('StockAdjustmentBatch')
            .values({ id: createId(), status: 'PENDING', createdById: ctx.user.userId })
            .returningAll()
            .executeTakeFirstOrThrow();
        }
        await trx.insertInto('StockAdjustmentLine')
          .values({ id: createId(), batchId: batch.id, ingredientId: input.ingredientId, delta: input.delta, reason: input.reason })
          .onConflict((oc) =>
            oc.columns(['batchId', 'ingredientId']).doUpdateSet({ delta: input.delta, reason: input.reason })
          )
          .execute();
      });
      return { ok: true };
    }),

  removeLine: roleProcedure('ADMIN')
    .input(z.object({ lineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const line = await trx
          .selectFrom('StockAdjustmentLine')
          .innerJoin('StockAdjustmentBatch', 'StockAdjustmentBatch.id', 'StockAdjustmentLine.batchId')
          .select(['StockAdjustmentLine.id as id', 'StockAdjustmentLine.batchId as batchId', 'StockAdjustmentBatch.status as batchStatus'])
          .where('StockAdjustmentLine.id', '=', input.lineId)
          .executeTakeFirstOrThrow();
        if (line.batchStatus !== 'PENDING') {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        await trx.deleteFrom('StockAdjustmentLine').where('id', '=', input.lineId).execute();
        const { count } = await trx
          .selectFrom('StockAdjustmentLine')
          .select(({ fn }) => fn.countAll().as('count'))
          .where('batchId', '=', line.batchId)
          .executeTakeFirstOrThrow();
        if (Number(count) === 0) {
          await trx.deleteFrom('StockAdjustmentBatch').where('id', '=', line.batchId).execute();
        }
      });
      return { ok: true };
    }),

  setNote: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string(), note: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.updateTable('StockAdjustmentBatch').set({ note: input.note }).where('id', '=', input.batchId).returningAll().executeTakeFirstOrThrow()
    ),

  confirm: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const result = await trx.updateTable('StockAdjustmentBatch')
          .set({ status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: ctx.user.userId })
          .where('id', '=', input.batchId)
          .where('status', '=', 'PENDING')
          .executeTakeFirst();
        if (result.numUpdatedRows !== BigInt(1)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        const lines = await trx.selectFrom('StockAdjustmentLine').selectAll().where('batchId', '=', input.batchId).execute();
        for (const line of lines) {
          await trx.updateTable('Ingredient')
            .set({ stockQty: sql`"stockQty" + ${Number(line.delta)}` })
            .where('id', '=', line.ingredientId)
            .execute();
          await trx.insertInto('StockMovement')
            .values({ id: createId(), ingredientId: line.ingredientId, delta: line.delta, reason: line.reason, createdById: ctx.user.userId })
            .execute();
          await recomputeAvailabilityForIngredient(trx, line.ingredientId);
        }
      });
      return { ok: true };
    }),

  // Cancelled batches aren't kept for accounting review -- discard the
  // batch and its lines entirely rather than marking status CANCELLED.
  cancel: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const result = await trx.updateTable('StockAdjustmentBatch')
          .set({ status: 'PENDING' })
          .where('id', '=', input.batchId)
          .where('status', '=', 'PENDING')
          .executeTakeFirst();
        if (result.numUpdatedRows !== BigInt(1)) {
          throw new TRPCError({ code: 'CONFLICT', message: 'Batch is no longer pending' });
        }
        await trx.deleteFrom('StockAdjustmentLine').where('batchId', '=', input.batchId).execute();
        await trx.deleteFrom('StockAdjustmentBatch').where('id', '=', input.batchId).execute();
      });
      return { ok: true };
    }),

  listHistory: roleProcedure('ADMIN').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const batches = await kdb
      .selectFrom('StockAdjustmentBatch')
      .innerJoin('User as CreatedBy', 'CreatedBy.id', 'StockAdjustmentBatch.createdById')
      .leftJoin('User as ConfirmedBy', 'ConfirmedBy.id', 'StockAdjustmentBatch.confirmedById')
      .select([
        'StockAdjustmentBatch.id as id',
        'StockAdjustmentBatch.status as status',
        'StockAdjustmentBatch.note as note',
        'StockAdjustmentBatch.createdAt as createdAt',
        'StockAdjustmentBatch.createdById as createdById',
        'StockAdjustmentBatch.confirmedAt as confirmedAt',
        'StockAdjustmentBatch.confirmedById as confirmedById',
        'CreatedBy.id as createdBy_id',
        'CreatedBy.name as createdBy_name',
        'ConfirmedBy.id as confirmedBy_id',
        'ConfirmedBy.name as confirmedBy_name',
      ])
      .where('StockAdjustmentBatch.status', '=', 'CONFIRMED')
      .orderBy('StockAdjustmentBatch.createdAt', 'desc')
      .execute();

    const batchIds = batches.map((b) => b.id);
    const lines = batchIds.length === 0 ? [] : await kdb
      .selectFrom('StockAdjustmentLine')
      .innerJoin('Ingredient', 'Ingredient.id', 'StockAdjustmentLine.ingredientId')
      .select([
        'StockAdjustmentLine.id as id',
        'StockAdjustmentLine.batchId as batchId',
        'StockAdjustmentLine.ingredientId as ingredientId',
        'StockAdjustmentLine.delta as delta',
        'StockAdjustmentLine.reason as reason',
        'Ingredient.id as ingredient_id',
        'Ingredient.name as ingredient_name',
        'Ingredient.unit as ingredient_unit',
        'Ingredient.stockQty as ingredient_stockQty',
      ])
      .where('StockAdjustmentLine.batchId', 'in', batchIds)
      .execute();
    const linesByBatch = new Map<string, typeof lines>();
    for (const l of lines) {
      const list = linesByBatch.get(l.batchId) ?? [];
      list.push(l);
      linesByBatch.set(l.batchId, list);
    }

    return batches.map((b) => ({
      id: b.id, status: b.status, note: b.note, createdAt: b.createdAt, createdById: b.createdById,
      confirmedAt: b.confirmedAt, confirmedById: b.confirmedById,
      createdBy: { id: b.createdBy_id, name: b.createdBy_name },
      confirmedBy: b.confirmedBy_id ? { id: b.confirmedBy_id, name: b.confirmedBy_name } : null,
      lines: (linesByBatch.get(b.id) ?? []).map((l) => ({
        id: l.id, batchId: l.batchId, ingredientId: l.ingredientId, delta: l.delta, reason: l.reason,
        ingredient: { id: l.ingredient_id, name: l.ingredient_name, unit: l.ingredient_unit, stockQty: l.ingredient_stockQty },
      })),
    }));
  }),
});
