# Menu Expansion & Category Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the seed data to the full 23-item/5-category "Kopi & Co" menu with real recipes for every item, and add a generated category-icon fallback system so every menu item has visual identity everywhere it's listed, including admin.

**Architecture:** No schema changes — `MenuItem.image: String?` already exists and is already accepted by `menu.createItem`/`menu.updateItem`. Two new presentational components (`CategoryIcon`, `MenuItemThumbnail`) make the image-or-icon decision in one place and get imported into the three pages that list menu items. `prisma/seed.ts` is rewritten to populate 5 categories, 25 ingredients, 23 menu items, and a full recipe per item.

**Tech Stack:** Next.js 16 App Router, Prisma 7 (`createManyAndReturn`), Tailwind v4 tokens from `src/app/globals.css`, plain inline SVG (no icon library dependency).

## Global Constraints

- No Prisma schema changes — `MenuItem.image String?` already exists.
- No backend router changes — `menu.createItem`/`menu.updateItem`'s Zod schema already accepts `image?: string`, and `MenuItemWithCategory` (the hand-written TS2589 workaround type in `src/server/trpc/routers/menu.ts`) already includes `image: string | null` and `category: { id, name, sortOrder }`.
- No automated tests for `CategoryIcon`/`MenuItemThumbnail` (pure presentational, matches project convention). The only required verification is a manual seed row-count sanity check (5 categories, 23 menu items, 25 ingredients, ≥1 recipe row per item) plus `npm run build` staying clean.
- Menu content, prices, and category assignment must match the table in `docs/superpowers/specs/2026-08-16-menu-expansion-item-icons-design.md` exactly (23 items across Coffee/Tea/Food/Pastry/Snacks).
- Ingredient list must match the spec's 25-row ingredient table exactly (name, unit, consuming items).
- Icon color mapping must match the spec's table exactly: Coffee `#efe3d6→#e4d3c0`, Tea `#e4ece1→#d3e0cf`, Food `#f0e2cf→#e6d2b6`, Pastry `#f2e6dc→#ead4c2`, Snacks `#eee0d6→#e2ccbe`, fallback neutral.
- **Database safety:** seeding must only ever run against `pos_test` or the developer's own `pos_dev` with explicit confirmation — never run destructive Prisma commands without an explicit `DATABASE_URL` check. `pos_dev` was accidentally wiped once already this project; do not repeat that mistake.
- After every task, run `npm run build` — `tsc --noEmit` alone has previously missed real build breakages on this project (zod v4 / Prisma union-type issues).

---

### Task 1: Expand `prisma/seed.ts` — 5 categories, 25 ingredients, 23 menu items, full recipes

**Files:**
- Modify: `prisma/seed.ts` (full rewrite of the category/ingredient/menuItem/recipe section; `Store`, `User`, `Table` blocks stay unchanged)

**Interfaces:**
- Consumes: existing Prisma models `Category { name, sortOrder }`, `Ingredient { name, unit, stockQty, lowStockThreshold }`, `MenuItem { name, price, categoryId, available }`, `Recipe { menuItemId, ingredientId, qtyPerUnit }`.
- Produces: seeded rows later tasks' manual verification checks against (5 categories, 25 ingredients, 23 menu items, 1+ recipe row per item). No code-level interface — this task only affects seed data.

- [ ] **Step 1: Replace the category/ingredient/menuItem/recipe block in `prisma/seed.ts`**

Replace lines 16-32 of the current file (the single-category/two-ingredient/one-item block, from `const category = await db.category.create(...)` through `await db.table.create(...)`) so the full file reads:

