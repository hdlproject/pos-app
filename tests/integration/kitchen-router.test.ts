import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { kdb } from '@/server/db.kysely';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('kitchen router', () => {
  beforeEach(resetDb);

  it('moves order to READY once all items are READY', async () => {
    const category = await kdb.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await kdb.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    const order = await kdb.insertInto('Order')
      .values({ id: createId(), type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 9 })
      .returningAll().executeTakeFirstOrThrow();
    const items = await kdb.insertInto('OrderItem')
      .values([
        { id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 },
        { id: createId(), orderId: order.id, menuItemId: item.id, qty: 1, unitPrice: 4.5 },
      ])
      .returningAll()
      .execute();

    const kitchen = appRouter.createCaller({ db, kdb, user: { userId: 'k1', role: 'KITCHEN', name: 'K' } });
    await kitchen.kitchen.updateItemStatus({ orderItemId: items[0].id, status: 'READY' });

    let refreshed = await kdb.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(refreshed.status).toBe('SENT_TO_KITCHEN');

    await kitchen.kitchen.updateItemStatus({ orderItemId: items[1].id, status: 'READY' });
    refreshed = await kdb.selectFrom('Order').selectAll().where('id', '=', order.id).executeTakeFirstOrThrow();
    expect(refreshed.status).toBe('READY');
  });
});
