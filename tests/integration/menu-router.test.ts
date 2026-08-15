import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';

describe('menu router', () => {
  beforeEach(resetDb);

  it('admin creates a category and item; public sees only available items', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const anon = appRouter.createCaller({ db, user: null });

    const category = await admin.menu.createCategory({ name: 'Coffee', sortOrder: 1 });
    const item = await admin.menu.createItem({
      name: 'Latte', price: 4.5, categoryId: category.id, available: true,
    });
    await admin.menu.createItem({
      name: 'Hidden', price: 1, categoryId: category.id, available: false,
    });

    const available = await anon.menu.listAvailable();
    expect(available.map((i) => i.id)).toEqual([item.id]);
  });

  it('rejects createItem from a non-admin role', async () => {
    const cashier = appRouter.createCaller({ db, user: { userId: 'u2', role: 'STAFF', name: 'C' } });
    const category = await db.category.create({ data: { name: 'Tea', sortOrder: 2 } });
    await expect(
      cashier.menu.createItem({ name: 'Green Tea', price: 3, categoryId: category.id, available: true })
    ).rejects.toThrow();
  });

  it('clears an item image by sending null', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const item = await db.menuItem.create({
      data: { name: 'Latte', price: 4.5, categoryId: category.id, image: 'http://example.com/old.jpg' },
    });

    const updated = await admin.menu.updateItem({ id: item.id, image: null });
    expect(updated.image).toBeNull();
  });
});
