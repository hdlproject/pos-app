import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('order router', () => {
  beforeEach(resetDb);

  async function seedMenu() {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    return kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
  }

  it('staff creates a dine-in order with items and a computed total', async () => {
    const item = await seedMenu();
    await kdb.insertInto('User').values({ id: 'u1', name: 'C', role: 'STAFF', pinHash: await hashPin('1234') }).execute();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });

    const order = await cashier.order.createStaff({
      type: 'DINE_IN',
      items: [{ menuItemId: item.id, qty: 2 }],
    });

    expect(Number(order.total)).toBe(9);
    expect(order.status).toBe('SENT_TO_KITCHEN');
    expect(order.source).toBe('STAFF');
  });

  it('rejects order creation for an item that is auto-out-of-stock even though the manual flag is still available', async () => {
    const item = await seedMenu();
    await kdb.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Milk' }).where('id', '=', item.id).execute();
    const refreshed = await kdb.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(refreshed.available).toBe(true);

    await kdb.insertInto('User').values({ id: 'u1', name: 'C', role: 'STAFF', pinHash: await hashPin('1234') }).execute();
    const cashier = appRouter.createCaller({ db, kdb, user: { userId: 'u1', role: 'STAFF', name: 'C' } });

    await expect(
      cashier.order.createStaff({
        type: 'DINE_IN',
        items: [{ menuItemId: item.id, qty: 1 }],
      })
    ).rejects.toThrow();
  });

  it('QR customer creates an order by table token and can append items', async () => {
    const item = await seedMenu();
    const table = await kdb.insertInto('Table').values({ id: createId(), label: 'T1', qrToken: 'tok-1' }).returningAll().executeTakeFirstOrThrow();
    const anon = appRouter.createCaller({ db, kdb, user: null });

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
    await kdb.insertInto('Table').values({ id: createId(), label: 'T1', qrToken: 'tok-1' }).execute();
    const anon = appRouter.createCaller({ db, kdb, user: null });
    const order = await anon.order.createByTable({ tableToken: 'tok-1', items: [{ menuItemId: item.id, qty: 1 }] });

    await expect(
      anon.order.appendItems({ orderId: order.id, tableToken: 'wrong-token', items: [{ menuItemId: item.id, qty: 1 }] })
    ).rejects.toThrow();
  });

  it('rejects order creation for an invalid table token', async () => {
    const item = await seedMenu();
    const anon = appRouter.createCaller({ db, kdb, user: null });
    await expect(
      anon.order.createByTable({ tableToken: 'does-not-exist', items: [{ menuItemId: item.id, qty: 1 }] })
    ).rejects.toThrow();
  });
});