```ts
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
      { name: 'Milk', unit: 'ml', stockQty: 5000, lowStockThreshold: 1000 },
      { name: 'Coffee Beans', unit: 'g', stockQty: 2000, lowStockThreshold: 300 },
      { name: 'Palm Sugar Syrup', unit: 'ml', stockQty: 750, lowStockThreshold: 150 },
      { name: 'Black Tea Leaves', unit: 'g', stockQty: 200, lowStockThreshold: 40 },
      { name: 'Matcha Powder', unit: 'g', stockQty: 250, lowStockThreshold: 50 },
      { name: 'Chamomile Tea Bag', unit: 'pcs', stockQty: 100, lowStockThreshold: 20 },
      { name: 'Lemon', unit: 'pcs', stockQty: 30, lowStockThreshold: 6 },
      { name: 'Rice', unit: 'g', stockQty: 5000, lowStockThreshold: 1000 },
      { name: 'Egg', unit: 'pcs', stockQty: 100, lowStockThreshold: 20 },
      { name: 'Chicken Breast', unit: 'g', stockQty: 3000, lowStockThreshold: 600 },
      { name: 'Egg Noodles', unit: 'g', stockQty: 3750, lowStockThreshold: 750 },
      { name: 'Beef Chuck', unit: 'g', stockQty: 3750, lowStockThreshold: 750 },
      { name: 'Coconut Milk', unit: 'ml', stockQty: 2500, lowStockThreshold: 500 },
      { name: 'Rendang Spice Paste', unit: 'g', stockQty: 1000, lowStockThreshold: 200 },
      { name: 'Romaine Lettuce', unit: 'g', stockQty: 2500, lowStockThreshold: 500 },
      { name: 'Parmesan Cheese', unit: 'g', stockQty: 500, lowStockThreshold: 100 },
      { name: 'Sandwich Bread', unit: 'pcs', stockQty: 150, lowStockThreshold: 30 },
      { name: 'Bacon', unit: 'g', stockQty: 1000, lowStockThreshold: 200 },
      { name: 'Croissant Dough', unit: 'pcs', stockQty: 50, lowStockThreshold: 10 },
      { name: 'Pain au Chocolat Dough', unit: 'pcs', stockQty: 50, lowStockThreshold: 10 },
      { name: 'Cinnamon Roll Dough', unit: 'pcs', stockQty: 50, lowStockThreshold: 10 },
      { name: 'Cheesecake Slice (pre-made)', unit: 'pcs', stockQty: 50, lowStockThreshold: 10 },
      { name: 'Potato', unit: 'g', stockQty: 4500, lowStockThreshold: 900 },
      { name: 'Onion Rings (frozen, bulk)', unit: 'g', stockQty: 3750, lowStockThreshold: 750 },
      { name: 'Chicken Wings', unit: 'g', stockQty: 6250, lowStockThreshold: 1250 },
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

  await db.table.create({ data: { label: 'T1', qrToken: 'seed-table-1-token' } });
}

main().finally(() => db.$disconnect());
```

- [ ] **Step 2: Type-check and build**

Run: `npm run build`
Expected: succeeds with no TypeScript errors. `createManyAndReturn` is available on the Prisma 7 client already in use by this project — no new dependency.

- [ ] **Step 3: Seed the test database and sanity-check row counts**

**Database safety:** run this ONLY with `DATABASE_URL` pointed at `pos_test` (port 5433), never `pos_dev`, unless the developer explicitly confirms otherwise.

