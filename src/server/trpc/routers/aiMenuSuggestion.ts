import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
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

export const aiMenuSuggestionRouter = router({
  suggestNewItem: roleProcedure('ADMIN')
    .input(suggestInput)
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.db;
      const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const bestSellerRows = await kdb
        .selectFrom('OrderItem')
        .innerJoin('Order', 'Order.id', 'OrderItem.orderId')
        .innerJoin('MenuItem', 'MenuItem.id', 'OrderItem.menuItemId')
        .where('Order.createdAt', '>=', since)
        .where((eb) =>
          eb.exists(eb.selectFrom('Payment').select('Payment.id').whereRef('Payment.orderId', '=', 'Order.id'))
        )
        .groupBy(['OrderItem.menuItemId', 'MenuItem.name'])
        .select(['MenuItem.name as name', (eb) => eb.fn.sum('OrderItem.qty').as('qtySold')])
        .execute();
      const soldItems = bestSellerRows.map((r) => ({ name: r.name, qtySold: Number(r.qtySold ?? 0) }));
      const bestSellers = [...soldItems].sort((a, b) => b.qtySold - a.qtySold).slice(0, 10);
      const worstSellers = [...soldItems].sort((a, b) => a.qtySold - b.qtySold).slice(0, 5);

      const ingredientRows = await kdb.selectFrom('Ingredient').selectAll().orderBy('stockQty', 'asc').execute();
      const ingredients: StockIngredient[] = ingredientRows.map((i) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        stockQty: Number(i.stockQty),
      }));

      const existingItems = await kdb
        .selectFrom('MenuItem')
        .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
        .select(['MenuItem.name as name', 'Category.name as categoryName'])
        .execute();

      const categoryCountMap = new Map<string, number>();
      for (const item of existingItems) {
        categoryCountMap.set(item.categoryName, (categoryCountMap.get(item.categoryName) ?? 0) + 1);
      }
      const categoryCounts = Array.from(categoryCountMap.entries()).map(([name, count]) => ({ name, count }));

      const messages = buildMenuSuggestionMessages({
        bestSellers,
        worstSellers,
        ingredients,
        existingItemNames: existingItems.map((i) => i.name),
        categoryCounts,
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
      const kdb = ctx.db;

      const menuItemId = await kdb.transaction().execute(async (trx) => {
        let categoryId = input.categoryId;
        if (!categoryId) {
          const maxSort = await trx.selectFrom('Category').select(({ fn }) => fn.max('sortOrder').as('maxSortOrder')).executeTakeFirst();
          const category = await trx.insertInto('Category')
            .values({ id: createId(), name: input.newCategoryName as string, sortOrder: Number(maxSort?.maxSortOrder ?? 0) + 1 })
            .returningAll()
            .executeTakeFirstOrThrow();
          categoryId = category.id;
        }

        const recipeInputs: { ingredientId: string; qtyPerUnit: number }[] = [];
        for (const ing of input.ingredients) {
          const ingredientId =
            ing.existingIngredientId ??
            (await trx.insertInto('Ingredient').values({ id: createId(), name: ing.name, unit: ing.unit, stockQty: 0 }).returningAll().executeTakeFirstOrThrow()).id;
          recipeInputs.push({ ingredientId, qtyPerUnit: ing.qtyPerUnit });
        }

        const created = await trx.insertInto('MenuItem')
          .values({
            id: createId(),
            name: input.name,
            price: input.price,
            categoryId,
            description: input.description,
            instructions: input.instructions,
            available: true,
          })
          .returningAll()
          .executeTakeFirstOrThrow();

        if (recipeInputs.length > 0) {
          await trx.insertInto('Recipe')
            .values(recipeInputs.map((r) => ({ id: createId(), menuItemId: created.id, ingredientId: r.ingredientId, qtyPerUnit: r.qtyPerUnit })))
            .execute();
        }

        await recomputeAvailabilityForMenuItem(trx, created.id);
        return created.id;
      });

      const item = await kdb
        .selectFrom('MenuItem')
        .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
        .selectAll('MenuItem')
        .select(['Category.id as category_id', 'Category.name as category_name', 'Category.sortOrder as category_sortOrder'])
        .where('MenuItem.id', '=', menuItemId)
        .executeTakeFirstOrThrow();
      return { ...item, category: { id: item.category_id, name: item.category_name, sortOrder: item.category_sortOrder } };
    }),
});
