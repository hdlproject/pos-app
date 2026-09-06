# Automatic Sold-Out Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically mark a menu item unavailable, with a reason naming the depleted ingredient(s), whenever a recipe ingredient it depends on runs out — independent of and never overriding the existing manual "Mark sold out" toggle.

**Architecture:** A new nullable `MenuItem.outOfStockReason` column tracks the automatic signal separately from the existing `available` boolean (the manual signal). One function, `recomputeAvailabilityForIngredient`, re-derives and writes that column for every affected menu item whenever ingredient stock or a recipe changes; it's called from all 4 existing stock/recipe-mutating code paths. Effective availability everywhere is `available && !outOfStockReason` — computed at read time, not stored.

**Tech Stack:** Existing Prisma/tRPC/Next.js stack, no new dependencies.

## Global Constraints

- `available: Boolean` (the manual toggle) keeps its exact current meaning and default — never touched by the automatic recompute.
- New column: `MenuItem.outOfStockReason: String?` — `null` means no recipe ingredient is depleted; otherwise `"Out of stock: <comma-joined ingredient names>"`.
- "Running out" means `Number(ingredient.stockQty) <= 0` — strict depletion, not `lowStockThreshold` (that stays a separate, unrelated warning, untouched).
- Effective availability = `available === true && outOfStockReason === null`, computed at read time wherever it's needed — no third stored column.
- Recompute must check *all* of an item's recipe ingredients each time, not just the one that changed.
- Wired into all 4 existing call sites: `ingredient.adjustStock`, `ingredient.setRecipe` (both in `src/server/trpc/routers/ingredient.ts`), `deductStockForOrder`, `revertStockForOrder` (both in `src/server/stock/deduct.ts`).
- Database safety: any `npm test` / `prisma migrate` / `prisma db seed` command must set `DATABASE_URL` explicitly on the command itself — never rely on a prior `source .env` (it points at `pos_dev`, the real dev database).

---

### Task 1: Prisma migration — add `MenuItem.outOfStockReason`

**Files:**
- Modify: `prisma/schema.prisma:85-96` (the `MenuItem` model)
- Create: `prisma/migrations/<timestamp>_add_menu_item_out_of_stock_reason/migration.sql`

**Interfaces:**
- Produces: `MenuItem.outOfStockReason: string | null` on the Prisma Client — every later task's TypeScript code depends on this field existing on the generated client.

- [ ] **Step 1: Edit the schema**

Current `MenuItem` model (`prisma/schema.prisma:85-96`):

```prisma
model MenuItem {
  id         String   @id @default(cuid())
  name       String
  price      Decimal  @db.Decimal(10, 2)
  categoryId String
  category   Category @relation(fields: [categoryId], references: [id])
  available  Boolean  @default(true)
  image      String?
  modifiers  Json?

  recipes    Recipe[]
  orderItems OrderItem[]
}
```

Replace it with:

```prisma
model MenuItem {
  id               String   @id @default(cuid())
  name             String
  price            Decimal  @db.Decimal(10, 2)
  categoryId       String
  category         Category @relation(fields: [categoryId], references: [id])
  available        Boolean  @default(true)
  outOfStockReason String?
  image            String?
  modifiers        Json?

  recipes    Recipe[]
  orderItems OrderItem[]
}
```

- [ ] **Step 2: Create the migration**

Get a timestamp: `date -u +"%Y%m%d%H%M%S"`. Create the directory `prisma/migrations/<that-timestamp>_add_menu_item_out_of_stock_reason/` and write `migration.sql` inside it:

```sql
-- Track automatic ingredient-driven sold-out detection separately from the
-- existing manual "available" toggle.
ALTER TABLE "MenuItem" ADD COLUMN "outOfStockReason" TEXT;
```

- [ ] **Step 3: Regenerate the Prisma Client and apply the migration**

