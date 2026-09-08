import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db } from '@/server/db';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';

vi.mock('@/server/ai/openaiClient', () => ({
  fetchChatCompletion: vi.fn(),
}));

import { fetchChatCompletion } from '@/server/ai/openaiClient';
import { appRouter } from '@/server/trpc/routers/_app';

const mockedFetch = vi.mocked(fetchChatCompletion);

describe('aiMenuSuggestion router', () => {
  beforeEach(async () => {
    await resetDb();
    mockedFetch.mockReset();
  });

  it('suggestNewItem returns candidates with existing ingredients tagged by real id', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Food', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const rice = await db.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 50 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Nasi Goreng', price: 30000, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const cashier = await db.insertInto('User').values({ id: createId(), name: 'Cashier', role: 'STAFF', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const order = await db.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', source: 'STAFF', status: 'PAID', total: 30000 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 5, unitPrice: 30000 }).execute();
    await db.insertInto('Payment').values({ id: createId(), orderId: order.id, amount: 30000, method: 'CASH', receivedById: cashier.id }).execute();

    mockedFetch.mockResolvedValue(
      JSON.stringify({
        candidates: [
          {
            name: 'Rice Bowl',
            price: 35000,
            category: 'Food',
            description: 'A simple rice bowl.',
            instructions: 'Cook rice, serve.',
            ingredients: [{ name: 'rice', unit: 'g', qtyPerUnit: 150 }],
            reasoning: 'Uses low-stock rice; Nasi Goreng sells well.',
          },
        ],
      })
    );

    const result = await admin.aiMenuSuggestion.suggestNewItem({ cuisine: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].name).toBe('Rice Bowl');
      expect(result.candidates[0].ingredients).toEqual([
        { name: 'Rice', unit: 'g', qtyPerUnit: 150, existingIngredientId: rice.id },
      ]);
    }
    const promptText = mockedFetch.mock.calls[0][0].map((m) => m.content).join('\n');
    expect(promptText).toContain('Nasi Goreng');
    expect(promptText).toContain('Rice');
  });

  it('rejects a non-admin caller', async () => {
    const staff = appRouter.createCaller({ db, user: { userId: 'u1', role: 'STAFF', name: 'S' } });
    await expect(staff.aiMenuSuggestion.suggestNewItem({ cuisine: [] })).rejects.toThrow();
  });

  it('surfaces a clear error when the AI call fails', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    mockedFetch.mockRejectedValue(new Error('network down'));
    await expect(admin.aiMenuSuggestion.suggestNewItem({ cuisine: [] })).rejects.toThrow(/couldn.t get a suggestion/i);
  });

  it('returns ok:false when the AI reports no sensible suggestion, without throwing', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    mockedFetch.mockResolvedValue(JSON.stringify({ error: 'No usable data yet.' }));
    const result = await admin.aiMenuSuggestion.suggestNewItem({ cuisine: [] });
    expect(result).toEqual({ ok: false, reason: 'No usable data yet.' });
  });

  it('createFromSuggestion creates the item using only existing ingredients', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Food', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const rice = await db.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    const created = await admin.aiMenuSuggestion.createFromSuggestion({
      name: 'Rice Bowl',
      price: 35000,
      categoryId: category.id,
      description: 'A simple rice bowl.',
      instructions: 'Cook rice, serve.',
      ingredients: [{ existingIngredientId: rice.id, name: 'Rice', unit: 'g', qtyPerUnit: 150 }],
    });

    expect(created.name).toBe('Rice Bowl');
    expect(created.description).toBe('A simple rice bowl.');
    expect(created.instructions).toBe('Cook rice, serve.');
    expect(created.outOfStockReason).toBeNull();

    const recipes = await db.selectFrom('Recipe').selectAll().where('menuItemId', '=', created.id).execute();
    expect(recipes).toHaveLength(1);
    expect(recipes[0].ingredientId).toBe(rice.id);

    const ingredientCountAfter = await db.selectFrom('Ingredient').select(({ fn }) => fn.countAll().as('count')).executeTakeFirstOrThrow();
    expect(Number(ingredientCountAfter.count)).toBe(1);
  });

  it('createFromSuggestion creates a new ingredient at 0 stock and marks the item out of stock', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Snacks', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();

    const created = await admin.aiMenuSuggestion.createFromSuggestion({
      name: 'Truffle Fries',
      price: 30000,
      categoryId: category.id,
      description: 'Fries with truffle oil.',
      instructions: 'Fry, toss in oil.',
      ingredients: [{ name: 'Truffle Oil', unit: 'ml', qtyPerUnit: 10 }],
    });

    expect(created.outOfStockReason).toContain('Truffle Oil');

    const newIngredient = await db.selectFrom('Ingredient').selectAll().where('name', '=', 'Truffle Oil').executeTakeFirst();
    expect(newIngredient).not.toBeUndefined();
    expect(Number(newIngredient!.stockQty)).toBe(0);
  });

  it('createFromSuggestion creates a new category when newCategoryName is given', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const rice = await db.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    const created = await admin.aiMenuSuggestion.createFromSuggestion({
      name: 'Rice Bowl',
      price: 35000,
      newCategoryName: 'Bowls',
      description: 'd',
      instructions: 'i',
      ingredients: [{ existingIngredientId: rice.id, name: 'Rice', unit: 'g', qtyPerUnit: 150 }],
    });

    const category = await db.selectFrom('Category').selectAll().where('id', '=', created.categoryId).executeTakeFirstOrThrow();
    expect(category.name).toBe('Bowls');
  });

  it('createFromSuggestion rejects when neither categoryId nor newCategoryName is given', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const rice = await db.insertInto('Ingredient').values({ id: createId(), name: 'Rice', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await expect(
      admin.aiMenuSuggestion.createFromSuggestion({
        name: 'Rice Bowl',
        price: 35000,
        description: 'd',
        instructions: 'i',
        ingredients: [{ existingIngredientId: rice.id, name: 'Rice', unit: 'g', qtyPerUnit: 150 }],
      })
    ).rejects.toThrow();
  });
});
