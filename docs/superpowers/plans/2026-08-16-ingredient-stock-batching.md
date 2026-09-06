# Ingredient Stock Batching & Review Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace immediate-apply ingredient stock adjustments with a stage → review → confirm flow, persisted server-side, plus a browsable accounting history of past batches.

**Architecture:** Two new Prisma models (`StockAdjustmentBatch`, `StockAdjustmentLine`) hold proposed-but-not-yet-applied stock changes, with a DB-level partial unique index guaranteeing at most one `PENDING` batch exists at a time. A new `stockBatch` tRPC router exposes stage/remove/note/confirm/cancel/history operations. Three pages: the rebuilt `/admin/ingredients` (staging), a new `/admin/ingredients/review` (the read-only change report + Confirm/Cancel), and a new `/admin/ingredients/history` (accounting record).

**Tech Stack:** Existing Prisma/tRPC/Next.js stack, no new dependencies.

## Global Constraints

- `StockAdjustmentBatch.status`: `PENDING | CONFIRMED | CANCELLED`. At most one `PENDING` batch ever exists — enforced by both application logic (`stageChange` finds-or-creates) and a hand-written partial unique index (Prisma's schema DSL can't express this directly).
- `StockAdjustmentLine.reason` reuses the existing `StockReason` enum, but `stageChange`'s Zod input restricts callers to `MANUAL_ADJUST` / `RESTOCK` only — `SALE`/`VOID_REVERT` stay exclusively system-generated.
- `@@unique([batchId, ingredientId])` on `StockAdjustmentLine`: re-staging the same ingredient updates that line, never duplicates it.
- Removing a batch's last line deletes the (still-`PENDING`) batch entirely — an empty pending batch has no accounting meaning and would block staging a fresh one.
- `cancel` never deletes a batch or its lines — kept for the accounting history, just marked `CANCELLED`.
- `confirm` applies every line atomically in one transaction: increment `Ingredient.stockQty`, write one `StockMovement` per line, call `recomputeAvailabilityForIngredient` per ingredient (same three-step pattern `ingredient.adjustStock` already uses).
- `listHistory` must never leak `User.pinHash` — select only `{ id, name }` on the `createdBy`/`confirmedBy` relations, never `include: true`.
- All `stockBatch` procedures are `roleProcedure('ADMIN')` — matches this project's existing convention that all of `ingredientRouter` is ADMIN-only.
- Database safety: any `npm test` / `prisma migrate` / `prisma db seed` command must set `DATABASE_URL` explicitly on the command itself — never rely on a prior `source .env` (it points at `pos_dev`, the real dev database).

---

### Task 1: Schema + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_stock_adjustment_batching/migration.sql`

**Interfaces:**
- Produces: `StockAdjustmentBatch`, `StockAdjustmentLine`, `StockBatchStatus` on the Prisma Client — every later task's TypeScript code depends on these existing.

- [ ] **Step 1: Add the new enum and models to `prisma/schema.prisma`**

Add this new enum near the other enums (after `StockReason`, which currently ends the enum block before `model Store`):

```prisma
enum StockBatchStatus {
  PENDING
  CONFIRMED
  CANCELLED
}
```

Add these two new models at the end of the file, after the existing `StockMovement` model:

```prisma
model StockAdjustmentBatch {
  id            String            @id @default(cuid())
  status        StockBatchStatus  @default(PENDING)
  note          String?
  createdAt     DateTime          @default(now())
  createdById   String
  createdBy     User              @relation("BatchCreatedBy", fields: [createdById], references: [id])
  confirmedAt   DateTime?
  confirmedById String?
  confirmedBy   User?             @relation("BatchConfirmedBy", fields: [confirmedById], references: [id])

  lines StockAdjustmentLine[]
}

model StockAdjustmentLine {
  id           String     @id @default(cuid())
  batchId      String
  batch        StockAdjustmentBatch @relation(fields: [batchId], references: [id])
  ingredientId String
  ingredient   Ingredient @relation(fields: [ingredientId], references: [id])
  delta        Decimal    @db.Decimal(10, 3)
  reason       StockReason

  @@unique([batchId, ingredientId])
}
```

Modify the existing `User` model (currently ending with `stockMoves StockMovement[]`) to add two new relations, so it reads:

```prisma
model User {
  id        String   @id @default(cuid())
  name      String
  pinHash   String
  role      Role
  active    Boolean  @default(true)
  createdAt DateTime @default(now())

  ordersCreated Order[]         @relation("OrderCreatedBy")
  payments      Payment[]
  stockMoves    StockMovement[]
  createdBatches   StockAdjustmentBatch[] @relation("BatchCreatedBy")
  confirmedBatches StockAdjustmentBatch[] @relation("BatchConfirmedBy")
}
```

Modify the existing `Ingredient` model (currently ending with `movements StockMovement[]`) to add the new relation, so it reads:

