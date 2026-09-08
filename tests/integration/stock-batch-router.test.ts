import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { createId } from '@/server/id';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('stock batch router', () => {
  beforeEach(resetDb);

  async function adminCaller() {
    const user = await db.insertInto('User').values({ id: createId(), name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') }).returningAll().executeTakeFirstOrThrow();
    return appRouter.createCaller({ db, user: { userId: user.id, role: user.role, name: user.name } });
  }

  it('getPending returns null when there is no pending batch', async () => {
    const admin = await adminCaller();
    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('stageChange creates a pending batch with one line', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });

    const pending = await admin.stockBatch.getPending();
    expect(pending).not.toBeNull();
    expect(pending?.status).toBe('PENDING');
    expect(pending?.lines).toHaveLength(1);
    expect(pending?.lines[0].ingredientId).toBe(milk.id);
    expect(Number(pending?.lines[0].delta)).toBe(500);
  });

  it('a second stageChange for a different ingredient adds a second line to the same batch', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await db.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const firstBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const secondBatch = await admin.stockBatch.getPending();

    expect(secondBatch?.id).toBe(firstBatch?.id);
    expect(secondBatch?.lines).toHaveLength(2);
  });

  it('re-staging the same ingredient updates the existing line instead of duplicating it', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -50, reason: 'MANUAL_ADJUST' });

    const pending = await admin.stockBatch.getPending();
    expect(pending?.lines).toHaveLength(1);
    expect(Number(pending?.lines[0].delta)).toBe(-50);
    expect(pending?.lines[0].reason).toBe('MANUAL_ADJUST');
  });

  it('removeLine removes one line but keeps the batch when other lines remain', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await db.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    const milkLine = batch!.lines.find((l) => l.ingredientId === milk.id)!;

    await admin.stockBatch.removeLine({ lineId: milkLine.id });

    const afterRemove = await admin.stockBatch.getPending();
    expect(afterRemove?.status).toBe('PENDING');
    expect(afterRemove?.lines).toHaveLength(1);
    expect(afterRemove?.lines[0].ingredientId).toBe(beans.id);
  });

  it('removeLine on the last remaining line deletes the batch entirely', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.removeLine({ lineId: batch!.lines[0].id });

    const afterRemove = await admin.stockBatch.getPending();
    expect(afterRemove).toBeNull();
    const stillExists = await db.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirst();
    expect(stillExists).toBeUndefined();
  });

  it('setNote updates the batch note', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.setNote({ batchId: batch!.id, note: 'Weekly supplier delivery' });

    const updated = await admin.stockBatch.getPending();
    expect(updated?.note).toBe('Weekly supplier delivery');
  });

  it('confirm applies every line, writes StockMovement rows, and marks the batch CONFIRMED', async () => {
    const admin = await adminCaller();
    const adminUser = await db.selectFrom('User').selectAll().where('name', '=', 'Admin').executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await db.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: -50, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const milkAfter = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(milkAfter.stockQty)).toBe(1500);
    const beansAfter = await db.selectFrom('Ingredient').selectAll().where('id', '=', beans.id).executeTakeFirstOrThrow();
    expect(Number(beansAfter.stockQty)).toBe(450);

    const movements = await db.selectFrom('StockMovement').selectAll().execute();
    expect(movements).toHaveLength(2);
    const beansMovement = movements.find((m) => m.ingredientId === beans.id)!;
    expect(beansMovement.reason).toBe('MANUAL_ADJUST');
    expect(Number(beansMovement.delta)).toBe(-50);

    const confirmedBatch = await db.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirstOrThrow();
    expect(confirmedBatch.status).toBe('CONFIRMED');
    expect(confirmedBatch.confirmedById).toBe(adminUser.id);
    expect(confirmedBatch.confirmedAt).not.toBeNull();
  });

  it('confirm removes the batch from getPending (it is no longer PENDING)', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('confirm calls the availability recompute for a depleted ingredient', async () => {
    const admin = await adminCaller();
    const category = await db.insertInto('Category').values({ id: createId(), name: 'Coffee', sortOrder: 1 }).returningAll().executeTakeFirstOrThrow();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 100 }).returningAll().executeTakeFirstOrThrow();
    const item = await db.insertInto('MenuItem').values({ id: createId(), name: 'Latte', price: 4.5, categoryId: category.id }).returningAll().executeTakeFirstOrThrow();
    await db.insertInto('Recipe').values({ id: createId(), menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 }).execute();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const updatedItem = await db.selectFrom('MenuItem').selectAll().where('id', '=', item.id).executeTakeFirstOrThrow();
    expect(updatedItem.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('cancel deletes the batch and its lines without applying any stock change', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.cancel({ batchId: batch!.id });

    const milkAfter = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(milkAfter.stockQty)).toBe(1000);
    const movements = await db.selectFrom('StockMovement').selectAll().execute();
    expect(movements).toHaveLength(0);
    const cancelledBatch = await db.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirst();
    expect(cancelledBatch).toBeUndefined();
    const cancelledLines = await db.selectFrom('StockAdjustmentLine').selectAll().where('batchId', '=', batch!.id).execute();
    expect(cancelledLines).toHaveLength(0);
  });

  it('confirming an already-CONFIRMED batch a second time throws CONFLICT and does not double-apply the delta', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    await expect(admin.stockBatch.confirm({ batchId: batch!.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const milkAfter = await db.selectFrom('Ingredient').selectAll().where('id', '=', milk.id).executeTakeFirstOrThrow();
    expect(Number(milkAfter.stockQty)).toBe(1500);
    const movements = await db.selectFrom('StockMovement').selectAll().execute();
    expect(movements).toHaveLength(1);
  });

  it('removeLine on a line belonging to an already-CONFIRMED batch throws CONFLICT and leaves the batch intact', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    const lineId = batch!.lines[0].id;

    await admin.stockBatch.confirm({ batchId: batch!.id });

    await expect(admin.stockBatch.removeLine({ lineId })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const stillExists = await db.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirst();
    expect(stillExists).not.toBeUndefined();
    expect(stillExists?.status).toBe('CONFIRMED');
  });

  it('cancel on an already-CONFIRMED batch throws CONFLICT and leaves the batch intact', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    await expect(admin.stockBatch.cancel({ batchId: batch!.id })).rejects.toMatchObject({
      code: 'CONFLICT',
    });

    const afterCancel = await db.selectFrom('StockAdjustmentBatch').selectAll().where('id', '=', batch!.id).executeTakeFirstOrThrow();
    expect(afterCancel.status).toBe('CONFIRMED');
  });

  it('listHistory returns confirmed batches, never cancelled or pending ones', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    const beans = await db.insertInto('Ingredient').values({ id: createId(), name: 'Coffee Beans', unit: 'g', stockQty: 500 }).returningAll().executeTakeFirstOrThrow();

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const confirmedBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: confirmedBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const cancelledBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.cancel({ batchId: cancelledBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 10, reason: 'MANUAL_ADJUST' });

    const history = await admin.stockBatch.listHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe('CONFIRMED');
    expect(history[0].id).toBe(confirmedBatch!.id);
  });

  it('listHistory never exposes pinHash on createdBy or confirmedBy', async () => {
    const admin = await adminCaller();
    const milk = await db.insertInto('Ingredient').values({ id: createId(), name: 'Milk', unit: 'ml', stockQty: 1000 }).returningAll().executeTakeFirstOrThrow();
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: batch!.id });

    const history = await admin.stockBatch.listHistory();
    expect(history[0].createdBy).not.toHaveProperty('pinHash');
    expect(history[0].confirmedBy).not.toHaveProperty('pinHash');
    expect(history[0].createdBy.name).toBe('Admin');
  });
});
