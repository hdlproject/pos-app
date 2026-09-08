import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('ingredient router', () => {
  beforeEach(resetDb);

  it('creates an ingredient, adjusts stock, and attaches a recipe', async () => {
    await db.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();

    const milk = await admin.ingredient.create({ name: 'Milk', unit: 'ml', stockQty: 5000 });
    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -200, reason: 'MANUAL_ADJUST' });

    const afterAdjust = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(afterAdjust.stockQty)).toBe(4800);

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });
    const recipes = await db.selectFrom('Recipe').selectAll().where('menuItemId', '=', menuItem.id).execute();
    expect(recipes).toHaveLength(1);
  });

  it('auto-marks an item out of stock when adjustStock depletes its ingredient', async () => {
    await db.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 100 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 100 }).execute();

    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });

    const updated = await db.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('auto-recomputes availability when setRecipe links an already-depleted ingredient', async () => {
    await db.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });

    const updated = await db.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('lists recipes for a menu item', async () => {
    await db.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 5000 }).returningAll().executeTakeFirstOrThrow();
    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });

    const recipes = await admin.ingredient.listRecipes({ menuItemId: menuItem.id });
    expect(recipes).toHaveLength(1);
    expect(Number(recipes[0].qtyPerUnit)).toBe(200);
    expect(recipes[0].ingredient.name).toBe('Milk');
  });

  it('removing the only recipe for a depleted ingredient clears the item\'s out-of-stock reason', async () => {
    await db.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const recipe = await db.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 }).returningAll().executeTakeFirstOrThrow();

    await db.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Milk' }).where('id', '=', menuItem.id).execute();

    await admin.ingredient.removeRecipe({ recipeId: recipe.id });

    const updated = await db.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBeNull();
    const remaining = await db.selectFrom('Recipe').selectAll().where('menuItemId', '=', menuItem.id).execute();
    expect(remaining).toHaveLength(0);
  });

  it('removing one of several recipes keeps the item out of stock if another linked ingredient is still depleted', async () => {
    await db.insertInto('User').values({ id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).execute();
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const menuItem = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 5000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await db.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 0 }).returningAll().executeTakeFirstOrThrow();
    const milkRecipe = await db.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('Recipe').values({ id: createId(), menuItemId: menuItem.id, ingredientId: beans.id, qtyPerUnit: 20 }).execute();
    await db.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Coffee Beans' }).where('id', '=', menuItem.id).execute();

    await admin.ingredient.removeRecipe({ recipeId: milkRecipe.id });

    const updated = await db.selectFrom('MenuItem').selectAll().where('id', '=', menuItem.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Coffee Beans');
  });
});
