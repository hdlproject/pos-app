import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('ingredient router', () => {
  beforeEach(resetDb);

  it('creates an ingredient, adjusts stock, and attaches a recipe', async () => {
    await db.user.create({ data: { id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const menuItem = await db.menuItem.create({
      data: { name: 'Latte', price: 4.5, categoryId: category.id },
    });

    const milk = await admin.ingredient.create({ name: 'Milk', unit: 'ml', stockQty: 5000, lowStockThreshold: 1000 });
    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -200, reason: 'MANUAL_ADJUST' });

    const afterAdjust = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(afterAdjust.stockQty)).toBe(4800);

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });
    const recipes = await db.recipe.findMany({ where: { menuItemId: menuItem.id } });
    expect(recipes).toHaveLength(1);
  });

  it('auto-marks an item out of stock when adjustStock depletes its ingredient', async () => {
    await db.user.create({ data: { id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const menuItem = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 100, lowStockThreshold: 200 } });
    await db.recipe.create({ data: { menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 100 } });

    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: menuItem.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('auto-recomputes availability when setRecipe links an already-depleted ingredient', async () => {
    await db.user.create({ data: { id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const menuItem = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0, lowStockThreshold: 200 } });

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: menuItem.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });
});
