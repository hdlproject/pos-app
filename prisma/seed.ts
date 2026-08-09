// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  await db.store.create({ data: { name: 'Main Store' } });

  await db.user.create({
    data: { name: 'Admin', role: 'ADMIN', pinHash: await bcrypt.hash('1234', 10) },
  });

  const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
  const milk = await db.ingredient.create({
    data: { name: 'Milk', unit: 'ml', stockQty: 5000, lowStockThreshold: 1000 },
  });
  const beans = await db.ingredient.create({
    data: { name: 'Coffee Beans', unit: 'g', stockQty: 2000, lowStockThreshold: 300 },
  });
  const latte = await db.menuItem.create({
    data: { name: 'Latte', price: 4.5, categoryId: category.id, available: true },
  });
  await db.recipe.createMany({
    data: [
      { menuItemId: latte.id, ingredientId: milk.id, qtyPerUnit: 200 },
      { menuItemId: latte.id, ingredientId: beans.id, qtyPerUnit: 18 },
    ],
  });
  await db.table.create({ data: { label: 'T1', qrToken: 'seed-table-1-token' } });
}

main().finally(() => db.$disconnect());
