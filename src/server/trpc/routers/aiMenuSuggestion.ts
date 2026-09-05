import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { fetchChatCompletion } from '../../ai/openaiClient';
import {
  buildMenuSuggestionMessages,
  parseMenuSuggestionResponse,
  MenuSuggestionParseError,
  type StockIngredient,
} from '../../ai/menuSuggestion';
import { recomputeAvailabilityForMenuItem } from '../../stock/availability';
import { TASTE_OPTIONS, AROMA_OPTIONS, TEXTURE_OPTIONS } from '../../../lib/suggestionOptions';

const CUISINE_OPTIONS = ['Indonesian', 'Italian', 'Korean', 'Japanese', 'Western', 'Fusion'] as const;

const suggestInput = z.object({
  cuisine: z.array(z.enum(CUISINE_OPTIONS)).max(CUISINE_OPTIONS.length).default([]),
  taste: z.array(z.enum(TASTE_OPTIONS)).max(TASTE_OPTIONS.length).default([]),
  aroma: z.array(z.enum(AROMA_OPTIONS)).max(AROMA_OPTIONS.length).default([]),
  texture: z.array(z.enum(TEXTURE_OPTIONS)).max(TEXTURE_OPTIONS.length).default([]),
  categoryHint: z.string().max(60).optional(),
  notes: z.string().max(200).optional(),
});

const createInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string().optional(),
  newCategoryName: z.string().min(1).optional(),
  description: z.string(),
  instructions: z.string(),
  ingredients: z
    .array(
      z.object({
        existingIngredientId: z.string().optional(),
        name: z.string().min(1),
        unit: z.string().min(1),
        qtyPerUnit: z.number().positive(),
      })
    )
    .min(1),
});

// Explicit flat row shapes -- same TS2589 workaround as every other router
// here (see menu.ts's MenuItemWithCategory) for a Prisma query with a
// nested include.
type MenuRow = { id: string; name: string };
type IngredientRow = { id: string; name: string; unit: string; stockQty: unknown };

export const aiMenuSuggestionRouter = router({
  suggestNewItem: roleProcedure('ADMIN')
    .input(suggestInput)
    .mutation(async ({ ctx, input }) => {
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const bestSellerRows = await ctx.db.orderItem.groupBy({
        by: ['menuItemId'],
        where: { order: { createdAt: { gte: since }, payments: { some: {} } } },
        _sum: { qty: true },
      });
      const bestSellerItems = (await ctx.db.menuItem.findMany({
        where: { id: { in: bestSellerRows.map((r) => r.menuItemId) } },
      })) as unknown as MenuRow[];
      const bestSellerById = new Map(bestSellerItems.map((i) => [i.id, i]));
      const bestSellers = bestSellerRows
        .map((r) => ({ name: bestSellerById.get(r.menuItemId)?.name, qtySold: r._sum.qty ?? 0 }))
        .filter((b): b is { name: string; qtySold: number } => typeof b.name === 'string')
        .sort((a, b) => b.qtySold - a.qtySold)
        .slice(0, 10);

      const ingredientRows = (await ctx.db.ingredient.findMany({
        orderBy: { stockQty: 'asc' },
      })) as unknown as IngredientRow[];
      const ingredients: StockIngredient[] = ingredientRows.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        stockQty: Number(i.stockQty),
      }));

      const existingItems = await ctx.db.menuItem.findMany({ select: { name: true } });

      const messages = buildMenuSuggestionMessages({
        bestSellers,
        ingredients,
        existingItemNames: existingItems.map((i) => i.name),
        cuisine: input.cuisine,
        taste: input.taste,
        aroma: input.aroma,
        texture: input.texture,
        categoryHint: input.categoryHint,
        notes: input.notes,
      });

      let raw: string;
      try {
        raw = await fetchChatCompletion(messages, { maxTokens: 1000 });
      } catch (err) {
        console.error('OpenAI menu suggestion call failed', err);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get a suggestion, try again." });
      }

      try {
        return parseMenuSuggestionResponse(raw, ingredients);
      } catch (err) {
        if (err instanceof MenuSuggestionParseError) {
          console.error('OpenAI menu suggestion response malformed', err);
          throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: "Couldn't get a suggestion, try again." });
        }
        throw err;
      }
    }),

  createFromSuggestion: roleProcedure('ADMIN')
    .input(createInput)
    .mutation(async ({ ctx, input }) => {
      if (!input.categoryId && !input.newCategoryName) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'category is required' });
      }

      const menuItemId = await ctx.db.$transaction(async (tx) => {
        let categoryId = input.categoryId;
        if (!categoryId) {
          const maxSort = await tx.category.aggregate({ _max: { sortOrder: true } });
          const category = await tx.category.create({
            data: { name: input.newCategoryName as string, sortOrder: (maxSort._max.sortOrder ?? 0) + 1 },
          });
          categoryId = category.id;
        }

        const recipeInputs: { ingredientId: string; qtyPerUnit: number }[] = [];
        for (const ing of input.ingredients) {
          const ingredientId =
            ing.existingIngredientId ??
            (await tx.ingredient.create({ data: { name: ing.name, unit: ing.unit, stockQty: 0 } })).id;
          recipeInputs.push({ ingredientId, qtyPerUnit: ing.qtyPerUnit });
        }

        const created = await tx.menuItem.create({
          data: {
            name: input.name,
            price: input.price,
            categoryId,
            description: input.description,
            instructions: input.instructions,
            available: true,
            recipes: { create: recipeInputs },
          },
        });

        await recomputeAvailabilityForMenuItem(tx, created.id);
        return created.id;
      });

      return ctx.db.menuItem.findUniqueOrThrow({ where: { id: menuItemId }, include: { category: true } });
    }),
});
