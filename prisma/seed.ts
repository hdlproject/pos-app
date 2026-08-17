// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  await db.store.create({ data: { name: 'Main Store' } });

  await db.user.createMany({
    data: [
      { name: 'Admin', role: 'ADMIN', pinHash: await bcrypt.hash('1234', 10) },
      { name: 'Staff', role: 'STAFF', pinHash: await bcrypt.hash('2345', 10) },
      { name: 'Kitchen', role: 'KITCHEN', pinHash: await bcrypt.hash('4567', 10) },
    ],
  });

  const categories = await db.category.createManyAndReturn({
    data: [
      { name: 'Coffee', sortOrder: 1 },
      { name: 'Tea', sortOrder: 2 },
      { name: 'Food', sortOrder: 3 },
      { name: 'Pastry', sortOrder: 4 },
      { name: 'Snacks', sortOrder: 5 },
    ],
  });
  const categoryId = (name: string) => categories.find((c) => c.name === name)!.id;

  const ingredients = await db.ingredient.createManyAndReturn({
    data: [
      { name: 'Milk', unit: 'ml', stockQty: 5000 },
      { name: 'Coffee Beans', unit: 'g', stockQty: 2000 },
      { name: 'Palm Sugar Syrup', unit: 'ml', stockQty: 750 },
      { name: 'Black Tea Leaves', unit: 'g', stockQty: 200 },
      { name: 'Matcha Powder', unit: 'g', stockQty: 250 },
      { name: 'Chamomile Tea Bag', unit: 'pcs', stockQty: 100 },
      { name: 'Lemon', unit: 'pcs', stockQty: 30 },
      { name: 'Rice', unit: 'g', stockQty: 5000 },
      { name: 'Egg', unit: 'pcs', stockQty: 100 },
      { name: 'Chicken Breast', unit: 'g', stockQty: 3000 },
      { name: 'Egg Noodles', unit: 'g', stockQty: 3750 },
      { name: 'Beef Chuck', unit: 'g', stockQty: 3750 },
      { name: 'Coconut Milk', unit: 'ml', stockQty: 2500 },
      { name: 'Rendang Spice Paste', unit: 'g', stockQty: 1000 },
      { name: 'Romaine Lettuce', unit: 'g', stockQty: 2500 },
      { name: 'Parmesan Cheese', unit: 'g', stockQty: 500 },
      { name: 'Sandwich Bread', unit: 'pcs', stockQty: 150 },
      { name: 'Bacon', unit: 'g', stockQty: 1000 },
      { name: 'Croissant Dough', unit: 'pcs', stockQty: 50 },
      { name: 'Pain au Chocolat Dough', unit: 'pcs', stockQty: 50 },
      { name: 'Cinnamon Roll Dough', unit: 'pcs', stockQty: 50 },
      { name: 'Cheesecake Slice (pre-made)', unit: 'pcs', stockQty: 50 },
      { name: 'Potato', unit: 'g', stockQty: 4500 },
      { name: 'Onion Rings (frozen, bulk)', unit: 'g', stockQty: 3750 },
      { name: 'Chicken Wings', unit: 'g', stockQty: 6250 },
    ],
  });
  const ingredientId = (name: string) => ingredients.find((i) => i.name === name)!.id;

  const items = await db.menuItem.createManyAndReturn({
    data: [
      { name: 'Espresso', price: 18000, categoryId: categoryId('Coffee'), available: true },
      { name: 'Kopi Susu Gula Aren', price: 22000, categoryId: categoryId('Coffee'), available: true },
      { name: 'Cappuccino', price: 25000, categoryId: categoryId('Coffee'), available: true },
      { name: 'Caffè Latte', price: 27000, categoryId: categoryId('Coffee'), available: true },
      { name: 'Americano', price: 20000, categoryId: categoryId('Coffee'), available: true },
      { name: 'Cold Brew', price: 24000, categoryId: categoryId('Coffee'), available: true },
      { name: 'Teh Tarik', price: 20000, categoryId: categoryId('Tea'), available: true },
      { name: 'Matcha Latte', price: 28000, categoryId: categoryId('Tea'), available: true },
      { name: 'Lemon Tea', price: 18000, categoryId: categoryId('Tea'), available: true },
      { name: 'Chamomile', price: 17000, categoryId: categoryId('Tea'), available: true },
      { name: 'Nasi Goreng Spesial', price: 32000, categoryId: categoryId('Food'), available: true },
      { name: 'Mie Ayam', price: 30000, categoryId: categoryId('Food'), available: true },
      { name: 'Chicken Katsu Rice', price: 35000, categoryId: categoryId('Food'), available: true },
      { name: 'Beef Rendang Rice', price: 58000, categoryId: categoryId('Food'), available: true },
      { name: 'Caesar Salad', price: 34000, categoryId: categoryId('Food'), available: true },
      { name: 'Club Sandwich', price: 36000, categoryId: categoryId('Food'), available: true },
      { name: 'Butter Croissant', price: 19000, categoryId: categoryId('Pastry'), available: true },
      { name: 'Pain au Chocolat', price: 21000, categoryId: categoryId('Pastry'), available: true },
      { name: 'Cinnamon Roll', price: 23000, categoryId: categoryId('Pastry'), available: true },
      { name: 'Cheesecake Slice', price: 29000, categoryId: categoryId('Pastry'), available: true },
      { name: 'French Fries', price: 18000, categoryId: categoryId('Snacks'), available: true },
      { name: 'Onion Rings', price: 20000, categoryId: categoryId('Snacks'), available: true },
      { name: 'Chicken Wings', price: 28000, categoryId: categoryId('Snacks'), available: true },
    ],
  });
  const itemId = (name: string) => items.find((i) => i.name === name)!.id;

  await db.recipe.createMany({
    data: [
      { menuItemId: itemId('Espresso'), ingredientId: ingredientId('Coffee Beans'), qtyPerUnit: 18 },

      { menuItemId: itemId('Kopi Susu Gula Aren'), ingredientId: ingredientId('Coffee Beans'), qtyPerUnit: 18 },
      { menuItemId: itemId('Kopi Susu Gula Aren'), ingredientId: ingredientId('Milk'), qtyPerUnit: 150 },
      { menuItemId: itemId('Kopi Susu Gula Aren'), ingredientId: ingredientId('Palm Sugar Syrup'), qtyPerUnit: 30 },

      { menuItemId: itemId('Cappuccino'), ingredientId: ingredientId('Coffee Beans'), qtyPerUnit: 18 },
      { menuItemId: itemId('Cappuccino'), ingredientId: ingredientId('Milk'), qtyPerUnit: 150 },

      { menuItemId: itemId('Caffè Latte'), ingredientId: ingredientId('Coffee Beans'), qtyPerUnit: 18 },
      { menuItemId: itemId('Caffè Latte'), ingredientId: ingredientId('Milk'), qtyPerUnit: 200 },

      { menuItemId: itemId('Americano'), ingredientId: ingredientId('Coffee Beans'), qtyPerUnit: 18 },

      { menuItemId: itemId('Cold Brew'), ingredientId: ingredientId('Coffee Beans'), qtyPerUnit: 25 },

      { menuItemId: itemId('Teh Tarik'), ingredientId: ingredientId('Black Tea Leaves'), qtyPerUnit: 8 },
      { menuItemId: itemId('Teh Tarik'), ingredientId: ingredientId('Milk'), qtyPerUnit: 150 },

      { menuItemId: itemId('Matcha Latte'), ingredientId: ingredientId('Matcha Powder'), qtyPerUnit: 10 },
      { menuItemId: itemId('Matcha Latte'), ingredientId: ingredientId('Milk'), qtyPerUnit: 180 },

      { menuItemId: itemId('Lemon Tea'), ingredientId: ingredientId('Black Tea Leaves'), qtyPerUnit: 8 },
      { menuItemId: itemId('Lemon Tea'), ingredientId: ingredientId('Lemon'), qtyPerUnit: 0.5 },

      { menuItemId: itemId('Chamomile'), ingredientId: ingredientId('Chamomile Tea Bag'), qtyPerUnit: 1 },

      { menuItemId: itemId('Nasi Goreng Spesial'), ingredientId: ingredientId('Rice'), qtyPerUnit: 200 },
      { menuItemId: itemId('Nasi Goreng Spesial'), ingredientId: ingredientId('Egg'), qtyPerUnit: 1 },
      { menuItemId: itemId('Nasi Goreng Spesial'), ingredientId: ingredientId('Chicken Breast'), qtyPerUnit: 100 },

      { menuItemId: itemId('Mie Ayam'), ingredientId: ingredientId('Egg Noodles'), qtyPerUnit: 150 },
      { menuItemId: itemId('Mie Ayam'), ingredientId: ingredientId('Chicken Breast'), qtyPerUnit: 100 },

      { menuItemId: itemId('Chicken Katsu Rice'), ingredientId: ingredientId('Rice'), qtyPerUnit: 200 },
      { menuItemId: itemId('Chicken Katsu Rice'), ingredientId: ingredientId('Chicken Breast'), qtyPerUnit: 150 },

      { menuItemId: itemId('Beef Rendang Rice'), ingredientId: ingredientId('Rice'), qtyPerUnit: 200 },
      { menuItemId: itemId('Beef Rendang Rice'), ingredientId: ingredientId('Beef Chuck'), qtyPerUnit: 150 },
      { menuItemId: itemId('Beef Rendang Rice'), ingredientId: ingredientId('Coconut Milk'), qtyPerUnit: 100 },
      { menuItemId: itemId('Beef Rendang Rice'), ingredientId: ingredientId('Rendang Spice Paste'), qtyPerUnit: 40 },

      { menuItemId: itemId('Caesar Salad'), ingredientId: ingredientId('Romaine Lettuce'), qtyPerUnit: 100 },
      { menuItemId: itemId('Caesar Salad'), ingredientId: ingredientId('Chicken Breast'), qtyPerUnit: 100 },
      { menuItemId: itemId('Caesar Salad'), ingredientId: ingredientId('Parmesan Cheese'), qtyPerUnit: 20 },

      { menuItemId: itemId('Club Sandwich'), ingredientId: ingredientId('Sandwich Bread'), qtyPerUnit: 3 },
      { menuItemId: itemId('Club Sandwich'), ingredientId: ingredientId('Chicken Breast'), qtyPerUnit: 100 },
      { menuItemId: itemId('Club Sandwich'), ingredientId: ingredientId('Bacon'), qtyPerUnit: 40 },
      { menuItemId: itemId('Club Sandwich'), ingredientId: ingredientId('Egg'), qtyPerUnit: 1 },

      { menuItemId: itemId('Butter Croissant'), ingredientId: ingredientId('Croissant Dough'), qtyPerUnit: 1 },
      { menuItemId: itemId('Pain au Chocolat'), ingredientId: ingredientId('Pain au Chocolat Dough'), qtyPerUnit: 1 },
      { menuItemId: itemId('Cinnamon Roll'), ingredientId: ingredientId('Cinnamon Roll Dough'), qtyPerUnit: 1 },
      { menuItemId: itemId('Cheesecake Slice'), ingredientId: ingredientId('Cheesecake Slice (pre-made)'), qtyPerUnit: 1 },

      { menuItemId: itemId('French Fries'), ingredientId: ingredientId('Potato'), qtyPerUnit: 180 },
      { menuItemId: itemId('Onion Rings'), ingredientId: ingredientId('Onion Rings (frozen, bulk)'), qtyPerUnit: 150 },
      { menuItemId: itemId('Chicken Wings'), ingredientId: ingredientId('Chicken Wings'), qtyPerUnit: 250 },
    ],
  });

  await db.table.createMany({
    data: [
      { label: 'T1', qrToken: 'seed-table-1-token' },
      { label: 'T2', qrToken: 'seed-table-2-token' },
      { label: 'T3', qrToken: 'seed-table-3-token' },
      { label: 'T4', qrToken: 'seed-table-4-token' },
      { label: 'T5', qrToken: 'seed-table-5-token' },
      { label: 'T6', qrToken: 'seed-table-6-token' },
      { label: 'Bar 1', qrToken: 'seed-table-bar1-token' },
      { label: 'Bar 2', qrToken: 'seed-table-bar2-token' },
      { label: 'Patio 1', qrToken: 'seed-table-patio1-token' },
      { label: 'Patio 2', qrToken: 'seed-table-patio2-token' },
    ],
  });
}

main().finally(() => db.$disconnect());
