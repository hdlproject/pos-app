import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { recomputeAvailabilityForIngredient } from '@/server/stock/availability';

describe('recomputeAvailabilityForIngredient', () => {
  beforeEach(resetDb);

  it('sets a reason naming the ingredient when it hits zero', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });

    await recomputeAvailabilityForIngredient(db, milk.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('clears the reason once the ingredient is restocked', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0 } });
    const item = await db.menuItem.create({
      data: { name: 'Latte', price: 4.5, categoryId: category.id, outOfStockReason: 'Out of stock: Milk' },
    });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });

    await db.ingredient.update({ where: { id: milk.id }, data: { stockQty: 1000 } });
    await recomputeAvailabilityForIngredient(db, milk.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBeNull();
  });

  it('names only the depleted ingredient when an item has more than one', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 0 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: beans.id, qtyPerUnit: 18 } });

    await recomputeAvailabilityForIngredient(db, beans.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Coffee Beans');
  });

  it('does not touch the manual available flag', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id, available: false } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });

    await recomputeAvailabilityForIngredient(db, milk.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.available).toBe(false);
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });
});
