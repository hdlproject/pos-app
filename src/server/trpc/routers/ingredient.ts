import { z } from 'zod';
import { sql } from 'kysely';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
import { recomputeAvailabilityForIngredient, recomputeAvailabilityForMenuItem } from '../../stock/availability';

export const ingredientRouter = router({
  list: roleProcedure('ADMIN').query(({ ctx }) => ctx.kdb!.selectFrom('Ingredient').selectAll().execute()),

  create: roleProcedure('ADMIN')
    .input(z.object({
      name: z.string().min(1),
      unit: z.string().min(1),
      stockQty: z.number().default(0),
    }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.insertInto('Ingredient')
        .values({ id: createId(), name: input.name, unit: input.unit, stockQty: input.stockQty })
        .returningAll()
        .executeTakeFirstOrThrow()
    ),

  adjustStock: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        await trx.updateTable('Ingredient')
          .set({ stockQty: sql`"stockQty" + ${input.delta}` })
          .where('id', '=', input.ingredientId)
          .execute();
        await trx.insertInto('StockMovement')
          .values({
            id: createId(),
            ingredientId: input.ingredientId,
            delta: input.delta,
            reason: input.reason,
            createdById: ctx.user.userId,
          })
          .execute();
        await recomputeAvailabilityForIngredient(trx, input.ingredientId);
      });
      return { ok: true };
    }),

  setRecipe: roleProcedure('ADMIN')
    .input(z.object({
      menuItemId: z.string(),
      ingredientId: z.string(),
      qtyPerUnit: z.number().positive(),
    }))
    .mutation(({ ctx, input }) =>
      ctx.kdb!.transaction().execute(async (trx) => {
        const recipe = await trx.insertInto('Recipe')
          .values({ id: createId(), menuItemId: input.menuItemId, ingredientId: input.ingredientId, qtyPerUnit: input.qtyPerUnit })
          .onConflict((oc) =>
            oc.columns(['menuItemId', 'ingredientId']).doUpdateSet({ qtyPerUnit: input.qtyPerUnit })
          )
          .returningAll()
          .executeTakeFirstOrThrow();
        await recomputeAvailabilityForIngredient(trx, input.ingredientId);
        return recipe;
      })
    ),

  listRecipes: roleProcedure('ADMIN')
    .input(z.object({ menuItemId: z.string() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.kdb!
        .selectFrom('Recipe')
        .innerJoin('Ingredient', 'Ingredient.id', 'Recipe.ingredientId')
        .select([
          'Recipe.id as id',
          'Recipe.menuItemId as menuItemId',
          'Recipe.ingredientId as ingredientId',
          'Recipe.qtyPerUnit as qtyPerUnit',
          'Ingredient.id as ingredient_id',
          'Ingredient.name as ingredient_name',
          'Ingredient.unit as ingredient_unit',
          'Ingredient.stockQty as ingredient_stockQty',
        ])
        .where('Recipe.menuItemId', '=', input.menuItemId)
        .orderBy('Ingredient.name', 'asc')
        .execute();
      return rows.map((r) => ({
        id: r.id,
        menuItemId: r.menuItemId,
        ingredientId: r.ingredientId,
        qtyPerUnit: r.qtyPerUnit,
        ingredient: { id: r.ingredient_id, name: r.ingredient_name, unit: r.ingredient_unit, stockQty: r.ingredient_stockQty },
      }));
    }),

  removeRecipe: roleProcedure('ADMIN')
    .input(z.object({ recipeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.kdb!.transaction().execute(async (trx) => {
        const recipe = await trx.deleteFrom('Recipe').where('id', '=', input.recipeId).returningAll().executeTakeFirstOrThrow();
        await recomputeAvailabilityForMenuItem(trx, recipe.menuItemId);
      });
      return { ok: true };
    }),
});