```bash
npx prisma generate
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_dev" npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx prisma migrate deploy
```
Expected: both report the new migration applied successfully. This is a pure additive `ADD COLUMN` — no data loss, no reset needed, existing rows get `outOfStockReason = NULL`.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds — `outOfStockReason` isn't referenced anywhere in application code yet, this just confirms the schema/client regenerate cleanly.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add MenuItem.outOfStockReason column for auto sold-out detection"
```

---

### Task 2: `recomputeAvailabilityForIngredient`

**Files:**
- Create: `src/server/stock/availability.ts`
- Test: `tests/integration/stock-availability.test.ts`

**Interfaces:**
- Consumes: `MenuItem.outOfStockReason` (Task 1).
- Produces: `recomputeAvailabilityForIngredient(db: Prisma.TransactionClient | PrismaClient, ingredientId: string): Promise<void>`. Tasks 3 and 4 import and call this from all 4 stock/recipe-changing code paths.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/stock-availability.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { recomputeAvailabilityForIngredient } from '@/server/stock/availability';

describe('recomputeAvailabilityForIngredient', () => {
  beforeEach(resetDb);

  it('sets a reason naming the ingredient when it hits zero', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });

    await recomputeAvailabilityForIngredient(db, milk.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('clears the reason once the ingredient is restocked', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({
      data: { name: 'Latte', price: 4.5, categoryId: category.id, outOfStockReason: 'Out of stock: Milk' },
    });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });

    await db.ingredient.update({ where: { id: milk.id }, data: { stockQty: 1000 } });
    await recomputeAvailabilityForIngredient(db, milk.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBeNull();
  });

  it('names only the depleted ingredient when an item has more than one', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 0, lowStockThreshold: 100 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: beans.id, qtyPerUnit: 18 } });

    await recomputeAvailabilityForIngredient(db, beans.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Coffee Beans');
  });

  it('does not touch the manual available flag', async () => {
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id, available: false } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });

    await recomputeAvailabilityForIngredient(db, milk.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.available).toBe(false);
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-availability.test.ts`
Expected: FAIL — `Cannot find module '@/server/stock/availability'` (the file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

```ts
// src/server/stock/availability.ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-availability.test.ts`
Expected: PASS (4/4).

- [ ] **Step 5: Commit**

```bash
git add src/server/stock/availability.ts tests/integration/stock-availability.test.ts
git commit -m "feat: add recomputeAvailabilityForIngredient"
```

---

### Task 3: Wire into `ingredient.adjustStock` and `ingredient.setRecipe`

**Files:**
- Modify: `src/server/trpc/routers/ingredient.ts` (full current content shown below)
- Test: `tests/integration/ingredient-router.test.ts`

**Interfaces:**
- Consumes: `recomputeAvailabilityForIngredient` from Task 2 (`@/server/stock/availability`).

- [ ] **Step 1: Write the failing test**

Current full content of `tests/integration/ingredient-router.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('ingredient router', () => {
  beforeEach(resetDb);

  it('creates an ingredient, adjusts stock, and attaches a recipe', async () => {
    await db.user.create({ data: { id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const menuItem = await db.menuItem.create({
      data: { name: 'Latte', price: 4.5, categoryId: category.id },
    });

    const milk = await admin.ingredient.create({ name: 'Milk', unit: 'ml', stockQty: 5000, lowStockThreshold: 1000 });
    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -200, reason: 'MANUAL_ADJUST' });

    const afterAdjust = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(afterAdjust.stockQty)).toBe(4800);

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });
    const recipes = await db.recipe.findMany({ where: { menuItemId: menuItem.id } });
    expect(recipes).toHaveLength(1);
  });
});
```

Add two new `it` blocks after the existing one (before the final closing `});`), so the file's tail reads:

```ts
    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });
    const recipes = await db.recipe.findMany({ where: { menuItemId: menuItem.id } });
    expect(recipes).toHaveLength(1);
  });

  it('auto-marks an item out of stock when adjustStock depletes its ingredient', async () => {
    await db.user.create({ data: { id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const menuItem = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 100, lowStockThreshold: 200 } });
    await db.recipe.create({ data: { menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 100 } });

    await admin.ingredient.adjustStock({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: menuItem.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('auto-recomputes availability when setRecipe links an already-depleted ingredient', async () => {
    await db.user.create({ data: { id: 'u1', name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const menuItem = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 0, lowStockThreshold: 200 } });

    await admin.ingredient.setRecipe({ menuItemId: menuItem.id, ingredientId: milk.id, qtyPerUnit: 200 });

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: menuItem.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/ingredient-router.test.ts`
Expected: the first test still passes, the two new ones FAIL (`outOfStockReason` stays `null` since nothing calls the recompute yet).

- [ ] **Step 3: Wire the recompute into both mutations**

Current full content of `src/server/trpc/routers/ingredient.ts`:

```ts
import { z } from 'zod';
import { router, roleProcedure } from '../trpc';

export const ingredientRouter = router({
  list: roleProcedure('ADMIN').query(({ ctx }) => ctx.db.ingredient.findMany()),

  create: roleProcedure('ADMIN')
    .input(z.object({
      name: z.string().min(1),
      unit: z.string().min(1),
      stockQty: z.number().default(0),
      lowStockThreshold: z.number(),
    }))
    .mutation(({ ctx, input }) => ctx.db.ingredient.create({ data: input })),

  adjustStock: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction([
        ctx.db.ingredient.update({
          where: { id: input.ingredientId },
          data: { stockQty: { increment: input.delta } },
        }),
        ctx.db.stockMovement.create({
          data: {
            ingredientId: input.ingredientId,
            delta: input.delta,
            reason: input.reason,
            createdById: ctx.user.userId,
          },
        }),
      ]);
      return { ok: true };
    }),

  setRecipe: roleProcedure('ADMIN')
    .input(z.object({
      menuItemId: z.string(),
      ingredientId: z.string(),
      qtyPerUnit: z.number().positive(),
    }))
    .mutation(({ ctx, input }) =>
      ctx.db.recipe.upsert({
        where: { menuItemId_ingredientId: { menuItemId: input.menuItemId, ingredientId: input.ingredientId } },
        create: input,
        update: { qtyPerUnit: input.qtyPerUnit },
      })
    ),
});
```

Replace it with:

```ts
import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { recomputeAvailabilityForIngredient } from '../../stock/availability';

export const ingredientRouter = router({
  list: roleProcedure('ADMIN').query(({ ctx }) => ctx.db.ingredient.findMany()),

  create: roleProcedure('ADMIN')
    .input(z.object({
      name: z.string().min(1),
      unit: z.string().min(1),
      stockQty: z.number().default(0),
      lowStockThreshold: z.number(),
    }))
    .mutation(({ ctx, input }) => ctx.db.ingredient.create({ data: input })),

  adjustStock: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        await tx.ingredient.update({
          where: { id: input.ingredientId },
          data: { stockQty: { increment: input.delta } },
        });
        await tx.stockMovement.create({
          data: {
            ingredientId: input.ingredientId,
            delta: input.delta,
            reason: input.reason,
            createdById: ctx.user.userId,
          },
        });
        await recomputeAvailabilityForIngredient(tx, input.ingredientId);
      });
      return { ok: true };
    }),

  setRecipe: roleProcedure('ADMIN')
    .input(z.object({
      menuItemId: z.string(),
      ingredientId: z.string(),
      qtyPerUnit: z.number().positive(),
    }))
    .mutation(async ({ ctx, input }) =>
      ctx.db.$transaction(async (tx) => {
        const recipe = await tx.recipe.upsert({
          where: { menuItemId_ingredientId: { menuItemId: input.menuItemId, ingredientId: input.ingredientId } },
          create: input,
          update: { qtyPerUnit: input.qtyPerUnit },
        });
        await recomputeAvailabilityForIngredient(tx, input.ingredientId);
        return recipe;
      })
    ),
});
```

`adjustStock` changes from the array form of `$transaction` to the interactive callback form (`async (tx) => {...}`) because the array form can't accommodate a third, dependent async call using the same transaction handle — the recompute needs to run after the stock update commits within the same atomic transaction, using `tx` (not `ctx.db`) so it sees the just-written `stockQty`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/ingredient-router.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Commit**

```bash
git add src/server/trpc/routers/ingredient.ts tests/integration/ingredient-router.test.ts
git commit -m "feat: recompute item availability on stock adjust and recipe changes"
```

---

### Task 4: Wire into `deductStockForOrder` and `revertStockForOrder`

**Files:**
- Modify: `src/server/stock/deduct.ts` (full current content shown below)
- Test: `tests/integration/stock-deduct.test.ts`

**Interfaces:**
- Consumes: `recomputeAvailabilityForIngredient` from Task 2.

- [ ] **Step 1: Write the failing tests**

Current full content of `tests/integration/stock-deduct.test.ts`:

```ts
// tests/integration/stock-deduct.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { deductStockForOrder, revertStockForOrder } from '@/server/stock/deduct';

describe('stock deduction', () => {
  beforeEach(resetDb);

  async function seedOrder() {
    const admin = await db.user.create({ data: { name: 'Admin', role: 'ADMIN', pinHash: 'x' } });
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    const order = await db.order.create({
      data: {
        type: 'TAKEAWAY', status: 'SENT_TO_KITCHEN', source: 'STAFF', total: 9,
        items: { create: [{ menuItemId: item.id, qty: 2, unitPrice: 4.5 }] },
      },
    });
    return { admin, milk, order };
  }

  it('deducts ingredient stock per recipe and records a StockMovement', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(db, order.id, admin.id);

    const afterDeduct = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(afterDeduct.stockQty)).toBe(600); // 1000 - (200 * 2)

    const movements = await db.stockMovement.findMany({ where: { refOrderId: order.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe('SALE');
  });

  it('allows stock to go negative rather than blocking', async () => {
    const { admin, milk, order } = await seedOrder();
    await db.ingredient.update({ where: { id: milk.id }, data: { stockQty: 100 } });

    await deductStockForOrder(db, order.id, admin.id);
    const afterDeduct = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(afterDeduct.stockQty)).toBe(-300); // 100 - 400, allowed negative
  });

  it('reverts a deduction', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(db, order.id, admin.id);
    await revertStockForOrder(db, order.id, admin.id);

    const reverted = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(reverted.stockQty)).toBe(1000);
  });
});
```

Add two new `it` blocks after the existing three (before the final closing `});`), so the file's tail reads:

```ts
  it('reverts a deduction', async () => {
    const { admin, milk, order } = await seedOrder();
    await deductStockForOrder(db, order.id, admin.id);
    await revertStockForOrder(db, order.id, admin.id);

    const reverted = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(reverted.stockQty)).toBe(1000);
  });

  it('auto-marks the item out of stock when a deduction depletes its ingredient', async () => {
    const { admin, milk, order, item } = await (async () => {
      const seeded = await seedOrder();
      const item = await db.menuItem.findFirstOrThrow({ where: { name: 'Latte' } });
      return { ...seeded, item };
    })();
    await db.ingredient.update({ where: { id: milk.id }, data: { stockQty: 400 } }); // exactly enough for this order

    await deductStockForOrder(db, order.id, admin.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBe('Out of stock: Milk');
  });

  it('auto-clears the item when reverting a deduction restores enough stock', async () => {
    const { admin, milk, order, item } = await (async () => {
      const seeded = await seedOrder();
      const item = await db.menuItem.findFirstOrThrow({ where: { name: 'Latte' } });
      return { ...seeded, item };
    })();
    await db.ingredient.update({ where: { id: milk.id }, data: { stockQty: 400 } });
    await deductStockForOrder(db, order.id, admin.id);

    await revertStockForOrder(db, order.id, admin.id);

    const updated = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updated.outOfStockReason).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-deduct.test.ts`
Expected: the first three tests still pass, the two new ones FAIL.

- [ ] **Step 3: Wire the recompute into both functions**

Current full content of `src/server/stock/deduct.ts`:

```ts
// src/server/stock/deduct.ts
import type { PrismaClient, Prisma } from '@prisma/client';

// Accepts either a plain PrismaClient or an interactive-transaction client
// (Prisma.TransactionClient) so callers can run this as part of a larger
// atomic transaction (e.g. payment.payCash, order.cancel). Prisma does not
// support nested $transaction calls on a transaction client, so this
// function deliberately does NOT wrap its writes in its own $transaction —
// it just awaits each Prisma call in sequence. When `db` is a transaction
// client, those calls run inside the caller's ambient transaction and are
// atomic with it. When `db` is a plain PrismaClient (e.g. called directly,
// as some tests do), the calls execute sequentially but are not atomic
// among themselves; callers that need that guarantee should wrap their own
// call in db.$transaction(async (tx) => { ... }).
export async function deductStockForOrder(
  db: Prisma.TransactionClient | PrismaClient,
  orderId: string,
  userId: string
): Promise<void> {
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

  for (const [ingredientId, qty] of deductions.entries()) {
    await db.ingredient.update({ where: { id: ingredientId }, data: { stockQty: { decrement: qty } } });
    await db.stockMovement.create({
      data: { ingredientId, delta: -qty, reason: 'SALE', refOrderId: orderId, createdById: userId },
    });
  }
}

export async function revertStockForOrder(
  db: Prisma.TransactionClient | PrismaClient,
  orderId: string,
  userId: string
): Promise<void> {
  const movements = await db.stockMovement.findMany({ where: { refOrderId: orderId, reason: 'SALE' } });

  for (const m of movements) {
    await db.ingredient.update({ where: { id: m.ingredientId }, data: { stockQty: { increment: Number(m.delta) * -1 } } });
    await db.stockMovement.create({
      data: {
        ingredientId: m.ingredientId,
        delta: Number(m.delta) * -1,
        reason: 'VOID_REVERT',
        refOrderId: orderId,
        createdById: userId,
      },
    });
  }
}
```

Replace it with:

```ts
// src/server/stock/deduct.ts
import type { PrismaClient, Prisma } from '@prisma/client';
import { recomputeAvailabilityForIngredient } from './availability';

// Accepts either a plain PrismaClient or an interactive-transaction client
// (Prisma.TransactionClient) so callers can run this as part of a larger
// atomic transaction (e.g. payment.payCash, order.cancel). Prisma does not
// support nested $transaction calls on a transaction client, so this
// function deliberately does NOT wrap its writes in its own $transaction —
// it just awaits each Prisma call in sequence. When `db` is a transaction
// client, those calls run inside the caller's ambient transaction and are
// atomic with it. When `db` is a plain PrismaClient (e.g. called directly,
// as some tests do), the calls execute sequentially but are not atomic
// among themselves; callers that need that guarantee should wrap their own
// call in db.$transaction(async (tx) => { ... }).
export async function deductStockForOrder(
  db: Prisma.TransactionClient | PrismaClient,
  orderId: string,
  userId: string
): Promise<void> {
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

  for (const [ingredientId, qty] of deductions.entries()) {
    await db.ingredient.update({ where: { id: ingredientId }, data: { stockQty: { decrement: qty } } });
    await db.stockMovement.create({
      data: { ingredientId, delta: -qty, reason: 'SALE', refOrderId: orderId, createdById: userId },
    });
    await recomputeAvailabilityForIngredient(db, ingredientId);
  }
}

export async function revertStockForOrder(
  db: Prisma.TransactionClient | PrismaClient,
  orderId: string,
  userId: string
): Promise<void> {
  const movements = await db.stockMovement.findMany({ where: { refOrderId: orderId, reason: 'SALE' } });

  for (const m of movements) {
    await db.ingredient.update({ where: { id: m.ingredientId }, data: { stockQty: { increment: Number(m.delta) * -1 } } });
    await db.stockMovement.create({
      data: {
        ingredientId: m.ingredientId,
        delta: Number(m.delta) * -1,
        reason: 'VOID_REVERT',
        refOrderId: orderId,
        createdById: userId,
      },
    });
    await recomputeAvailabilityForIngredient(db, m.ingredientId);
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-deduct.test.ts`
Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add src/server/stock/deduct.ts tests/integration/stock-deduct.test.ts
git commit -m "feat: recompute item availability on order stock deduction/reversion"
```

---

### Task 5: Update `menu.ts` — filter and type

**Files:**
- Modify: `src/server/trpc/routers/menu.ts:31-65` (the `MenuItemWithCategory` type and `listAvailable`)
- Test: `tests/integration/menu-router.test.ts`

**Interfaces:**
- Produces: `MenuItemWithCategory` now includes `outOfStockReason: string | null`. Tasks 6 and 7's frontend code depend on this field being present on `menu.listAll`'s and `menu.listAvailable`'s response type.

- [ ] **Step 1: Write the failing test**

Read the current full content of `tests/integration/menu-router.test.ts` first (it was last modified by a prior feature and already has 5 `it` blocks). Add one new `it` block right before the file's final closing `});`:

```ts
  it('excludes an auto-detected-out-of-stock item from listAvailable', async () => {
    const admin = appRouter.createCaller({ db, user: { userId: 'u1', role: 'ADMIN', name: 'A' } });
    const anon = appRouter.createCaller({ db, user: null });
    const category = await admin.menu.createCategory({ name: 'Coffee', sortOrder: 1 });
    const item = await admin.menu.createItem({
      name: 'Latte', price: 4.5, categoryId: category.id, available: true,
    });
    await db.menuItem.update({ where: { id: item.id }, data: { outOfStockReason: 'Out of stock: Milk' } });

    const available = await anon.menu.listAvailable();
    expect(available.map((i) => i.id)).not.toContain(item.id);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/menu-router.test.ts`
Expected: FAIL — `listAvailable` still returns the item, since its filter doesn't check `outOfStockReason` yet.

- [ ] **Step 3: Update the type and the filter**

In `src/server/trpc/routers/menu.ts`, the `MenuItemWithCategory` type currently reads:

```ts
type MenuItemWithCategory = {
  id: string;
  name: string;
  price: Prisma.Decimal;
  categoryId: string;
  available: boolean;
  image: string | null;
  modifiers: Prisma.JsonValue;
  category: {
    id: string;
    name: string;
    sortOrder: number;
  };
};
```

Add the new field so it reads:

```ts
type MenuItemWithCategory = {
  id: string;
  name: string;
  price: Prisma.Decimal;
  categoryId: string;
  available: boolean;
  outOfStockReason: string | null;
  image: string | null;
  modifiers: Prisma.JsonValue;
  category: {
    id: string;
    name: string;
    sortOrder: number;
  };
};
```

No `select` needs updating anywhere in this file — `listAll` and `listAvailable` both use Prisma's default scalar selection (no explicit `select`), so `outOfStockReason` is already included in every query's actual returned row; only the hand-written type annotation needed to catch up.

Then change `listAvailable`'s `where` clause from:

```ts
  listAvailable: publicProcedure.query(
    ({ ctx }): Promise<MenuItemWithCategory[]> =>
      ctx.db.menuItem.findMany({
        where: { available: true },
        include: { category: true },
        orderBy: { category: { sortOrder: 'asc' } },
      })
  ),
```

to:

```ts
  listAvailable: publicProcedure.query(
    ({ ctx }): Promise<MenuItemWithCategory[]> =>
      ctx.db.menuItem.findMany({
        where: { available: true, outOfStockReason: null },
        include: { category: true },
        orderBy: { category: { sortOrder: 'asc' } },
      })
  ),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/menu-router.test.ts`
Expected: PASS (all tests in the file, including the new one). The pre-existing "public sees only available items" test is unaffected — the items it creates have no recipes, so `outOfStockReason` naturally stays `NULL` on creation, already satisfying the new filter condition.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/menu.ts tests/integration/menu-router.test.ts
git commit -m "feat: exclude auto-detected out-of-stock items from listAvailable"
```

---

### Task 6: Show the reason on `/admin/menu`

**Files:**
- Modify: `src/app/(staff)/admin/menu/page.tsx`

**Interfaces:**
- Consumes: `item.outOfStockReason` from `menu.listAll` (Task 5).

- [ ] **Step 1: Add the reason line**

In `src/app/(staff)/admin/menu/page.tsx`, the item row currently reads (inside the `items.data?.map((item) => (...))` block):

```tsx
                  <div>
                    <span className="font-bold text-sm text-text">{item.name}</span>
                    <span className="text-text-muted text-sm ml-2">Rp {Number(item.price).toLocaleString('id-ID')}</span>
                    <span className={`text-xs font-bold ml-2 ${item.available ? 'text-success' : 'text-warning'}`}>
                      {item.available ? 'available' : 'sold out'}
                    </span>
                  </div>
```

Replace it with:

```tsx
                  <div>
                    <span className="font-bold text-sm text-text">{item.name}</span>
                    <span className="text-text-muted text-sm ml-2">Rp {Number(item.price).toLocaleString('id-ID')}</span>
                    <span className={`text-xs font-bold ml-2 ${item.available ? 'text-success' : 'text-warning'}`}>
                      {item.available ? 'available' : 'sold out'}
                    </span>
                    {item.outOfStockReason && (
                      <div className="text-warning text-xs font-semibold mt-0.5">{item.outOfStockReason}</div>
                    )}
                  </div>
```

This means an item can show both the manual "sold out" label and the auto reason simultaneously if both apply — intentional, matches the spec's "both signals shown distinctly" requirement.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/menu/page.tsx"
git commit -m "feat: show auto sold-out reason on admin menu item rows"
```

---

### Task 7: Enforce and display effective availability on `/pos`

**Files:**
- Modify: `src/app/(staff)/pos/page.tsx`

**Interfaces:**
- Consumes: `item.available` and `item.outOfStockReason` from `menu.listAll` (Task 5).

- [ ] **Step 1: Disable sold-out items in the item grid**

In `src/app/(staff)/pos/page.tsx`, the item grid currently reads:

```tsx
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
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
                  <div className="font-extrabold text-accent-tint text-sm">Rp {Number(item.price).toLocaleString('id-ID')}</div>
                  <Button variant="dark" size="sm" onClick={() => addToCart(item.id)}>
                    + Add
                  </Button>
                </div>
              </Card>
            ))}
          </div>