Run: `DATABASE_URL="postgresql://<test-db-url>" npx prisma db seed` (use this project's actual `pos_test` connection string, same one `vitest` uses)

Then verify row counts with `psql` or an ad-hoc Prisma script against the same test DB:
- `Category` count = 5
- `Ingredient` count = 25
- `MenuItem` count = 23
- `Recipe` count ≥ 23 (one or more rows per item; the running total above is 43 rows)

Expected: all four counts match.

- [ ] **Step 4: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat: expand seed data to full 23-item 5-category menu with recipes"
```

---

### Task 2: `CategoryIcon` component

**Files:**
- Create: `src/components/ui/CategoryIcon.tsx`

**Interfaces:**
- Produces: `CategoryIcon({ category, className }: { category: string; className?: string })` — a React component. Later tasks (`MenuItemThumbnail`) import `{ CategoryIcon } from '@/components/ui/CategoryIcon'`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/ui/CategoryIcon.tsx
type CategoryIconProps = {
  category: string;
  className?: string;
};

const CATEGORY_STYLES: Record<string, { from: string; to: string }> = {
  Coffee: { from: '#efe3d6', to: '#e4d3c0' },
  Tea: { from: '#e4ece1', to: '#d3e0cf' },
  Food: { from: '#f0e2cf', to: '#e6d2b6' },
  Pastry: { from: '#f2e6dc', to: '#ead4c2' },
  Snacks: { from: '#eee0d6', to: '#e2ccbe' },
};

const FALLBACK_STYLE = { from: '#f3ede3', to: '#e9e0d2' };

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  className: 'w-6 h-6',
};

function CoffeeIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4V9Z" />
      <path d="M16 10h2a2 2 0 0 1 0 4h-2" />
      <path d="M8 3c0 1-1 1-1 2s1 1 1 2" />
      <path d="M12 3c0 1-1 1-1 2s1 1 1 2" />
    </svg>
  );
}

function TeaIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M3 11h11a4 4 0 0 1 0 8H7a4 4 0 0 1-4-8Z" />
      <path d="M14 12l6-2" />
      <path d="M7 11V8a2 2 0 0 1 2-2h2" />
    </svg>
  );
}

function FoodIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  );
}

function PastryIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M4 15c0-6 4-10 9-10 4 0 7 3 7 7 0 1-1 2-2 1-1-2-3-3-5-3-4 0-7 3-7 7 0 1-2 1-2-2Z" />
    </svg>
  );
}

function SnacksIcon() {
  return (
    <svg {...ICON_PROPS}>
      <path d="M5 10h14l-1.5 9a2 2 0 0 1-2 1.7H8.5a2 2 0 0 1-2-1.7L5 10Z" />
      <path d="M9 10V6M12 10V5M15 10V6" />
    </svg>
  );
}

function FallbackIcon() {
  return (
    <svg {...ICON_PROPS}>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4M12 15h.01" />
    </svg>
  );
}

const CATEGORY_ICONS: Record<string, () => React.JSX.Element> = {
  Coffee: CoffeeIcon,
  Tea: TeaIcon,
  Food: FoodIcon,
  Pastry: PastryIcon,
  Snacks: SnacksIcon,
};

export function CategoryIcon({ category, className = '' }: CategoryIconProps) {
  const style = CATEGORY_STYLES[category] ?? FALLBACK_STYLE;
  const Icon = CATEGORY_ICONS[category] ?? FallbackIcon;

  return (
    <div
      className={`flex items-center justify-center text-text-muted-2 ${className}`}
      style={{ background: `linear-gradient(135deg, ${style.from}, ${style.to})` }}
    >
      <Icon />
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds. `text-text-muted-2` is an existing Tailwind token already used elsewhere in this project (e.g. `src/app/(staff)/pos/page.tsx`).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/CategoryIcon.tsx
git commit -m "feat: add CategoryIcon component with 5-category SVG icon system"
```

---

### Task 3: `MenuItemThumbnail` component

**Files:**
- Create: `src/components/ui/MenuItemThumbnail.tsx`

**Interfaces:**
- Consumes: `CategoryIcon` from Task 2 (`import { CategoryIcon } from './CategoryIcon'`).
- Produces: `MenuItemThumbnail({ image, categoryName, alt, className }: { image?: string | null; categoryName: string; alt: string; className?: string })`. Tasks 4-6 import `{ MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail'`.

- [ ] **Step 1: Create the component**

```tsx
// src/components/ui/MenuItemThumbnail.tsx
import { CategoryIcon } from './CategoryIcon';

type MenuItemThumbnailProps = {
  image?: string | null;
  categoryName: string;
  alt: string;
  className?: string;
};

export function MenuItemThumbnail({ image, categoryName, alt, className = '' }: MenuItemThumbnailProps) {
  if (image) {
    return <img src={image} alt={alt} className={`object-cover ${className}`} />;
  }
  return <CategoryIcon category={categoryName} className={className} />;
}
```

A plain `<img>` is used instead of `next/image` because item images will be arbitrary external URLs the developer pastes in later via the admin field — `next/image` requires each remote host to be allow-listed in `next.config.ts`, which would break the moment a URL from an unlisted host is entered. A plain `<img>` has no such restriction and keeps the "paste a URL, it works" admin flow simple.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/MenuItemThumbnail.tsx
git commit -m "feat: add MenuItemThumbnail image-or-icon component"
```

---

### Task 4: Wire `MenuItemThumbnail` into `/pos`

**Files:**
- Modify: `src/app/(staff)/pos/page.tsx`

**Interfaces:**
- Consumes: `MenuItemThumbnail` from Task 3. `item.image` and `item.category.name` are already present on `menu.listAll`'s return type (`MenuItemWithCategory` in `src/server/trpc/routers/menu.ts`) — no backend change needed.

- [ ] **Step 1: Add the import**

In `src/app/(staff)/pos/page.tsx`, add after the existing `LogoutButton` import (line 8):

```tsx
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
```

- [ ] **Step 2: Add the thumbnail to each grid card**

Replace the current item-card block (lines 70-80):

```tsx
            {visibleItems.map((item) => (
              <Card key={item.id} className="flex flex-col gap-2.5">
                <div className="font-bold text-text text-sm">{item.name}</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-extrabold text-accent-tint text-sm">Rp {String(item.price)}</div>
                  <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                    + Add
                  </Button>
                </div>
              </Card>
            ))}
```

with:

```tsx
            {visibleItems.map((item) => (
              <Card key={item.id} className="flex flex-col gap-2.5">
                <MenuItemThumbnail
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  className="w-full h-20 rounded-xl"
                />
                <div className="font-bold text-text text-sm">{item.name}</div>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-extrabold text-accent-tint text-sm">Rp {String(item.price)}</div>
                  <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                    + Add
                  </Button>
                </div>
              </Card>
            ))}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(staff)/pos/page.tsx"
git commit -m "feat: show item thumbnails in POS item grid"
```

---

### Task 5: Wire `MenuItemThumbnail` into `/order/[tableToken]`

**Files:**
- Modify: `src/app/order/[tableToken]/page.tsx`

**Interfaces:**
- Consumes: `MenuItemThumbnail` from Task 3. `item.image`/`item.category.name` come from `menu.listAvailable`, which returns the same `MenuItemWithCategory` shape as `listAll`.

- [ ] **Step 1: Add the import**

In `src/app/order/[tableToken]/page.tsx`, add after the existing `Chip` import (line 6):

```tsx
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
```

- [ ] **Step 2: Add the thumbnail to each item row**

Replace the current item-row block (lines 87-99):

```tsx
            {visibleItems.map((item) => (
              <div key={item.id} className="flex gap-3 bg-surface border border-border rounded-2xl p-3">
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="font-extrabold text-sm text-text">{item.name}</span>
                  <div className="flex items-center justify-between mt-auto pt-2">
                    <span className="font-extrabold text-sm text-accent-tint">Rp {String(item.price)}</span>
                    <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            ))}
```

with:

```tsx
            {visibleItems.map((item) => (
              <div key={item.id} className="flex gap-3 bg-surface border border-border rounded-2xl p-3">
                <MenuItemThumbnail
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  className="w-16 h-16 rounded-xl shrink-0"
                />
                <div className="flex-1 min-w-0 flex flex-col">
                  <span className="font-extrabold text-sm text-text">{item.name}</span>
                  <div className="flex items-center justify-between mt-auto pt-2">
                    <span className="font-extrabold text-sm text-accent-tint">Rp {String(item.price)}</span>
                    <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            ))}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/order/[tableToken]/page.tsx"
git commit -m "feat: show item thumbnails on customer QR order page"
```

---

### Task 6: Wire `MenuItemThumbnail` into `/admin/menu` and add the Image URL field

**Files:**
- Modify: `src/app/(staff)/admin/menu/page.tsx`

**Interfaces:**
- Consumes: `MenuItemThumbnail` from Task 3. `menu.createItem` already accepts `image?: string` in its Zod input (`src/server/trpc/routers/menu.ts:10`) — no backend change.

- [ ] **Step 1: Add the import**

In `src/app/(staff)/admin/menu/page.tsx`, add after the existing `Card` import (line 5):

```tsx
import { MenuItemThumbnail } from '@/components/ui/MenuItemThumbnail';
```

- [ ] **Step 2: Add `image` state and wire it into `createItem`**

Replace the existing item-form state and mutation block (lines 19-24):

```tsx
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); },
  });
