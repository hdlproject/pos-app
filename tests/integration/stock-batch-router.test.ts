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
});
