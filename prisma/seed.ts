// prisma/seed.ts
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hashPin } from '../src/server/auth/pin';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });

async function main() {
  await db.store.create({ data: { name: 'Main Store' } });

  const users = await db.user.createManyAndReturn({
    data: [
      { name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') },
      { name: 'Staff', role: 'STAFF', pinHash: await hashPin('2345') },
      { name: 'Kitchen', role: 'KITCHEN', pinHash: await hashPin('4567') },
    ],
  });
  const userId = (name: string) => users.find((u) => u.name === name)!.id;

  const categories = await db.category.createManyAndReturn({
    data: [
      { name: 'Coffee', sortOrder: 1 },
      { name: 'Tea', sortOrder: 2 },
      { name: 'Food', sortOrder: 3 },
      { name: 'Pastry', sortOrder: 4 },
      { name: 'Snacks', sortOrder: 5 },
      { name: 'Steak', sortOrder: 6 },
      { name: 'Italian', sortOrder: 7 },
      { name: 'Korean', sortOrder: 8 },
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
      // Steak
      { name: 'Ribeye Cut', unit: 'g', stockQty: 5000 },
      { name: 'Sirloin Cut', unit: 'g', stockQty: 4400 },
      { name: 'Tenderloin Cut', unit: 'g', stockQty: 4000 },
      { name: 'T-Bone Cut', unit: 'g', stockQty: 6000 },
      { name: 'Wagyu Striploin Cut', unit: 'g', stockQty: 2000 },
      { name: 'Butter', unit: 'g', stockQty: 3000 },
      // Italian
      { name: 'Spaghetti', unit: 'g', stockQty: 3600 },
      { name: 'Fettuccine', unit: 'g', stockQty: 3600 },
      { name: 'Pizza Dough', unit: 'pcs', stockQty: 40 },
      { name: 'Mozzarella Cheese', unit: 'g', stockQty: 2000 },
      { name: 'Tomato Sauce', unit: 'ml', stockQty: 3000 },
      { name: 'Lasagna Sheets', unit: 'g', stockQty: 1500 },
      { name: 'Arborio Rice', unit: 'g', stockQty: 1800 },
      { name: 'Mushroom', unit: 'g', stockQty: 1500 },
      { name: 'Breadcrumbs', unit: 'g', stockQty: 1000 },
      // Korean
      { name: 'Gochujang', unit: 'g', stockQty: 1200 },
      { name: 'Kimchi', unit: 'g', stockQty: 1500 },
      { name: 'Rice Cake (Tteok)', unit: 'g', stockQty: 2000 },
      { name: 'Glass Noodles (Dangmyeon)', unit: 'g', stockQty: 1500 },
      { name: 'Sesame Oil', unit: 'ml', stockQty: 1000 },
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
      // Steak
      { name: 'Sirloin Steak', price: 145000, categoryId: categoryId('Steak'), available: true },
      { name: 'T-Bone Steak', price: 165000, categoryId: categoryId('Steak'), available: true },
      { name: 'Tenderloin Steak', price: 175000, categoryId: categoryId('Steak'), available: true },
      { name: 'Ribeye Steak', price: 185000, categoryId: categoryId('Steak'), available: true },
      { name: 'Wagyu Striploin', price: 285000, categoryId: categoryId('Steak'), available: true },
      // Italian
      { name: 'Spaghetti Carbonara', price: 48000, categoryId: categoryId('Italian'), available: true },
      { name: 'Fettuccine Alfredo', price: 46000, categoryId: categoryId('Italian'), available: true },
      { name: 'Margherita Pizza', price: 52000, categoryId: categoryId('Italian'), available: true },
      { name: 'Lasagna al Forno', price: 55000, categoryId: categoryId('Italian'), available: true },
      { name: 'Chicken Parmigiana', price: 58000, categoryId: categoryId('Italian'), available: true },
      { name: 'Risotto ai Funghi', price: 50000, categoryId: categoryId('Italian'), available: true },
      // Korean
      { name: 'Bibimbap', price: 42000, categoryId: categoryId('Korean'), available: true },
      { name: 'Bulgogi Beef', price: 55000, categoryId: categoryId('Korean'), available: true },
      { name: 'Korean Fried Chicken', price: 45000, categoryId: categoryId('Korean'), available: true },
      { name: 'Kimchi Fried Rice', price: 38000, categoryId: categoryId('Korean'), available: true },
      { name: 'Tteokbokki', price: 32000, categoryId: categoryId('Korean'), available: true },
      { name: 'Japchae', price: 36000, categoryId: categoryId('Korean'), available: true },
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

      // Steak
      { menuItemId: itemId('Sirloin Steak'), ingredientId: ingredientId('Sirloin Cut'), qtyPerUnit: 220 },
      { menuItemId: itemId('Sirloin Steak'), ingredientId: ingredientId('Butter'), qtyPerUnit: 15 },

      { menuItemId: itemId('T-Bone Steak'), ingredientId: ingredientId('T-Bone Cut'), qtyPerUnit: 300 },
      { menuItemId: itemId('T-Bone Steak'), ingredientId: ingredientId('Butter'), qtyPerUnit: 20 },

      { menuItemId: itemId('Tenderloin Steak'), ingredientId: ingredientId('Tenderloin Cut'), qtyPerUnit: 200 },
      { menuItemId: itemId('Tenderloin Steak'), ingredientId: ingredientId('Butter'), qtyPerUnit: 15 },

      { menuItemId: itemId('Ribeye Steak'), ingredientId: ingredientId('Ribeye Cut'), qtyPerUnit: 250 },
      { menuItemId: itemId('Ribeye Steak'), ingredientId: ingredientId('Butter'), qtyPerUnit: 20 },

      { menuItemId: itemId('Wagyu Striploin'), ingredientId: ingredientId('Wagyu Striploin Cut'), qtyPerUnit: 200 },
      { menuItemId: itemId('Wagyu Striploin'), ingredientId: ingredientId('Butter'), qtyPerUnit: 25 },

      // Italian
      { menuItemId: itemId('Spaghetti Carbonara'), ingredientId: ingredientId('Spaghetti'), qtyPerUnit: 180 },
      { menuItemId: itemId('Spaghetti Carbonara'), ingredientId: ingredientId('Egg'), qtyPerUnit: 2 },
      { menuItemId: itemId('Spaghetti Carbonara'), ingredientId: ingredientId('Bacon'), qtyPerUnit: 60 },
      { menuItemId: itemId('Spaghetti Carbonara'), ingredientId: ingredientId('Parmesan Cheese'), qtyPerUnit: 30 },

      { menuItemId: itemId('Fettuccine Alfredo'), ingredientId: ingredientId('Fettuccine'), qtyPerUnit: 180 },
      { menuItemId: itemId('Fettuccine Alfredo'), ingredientId: ingredientId('Butter'), qtyPerUnit: 30 },
      { menuItemId: itemId('Fettuccine Alfredo'), ingredientId: ingredientId('Parmesan Cheese'), qtyPerUnit: 40 },
      { menuItemId: itemId('Fettuccine Alfredo'), ingredientId: ingredientId('Milk'), qtyPerUnit: 100 },

      { menuItemId: itemId('Margherita Pizza'), ingredientId: ingredientId('Pizza Dough'), qtyPerUnit: 1 },
      { menuItemId: itemId('Margherita Pizza'), ingredientId: ingredientId('Tomato Sauce'), qtyPerUnit: 80 },
      { menuItemId: itemId('Margherita Pizza'), ingredientId: ingredientId('Mozzarella Cheese'), qtyPerUnit: 120 },

      { menuItemId: itemId('Lasagna al Forno'), ingredientId: ingredientId('Lasagna Sheets'), qtyPerUnit: 150 },
      { menuItemId: itemId('Lasagna al Forno'), ingredientId: ingredientId('Beef Chuck'), qtyPerUnit: 150 },
      { menuItemId: itemId('Lasagna al Forno'), ingredientId: ingredientId('Tomato Sauce'), qtyPerUnit: 100 },
      { menuItemId: itemId('Lasagna al Forno'), ingredientId: ingredientId('Mozzarella Cheese'), qtyPerUnit: 80 },

      { menuItemId: itemId('Chicken Parmigiana'), ingredientId: ingredientId('Chicken Breast'), qtyPerUnit: 180 },
      { menuItemId: itemId('Chicken Parmigiana'), ingredientId: ingredientId('Breadcrumbs'), qtyPerUnit: 50 },
      { menuItemId: itemId('Chicken Parmigiana'), ingredientId: ingredientId('Tomato Sauce'), qtyPerUnit: 80 },
      { menuItemId: itemId('Chicken Parmigiana'), ingredientId: ingredientId('Mozzarella Cheese'), qtyPerUnit: 60 },

      { menuItemId: itemId('Risotto ai Funghi'), ingredientId: ingredientId('Arborio Rice'), qtyPerUnit: 180 },
      { menuItemId: itemId('Risotto ai Funghi'), ingredientId: ingredientId('Mushroom'), qtyPerUnit: 100 },
      { menuItemId: itemId('Risotto ai Funghi'), ingredientId: ingredientId('Parmesan Cheese'), qtyPerUnit: 30 },
      { menuItemId: itemId('Risotto ai Funghi'), ingredientId: ingredientId('Butter'), qtyPerUnit: 20 },

      // Korean
      { menuItemId: itemId('Bibimbap'), ingredientId: ingredientId('Rice'), qtyPerUnit: 200 },
      { menuItemId: itemId('Bibimbap'), ingredientId: ingredientId('Beef Chuck'), qtyPerUnit: 100 },
      { menuItemId: itemId('Bibimbap'), ingredientId: ingredientId('Egg'), qtyPerUnit: 1 },
      { menuItemId: itemId('Bibimbap'), ingredientId: ingredientId('Kimchi'), qtyPerUnit: 50 },
      { menuItemId: itemId('Bibimbap'), ingredientId: ingredientId('Sesame Oil'), qtyPerUnit: 10 },

      { menuItemId: itemId('Bulgogi Beef'), ingredientId: ingredientId('Beef Chuck'), qtyPerUnit: 200 },
      { menuItemId: itemId('Bulgogi Beef'), ingredientId: ingredientId('Sesame Oil'), qtyPerUnit: 15 },
      { menuItemId: itemId('Bulgogi Beef'), ingredientId: ingredientId('Rice'), qtyPerUnit: 150 },

      { menuItemId: itemId('Korean Fried Chicken'), ingredientId: ingredientId('Chicken Wings'), qtyPerUnit: 300 },
      { menuItemId: itemId('Korean Fried Chicken'), ingredientId: ingredientId('Gochujang'), qtyPerUnit: 30 },

      { menuItemId: itemId('Kimchi Fried Rice'), ingredientId: ingredientId('Rice'), qtyPerUnit: 200 },
      { menuItemId: itemId('Kimchi Fried Rice'), ingredientId: ingredientId('Kimchi'), qtyPerUnit: 100 },
      { menuItemId: itemId('Kimchi Fried Rice'), ingredientId: ingredientId('Egg'), qtyPerUnit: 1 },
      { menuItemId: itemId('Kimchi Fried Rice'), ingredientId: ingredientId('Sesame Oil'), qtyPerUnit: 10 },

      { menuItemId: itemId('Tteokbokki'), ingredientId: ingredientId('Rice Cake (Tteok)'), qtyPerUnit: 200 },
      { menuItemId: itemId('Tteokbokki'), ingredientId: ingredientId('Gochujang'), qtyPerUnit: 40 },

      { menuItemId: itemId('Japchae'), ingredientId: ingredientId('Glass Noodles (Dangmyeon)'), qtyPerUnit: 150 },
      { menuItemId: itemId('Japchae'), ingredientId: ingredientId('Beef Chuck'), qtyPerUnit: 80 },
      { menuItemId: itemId('Japchae'), ingredientId: ingredientId('Sesame Oil'), qtyPerUnit: 10 },
      { menuItemId: itemId('Japchae'), ingredientId: ingredientId('Egg'), qtyPerUnit: 1 },
    ],
  });

  const tables = await db.table.createManyAndReturn({
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
  const tableId = (label: string) => tables.find((t) => t.label === label)!.id;

  // Sample completed sales spread across the last week, so Reports (revenue,
  // best sellers, shift summary) has real data instead of an empty state.
  const daysAgo = (n: number, hour: number) => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  const orderSpecs: {
    daysAgo: number;
    hour: number;
    type: 'DINE_IN' | 'TAKEAWAY';
    source: 'STAFF' | 'QR';
    table?: string;
    cashier: string;
    lines: { item: string; qty: number }[];
  }[] = [
    { daysAgo: 6, hour: 8, type: 'DINE_IN', source: 'QR', table: 'T1', cashier: 'Staff', lines: [{ item: 'Espresso', qty: 2 }, { item: 'Butter Croissant', qty: 2 }] },
    { daysAgo: 6, hour: 12, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Nasi Goreng Spesial', qty: 1 }, { item: 'Lemon Tea', qty: 1 }] },
    { daysAgo: 5, hour: 9, type: 'DINE_IN', source: 'QR', table: 'T3', cashier: 'Staff', lines: [{ item: 'Caffè Latte', qty: 1 }, { item: 'Cinnamon Roll', qty: 1 }] },
    { daysAgo: 5, hour: 13, type: 'DINE_IN', source: 'QR', table: 'Bar 1', cashier: 'Admin', lines: [{ item: 'Chicken Katsu Rice', qty: 2 }] },
    { daysAgo: 4, hour: 10, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Kopi Susu Gula Aren', qty: 3 }] },
    { daysAgo: 4, hour: 18, type: 'DINE_IN', source: 'QR', table: 'T5', cashier: 'Staff', lines: [{ item: 'Beef Rendang Rice', qty: 1 }, { item: 'Chamomile', qty: 1 }] },
    { daysAgo: 3, hour: 8, type: 'DINE_IN', source: 'QR', table: 'Patio 1', cashier: 'Admin', lines: [{ item: 'Cappuccino', qty: 2 }, { item: 'Pain au Chocolat', qty: 2 }] },
    { daysAgo: 3, hour: 19, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Mie Ayam', qty: 2 }, { item: 'French Fries', qty: 1 }] },
    { daysAgo: 2, hour: 11, type: 'DINE_IN', source: 'QR', table: 'T2', cashier: 'Staff', lines: [{ item: 'Americano', qty: 1 }, { item: 'Club Sandwich', qty: 1 }] },
    { daysAgo: 2, hour: 17, type: 'DINE_IN', source: 'QR', table: 'Bar 2', cashier: 'Admin', lines: [{ item: 'Matcha Latte', qty: 2 }, { item: 'Cheesecake Slice', qty: 1 }] },
    { daysAgo: 1, hour: 9, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Staff', lines: [{ item: 'Cold Brew', qty: 2 }] },
    { daysAgo: 1, hour: 14, type: 'DINE_IN', source: 'QR', table: 'T4', cashier: 'Staff', lines: [{ item: 'Caesar Salad', qty: 1 }, { item: 'Onion Rings', qty: 1 }] },
    { daysAgo: 0, hour: 8, type: 'DINE_IN', source: 'QR', table: 'T1', cashier: 'Staff', lines: [{ item: 'Espresso', qty: 1 }, { item: 'Kopi Susu Gula Aren', qty: 1 }] },
    { daysAgo: 0, hour: 11, type: 'TAKEAWAY', source: 'STAFF', cashier: 'Admin', lines: [{ item: 'Chicken Wings', qty: 1 }, { item: 'Teh Tarik', qty: 1 }] },
  ];

  const itemPrice = new Map(items.map((i) => [i.name, Number(i.price)]));

  const allRecipes = await db.recipe.findMany();
  const recipesByItem = new Map<string, { ingredientId: string; qtyPerUnit: number }[]>();
  for (const r of allRecipes) {
    const list = recipesByItem.get(r.menuItemId) ?? [];
    list.push({ ingredientId: r.ingredientId, qtyPerUnit: Number(r.qtyPerUnit) });
    recipesByItem.set(r.menuItemId, list);
  }

  for (const spec of orderSpecs) {
    const createdAt = daysAgo(spec.daysAgo, spec.hour);
    const total = spec.lines.reduce((sum, l) => sum + itemPrice.get(l.item)! * l.qty, 0);
    const cashierId = userId(spec.cashier);
    const order = await db.order.create({
      data: {
        type: spec.type,
        source: spec.source,
        status: 'PAID',
        tableId: spec.table ? tableId(spec.table) : undefined,
        createdById: spec.source === 'STAFF' ? cashierId : undefined,
        total,
        createdAt,
        items: {
          create: spec.lines.map((l) => ({
            menuItemId: itemId(l.item),
            qty: l.qty,
            unitPrice: itemPrice.get(l.item)!,
            kitchenStatus: 'SERVED',
          })),
        },
        payments: {
          create: {
            amount: total,
            method: 'CASH',
            receivedById: cashierId,
            createdAt,
          },
        },
      },
    });

    // Deduct ingredient stock for this sale, mirroring
    // deductStockForOrder's effect (src/server/stock/deduct.ts), but with
    // createdAt backdated to match the order instead of "now".
    const deductions = new Map<string, number>();
    for (const line of spec.lines) {
      for (const recipe of recipesByItem.get(itemId(line.item)) ?? []) {
        const qty = recipe.qtyPerUnit * line.qty;
        deductions.set(recipe.ingredientId, (deductions.get(recipe.ingredientId) ?? 0) + qty);
      }
    }
    for (const [ingId, qty] of deductions.entries()) {
      await db.ingredient.update({ where: { id: ingId }, data: { stockQty: { decrement: qty } } });
      await db.stockMovement.create({
        data: { ingredientId: ingId, delta: -qty, reason: 'SALE', refOrderId: order.id, createdById: cashierId, createdAt },
      });
    }
  }
}

main().finally(() => db.$disconnect());