```

Replace it with:

```tsx
          <div className="grid gap-3.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
            {visibleItems.map((item) => {
              const effectivelyAvailable = item.available && !item.outOfStockReason;
              return (
                <Card key={item.id} className={`flex flex-col gap-2.5 ${effectivelyAvailable ? '' : 'opacity-50'}`}>
                  <MenuItemThumbnail
                    image={item.image}
                    categoryName={item.category.name}
                    alt={item.name}
                    className="w-full h-20 rounded-xl"
                  />
                  <div className="font-bold text-text text-sm">{item.name}</div>
                  <div className="flex items-center justify-between gap-2">
                    {effectivelyAvailable ? (
                      <div className="font-extrabold text-accent-tint text-sm">Rp {Number(item.price).toLocaleString('id-ID')}</div>
                    ) : (
                      <div className="text-warning text-xs font-semibold">{item.outOfStockReason ?? 'Sold out'}</div>
                    )}
                    <Button variant="dark" size="sm" disabled={!effectivelyAvailable} onClick={() => addToCart(item.id)}>
                      + Add
                    </Button>
                  </div>
                </Card>
              );
            })}
          </div>
```

This closes an existing gap: `/pos` previously had no availability check at all, so a staff member could add a manually-sold-out item to an order. Now both the manual `available` flag and the auto-detected `outOfStockReason` block adding the item, and the reason (auto) or generic "Sold out" (manual only) shows in place of the price.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/pos/page.tsx"
git commit -m "fix: disable sold-out items in POS item grid, show the reason"
```