```prisma
model Ingredient {
  id                String   @id @default(cuid())
  name              String
  unit              String
  stockQty          Decimal  @db.Decimal(10, 3)
  lowStockThreshold Decimal  @db.Decimal(10, 3)

  recipes   Recipe[]
  movements StockMovement[]
  adjustmentLines StockAdjustmentLine[]
}
```

- [ ] **Step 2: Create the migration**

Get a timestamp: `date -u +"%Y%m%d%H%M%S"`. Create the directory `prisma/migrations/<that-timestamp>_add_stock_adjustment_batching/` and write `migration.sql` inside it:

```sql
-- CreateEnum
CREATE TYPE "StockBatchStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockAdjustmentBatch" (
    "id" TEXT NOT NULL,
    "status" "StockBatchStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,

    CONSTRAINT "StockAdjustmentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "delta" DECIMAL(10,3) NOT NULL,
    "reason" "StockReason" NOT NULL,

    CONSTRAINT "StockAdjustmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustmentLine_batchId_ingredientId_key" ON "StockAdjustmentLine"("batchId", "ingredientId");

-- Ensure at most one PENDING batch exists at a time. Not expressible via
-- Prisma's schema DSL (no partial/filtered unique index support), so this
-- index is added by hand.
CREATE UNIQUE INDEX "one_pending_stock_batch" ON "StockAdjustmentBatch" ((status)) WHERE status = 'PENDING';

-- AddForeignKey
ALTER TABLE "StockAdjustmentBatch" ADD CONSTRAINT "StockAdjustmentBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentBatch" ADD CONSTRAINT "StockAdjustmentBatch_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockAdjustmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
```

- [ ] **Step 3: Regenerate the Prisma Client and apply the migration**

```bash
npx prisma generate
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_dev" npx prisma migrate deploy
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx prisma migrate deploy
```
Expected: both report the new migration applied successfully. This is additive (new tables/enum only, no existing column touched) — no data loss, no reset needed.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: succeeds — nothing references the new models in application code yet, this just confirms the schema/client regenerate cleanly.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add StockAdjustmentBatch/Line models for staged stock changes"
```

---

### Task 2: `stockBatch` router — `getPending` + `stageChange`

**Files:**
- Create: `src/server/trpc/routers/stockBatch.ts`
- Modify: `src/server/trpc/routers/_app.ts`
- Test: `tests/integration/stock-batch-router.test.ts`

**Interfaces:**
- Produces: `stockBatch.getPending` (query, returns the `PENDING` batch with `lines` → `ingredient` included, or `null`), `stockBatch.stageChange` (mutation, input `{ ingredientId: string; delta: number; reason: 'MANUAL_ADJUST' | 'RESTOCK' }`, returns `{ ok: true }`). Tasks 3-5 add more procedures to this same file. Task 6-7's frontend consume both.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/integration/stock-batch-router.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { db } from '@/server/db';
import { resetDb } from '../helpers/db';
import { appRouter } from '@/server/trpc/routers/_app';
import { hashPin } from '@/server/auth/pin';

describe('stock batch router', () => {
  beforeEach(resetDb);

  async function adminCaller() {
    const user = await db.user.create({ data: { name: 'Admin', role: 'ADMIN', pinHash: await hashPin('1234') } });
    return appRouter.createCaller({ db, user: { userId: user.id, role: user.role, name: user.name } });
  }

  it('getPending returns null when there is no pending batch', async () => {
    const admin = await adminCaller();
    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('stageChange creates a pending batch with one line', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });

    const pending = await admin.stockBatch.getPending();
    expect(pending).not.toBeNull();
    expect(pending?.status).toBe('PENDING');
    expect(pending?.lines).toHaveLength(1);
    expect(pending?.lines[0].ingredientId).toBe(milk.id);
    expect(Number(pending?.lines[0].delta)).toBe(500);
  });

  it('a second stageChange for a different ingredient adds a second line to the same batch', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const firstBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const secondBatch = await admin.stockBatch.getPending();

    expect(secondBatch?.id).toBe(firstBatch?.id);
    expect(secondBatch?.lines).toHaveLength(2);
  });

  it('re-staging the same ingredient updates the existing line instead of duplicating it', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -50, reason: 'MANUAL_ADJUST' });

    const pending = await admin.stockBatch.getPending();
    expect(pending?.lines).toHaveLength(1);
    expect(Number(pending?.lines[0].delta)).toBe(-50);
    expect(pending?.lines[0].reason).toBe('MANUAL_ADJUST');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: FAIL — `Cannot find module '@/server/trpc/routers/stockBatch'` or `appRouter.stockBatch is not a function` (the router doesn't exist yet).

- [ ] **Step 3: Create the router**

```ts
// src/server/trpc/routers/stockBatch.ts
import { z } from 'zod';
import { router, roleProcedure } from '../trpc';