```

with:

```tsx
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [image, setImage] = useState('');
  const createItem = trpc.menu.createItem.useMutation({
    onSuccess: () => { utils.menu.listAll.invalidate(); setName(''); setPrice(''); setImage(''); },
  });
```

- [ ] **Step 3: Add the Image URL input to the form**

Replace the "New Item" form block (lines 48-80):

```tsx
      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Item</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="flex-1 min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            type="number"
            className="w-28 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <Button
            variant="dark"
            disabled={!name || !price || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true })}
          >
            Add Item
          </Button>
        </div>
      </Card>
```

with:

```tsx
      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Item</h2>
        <div className="flex gap-2 flex-wrap">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Item name"
            className="flex-1 min-w-[160px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="Price"
            type="number"
            className="w-28 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">Select category</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input
            value={image}
            onChange={(e) => setImage(e.target.value)}
            placeholder="Image URL (optional)"
            className="flex-1 min-w-[200px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="dark"
            disabled={!name || !price || !categoryId}
            onClick={() => createItem.mutate({ name, price: Number(price), categoryId, available: true, image: image || undefined })}
          >
            Add Item
          </Button>
        </div>
      </Card>
```

- [ ] **Step 4: Add the thumbnail to each item row**

Replace the item-list row block (lines 85-101):

```tsx
          {items.data?.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div>
                <span className="font-bold text-sm text-text">{item.name}</span>
                <span className="text-text-muted text-sm ml-2">Rp {String(item.price)}</span>
                <span className={`text-xs font-bold ml-2 ${item.available ? 'text-success' : 'text-warning'}`}>
                  {item.available ? 'available' : 'sold out'}
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
              >
                {item.available ? 'Mark sold out' : 'Mark available'}
              </Button>
            </div>
          ))}
