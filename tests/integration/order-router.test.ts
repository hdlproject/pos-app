import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('order router', () => {
  beforeEach(resetDb);

  async function seedMenu() {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    return item;
  }

  it('staff creates a dine-in order with items and a computed total', async () => {
    const item = await seedMenu();
    // Order.createdById is a real FK to User, unlike Category/MenuItem/Table in the
    // other router tests, so the ctx.user id must correspond to an actual row
    // (same reasoning as ingredient-router.test.ts's StockMovement.createdById).
    await db.user.create({ data: { id: 'u1', name: 'C', role: 'CASHIER', pinHash: await hashPin('1234') } });
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'CASHIER', name: 'C' } });

    const order = await cashier.order.createStaff({
      type: 'DINE_IN',
      items: [{ menuItemId: item.id, qty: 2 }],
    });

    expect(Number(order.total)).toBe(9);
    expect(order.status).toBe('SENT_TO_KITCHEN');
    expect(order.source).toBe('STAFF');
  });

  it('QR customer creates an order by table token and can append items', async () => {
    const item = await seedMenu();
    const table = await db.table.create({ data: { label: 'T1', qrToken: 'tok-1' } });
    const anon = appRouter.createCaller({ db, user: null });

    const order = await anon.order.createByTable({
      tableToken: 'tok-1',
      items: [{ menuItemId: item.id, qty: 1 }],
    });
    expect(order.source).toBe('QR');
    expect(order.tableId).toBe(table.id);

    const updated = await anon.order.appendItems({
      orderId: order.id,
      tableToken: 'tok-1',
      items: [{ menuItemId: item.id, qty: 1 }],
    });
    expect(Number(updated.total)).toBe(9);
  });

  it('rejects an append with the wrong table token', async () => {
    const item = await seedMenu();
    await db.table.create({ data: { label: 'T1', qrToken: 'tok-1' } });
    const anon = appRouter.createCaller({ db, user: null });
    const order = await anon.order.createByTable({ tableToken: 'tok-1', items: [{ menuItemId: item.id, qty: 1 }] });

    await expect(
      anon.order.appendItems({ orderId: order.id, tableToken: 'wrong-token', items: [{ menuItemId: item.id, qty: 1 }] })
    ).rejects.toThrow();
  });

  it('rejects order creation for an invalid table token', async () => {
    const item = await seedMenu();
    const anon = appRouter.createCaller({ db, user: null });
    await expect(
      anon.order.createByTable({ tableToken: 'does-not-exist', items: [{ menuItemId: item.id, qty: 1 }] })
    ).rejects.toThrow();
  });
});
