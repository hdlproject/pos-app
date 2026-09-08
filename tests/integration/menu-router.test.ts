import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { createId } from '@/server/id';
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
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Tea', sortOrder: 2 }).returningAll().executeTakeFirstOrThrow();
    await expect(
      cashier.menu.createItem({ name: 'Green Tea', price: 3, categoryId: category.id, available: true })
    ).rejects.toThrow();
  });

  it('clears an item image by sending null', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem')
      .values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, image: 'http://example.com/old.jpg' })
      .returningAll().executeTakeFirstOrThrow();

    const updated = await admin.menu.updateItem({ id: item.id, image: null });
    expect(updated.image).toBeNull();
  });

  it('updating only the image does not silently flip available back to true', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem')
      .values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, available: false })
      .returningAll().executeTakeFirstOrThrow();

    const updated = await admin.menu.updateItem({
      id: item.id,
      image: 'http://example.com/new.jpg',
    });

    expect(updated.available).toBe(false);
    expect(updated.image).toBe('http://example.com/new.jpg');
  });

  it('toggleAvailable-style explicit available update still works', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem')
      .values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id, available: true })
      .returningAll().executeTakeFirstOrThrow();

    const updated = await admin.menu.updateItem({ id: item.id, available: false });
    expect(updated.available).toBe(false);
  });

  it('excludes an auto-detected-out-of-stock item from listAvailable', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const anon = appRouter.createCaller({ db, user: null });
    const category = await admin.menu.createCategory({ name: 'Coffee', sortOrder: 1 });
    const item = await admin.menu.createItem({
      name: 'Latte', price: 4.5, categoryId: category.id, available: true,
    });
    await db.updateTable('MenuItem').set({ outOfStockReason: 'Out of stock: Milk' }).where('id', '=', item.id).execute();

    const available = await anon.menu.listAvailable();
    expect(available.map((i) => i.id)).not.toContain(item.id);
  });
});