```

with:

```tsx
          {items.data?.map((item) => (
            <div key={item.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3">
                <MenuItemThumbnail
                  image={item.image}
                  categoryName={item.category.name}
                  alt={item.name}
                  className="w-10 h-10 rounded-lg shrink-0"
                />
                <div>
                  <span className="font-bold text-sm text-text">{item.name}</span>
                  <span className="text-text-muted text-sm ml-2">Rp {String(item.price)}</span>
                  <span className={`text-xs font-bold ml-2 ${item.available ? 'text-success' : 'text-warning'}`}>
                    {item.available ? 'available' : 'sold out'}
                  </span>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => toggleAvailable.mutate({ id: item.id, available: !item.available })}
              >
                {item.available ? 'Mark sold out' : 'Mark available'}
              </Button>
            </div>
          ))}
```

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(staff)/admin/menu/page.tsx"
git commit -m "feat: add Image URL field and thumbnails to admin menu management"
```

---

### Task 7: Document the icon pattern in `docs/menu-item-icons.md`

**Files:**
- Create: `docs/menu-item-icons.md`

**Interfaces:**
- None — pure documentation, no code dependency.

- [ ] **Step 1: Write the doc**

```markdown
# Menu Item Icons

How every menu item gets a visual: a real photo when one exists, otherwise a generated icon based on its category. This is the reference for the pattern implemented in `src/components/ui/CategoryIcon.tsx` and `src/components/ui/MenuItemThumbnail.tsx`.

## How it works

`MenuItemThumbnail` is the single place that decides between a real image and a generated icon:

- `item.image` set (non-empty string) → renders `<img src={item.image}>`.
- `item.image` unset → renders `CategoryIcon` for the item's category.

Every page that lists menu items (`/pos`, `/order/[tableToken]`, `/admin/menu`) renders `MenuItemThumbnail`, never `CategoryIcon` or a raw `<img>` directly, so the fallback logic only exists in one place.

## Category → icon → color map

| Category | Icon | Gradient |
|---|---|---|
| Coffee | Mug with steam | `#efe3d6` → `#e4d3c0` |
| Tea | Teapot | `#e4ece1` → `#d3e0cf` |
| Food | Plate | `#f0e2cf` → `#e6d2b6` |
| Pastry | Croissant crescent | `#f2e6dc` → `#ead4c2` |
| Snacks | Fries basket | `#eee0d6` → `#e2ccbe` |
| *(unmapped)* | Generic dot | `#f3ede3` → `#e9e0d2` (neutral fallback) |