export const stockBatchRouter = router({
  getPending: roleProcedure('ADMIN').query(({ ctx }) =>
    ctx.db.stockAdjustmentBatch.findFirst({
      where: { status: 'PENDING' },
      include: { lines: { include: { ingredient: true } } },
    })
  ),

  stageChange: roleProcedure('ADMIN')
    .input(z.object({
      ingredientId: z.string(),
      delta: z.number(),
      reason: z.enum(['MANUAL_ADJUST', 'RESTOCK']),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        let batch = await tx.stockAdjustmentBatch.findFirst({ where: { status: 'PENDING' } });
        if (!batch) {
          batch = await tx.stockAdjustmentBatch.create({
            data: { status: 'PENDING', createdById: ctx.user.userId },
          });
        }
        await tx.stockAdjustmentLine.upsert({
          where: { batchId_ingredientId: { batchId: batch.id, ingredientId: input.ingredientId } },
          create: {
            batchId: batch.id,
            ingredientId: input.ingredientId,
            delta: input.delta,
            reason: input.reason,
          },
          update: { delta: input.delta, reason: input.reason },
        });
      });
      return { ok: true };
    }),
});
```

- [ ] **Step 4: Register the router in `_app.ts`**

Current full content of `src/server/trpc/routers/_app.ts`:

```ts
import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';
import { ingredientRouter } from './ingredient';
import { tableRouter } from './table';
import { orderRouter } from './order';
import { kitchenRouter } from './kitchen';
import { paymentRouter } from './payment';
import { reportRouter } from './report';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
  ingredient: ingredientRouter,
  table: tableRouter,
  order: orderRouter,
  kitchen: kitchenRouter,
  payment: paymentRouter,
  report: reportRouter,
});

export type AppRouter = typeof appRouter;
```

Replace it with:

```ts
import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';
import { ingredientRouter } from './ingredient';
import { tableRouter } from './table';
import { orderRouter } from './order';
import { kitchenRouter } from './kitchen';
import { paymentRouter } from './payment';
import { reportRouter } from './report';
import { stockBatchRouter } from './stockBatch';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
  ingredient: ingredientRouter,
  table: tableRouter,
  order: orderRouter,
  kitchen: kitchenRouter,
  payment: paymentRouter,
  report: reportRouter,
  stockBatch: stockBatchRouter,
});

export type AppRouter = typeof appRouter;
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: PASS (4/4).

- [ ] **Step 6: Run the build**

Run: `npm run build`
Expected: succeeds. If TypeScript reports "Type instantiation is excessively deep" (TS2589) on `getPending`'s inferred return type, that's a known class of issue this project has hit before on `Prisma.JsonValue`-containing types — but `StockAdjustmentBatch`/`StockAdjustmentLine`/`Ingredient` have no JSON fields anywhere in this chain, so this is not expected to occur. If it somehow does, stop and report — do not silently add a workaround type without understanding why, since this shape genuinely shouldn't trigger it.

- [ ] **Step 7: Commit**

```bash
git add src/server/trpc/routers/stockBatch.ts src/server/trpc/routers/_app.ts tests/integration/stock-batch-router.test.ts
git commit -m "feat: add stockBatch router with getPending and stageChange"
```

---

### Task 3: `stockBatch` router — `removeLine` + `setNote`

**Files:**
- Modify: `src/server/trpc/routers/stockBatch.ts`
- Test: `tests/integration/stock-batch-router.test.ts`

**Interfaces:**
- Produces: `stockBatch.removeLine` (mutation, input `{ lineId: string }`), `stockBatch.setNote` (mutation, input `{ batchId: string; note: string }`).

- [ ] **Step 1: Write the failing tests**

Add these three `it` blocks inside the existing `describe('stock batch router', ...)` block in `tests/integration/stock-batch-router.test.ts`, after the last existing test (before the closing `});`):

```ts
  it('removeLine removes one line but keeps the batch when other lines remain', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    const milkLine = batch!.lines.find((l) => l.ingredientId === milk.id)!;

    await admin.stockBatch.removeLine({ lineId: milkLine.id });

    const afterRemove = await admin.stockBatch.getPending();
    expect(afterRemove?.status).toBe('PENDING');
    expect(afterRemove?.lines).toHaveLength(1);
    expect(afterRemove?.lines[0].ingredientId).toBe(beans.id);
  });

  it('removeLine on the last remaining line deletes the batch entirely', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.removeLine({ lineId: batch!.lines[0].id });

    const afterRemove = await admin.stockBatch.getPending();
    expect(afterRemove).toBeNull();
    const stillExists = await db.stockAdjustmentBatch.findUnique({ where: { id: batch!.id } });
    expect(stillExists).toBeNull();
  });

  it('setNote updates the batch note', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.setNote({ batchId: batch!.id, note: 'Weekly supplier delivery' });

    const updated = await admin.stockBatch.getPending();
    expect(updated?.note).toBe('Weekly supplier delivery');
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: the first 4 tests still pass, the 3 new ones FAIL (`removeLine`/`setNote` don't exist on the router yet).

- [ ] **Step 3: Add the two procedures**

In `src/server/trpc/routers/stockBatch.ts`, add these two procedures inside the `stockBatchRouter` object, after `stageChange` (before the closing `});`):

```ts
  removeLine: roleProcedure('ADMIN')
    .input(z.object({ lineId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        const line = await tx.stockAdjustmentLine.delete({ where: { id: input.lineId } });
        const remaining = await tx.stockAdjustmentLine.count({ where: { batchId: line.batchId } });
        if (remaining === 0) {
          await tx.stockAdjustmentBatch.delete({ where: { id: line.batchId } });
        }
      });
      return { ok: true };
    }),

  setNote: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string(), note: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.stockAdjustmentBatch.update({ where: { id: input.batchId }, data: { note: input.note } })
    ),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Run the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/stockBatch.ts tests/integration/stock-batch-router.test.ts
