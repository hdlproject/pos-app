// database/seed.ts
import { sql } from 'kysely';
import { db } from '../src/server/db';
import { createId } from '../src/server/id';
import { hashPin } from '../src/server/auth/pin';

async function main() {
  await db.insertInto('Store').values({ id: createId(), name: 'Main Store' }).execute();

  const userSpecs = [
    { name: 'Admin', role: 'ADMIN' as const, pin: '1234' },
    { name: 'Staff', role: 'STAFF' as const, pin: '2345' },
    { name: 'Kitchen', role: 'KITCHEN' as const, pin: '4567' },
  ];
  const users = await db.insertInto('User')
    .values(await Promise.all(userSpecs.map(async (u) => ({ id: createId(), name: u.name, role: u.role, pinHash: await hashPin(u.pin) }))))
    .returningAll()
    .execute();
  const userId = (name: string) => users.find((u) => u.name === name)!.id;

  const categorySpecs = [
    { name: 'Coffee', sortOrder: 1 },
    { name: 'Tea', sortOrder: 2 },
    { name: 'Food', sortOrder: 3 },
    { name: 'Pastry', sortOrder: 4 },
    { name: 'Snacks', sortOrder: 5 },
    { name: 'Steak', sortOrder: 6 },
    { name: 'Italian', sortOrder: 7 },
    { name: 'Korean', sortOrder: 8 },
  ];
  const categories = await db.insertInto('Category')
    .values(categorySpecs.map((c) => ({ id: createId(), ...c })))
    .returningAll()
    .execute();
  const categoryId = (name: string) => categories.find((c) => c.name === name)!.id;

  const ingredientSpecs = [
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
  ];
  const ingredients = await db.insertInto('Ingredient')
    .values(ingredientSpecs.map((i) => ({ id: createId(), ...i })))
    .returningAll()
    .execute();
  const ingredientId = (name: string) => ingredients.find((i) => i.name === name)!.id;

  const itemSpecs = [
    { name: 'Espresso', price: 18000, categoryName: 'Coffee' },
    { name: 'Kopi Susu Gula Aren', price: 22000, categoryName: 'Coffee' },
    { name: 'Cappuccino', price: 25000, categoryName: 'Coffee' },
    { name: 'Caffè Latte', price: 27000, categoryName: 'Coffee' },
    { name: 'Americano', price: 20000, categoryName: 'Coffee' },
    { name: 'Cold Brew', price: 24000, categoryName: 'Coffee' },
    { name: 'Teh Tarik', price: 20000, categoryName: 'Tea' },
    { name: 'Matcha Latte', price: 28000, categoryName: 'Tea' },
    { name: 'Lemon Tea', price: 18000, categoryName: 'Tea' },
    { name: 'Chamomile', price: 17000, categoryName: 'Tea' },
    { name: 'Nasi Goreng Spesial', price: 32000, categoryName: 'Food' },
    { name: 'Mie Ayam', price: 30000, categoryName: 'Food' },
    { name: 'Chicken Katsu Rice', price: 35000, categoryName: 'Food' },
    { name: 'Beef Rendang Rice', price: 58000, categoryName: 'Food' },
    { name: 'Caesar Salad', price: 34000, categoryName: 'Food' },
    { name: 'Club Sandwich', price: 36000, categoryName: 'Food' },
    { name: 'Butter Croissant', price: 19000, categoryName: 'Pastry' },
    { name: 'Pain au Chocolat', price: 21000, categoryName: 'Pastry' },
    { name: 'Cinnamon Roll', price: 23000, categoryName: 'Pastry' },
    { name: 'Cheesecake Slice', price: 29000, categoryName: 'Pastry' },
    { name: 'French Fries', price: 18000, categoryName: 'Snacks' },
    { name: 'Onion Rings', price: 20000, categoryName: 'Snacks' },
    { name: 'Chicken Wings', price: 28000, categoryName: 'Snacks' },
    { name: 'Sirloin Steak', price: 145000, categoryName: 'Steak' },
    { name: 'T-Bone Steak', price: 165000, categoryName: 'Steak' },
    { name: 'Tenderloin Steak', price: 175000, categoryName: 'Steak' },
    { name: 'Ribeye Steak', price: 185000, categoryName: 'Steak' },
    { name: 'Wagyu Striploin', price: 285000, categoryName: 'Steak' },
    { name: 'Spaghetti Carbonara', price: 48000, categoryName: 'Italian' },
    { name: 'Fettuccine Alfredo', price: 46000, categoryName: 'Italian' },
    { name: 'Margherita Pizza', price: 52000, categoryName: 'Italian' },
    { name: 'Lasagna al Forno', price: 55000, categoryName: 'Italian' },
    { name: 'Chicken Parmigiana', price: 58000, categoryName: 'Italian' },
    { name: 'Risotto ai Funghi', price: 50000, categoryName: 'Italian' },
    { name: 'Bibimbap', price: 42000, categoryName: 'Korean' },
    { name: 'Bulgogi Beef', price: 55000, categoryName: 'Korean' },
    { name: 'Korean Fried Chicken', price: 45000, categoryName: 'Korean' },
    { name: 'Kimchi Fried Rice', price: 38000, categoryName: 'Korean' },
    { name: 'Tteokbokki', price: 32000, categoryName: 'Korean' },
    { name: 'Japchae', price: 36000, categoryName: 'Korean' },
  ];
  const items = await db.insertInto('MenuItem')
    .values(itemSpecs.map((i) => ({ id: createId(), name: i.name, price: i.price, categoryId: categoryId(i.categoryName), available: true })))
    .returningAll()
    .execute();
  const itemId = (name: string) => items.find((i) => i.name === name)!.id;

  const recipeSpecs = [
    { menuItemName: 'Espresso', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Kopi Susu Gula Aren', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Kopi Susu Gula Aren', ingredientName: 'Milk', qtyPerUnit: 150 },
    { menuItemName: 'Kopi Susu Gula Aren', ingredientName: 'Palm Sugar Syrup', qtyPerUnit: 30 },
    { menuItemName: 'Cappuccino', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Cappuccino', ingredientName: 'Milk', qtyPerUnit: 150 },
    { menuItemName: 'Caffè Latte', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Caffè Latte', ingredientName: 'Milk', qtyPerUnit: 200 },
    { menuItemName: 'Americano', ingredientName: 'Coffee Beans', qtyPerUnit: 18 },
    { menuItemName: 'Cold Brew', ingredientName: 'Coffee Beans', qtyPerUnit: 25 },
    { menuItemName: 'Teh Tarik', ingredientName: 'Black Tea Leaves', qtyPerUnit: 8 },
    { menuItemName: 'Teh Tarik', ingredientName: 'Milk', qtyPerUnit: 150 },
    { menuItemName: 'Matcha Latte', ingredientName: 'Matcha Powder', qtyPerUnit: 10 },
    { menuItemName: 'Matcha Latte', ingredientName: 'Milk', qtyPerUnit: 180 },
    { menuItemName: 'Lemon Tea', ingredientName: 'Black Tea Leaves', qtyPerUnit: 8 },
    { menuItemName: 'Lemon Tea', ingredientName: 'Lemon', qtyPerUnit: 0.5 },
    { menuItemName: 'Chamomile', ingredientName: 'Chamomile Tea Bag', qtyPerUnit: 1 },
    { menuItemName: 'Nasi Goreng Spesial', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Nasi Goreng Spesial', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Nasi Goreng Spesial', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Mie Ayam', ingredientName: 'Egg Noodles', qtyPerUnit: 150 },
    { menuItemName: 'Mie Ayam', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Chicken Katsu Rice', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Chicken Katsu Rice', ingredientName: 'Chicken Breast', qtyPerUnit: 150 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Beef Chuck', qtyPerUnit: 150 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Coconut Milk', qtyPerUnit: 100 },
    { menuItemName: 'Beef Rendang Rice', ingredientName: 'Rendang Spice Paste', qtyPerUnit: 40 },
    { menuItemName: 'Caesar Salad', ingredientName: 'Romaine Lettuce', qtyPerUnit: 100 },
    { menuItemName: 'Caesar Salad', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Caesar Salad', ingredientName: 'Parmesan Cheese', qtyPerUnit: 20 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Sandwich Bread', qtyPerUnit: 3 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Chicken Breast', qtyPerUnit: 100 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Bacon', qtyPerUnit: 40 },
    { menuItemName: 'Club Sandwich', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Butter Croissant', ingredientName: 'Croissant Dough', qtyPerUnit: 1 },
    { menuItemName: 'Pain au Chocolat', ingredientName: 'Pain au Chocolat Dough', qtyPerUnit: 1 },
    { menuItemName: 'Cinnamon Roll', ingredientName: 'Cinnamon Roll Dough', qtyPerUnit: 1 },
    { menuItemName: 'Cheesecake Slice', ingredientName: 'Cheesecake Slice (pre-made)', qtyPerUnit: 1 },
    { menuItemName: 'French Fries', ingredientName: 'Potato', qtyPerUnit: 180 },
    { menuItemName: 'Onion Rings', ingredientName: 'Onion Rings (frozen, bulk)', qtyPerUnit: 150 },
    { menuItemName: 'Chicken Wings', ingredientName: 'Chicken Wings', qtyPerUnit: 250 },
    { menuItemName: 'Sirloin Steak', ingredientName: 'Sirloin Cut', qtyPerUnit: 220 },
    { menuItemName: 'Sirloin Steak', ingredientName: 'Butter', qtyPerUnit: 15 },
    { menuItemName: 'T-Bone Steak', ingredientName: 'T-Bone Cut', qtyPerUnit: 300 },
    { menuItemName: 'T-Bone Steak', ingredientName: 'Butter', qtyPerUnit: 20 },
    { menuItemName: 'Tenderloin Steak', ingredientName: 'Tenderloin Cut', qtyPerUnit: 200 },
    { menuItemName: 'Tenderloin Steak', ingredientName: 'Butter', qtyPerUnit: 15 },
    { menuItemName: 'Ribeye Steak', ingredientName: 'Ribeye Cut', qtyPerUnit: 250 },
    { menuItemName: 'Ribeye Steak', ingredientName: 'Butter', qtyPerUnit: 20 },
    { menuItemName: 'Wagyu Striploin', ingredientName: 'Wagyu Striploin Cut', qtyPerUnit: 200 },
    { menuItemName: 'Wagyu Striploin', ingredientName: 'Butter', qtyPerUnit: 25 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Spaghetti', qtyPerUnit: 180 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Egg', qtyPerUnit: 2 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Bacon', qtyPerUnit: 60 },
    { menuItemName: 'Spaghetti Carbonara', ingredientName: 'Parmesan Cheese', qtyPerUnit: 30 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Fettuccine', qtyPerUnit: 180 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Butter', qtyPerUnit: 30 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Parmesan Cheese', qtyPerUnit: 40 },
    { menuItemName: 'Fettuccine Alfredo', ingredientName: 'Milk', qtyPerUnit: 100 },
    { menuItemName: 'Margherita Pizza', ingredientName: 'Pizza Dough', qtyPerUnit: 1 },
    { menuItemName: 'Margherita Pizza', ingredientName: 'Tomato Sauce', qtyPerUnit: 80 },
    { menuItemName: 'Margherita Pizza', ingredientName: 'Mozzarella Cheese', qtyPerUnit: 120 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Lasagna Sheets', qtyPerUnit: 150 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Beef Chuck', qtyPerUnit: 150 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Tomato Sauce', qtyPerUnit: 100 },
    { menuItemName: 'Lasagna al Forno', ingredientName: 'Mozzarella Cheese', qtyPerUnit: 80 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Chicken Breast', qtyPerUnit: 180 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Breadcrumbs', qtyPerUnit: 50 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Tomato Sauce', qtyPerUnit: 80 },
    { menuItemName: 'Chicken Parmigiana', ingredientName: 'Mozzarella Cheese', qtyPerUnit: 60 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Arborio Rice', qtyPerUnit: 180 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Mushroom', qtyPerUnit: 100 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Parmesan Cheese', qtyPerUnit: 30 },
    { menuItemName: 'Risotto ai Funghi', ingredientName: 'Butter', qtyPerUnit: 20 },
    { menuItemName: 'Bibimbap', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Bibimbap', ingredientName: 'Beef Chuck', qtyPerUnit: 100 },
    { menuItemName: 'Bibimbap', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Bibimbap', ingredientName: 'Kimchi', qtyPerUnit: 50 },
    { menuItemName: 'Bibimbap', ingredientName: 'Sesame Oil', qtyPerUnit: 10 },
    { menuItemName: 'Bulgogi Beef', ingredientName: 'Beef Chuck', qtyPerUnit: 200 },
    { menuItemName: 'Bulgogi Beef', ingredientName: 'Sesame Oil', qtyPerUnit: 15 },
    { menuItemName: 'Bulgogi Beef', ingredientName: 'Rice', qtyPerUnit: 150 },
    { menuItemName: 'Korean Fried Chicken', ingredientName: 'Chicken Wings', qtyPerUnit: 300 },
    { menuItemName: 'Korean Fried Chicken', ingredientName: 'Gochujang', qtyPerUnit: 30 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Rice', qtyPerUnit: 200 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Kimchi', qtyPerUnit: 100 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Egg', qtyPerUnit: 1 },
    { menuItemName: 'Kimchi Fried Rice', ingredientName: 'Sesame Oil', qtyPerUnit: 10 },
    { menuItemName: 'Tteokbokki', ingredientName: 'Rice Cake (Tteok)', qtyPerUnit: 200 },
    { menuItemName: 'Tteokbokki', ingredientName: 'Gochujang', qtyPerUnit: 40 },
    { menuItemName: 'Japchae', ingredientName: 'Glass Noodles (Dangmyeon)', qtyPerUnit: 150 },
    { menuItemName: 'Japchae', ingredientName: 'Beef Chuck', qtyPerUnit: 80 },
    { menuItemName: 'Japchae', ingredientName: 'Sesame Oil', qtyPerUnit: 10 },
    { menuItemName: 'Japchae', ingredientName: 'Egg', qtyPerUnit: 1 },
  ];
  await db.insertInto('Recipe')
    .values(recipeSpecs.map((r) => ({ id: createId(), menuItemId: itemId(r.menuItemName), ingredientId: ingredientId(r.ingredientName), qtyPerUnit: r.qtyPerUnit })))
    .execute();

  const tableSpecs = [
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
  ];
  const tables = await db.insertInto('Table')
    .values(tableSpecs.map((t) => ({ id: createId(), ...t })))
    .returningAll()
    .execute();
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

  const allRecipes = await db.selectFrom('Recipe').selectAll().execute();
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

    const order = await db.transaction().execute(async (trx) => {
      const created = await trx.insertInto('Order')
        .values({
          id: createId(), type: spec.type, source: spec.source, status: 'PAID',
          tableId: spec.table ? tableId(spec.table) : null,
          createdById: spec.source === 'STAFF' ? cashierId : null,
          total, createdAt,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.insertInto('OrderItem')
        .values(spec.lines.map((l) => ({
          id: createId(), orderId: created.id, menuItemId: itemId(l.item), qty: l.qty,
          unitPrice: itemPrice.get(l.item)!, kitchenStatus: 'SERVED' as const,
        })))
        .execute();
      await trx.insertInto('Payment')
        .values({ id: createId(), orderId: created.id, amount: total, method: 'CASH', receivedById: cashierId, createdAt })
        .execute();
      return created;
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
      await db.updateTable('Ingredient').set({ stockQty: sql`"stockQty" - ${qty}` }).where('id', '=', ingId).execute();
      await db.insertInto('StockMovement')
        .values({ id: createId(), ingredientId: ingId, delta: -qty, reason: 'SALE', refOrderId: order.id, createdById: cashierId, createdAt })
        .execute();
    }
  }
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