Gradients run `135deg`, from → to, applied as the background of a centered flex box that holds the icon.

## Icon style rules

- Inline SVG, `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth={1.5}`, `strokeLinecap="round"`, `strokeLinejoin="round"`.
- Icon color is `text-text-muted-2` (inherits via `currentColor`) regardless of category — only the background gradient changes per category.
- Icons are simple 1-3 path line drawings — no fills, no photographic detail, no per-item variation. One icon per category, not per item.

## Sizing per surface

`CategoryIcon`/`MenuItemThumbnail` take a `className` for sizing — the box and the fallback `<img>` both size from it, so real photos and generated icons occupy identical space:

| Surface | Size classes |
|---|---|
| `/pos` item grid | `w-full h-20 rounded-xl` |
| `/order/[tableToken]` item list | `w-16 h-16 rounded-xl shrink-0` |
| `/admin/menu` item rows | `w-10 h-10 rounded-lg shrink-0` |

The inner SVG stays a fixed `w-6 h-6` at every size — on larger tiles it reads as a centered badge icon, not a stretched illustration.

## Adding a 6th category

1. Pick the next tint pair from the existing palette family (warm neutral, 2 hex values, `135deg` gradient — stay within roughly `#e0`-`#f3` lightness to match the existing set).
2. Add a `<NameIcon>` function following the same SVG prop pattern (viewBox, stroke, no fill) — keep it to 1-3 simple paths.
3. Add one row each to `CATEGORY_STYLES` and `CATEGORY_ICONS` in `src/components/ui/CategoryIcon.tsx`, keyed by the exact `Category.name` string used in the database.
4. Add a row to the table above.

No changes are needed anywhere else — `MenuItemThumbnail` and every page consuming it pick up the new category automatically.

## Adding a real photo to an item

Set `MenuItem.image` to an image URL — via the admin "Image URL" field on `/admin/menu`, or directly via `menu.updateItem`. Once set, `MenuItemThumbnail` shows it in place of the generated icon everywhere the item is listed. No code change required.
```

- [ ] **Step 2: Commit**

```bash
git add docs/menu-item-icons.md
git commit -m "docs: document the category icon pattern"
```

---

### Task 8: Final verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all existing tests pass (32/32 as of the last feature), no regressions — this feature adds no automated tests per the Global Constraints.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds cleanly.

- [ ] **Step 3: Re-verify seed row counts against `pos_test`**

Repeat Task 1 Step 3's row-count check (5 categories, 25 ingredients, 23 menu items, 43 recipe rows) to confirm nothing in Tasks 2-7 altered seed behavior.

- [ ] **Step 4: Grep SSR output for icon rendering as a substitute for a browser check**

Since no browser automation tool is available in this session, use this project's established technique: after `npm run build`, inspect `.next/server/app/**/*.html` (or run the dev server and `fetch` the rendered HTML for `/pos`, `/order/seed-table-1-token`, and `/admin/menu`) and confirm:
- Each page's HTML contains multiple `linear-gradient(135deg,` occurrences (one per distinct category shown) — confirms `CategoryIcon` is rendering, not silently failing.
- No `opacity:0` or other blank-screen indicators are present (the same regression class caught in the login/transitions feature).

Expected: gradients present, no blank-screen indicators.

---