git commit -m "feat: add removeLine and setNote to stockBatch router"
```

---

### Task 4: `stockBatch` router — `confirm`

**Files:**
- Modify: `src/server/trpc/routers/stockBatch.ts`
- Test: `tests/integration/stock-batch-router.test.ts`

**Interfaces:**
- Consumes: `recomputeAvailabilityForIngredient(db, ingredientId)` from `@/server/stock/availability` (already exists, used by `ingredient.adjustStock`, `deductStockForOrder`, `revertStockForOrder`, `ingredient.setRecipe`).
- Produces: `stockBatch.confirm` (mutation, input `{ batchId: string }`, returns `{ ok: true }`).

- [ ] **Step 1: Write the failing tests**

Add these three `it` blocks inside the existing `describe` block, after the `setNote` test (before the closing `});`):

```ts
  it('confirm applies every line, writes StockMovement rows, and marks the batch CONFIRMED', async () => {
    const admin = await adminCaller();
    const adminUser = await db.user.findFirstOrThrow({ where: { name: 'Admin' } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: -50, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const milkAfter = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(milkAfter.stockQty)).toBe(1500);
    const beansAfter = await db.ingredient.findUniqueOrThrow({ where: { id: beans.id } });
    expect(Number(beansAfter.stockQty)).toBe(450);

    const movements = await db.stockMovement.findMany();
    expect(movements).toHaveLength(2);
    const beansMovement = movements.find((m) => m.ingredientId === beans.id)!;
    expect(beansMovement.reason).toBe('MANUAL_ADJUST');
    expect(Number(beansMovement.delta)).toBe(-50);

    const confirmedBatch = await db.stockAdjustmentBatch.findUniqueOrThrow({ where: { id: batch!.id } });
    expect(confirmedBatch.status).toBe('CONFIRMED');
    expect(confirmedBatch.confirmedById).toBe(adminUser.id);
    expect(confirmedBatch.confirmedAt).not.toBeNull();
  });

  it('confirm removes the batch from getPending (it is no longer PENDING)', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const pending = await admin.stockBatch.getPending();
    expect(pending).toBeNull();
  });

  it('confirm calls the availability recompute for a depleted ingredient', async () => {
    const admin = await adminCaller();
    const category = await db.category.create({ data: { name: 'Coffee', sortOrder: 1 } });
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 100, lowStockThreshold: 200 } });
    const item = await db.menuItem.create({ data: { name: 'Latte', price: 4.5, categoryId: category.id } });
    await db.recipe.create({ data: { menuItemId: item.id, ingredientId: milk.id, qtyPerUnit: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: -100, reason: 'MANUAL_ADJUST' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.confirm({ batchId: batch!.id });

    const updatedItem = await db.menuItem.findUniqueOrThrow({ where: { id: item.id } });
    expect(updatedItem.outOfStockReason).toBe('Out of stock: Milk');
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: the first 7 tests still pass, the 3 new ones FAIL (`confirm` doesn't exist yet).

- [ ] **Step 3: Add the procedure**

In `src/server/trpc/routers/stockBatch.ts`:

Add the import at the top of the file:

```ts
import { recomputeAvailabilityForIngredient } from '../../stock/availability';
```

Add this procedure inside `stockBatchRouter`, after `setNote` (before the closing `});`):

```ts
  confirm: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.$transaction(async (tx) => {
        const batch = await tx.stockAdjustmentBatch.findUniqueOrThrow({
          where: { id: input.batchId },
          include: { lines: true },
        });
        for (const line of batch.lines) {
          await tx.ingredient.update({
            where: { id: line.ingredientId },
            data: { stockQty: { increment: line.delta } },
          });
          await tx.stockMovement.create({
            data: {
              ingredientId: line.ingredientId,
              delta: line.delta,
              reason: line.reason,
              createdById: ctx.user.userId,
            },
          });
          await recomputeAvailabilityForIngredient(tx, line.ingredientId);
        }
        await tx.stockAdjustmentBatch.update({
          where: { id: input.batchId },
          data: { status: 'CONFIRMED', confirmedAt: new Date(), confirmedById: ctx.user.userId },
        });
      });
      return { ok: true };
    }),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: PASS (10/10).

- [ ] **Step 5: Run the build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/stockBatch.ts tests/integration/stock-batch-router.test.ts
git commit -m "feat: add confirm to stockBatch router"
```

---

### Task 5: `stockBatch` router — `cancel` + `listHistory`

**Files:**
- Modify: `src/server/trpc/routers/stockBatch.ts`
- Test: `tests/integration/stock-batch-router.test.ts`

**Interfaces:**
- Produces: `stockBatch.cancel` (mutation, input `{ batchId: string }`), `stockBatch.listHistory` (query, returns batches with `status IN (CONFIRMED, CANCELLED)`, each with `lines` → `ingredient`, `createdBy: { id, name }`, `confirmedBy: { id, name } | null`, newest first).

- [ ] **Step 1: Write the failing tests**

Add these three `it` blocks inside the existing `describe` block, after the last `confirm` test (before the closing `});`):

```ts
  it('cancel marks the batch CANCELLED without applying any stock change', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();

    await admin.stockBatch.cancel({ batchId: batch!.id });

    const milkAfter = await db.ingredient.findUniqueOrThrow({ where: { id: milk.id } });
    expect(Number(milkAfter.stockQty)).toBe(1000);
    const movements = await db.stockMovement.findMany();
    expect(movements).toHaveLength(0);
    const cancelledBatch = await db.stockAdjustmentBatch.findUniqueOrThrow({ where: { id: batch!.id } });
    expect(cancelledBatch.status).toBe('CANCELLED');
  });

  it('listHistory returns confirmed and cancelled batches but never the pending one', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    const beans = await db.ingredient.create({ data: { name: 'Coffee Beans', unit: 'g', stockQty: 500, lowStockThreshold: 100 } });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const confirmedBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: confirmedBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: beans.id, delta: 200, reason: 'RESTOCK' });
    const cancelledBatch = await admin.stockBatch.getPending();
    await admin.stockBatch.cancel({ batchId: cancelledBatch!.id });

    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 10, reason: 'MANUAL_ADJUST' });

    const history = await admin.stockBatch.listHistory();
    expect(history).toHaveLength(2);
    expect(history.map((b) => b.status).sort()).toEqual(['CANCELLED', 'CONFIRMED']);
    expect(history.every((b) => b.status !== 'PENDING')).toBe(true);
  });

  it('listHistory never exposes pinHash on createdBy or confirmedBy', async () => {
    const admin = await adminCaller();
    const milk = await db.ingredient.create({ data: { name: 'Milk', unit: 'ml', stockQty: 1000, lowStockThreshold: 200 } });
    await admin.stockBatch.stageChange({ ingredientId: milk.id, delta: 500, reason: 'RESTOCK' });
    const batch = await admin.stockBatch.getPending();
    await admin.stockBatch.confirm({ batchId: batch!.id });

    const history = await admin.stockBatch.listHistory();
    expect(history[0].createdBy).not.toHaveProperty('pinHash');
    expect(history[0].confirmedBy).not.toHaveProperty('pinHash');
    expect(history[0].createdBy.name).toBe('Admin');
  });
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: the first 10 tests still pass, the 3 new ones FAIL (`cancel`/`listHistory` don't exist yet).

- [ ] **Step 3: Add the two procedures**

In `src/server/trpc/routers/stockBatch.ts`, add these two procedures inside `stockBatchRouter`, after `confirm` (before the closing `});`):

```ts
  cancel: roleProcedure('ADMIN')
    .input(z.object({ batchId: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.stockAdjustmentBatch.update({ where: { id: input.batchId }, data: { status: 'CANCELLED' } })
    ),

  listHistory: roleProcedure('ADMIN').query(({ ctx }) =>
    ctx.db.stockAdjustmentBatch.findMany({
      where: { status: { in: ['CONFIRMED', 'CANCELLED'] } },
      include: {
        lines: { include: { ingredient: true } },
        createdBy: { select: { id: true, name: true } },
        confirmedBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    })
  ),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" npx vitest run tests/integration/stock-batch-router.test.ts`
Expected: PASS (13/13).

- [ ] **Step 5: Run the full suite and the build**

Run: `DATABASE_URL="postgresql://postgres:postgres@localhost:5433/pos_test" JWT_SECRET="dev-secret-change-in-prod" S3_ENDPOINT="http://localhost:9000" S3_ACCESS_KEY="minioadmin" S3_SECRET_KEY="minioadmin" S3_BUCKET="menu-images" npm test`
Expected: all tests pass (existing 50 + 13 new = 63).

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/server/trpc/routers/stockBatch.ts tests/integration/stock-batch-router.test.ts
git commit -m "feat: add cancel and listHistory to stockBatch router"
```

---

### Task 6: Fix initial stock + rebuild `/admin/ingredients`

**Files:**
- Modify: `src/app/(staff)/admin/ingredients/page.tsx` (full replacement)

**Interfaces:**
- Consumes: `stockBatch.getPending`, `stockBatch.stageChange` (Task 2), `Popover` from `@/components/ui/Popover`, `Select` from `@/components/ui/Select`, `Input` from `@/components/ui/Input`.
- Produces: nothing new consumed by later tasks — Task 7/8 are separate pages under the same route segment.

- [ ] **Step 1: Replace the file**

Current full content of `src/app/(staff)/admin/ingredients/page.tsx`:

```tsx
'use client';
import { useState } from 'react';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export default function AdminIngredientsPage() {
  const utils = trpc.useUtils();
  const ingredients = trpc.ingredient.list.useQuery();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [threshold, setThreshold] = useState('');
  const create = trpc.ingredient.create.useMutation({
    onSuccess: () => { utils.ingredient.list.invalidate(); setName(''); setUnit(''); setThreshold(''); },
  });
  const adjust = trpc.ingredient.adjustStock.useMutation({ onSuccess: () => utils.ingredient.list.invalidate() });

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Ingredients</h1>

      <Card className="mb-5">
        <h2 className="font-bold text-text mb-3">New Ingredient</h2>
        <div className="flex flex-col sm:flex-row gap-2 sm:flex-wrap">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="w-full sm:flex-1 sm:min-w-[140px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Input
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            placeholder="Unit (g, ml, pcs)"
            className="w-full sm:w-40 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Input
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            placeholder="Low-stock threshold"
            type="number"
            className="w-full sm:w-44 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="dark"
            className="w-full sm:w-auto"
            disabled={!name || !unit || !threshold}
            onClick={() => create.mutate({ name, unit, lowStockThreshold: Number(threshold), stockQty: 0 })}
          >
            Add Ingredient
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-bold text-text mb-3">Stock</h2>
        <div className="flex flex-col gap-2">
          {ingredients.data?.map((ing) => {
            const low = Number(ing.stockQty) < Number(ing.lowStockThreshold);
            return (
              <div key={ing.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className={low ? 'text-warning' : 'text-text'}>
                  <span className="font-bold text-sm">{ing.name}</span>
                  <span className="text-sm ml-2">{String(ing.stockQty)} {ing.unit}</span>
                  {low && <span className="text-xs font-extrabold ml-2">LOW STOCK</span>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => adjust.mutate({ ingredientId: ing.id, delta: 100, reason: 'RESTOCK' })}
                >
                  +100 Restock
                </Button>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
```

Replace it entirely with:

```tsx
'use client';
import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Popover } from '@/components/ui/Popover';

type StageReason = 'MANUAL_ADJUST' | 'RESTOCK';

function StageChangePopover({
  ingredientId,
  onStage,
}: {
  ingredientId: string;
  onStage: (input: { ingredientId: string; delta: number; reason: StageReason }) => void;
}) {
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState<StageReason>('RESTOCK');

  return (
    <Popover
      trigger={({ toggle }) => (
        <Button variant="outline" size="sm" onClick={toggle}>
          Stage Change
        </Button>
      )}
    >
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs font-bold text-text-muted-2 block mb-1">Amount</label>
          <Input
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="e.g. 100 or -20"
            type="number"
            className="w-full px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-text-muted-2 block mb-1">Reason</label>
          <Select
            value={reason}
            onChange={(v) => setReason(v as StageReason)}
            options={[
              { value: 'RESTOCK', label: 'Restock' },
              { value: 'MANUAL_ADJUST', label: 'Manual Adjust' },
            ]}
            className="w-full px-3 py-2"
          />
        </div>
        <Button
          variant="dark"
          size="sm"
          disabled={!delta || Number(delta) === 0}
          onClick={() => {
            onStage({ ingredientId, delta: Number(delta), reason });
            setDelta('');
          }}
        >
          Stage
        </Button>
      </div>
    </Popover>
  );
}

export default function AdminIngredientsPage() {
  const utils = trpc.useUtils();
  const ingredients = trpc.ingredient.list.useQuery();
  const pending = trpc.stockBatch.getPending.useQuery();

  const [showNewIngredientForm, setShowNewIngredientForm] = useState(false);
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('');
  const [initialStock, setInitialStock] = useState('');
  const [threshold, setThreshold] = useState('');
  const create = trpc.ingredient.create.useMutation({
    onSuccess: () => {
      utils.ingredient.list.invalidate();
      setName('');
      setUnit('');
      setInitialStock('');
      setThreshold('');
      setShowNewIngredientForm(false);
    },
  });

  const stageChange = trpc.stockBatch.stageChange.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
  });

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-2">
        <h1 className="font-display text-2xl text-text">Ingredients</h1>
        <div className="flex items-center gap-2">
          <Link href="/admin/ingredients/history">
            <Button variant="outline" size="sm">History</Button>
          </Link>
          {!showNewIngredientForm && (
            <Button variant="primary" onClick={() => setShowNewIngredientForm(true)}>
              + New Ingredient
            </Button>
          )}
        </div>
      </div>

      {pending.data && (
        <Card className="mb-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-bold text-text">
              {pending.data.lines.length} pending change{pending.data.lines.length === 1 ? '' : 's'} awaiting confirmation
            </span>
            <Link href="/admin/ingredients/review">
              <Button variant="primary" size="sm">Review Changes</Button>
            </Link>
          </div>
        </Card>
      )}

      {showNewIngredientForm && (
        <Card className="mb-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-text">New Ingredient</h2>
            <Button variant="outline" size="sm" onClick={() => setShowNewIngredientForm(false)}>
              Cancel
            </Button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 sm:flex-wrap">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="w-full sm:flex-1 sm:min-w-[140px] px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="Unit (g, ml, pcs)"
              className="w-full sm:w-32 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={initialStock}
              onChange={(e) => setInitialStock(e.target.value)}
              placeholder="Initial stock"
              type="number"
              min="0"
              className="w-full sm:w-36 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="Low-stock threshold"
              type="number"
              className="w-full sm:w-44 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <Button
              variant="dark"
              className="w-full sm:w-auto"
              disabled={!name || !unit || !threshold}
              onClick={() =>
                create.mutate({
                  name,
                  unit,
                  stockQty: Number(initialStock) || 0,
                  lowStockThreshold: Number(threshold),
                })
              }
            >
              Add Ingredient
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2 className="font-bold text-text mb-3">Stock</h2>
        <div className="flex flex-col gap-2">
          {ingredients.data?.map((ing) => {
            const low = Number(ing.stockQty) < Number(ing.lowStockThreshold);
            return (
              <div key={ing.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div className={low ? 'text-warning' : 'text-text'}>
                  <span className="font-bold text-sm">{ing.name}</span>
                  <span className="text-sm ml-2">{String(ing.stockQty)} {ing.unit}</span>
                  {low && <span className="text-xs font-extrabold ml-2">LOW STOCK</span>}
                </div>
                <StageChangePopover
                  ingredientId={ing.id}
                  onStage={(input) => stageChange.mutate(input)}
                />
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/ingredients/page.tsx"
git commit -m "feat: rebuild admin ingredients page with stock staging and initial-stock field"
```

---

### Task 7: `/admin/ingredients/review` page

**Files:**
- Create: `src/app/(staff)/admin/ingredients/review/page.tsx`

**Interfaces:**
- Consumes: `stockBatch.getPending`, `stockBatch.removeLine`, `stockBatch.setNote`, `stockBatch.confirm`, `stockBatch.cancel` (all from Task 2-5).

- [ ] **Step 1: Create the page**

```tsx
// src/app/(staff)/admin/ingredients/review/page.tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc-client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

export default function IngredientReviewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const pending = trpc.stockBatch.getPending.useQuery();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (pending.data?.note) setNote(pending.data.note);
  }, [pending.data?.note]);

  const removeLine = trpc.stockBatch.removeLine.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
  });
  const setNoteMutation = trpc.stockBatch.setNote.useMutation({
    onSuccess: () => utils.stockBatch.getPending.invalidate(),
  });
  const confirm = trpc.stockBatch.confirm.useMutation({
    onSuccess: () => {
      utils.stockBatch.getPending.invalidate();
      utils.stockBatch.listHistory.invalidate();
      utils.ingredient.list.invalidate();
      router.push('/admin/ingredients');
    },
  });
  const cancel = trpc.stockBatch.cancel.useMutation({
    onSuccess: () => {
      utils.stockBatch.getPending.invalidate();
      utils.stockBatch.listHistory.invalidate();
      router.push('/admin/ingredients');
    },
  });

  if (pending.isLoading) {
    return <div className="p-6 text-text-muted text-sm">Loading…</div>;
  }

  if (!pending.data) {
    return (
      <div className="p-6">
        <p className="text-text-muted text-sm mb-3">No pending changes to review.</p>
        <Link href="/admin/ingredients">
          <Button variant="outline" size="sm">Back to Ingredients</Button>
        </Link>
      </div>
    );
  }

  const batch = pending.data;

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Review Stock Changes</h1>

      <Card className="mb-5">
        <div className="flex flex-col gap-2">
          {batch.lines.map((line) => {
            const current = Number(line.ingredient.stockQty);
            const delta = Number(line.delta);
            return (
              <div key={line.id} className="flex items-center justify-between py-2 border-b border-border last:border-0">
                <div>
                  <span className="font-bold text-sm text-text">{line.ingredient.name}</span>
                  <span className="text-text-muted text-sm ml-2">
                    {current} → {current + delta} {line.ingredient.unit}
                  </span>
                  <span className={`text-xs font-bold ml-2 ${delta >= 0 ? 'text-success' : 'text-warning'}`}>
                    {delta >= 0 ? '+' : ''}{delta} ({line.reason === 'RESTOCK' ? 'Restock' : 'Manual Adjust'})
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => removeLine.mutate({ lineId: line.id })}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      </Card>

      <Card className="mb-5">
        <label className="text-xs font-bold text-text-muted-2 block mb-1">Note (optional)</label>
        <div className="flex gap-2">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Weekly restock from supplier X"
            className="flex-1 px-3 py-2 border border-border-strong rounded-lg bg-surface-input text-sm outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => setNoteMutation.mutate({ batchId: batch.id, note })}
          >
            Save Note
          </Button>
        </div>
      </Card>

      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={confirm.isPending}
          onClick={() => confirm.mutate({ batchId: batch.id })}
        >
          Confirm
        </Button>
        <Button
          variant="outline"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate({ batchId: batch.id })}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/ingredients/review/page.tsx"
git commit -m "feat: add ingredient stock change review page"
```

---

### Task 8: `/admin/ingredients/history` page

**Files:**
- Create: `src/app/(staff)/admin/ingredients/history/page.tsx`

**Interfaces:**
- Consumes: `stockBatch.listHistory` (Task 5).

- [ ] **Step 1: Create the page**

```tsx
// src/app/(staff)/admin/ingredients/history/page.tsx
'use client';
import { trpc } from '@/lib/trpc-client';
import { Card } from '@/components/ui/Card';

export default function IngredientHistoryPage() {
  const history = trpc.stockBatch.listHistory.useQuery();

  return (
    <div className="p-6">
      <h1 className="font-display text-2xl text-text mb-6">Stock Adjustment History</h1>

      <div className="flex flex-col gap-4">
        {history.data?.map((batch) => (
          <Card key={batch.id}>
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <span
                className={`text-xs font-extrabold uppercase px-2 py-1 rounded-full ${
                  batch.status === 'CONFIRMED' ? 'bg-success/15 text-success' : 'bg-border text-text-muted-2'
                }`}
              >
                {batch.status === 'CONFIRMED' ? 'Confirmed' : 'Cancelled'}
              </span>
              <span className="text-xs text-text-muted">
                {new Date(batch.createdAt).toLocaleString('id-ID')}
              </span>
            </div>
            {batch.note && <p className="text-sm text-text mb-2">{batch.note}</p>}
            <div className="flex flex-col gap-1 mb-2">
              {batch.lines.map((line) => (
                <div key={line.id} className="flex justify-between text-sm">
                  <span className="text-text">{line.ingredient.name}</span>
                  <span className={Number(line.delta) >= 0 ? 'text-success' : 'text-warning'}>
                    {Number(line.delta) >= 0 ? '+' : ''}{String(line.delta)} {line.ingredient.unit} ({line.reason === 'RESTOCK' ? 'Restock' : 'Manual Adjust'})
                  </span>
                </div>
              ))}
            </div>
            <div className="text-xs text-text-muted">
              Staged by {batch.createdBy.name}
              {batch.status === 'CONFIRMED' && batch.confirmedBy && ` · Confirmed by ${batch.confirmedBy.name}`}
            </div>
          </Card>
        ))}
        {history.data?.length === 0 && (
          <p className="text-text-muted text-sm text-center py-6">No history yet.</p>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(staff)/admin/ingredients/history/page.tsx"
git commit -m "feat: add ingredient stock adjustment history page"
```

---

### Task 9: End-to-end verification

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
Expected: all tests pass (existing 50 + 13 new from Tasks 2-5 = 63).

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: succeeds cleanly.

- [ ] **Step 3: Manually verify the end-to-end flow against a running dev server**

No browser automation is available in this session — use this project's established technique: start `npm run dev` (or use an already-running instance on port 3000; check first with `lsof -i :3000 -sTCP:LISTEN`), log in as ADMIN (PIN 1234), then drive the flow via real HTTP requests:

1. `POST /api/trpc/auth.login` with `{"pin":"1234"}`, capturing the session cookie.
2. `GET /api/trpc/ingredient.list` and pick one seeded ingredient's id and current `stockQty`.
3. `POST /api/trpc/stockBatch.stageChange` with `{"ingredientId":"<id>","delta":50,"reason":"RESTOCK"}` — confirm 200.
4. `GET /api/trpc/stockBatch.getPending` — confirm it returns a batch with one line matching that ingredient and delta.
5. `POST /api/trpc/stockBatch.confirm` with `{"batchId":"<id from step 4>"}` — confirm 200.
6. `GET /api/trpc/ingredient.list` again — confirm that ingredient's `stockQty` increased by exactly 50 from the value recorded in step 2.
7. `GET /api/trpc/stockBatch.listHistory` — confirm the just-confirmed batch appears with `status: "CONFIRMED"`, the correct line, and `confirmedBy.name` set.
8. Repeat steps 3-4 with a different ingredient and a negative delta, then `POST /api/trpc/stockBatch.cancel` instead of confirm — confirm that ingredient's `stockQty` is unchanged in `ingredient.list`, and the batch shows up in `listHistory` with `status: "CANCELLED"`.

Expected: every step matches the spec's described behavior exactly.

- [ ] **Step 4: Restore any ingredient stock changed during verification**

Steps 3-8 above changed real `pos_dev` ingredient stock levels. For each ingredient touched, check `prisma/seed.ts` for its originally-seeded `stockQty` and use `stockBatch.stageChange` + `stockBatch.confirm` (the real flow, not a direct DB write) to bring it back to that exact original value, then verify via `GET /api/trpc/ingredient.list` that all seeded ingredients match `prisma/seed.ts`'s values again.

---
