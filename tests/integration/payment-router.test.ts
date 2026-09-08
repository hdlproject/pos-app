import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('payment router', () => {
  beforeEach(resetDb);

  async function seedOrder() {
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    // Payment.receivedById and StockMovement.createdById are real FKs to User,
    // so the ctx.user id used by these tests must correspond to an actual row.
    await db.insertInto('User').values({ id: 'u1', name: 'C', role: 'STAFF', pinHash: await hashPin('1234') }).execute();
    const order = await db.insertInto('Order')
      .values({ id: createId(), type: 'TAKEAWAY', status: 'READY', source: 'STAFF', total: 9 })
      .returningAll().executeTakeFirstOrThrow();
    await db.insertInto('OrderItem').values({ id: createId(), orderId: order.id, menuItemId: item.id, qty: 2, unitPrice: 4.5 }).execute();
    return order;
  }

  it('pays cash, records change, marks order paid, and deducts stock', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'STAFF', name: 'C' } });

    const result = await cashier.payment.payCash({ orderId: order.id, tendered: 10 });
    expect(result.change).toBeCloseTo(1);

    const paid = await db.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(paid.status).toBe('PAID');

    const movements = await db.selectFrom('StockMovement').selectAll().where('refOrderId', '=', order.id).execute();
    expect(movements).toHaveLength(1);
  });

  it('rejects insufficient tendered amount', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'STAFF', name: 'C' } });
    await expect(cashier.payment.payCash({ orderId: order.id, tendered: 5 })).rejects.toThrow();
  });

  it('rejects paying an already-paid order', async () => {
    const order = await seedOrder();
    const cashier = appRouter.createCaller({ db, user: { userId: 'u1', role: 'STAFF', name: 'C' } });
    await cashier.payment.payCash({ orderId: order.id, tendered: 10 });
    await expect(cashier.payment.payCash({ orderId: order.id, tendered: 10 })).rejects.toThrow();
  });
});
