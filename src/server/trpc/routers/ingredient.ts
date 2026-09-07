import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { recomputeAvailabilityForIngredient, recomputeAvailabilityForMenuItem } from '../../stock/availability.prisma';

export const ingredientRouter = router({
  list: roleProcedure('ADMIN').query(({ ctx }) => ctx.db.ingredient.findMany()),

  create: roleProcedure('ADMIN')
    .input(z.object({
      name: z.string().min(1),
      unit: z.string().min(1),
      stockQty: z.number().default(0),
    }))
    .mutation(({ ctx, input }) => ctx.db.ingredient.create({ data: input })),

  adjustStock: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        await tx.ingredient.update({
          where: { id: input.ingredientId },
          data: { stockQty: { increment: input.delta } },
        });
        await tx.stockMovement.create({
          data: {
            ingredientId: input.ingredientId,
            delta: input.delta,
            reason: input.reason,
            createdById: ctx.user.userId,
          },
        });
        await recomputeAvailabilityForIngredient(tx, input.ingredientId);
      });
      return { ok: true };
    }),

  setRecipe: roleProcedure('ADMIN')
    .input(z.object({
      menuItemId: z.string(),
      ingredientId: z.string(),
      qtyPerUnit: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const recipe = await tx.recipe.upsert({
          where: { menuItemId_ingredientId: { menuItemId: input.menuItemId, ingredientId: input.ingredientId } },
          create: input,
          update: { qtyPerUnit: input.qtyPerUnit },
        });
        await recomputeAvailabilityForIngredient(tx, input.ingredientId);
        return recipe;
      })
    ),

  listRecipes: roleProcedure('ADMIN')
    .input(z.object({ menuItemId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.recipe.findMany({
        where: { menuItemId: input.menuItemId },
        include: { ingredient: true },
        orderBy: { ingredient: { name: 'asc' } },
      })
    ),

  removeRecipe: roleProcedure('ADMIN')
    .input(z.object({ recipeId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        const recipe = await tx.recipe.delete({ where: { id: input.recipeId } });
        await recomputeAvailabilityForMenuItem(tx, recipe.menuItemId);
      });
      return { ok: true };
    }),
});
