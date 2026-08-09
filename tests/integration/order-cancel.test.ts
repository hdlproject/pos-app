import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('order cancel', () => {
  beforeEach(resetDb);

  it('cancels an open order without touching stock', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const adminUser = await db.user.create({ data: { name: 'A1', role: 'ADMIN', pinHash: 'x' } });
    const order = await db.order.create({
      data: { type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 4.5, items: { create: [{ menuItemId: item.id, qty: 1, unitPrice: 4.5 }] } },
    });

    const admin = appRouter.createCaller({ db, user: { userId: adminUser.id, role: 'ADMIN', name: 'A1' } });
    await admin.order.cancel({ orderId: order.id, reason: 'customer changed mind' });

    const cancelled = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(cancelled.status).toBe('CANCELLED');
  });

  it('reverts stock when cancelling a paid order', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 800, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    const adminUser = await db.user.create({ data: { name: 'A2', role: 'ADMIN', pinHash: 'x' } });
    const order = await db.order.create({
      data: { type: 'TAKEAWAY', status: 'PAID', source: 'STAFF', total: 4.5, items: { create: [{ menuItemId: item.id, qty: 1, unitPrice: 4.5 }] } },
    });
    await db.stockMovement.create({
      data: { ingredientId: milk.id, delta: -200, reason: 'SALE', refOrderId: order.id, createdById: adminUser.id },
    });

    const admin = appRouter.createCaller({ db, user: { userId: adminUser.id, role: 'ADMIN', name: 'A2' } });
    await admin.order.cancel({ orderId: order.id, reason: 'refund' });

    const restocked = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(restocked.stockQty)).toBe(1000);
  });

  it('rejects cancel from a non-admin role', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const order = await db.order.create({
      data: { type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 4.5, items: { create: [{ menuItemId: item.id, qty: 1, unitPrice: 4.5 }] } },
    });
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'CASHIER', name: 'C' } });
    await expect(cashier.order.cancel({ orderId: order.id, reason: 'x' })).rejects.toThrow();
  });
});
