import type { PrismaClient, Prisma } from '@prisma/client';

export async function recomputeAvailabilityForIngredient(
  db: Prisma.TransactionClient | PrismaClient,
  ingredientId: string
): Promise<void> {
  const items = await db.menuItem.findMany({
    where: { recipes: { some: { ingredientId } } },
    include: {
      recipes: { include: { ingredient: true }, orderBy: { ingredient: { name: 'asc' } } },
    },
  });

  for (const item of items) {
    const depletedNames = item.recipes
      .filter((recipe) => Number(recipe.ingredient.stockQty) <= 0)
      .map((recipe) => recipe.ingredient.name);

    const reason = depletedNames.length > 0 ? `Out of stock: ${depletedNames.join(', ')}` : null;

    if (item.outOfStockReason !== reason) {
      await db.menuItem.update({ where: { id: item.id }, data: { outOfStockReason: reason } });
    }
  }
}

// Scoped to one menu item rather than one ingredient: needed after a recipe
// link is removed, since the item's own recipes no longer mention that
// ingredient, so recomputeAvailabilityForIngredient wouldn't find it anymore.
export async function recomputeAvailabilityForMenuItem(
  db: Prisma.TransactionClient | PrismaClient,
  menuItemId: string
): Promise<void> {
  const item = await db.menuItem.findUniqueOrThrow({
    where: { id: menuItemId },
    include: {
      recipes: { include: { ingredient: true }, orderBy: { ingredient: { name: 'asc' } } },
    },
  });

  const depletedNames = item.recipes
    .filter((recipe) => Number(recipe.ingredient.stockQty) <= 0)
    .map((recipe) => recipe.ingredient.name);

  const reason = depletedNames.length > 0 ? `Out of stock: ${depletedNames.join(', ')}` : null;

  if (item.outOfStockReason !== reason) {
    await db.menuItem.update({ where: { id: item.id }, data: { outOfStockReason: reason } });
  }
}
