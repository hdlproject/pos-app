// src/server/stock/deduct.ts
import type { PrismaClient } from '@prisma/client';

export async function deductStockForOrder(db: PrismaClient, orderId: string, userId: string): Promise<void> {
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

  await db.$transaction(
    Array.from(deductions.entries()).flatMap(([ingredientId, qty]) => [
      db.ingredient.update({ where: { id: ingredientId }, data: { stockQty: { decrement: qty } } }),
      db.stockMovement.create({
        data: { ingredientId, delta: -qty, reason: 'SALE', refOrderId: orderId, createdById: userId },
      }),
    ])
  );
}

export async function revertStockForOrder(db: PrismaClient, orderId: string, userId: string): Promise<void> {
  const movements = await db.stockMovement.findMany({ where: { refOrderId: orderId, reason: 'SALE' } });

  await db.$transaction(
    movements.flatMap((m) => [
      db.ingredient.update({ where: { id: m.ingredientId }, data: { stockQty: { increment: Number(m.delta) * -1 } } }),
      db.stockMovement.create({
        data: {
          ingredientId: m.ingredientId,
          delta: Number(m.delta) * -1,
          reason: 'VOID_REVERT',
          refOrderId: orderId,
          createdById: userId,
        },
      }),
    ])
  );
}
