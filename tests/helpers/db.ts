import { db } from '@/server/db';

export async function resetDb() {
  await db.transaction().execute(async (trx) => {
    await trx.deleteFrom('StockMovement').execute();
    await trx.deleteFrom('StockAdjustmentLine').execute();
    await trx.deleteFrom('StockAdjustmentBatch').execute();
    await trx.deleteFrom('Payment').execute();
    await trx.deleteFrom('OrderItem').execute();
    await trx.deleteFrom('Order').execute();
    await trx.deleteFrom('Recipe').execute();
    await trx.deleteFrom('MenuItem').execute();
    await trx.deleteFrom('Category').execute();
    await trx.deleteFrom('Ingredient').execute();
    await trx.deleteFrom('Table').execute();
    await trx.deleteFrom('User').execute();
    await trx.deleteFrom('Store').execute();
  });
}
