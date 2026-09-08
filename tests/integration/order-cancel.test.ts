import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('order cancel', () => {
  beforeEach(resetDb);

  it('cancels an open order without touching stock', async () => {
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const adminUser = await db.insertInto('User').values({ id: createId(), name: 'A1', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const order = await db.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 4.5 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 }).execute();

    const admin = appRouter.createCaller({ db, user: { userId: adminUser.id, role: 'ADMIN', name: 'A1' } });
    await admin.order.cancel({ orderId: order.id, reason: 'customer changed mind' });

    const cancelled = await db.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('reverts stock when cancelling a paid order', async () => {
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 800 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    const adminUser = await db.insertInto('User').values({ id: createId(), name: 'A2', role: 'ADMIN', pinHash: 'x' }).returningAll().executeTakeFirstOrThrow();
    const order = await db.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'PAID', source: 'STAFF', total: 4.5 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 }).execute();
    await db.insertInto('StockMovement').values({ id: createId(), ingredientId: milk.id, delta: -200, reason: 'SALE', refOrderId: order.id, createdById: adminUser.id }).execute();
    await db.insertInto('Payment').values({ id: createId(), orderId: order.id, amount: 4.5, method: 'CASH', receivedById: adminUser.id }).execute();

    const admin = appRouter.createCaller({ db, user: { userId: adminUser.id, role: 'ADMIN', name: 'A2' } });
    await admin.order.cancel({ orderId: order.id, reason: 'refund' });

    const restocked = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(restocked.stockQty)).toBe(1000);
  });

  it('rejects cancel from a non-admin role', async () => {
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await db.insertInto('Order').values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 4.5 }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 }).execute();
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'STAFF', name: 'C' } });
    await expect(cashier.order.cancel({ orderId: order.id, reason: 'x' })).rejects.toThrow();
  });
});
