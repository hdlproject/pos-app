import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { redis } from '@/server/redis';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('report router', () => {
  beforeEach(async () => {
    await resetDb();
    await redis.flushdb();
  });

  it('computes daily sales, best sellers, inventory usage, and shift summary', async () => {
    const cashier = await db.user.create({ data: { name: 'Cashier', role: 'CASHIER', pinHash: 'x' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 500, lowStockThreshold: 1000 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const order = await db.order.create({
      data: { type: 'TAKEAWAY', status: 'PAID', source: 'STAFF', total: 9, items: { create: [{ menuItemId: item.id, qty: 2, unitPrice: 4.5 }] } },
    });
    await db.payment.create({ data: { orderId: order.id, amount: 9, method: 'CASH', receivedById: cashier.id } });
    await db.stockMovement.create({ data: { ingredientId: milk.id, delta: -400, reason: 'SALE', refOrderId: order.id, createdById: cashier.id } });

    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const sales = await admin.report.dailySales(range);
    expect(sales.totalRevenue).toBe(9);
    expect(sales.orderCount).toBe(1);

    const best = await admin.report.bestSellers(range);
    expect(best[0]).toMatchObject({ qtySold: 2 });

    const usage = await admin.report.inventoryUsage(range);
    expect(usage.usage).toHaveLength(1);
    expect(usage.lowStock.map((i) => i.id)).toContain(milk.id);

    const shift = await admin.report.shiftSummary(range);
    expect(shift[0]).toMatchObject({ name: 'Cashier', orderCount: 1, total: 9 });
  });
});
