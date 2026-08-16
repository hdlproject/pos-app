// src/server/stock/deduct.ts
import type { PrismaClient, Prisma } from '@prisma/client';
import { recomputeAvailabilityForIngredient } from './availability';

// Accepts either a plain PrismaClient or an interactive-transaction client
// (Prisma.TransactionClient) so callers can run this as part of a larger
// atomic transaction (e.g. payment.payCash, order.cancel). Prisma does not
// support nested $transaction calls on a transaction client, so this
// function deliberately does NOT wrap its writes in its own $transaction —
// it just awaits each Prisma call in sequence. When `db` is a transaction
// client, those calls run inside the caller's ambient transaction and are
// atomic with it. When `db` is a plain PrismaClient (e.g. called directly,
// as some tests do), the calls execute sequentially but are not atomic
// among themselves; callers that need that guarantee should wrap their own
// call in db.$transaction(async (tx) => { ... }).
export async function deductStockForOrder(
  db: Prisma.TransactionClient | PrismaClient,
  orderId: string,
  userId: string
): Promise<void> {
  const order = await db.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { items: { include: { menuItem: { include: { recipes: true } } } } },
  });

  const deductions = new Map<string, number>();
  for (const item of order.items) {
    for (const recipe of item.menuItem.recipes) {
      const qty = Number(recipe.qtyPerUnit) * item.qty;
      deductions.set(recipe.ingredientId, (deductions.get(recipe.ingredientId) ?? 0) + qty);
    }
  }

  for (const [ingredientId, qty] of deductions.entries()) {
    await db.ingredient.update({ where: { id: ingredientId }, data: { stockQty: { decrement: qty } } });
    await db.stockMovement.create({
      data: { ingredientId, delta: -qty, reason: 'SALE', refOrderId: orderId, createdById: userId },
    });
    await recomputeAvailabilityForIngredient(db, ingredientId);
  }
}

export async function revertStockForOrder(
  db: Prisma.TransactionClient | PrismaClient,
  orderId: string,
  userId: string
): Promise<void> {
  const movements = await db.stockMovement.findMany({ where: { refOrderId: orderId, reason: 'SALE' } });

  for (const m of movements) {
    await db.ingredient.update({ where: { id: m.ingredientId }, data: { stockQty: { increment: Number(m.delta) * -1 } } });
    await db.stockMovement.create({
      data: {
        ingredientId: m.ingredientId,
        delta: Number(m.delta) * -1,
        reason: 'VOID_REVERT',
        refOrderId: orderId,
        createdById: userId,
      },
    });
    await recomputeAvailabilityForIngredient(db, m.ingredientId);
  }
}
