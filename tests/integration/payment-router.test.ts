import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('payment router', () => {
  beforeEach(resetDb);

  async function seedOrder() {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    // Payment.receivedById and StockMovement.createdById are real FKs to User
    // (same reasoning as order-router.test.ts and ingredient-router.test.ts), so the
    // ctx.user id used by these tests must correspond to an actual row.
    await db.user.create({ data: { id: 'u1', name: 'C', role: 'CASHIER', pinHash: await hashPin('1234') } });
    return db.order.create({
      data: {
        type: 'TAKEAWAY', status: 'READY', source: 'STAFF', total: 9,
        items: { create: [{ menuItemId: item.id, qty: 2, unitPrice: 4.5 }] },
      },
    });
  }

  it('pays cash, records change, marks order paid, and deducts stock', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'CASHIER', name: 'C' } });

    const result = await cashier.payment.payCash({ orderId: order.id, tendered: 10 });
    expect(result.change).toBeCloseTo(1);

    const paid = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(paid.status).toBe('PAID');

    const movements = await db.stockMovement.findMany({ where: { refOrderId: order.id } });
    expect(movements).toHaveLength(1);
  });

  it('rejects insufficient tendered amount', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'CASHIER', name: 'C' } });
    await expect(cashier.payment.payCash({ orderId: order.id, tendered: 5 })).rejects.toThrow();
  });

  it('rejects paying an already-paid order', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'CASHIER', name: 'C' } });
    await cashier.payment.payCash({ orderId: order.id, tendered: 10 });
    await expect(cashier.payment.payCash({ orderId: order.id, tendered: 10 })).rejects.toThrow();
  });
});
