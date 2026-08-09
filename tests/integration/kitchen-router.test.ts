import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/ably', () => ({ publishOrderEvent: vi.fn() }));

import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('kitchen router', () => {
  beforeEach(resetDb);

  it('moves order to READY once all items are READY', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const order = await db.order.create({
      data: {
        type: 'TAKEAWAY',
        status: 'SENT_TO_KITCHEN',
        source: 'STAFF',
        total: 9,
        items: { create: [{ menuItemId: item.id, qty: 1, unitPrice: 4.5 }, { menuItemId: item.id, qty: 1, unitPrice: 4.5 }] },
      },
      include: { items: true },
    });

    const kitchen = appRouter.createCaller({ db, user: { userId: 'k1', role: 'KITCHEN', name: 'K' } });
    await kitchen.kitchen.updateItemStatus({ orderItemId: order.items[0].id, status: 'READY' });

    let refreshed = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe('SENT_TO_KITCHEN');

    await kitchen.kitchen.updateItemStatus({ orderItemId: order.items[1].id, status: 'READY' });
    refreshed = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(refreshed.status).toBe('READY');
  });
});
