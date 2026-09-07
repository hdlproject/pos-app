import { sql, type Kysely, type Transaction } from 'kysely';
import type { DB } from '../db.types';
import { createId } from '../id';
import { recomputeAvailabilityForIngredient } from './availability';

export async function deductStockForOrder(
  db: Kysely<DB> | Transaction<DB>,
  orderId: string,
  userId: string
): Promise<void> {
  const rows = await db
    .selectFrom('OrderItem')
    .innerJoin('Recipe', 'Recipe.menuItemId', 'OrderItem.menuItemId')
    .select(['OrderItem.qty as qty', 'Recipe.ingredientId as ingredientId', 'Recipe.qtyPerUnit as qtyPerUnit'])
    .where('OrderItem.orderId', '=', orderId)
    .execute();

  const deductions = new Map<string, number>();
  for (const r of rows) {
    const qty = Number(r.qtyPerUnit) * r.qty;
    deductions.set(r.ingredientId, (deductions.get(r.ingredientId) ?? 0) + qty);
  }

  for (const [ingredientId, qty] of deductions.entries()) {
    await db.updateTable('Ingredient').set({ stockQty: sql`"stockQty" - ${qty}` }).where('id', '=', ingredientId).execute();
    await db.insertInto('StockMovement')
      .values({ id: createId(), ingredientId, delta: -qty, reason: 'SALE', refOrderId: orderId, createdById: userId })
      .execute();
    await recomputeAvailabilityForIngredient(db, ingredientId);
  }
}

export async function revertStockForOrder(
  db: Kysely<DB> | Transaction<DB>,
  orderId: string,
  userId: string
): Promise<void> {
  const movements = await db.selectFrom('StockMovement').selectAll()
    .where('refOrderId', '=', orderId).where('reason', '=', 'SALE').execute();

  for (const m of movements) {
    const revertQty = Number(m.delta) * -1;
    await db.updateTable('Ingredient').set({ stockQty: sql`"stockQty" + ${revertQty}` }).where('id', '=', m.ingredientId).execute();
    await db.insertInto('StockMovement')
      .values({ id: createId(), ingredientId: m.ingredientId, delta: revertQty, reason: 'VOID_REVERT', refOrderId: orderId, createdById: userId })
      .execute();
    await recomputeAvailabilityForIngredient(db, m.ingredientId);
  }
}
