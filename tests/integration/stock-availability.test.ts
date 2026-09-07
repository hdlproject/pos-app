import { describe, it, expect, beforeEach } from 'vitest';
import { kdb } from '@/server/db.kysely';
import { resetDb } from '../helpers/db';
import { createId } from '@/server/id';
import { recomputeAvailabilityForIngredient } from '@/server/stock/availability';

describe('recomputeAvailabilityForIngredient (Kysely)', () => {
  beforeEach(resetDb);

  it('sets a reason naming the ingredient when it hits zero', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();

    await recomputeAvailabilityForIngredient(kdb, milk.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('clears the reason once the ingredient is restocked', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, outOfStockReason: 'Out of stock: Milk' }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();

    await kdb.updateTable('Ingredient').set({ stockQty: 1000 }).where('id', '=', milk.id).execute();
    await recomputeAvailabilityForIngredient(kdb, milk.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBeNull();
  });

  it('names only the depleted ingredient when an item has more than one', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: beans.id, qtyPerUnit: 18 }).execute();

    await recomputeAvailabilityForIngredient(kdb, beans.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Coffee Beans');
  });

  it('does not touch the manual available flag', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await kdb.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, available: false }).returningAll().executeTakeFirstOrThrow();
    await kdb.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();

    await recomputeAvailabilityForIngredient(kdb, milk.id);

    const updated = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.available).toBe(false);
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });
});