---

### Task 8: Final verification

**Files:** none (verification only)

**Interfaces:** none

- [ ] **Step 1: Run the full test suite**

```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" \
JWT_SECRET="dev-secret-change-in-prod" \
S3_ENDPOINT="http://localhost:9000" \
S3_ACCESS_KEY="minioadmin" \
S3_SECRET_KEY="minioadmin" \
S3_BUCKET="menu-images" \
npm test
```
Expected: all tests pass, including the 9 new ones added across Tasks 2-5 (4 + 2 + 2 + 1).

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds cleanly.

- [ ] **Step 3: Manually verify the end-to-end flow against a running dev server**

No browser automation is available in this session — use this project's established technique: start `npm run dev` (or use an already-running instance on port 3000), log in as ADMIN (PIN 1234), then drive the flow via real HTTP requests:

1. Pick one seeded ingredient that's used by exactly one seeded menu item with no other ingredients competing (check `prisma/seed.ts` for a simple single-ingredient item, e.g. "Espresso" → "Coffee Beans" only) — call `ingredient.adjustStock` with a `delta` large enough to bring that ingredient's `stockQty` to exactly `0` or below.
2. `GET` `menu.listAll` (authenticated) and confirm that item's `outOfStockReason` is now set and names the ingredient.
3. `GET` `menu.listAvailable` (public, unauthenticated) and confirm that item is no longer in the list.
4. Fetch `/pos` while authenticated and confirm the rendered HTML shows the item's card with reduced opacity and the reason text (grep for the exact reason string in the response body).
5. Call `ingredient.adjustStock` again with a positive `delta` to restock it back above zero, then repeat step 2 and confirm `outOfStockReason` is back to `null`.
6. As a manual/auto-independence check: call `menu.updateItem` on a *different* seeded item with `available: false` (no ingredient depletion involved), confirm it does NOT get an `outOfStockReason`, and confirm it's still excluded from `listAvailable` purely via the manual flag.

Expected: every step matches the spec's behavior exactly.

- [ ] **Step 4: Restore the ingredient's stock level**

Whatever ingredient was adjusted in Step 3.1/3.5 must end at its original seeded `stockQty` value (check `prisma/seed.ts` for that ingredient's seeded quantity) so `pos_dev` isn't left in a different state than the rest of the seed data. Use `ingredient.adjustStock` with a `delta` that brings it back to the exact original value, or re-run `prisma db seed` against `pos_dev` if simpler — either way, confirm the final `stockQty` matches the seed file's value before finishing.

---
