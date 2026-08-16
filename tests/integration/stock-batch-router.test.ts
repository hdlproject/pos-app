import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('stock batch router', () => {
  beforeEach(resetDb);

  async function adminCaller() {
    const user = await db.user.create({ data: { name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    return appRouter.createCaller({ db, user: { userId: user.id, role: user.role, name: user.name } });
  }

  it('getPending returns null when there is no pending batch', async () => {
    const admin = await adminCaller();
    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('stageChange creates a pending batch with one line', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });

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
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const firstBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const secondBatch = await admin.stockBatch.getPending();

    expect(secondBatch?.id).toBe(firstBatch?.id);
    expect(secondBatch?.lines).toHaveLength(2);
  });

  it('re-staging the same ingredient updates the existing line instead of duplicating it', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -50, reason: 'MANUAL_ADJUST' });

    const pending = await admin.stockBatch.getPending();
    expect(pending?.lines).toHaveLength(1);
    expect(Number(pending?.lines[0].delta)).toBe(-50);
    expect(pending?.lines[0].reason).toBe('MANUAL_ADJUST');
  });

  it('removeLine removes one line but keeps the batch when other lines remain', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });
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
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.removeLine({ lineId: batch!.lines[0].id });

    const afterRemove = await admin.stockBatch.getPending();
    expect(afterRemove).toBeNull();
    const stillExists = await db.stockAdjustmentBatch.findUnique({ where: { id: batch!.id } });
    expect(stillExists).toBeNull();
  });

  it('setNote updates the batch note', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.setNote({ batchId: batch!.id, note: 'Weekly supplier delivery' });

    const updated = await admin.stockBatch.getPending();
    expect(updated?.note).toBe('Weekly supplier delivery');
  });

  it('confirm applies every line, writes StockMovement rows, and marks the batch CONFIRMED', async () => {
    const admin = await adminCaller();
    const adminUser = await db.user.findFirstOrThrow({ where: { name: 'Admin' } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: -50, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const milkAfter = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(milkAfter.stockQty)).toBe(1500);
    const beansAfter = await db.ingredient.findUniqueOrThrow({ where: { id: beans.id } });
    expect(Number(beansAfter.stockQty)).toBe(450);

    const movements = await db.stockMovement.findMany();
    expect(movements).toHaveLength(2);
    const beansMovement = movements.find((m) => m.ingredientId === beans.id)!;
    expect(beansMovement.reason).toBe('MANUAL_ADJUST');
    expect(Number(beansMovement.delta)).toBe(-50);

    const confirmedBatch = await db.stockAdjustmentBatch.findUniqueOrThrow({ where: { id: batch!.id } });
    expect(confirmedBatch.status).toBe('CONFIRMED');
    expect(confirmedBatch.confirmedById).toBe(adminUser.id);
    expect(confirmedBatch.confirmedAt).not.toBeNull();
  });

  it('confirm removes the batch from getPending (it is no longer PENDING)', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('confirm calls the availability recompute for a depleted ingredient', async () => {
    const admin = await adminCaller();
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 100, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const updatedItem = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updatedItem.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('cancel marks the batch CANCELLED without applying any stock change', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.cancel({ batchId: batch!.id });

    const milkAfter = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(milkAfter.stockQty)).toBe(1000);
    const movements = await db.stockMovement.findMany();
    expect(movements).toHaveLength(0);
    const cancelledBatch = await db.stockAdjustmentBatch.findUniqueOrThrow({ where: { id: batch!.id } });
    expect(cancelledBatch.status).toBe('CANCELLED');
  });

  it('listHistory returns confirmed and cancelled batches but never the pending one', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const confirmedBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: confirmedBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const cancelledBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.cancel({ batchId: cancelledBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 10, reason: 'MANUAL_ADJUST' });

    const history = await admin.stockBatch.listHistory();
    expect(history).toHaveLength(2);
    expect(history.map((b) => b.status).sort()).toEqual(['CANCELLED', 'CONFIRMED']);
    expect(history.every((b) => b.status !== 'PENDING')).toBe(true);
  });

  it('listHistory never exposes pinHash on createdBy or confirmedBy', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: batch!.id });

    const history = await admin.stockBatch.listHistory();
    expect(history[0].createdBy).not.toHaveProperty('pinHash');
    expect(history[0].confirmedBy).not.toHaveProperty('pinHash');
    expect(history[0].createdBy.name).toBe('Admin');
  });
});
