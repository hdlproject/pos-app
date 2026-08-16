import { db } from '@/server/db';

export async function resetDb() {
  await db.$transaction([
    db.stockMovement.deleteMany(),
    db.stockAdjustmentLine.deleteMany(),
    db.stockAdjustmentBatch.deleteMany(),
    db.payment.deleteMany(),
    db.orderItem.deleteMany(),
    db.order.deleteMany(),
    db.recipe.deleteMany(),
    db.menuItem.deleteMany(),
    db.category.deleteMany(),
    db.ingredient.deleteMany(),
    db.table.deleteMany(),
    db.user.deleteMany(),
    db.store.deleteMany(),
  ]);
}
