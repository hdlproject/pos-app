import type { Kysely, Transaction } from 'kysely';
import type { DB } from '../db.types';

export async function recomputeAvailabilityForMenuItem(
  db: Kysely<DB> | Transaction<DB>,
  menuItemId: string
): Promise<void> {
  const item = await db.selectFrom('MenuItem').selectAll().where('id', '=', menuItemId).executeTakeFirstOrThrow();
  const rows = await db
    .selectFrom('Recipe')
    .innerJoin('Ingredient', 'Ingredient.id', 'Recipe.ingredientId')
    .select(['Ingredient.name as name', 'Ingredient.stockQty as stockQty'])
    .where('Recipe.menuItemId', '=', menuItemId)
    .orderBy('Ingredient.name', 'asc')
    .execute();

  const depletedNames = rows.filter((r) => Number(r.stockQty) <= 0).map((r) => r.name);
  const reason = depletedNames.length > 0 ? `Out of stock: ${depletedNames.join(', ')}` : null;

  if (item.outOfStockReason !== reason) {
    await db.updateTable('MenuItem').set({ outOfStockReason: reason }).where('id', '=', menuItemId).execute();
  }
}

// Scoped to every menu item that uses this ingredient — needed after a stock
// adjustment to that ingredient, since we don't know in advance which items
// are affected. Reuses recomputeAvailabilityForMenuItem's per-item logic
// exactly, one item at a time.
export async function recomputeAvailabilityForIngredient(
  db: Kysely<DB> | Transaction<DB>,
  ingredientId: string
): Promise<void> {
  const affected = await db
    .selectFrom('Recipe')
    .select('menuItemId')
    .distinct()
    .where('ingredientId', '=', ingredientId)
    .execute();
  for (const { menuItemId } of affected) {
    await recomputeAvailabilityForMenuItem(db, menuItemId);
  }
}
