import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { createId } from '@/server/id';
import { redis } from '@/server/redis';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('report router', () => {
  beforeEach(async () => {
    await resetDb();
    await redis.flushdb();
  });

  it('computes daily sales, best sellers, inventory usage, and shift summary', async () => {
    const cashier = await db.insertInto('User').values({ id: createId(), name: 'Cashier', role: 'STAFF', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await db.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'PAID', source: 'STAFF', total: 9 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();
    await db.insertInto('Payment').values({ id: createId(), orderId: order.id, amount: 9, method: 'CASH', receivedById: cashier.id }).execute();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -400, reason: 'SALE', refOrderId: order.id, createdById: cashier.id }).execute();

    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const sales = await admin.report.dailySales(range);
    expect(sales.totalRevenue).toBe(9);
    expect(sales.orderCount).toBe(1);

    const best = await admin.report.bestSellers(range);
    expect(best[0]).toMatchObject({ qtySold: 2 });

    const usage = await admin.report.inventoryUsage(range);
    expect(usage.usage).toHaveLength(1);
    expect(usage.usage[0]).toMatchObject({ ingredient: { name: 'Milk' } });
    expect(Number(usage.usage[0].totalDelta)).toBe(-400);

    const shift = await admin.report.shiftSummary(range);
    expect(shift[0]).toMatchObject({ name: 'Cashier', orderCount: 1, total: 9 });

    const detail = await admin.report.salesDetail(range);
    expect(detail).toHaveLength(1);
    expect(Number(detail[0].total)).toBe(9);
    expect(detail[0].items).toHaveLength(1);
    expect(detail[0].items[0]).toMatchObject({ qty: 2, menuItem: { name: 'Latte' } });
  });

  it('inventoryUsage excludes restocks and manual adjustments, keeping only sales', async () => {
    const admin2 = await db.insertInto('User').values({ id: createId(), name: 'Admin2', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -100, reason: 'SALE', createdById: admin2.id }).execute();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: 200, reason: 'RESTOCK', createdById: admin2.id }).execute();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -50, reason: 'MANUAL_ADJUST', createdById: admin2.id }).execute();

    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const usage = await admin.report.inventoryUsage(range);
    expect(usage.usage).toHaveLength(1);
    expect(Number(usage.usage[0].totalDelta)).toBe(-100);
  });

  it('inventoryUsage summarizes multiple sales of the same ingredient into one row', async () => {
    const admin2 = await db.insertInto('User').values({ id: createId(), name: 'Admin2', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    const beans = await db.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -100, reason: 'SALE', createdById: admin2.id }).execute();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -50, reason: 'SALE', createdById: admin2.id }).execute();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: beans.id, delta: -18, reason: 'SALE', createdById: admin2.id }).execute();

    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const usage = await admin.report.inventoryUsage(range);
    expect(usage.usage).toHaveLength(2);
    const milkRow = usage.usage.find((u) => u.ingredient?.name === 'Milk');
    expect(Number(milkRow!.totalDelta)).toBe(-150);
  });

  it('salesDetail excludes unpaid orders', async () => {
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await db.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'OPEN', source: 'STAFF', total: 9 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();

    const admin = appRouter.createCaller({ db, user: { userId: 'a1', role: 'ADMIN', name: 'A' } });
    const range = { from: new Date(Date.now() - 86400000).toISOString(), to: new Date(Date.now() + 86400000).toISOString() };

    const detail = await admin.report.salesDetail(range);
    expect(detail).toHaveLength(0);
  });
});
