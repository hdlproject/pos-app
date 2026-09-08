import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { createId } from '@/server/id';
import { deductStockForOrder, revertStockForOrder } from '@/server/stock/deduct';

describe('stock deduction (Kysely)', () => {
  beforeEach(resetDb);

  async function seedOrder() {
    const admin = await db.insertInto('User').values({ id: createId(), name: 'Admin', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    const order = await db.insertInto('Order')
      .values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 9 })
      .returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();
    return { admin, milk, order, item };
  }

  it('deducts ingredient stock per recipe and records a StockMovement', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(db, order.id, admin.id);

    const afterDeduct = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(afterDeduct.stockQty)).toBe(600); // 1000 - (200 * 2)

    const movements = await db.selectFrom('StockMovement').selectAll().where('refOrderId', '=', order.id).execute();
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe('SALE');
  });

  it('allows stock to go negative rather than blocking', async () => {
    const { admin, milk, order } = await seedOrder();
    await db.updateTable('Ingredient').set({ stockQty: 100 }).where('id', '=', milk.id).execute();

    await deductStockForOrder(db, order.id, admin.id);
    const afterDeduct = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(afterDeduct.stockQty)).toBe(-300); // 100 - 400, allowed negative
  });

  it('reverts a deduction', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(db, order.id, admin.id);
    await revertStockForOrder(db, order.id, admin.id);

    const reverted = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(reverted.stockQty)).toBe(1000);
  });

  it('auto-marks the item out of stock when a deduction depletes its ingredient', async () => {
    const { admin, milk, order, item } = await seedOrder();
    await db.updateTable('Ingredient').set({ stockQty: 400 }).where('id', '=', milk.id).execute(); // exactly enough for this order

    await deductStockForOrder(db, order.id, admin.id);

    const updated = await db.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('auto-clears the item when reverting a deduction restores enough stock', async () => {
    const { admin, milk, order, item } = await seedOrder();
    await db.updateTable('Ingredient').set({ stockQty: 400 }).where('id', '=', milk.id).execute();
    await deductStockForOrder(db, order.id, admin.id);

    await revertStockForOrder(db, order.id, admin.id);

    const updated = await db.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updated.outOfStockReason).toBeNull();
  });
});
