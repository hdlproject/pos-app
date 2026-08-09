// tests/integration/stock-deduct.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { deductStockForOrder, revertStockForOrder } from '@/server/stock/deduct';

describe('stock deduction', () => {
  beforeEach(resetDb);

  async function seedOrder() {
    const admin = await db.user.create({ data: { name: 'Admin', role: 'ADMIN', pinHash: 'x' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    const order = await db.order.create({
      data: {
        type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 9,
        items: { create: [{ menuItemId: item.id, qty: 2, unitPrice: 4.5 }] },
      },
    });
    return { admin, milk, order };
  }

  it('deducts ingredient stock per recipe and records a StockMovement', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(db, order.id, admin.id);

    const afterDeduct = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(afterDeduct.stockQty)).toBe(600); // 1000 - (200 * 2)

    const movements = await db.stockMovement.findMany({ where: { refOrderId: order.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe('SALE');
  });

  it('allows stock to go negative rather than blocking', async () => {
    const { admin, milk, order } = await seedOrder();
    await db.ingredient.update({ where: { id: milk.id }, data: { stockQty: 100 } });

    await deductStockForOrder(db, order.id, admin.id);
    const afterDeduct = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(afterDeduct.stockQty)).toBe(-300); // 100 - 400, allowed negative
  });

  it('reverts a deduction', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(db, order.id, admin.id);
    await revertStockForOrder(db, order.id, admin.id);

    const reverted = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(reverted.stockQty)).toBe(1000);
  });
});
