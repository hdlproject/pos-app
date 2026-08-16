# Automatic Sold-Out Detection (Ingredient Stock) — Design

**Date**: 2026-08-16
**Status**: Approved (design), pending implementation plan

## Overview

Alongside the existing manual "Mark sold out" toggle on `/admin/menu`, add automated sold-out detection driven by ingredient stock: when a menu item's recipe includes an ingredient that has run out, the item is automatically marked unavailable with a reason naming the depleted ingredient(s). The manual toggle and the automatic detection are tracked as two independent signals — an item is effectively available only when *both* say so; if either says unavailable, the item is unavailable. Restocking an ingredient only re-enables items the automation itself disabled, never one a staff member manually 86'd for an unrelated reason.

## Scope

**In scope:**
- New `MenuItem.outOfStockReason: String?` column (migration required).
- `src/server/stock/availability.ts`: `recomputeAvailabilityForIngredient(db, ingredientId)`, checking all recipe ingredients for every menu item that references the given ingredient.
- Wiring into all 4 existing stock/recipe-changing code paths: `ingredient.adjustStock`, `deductStockForOrder`, `revertStockForOrder` (all in `src/server/stock/deduct.ts` / `src/server/trpc/routers/ingredient.ts`), and `ingredient.setRecipe`.
- `menu.listAvailable` (customer QR menu) filters on both `available: true` and `outOfStockReason: null`.
- `menu.listAll` continues returning every item regardless of status, now also selecting `outOfStockReason`.
- `/admin/menu` item rows show both signals distinctly: the manual toggle's own label, plus a separate note when `outOfStockReason` is set.
- `/pos` (staff order entry): fixes an existing gap where availability isn't checked at all today — sold-out items (manual or auto) become visually disabled with the reason shown, and their "+ Add" button is disabled.
- Integration tests for the recompute function directly, one per wired call site, and the manual/auto-independence behavior.

**Out of scope:**
- Any change to `lowStockThreshold`'s existing meaning or the "LOW STOCK" warning badge already shown in `/admin/ingredients` — untouched.
- Any change to `available`'s existing column meaning or the manual toggle button's own behavior — it still does exactly what it does today (flips the manual flag only).
- Partial/graduated sold-out states (e.g. "low stock, order at your own risk") — an item is either effectively available or not, no middle state.
- Automatically disabling an item because a recipe ingredient is merely low (below `lowStockThreshold`) — the trigger is strict depletion (`stockQty <= 0`) only, per the approved design decision.

## Data Model

`MenuItem` gains one nullable column:

```prisma
model MenuItem {
  // ...existing fields unchanged...
  outOfStockReason String?
}
```

`available: Boolean` is unchanged — it remains the manual "Mark sold out"/"Mark available" toggle's own field, with its existing default (`true`) and existing meaning.

**Effective availability**, used everywhere availability is displayed or enforced, is always the combination:

```
effectivelyAvailable = (available === true) && (outOfStockReason === null)
```

No new column stores this combined value — it's derived at read time from the two independent fields, since it's only ever computed from data already being fetched (no extra query cost) and storing a third derived column would introduce a synchronization-drift risk between three fields instead of two.

## Recompute Logic

**`src/server/stock/availability.ts`:**

```ts
export async function recomputeAvailabilityForIngredient(
  db: Prisma.TransactionClient | PrismaClient,
  ingredientId: string
): Promise<void>
```

Finds every `MenuItem` with at least one `Recipe` row referencing `ingredientId`. For each such item, re-checks *all* of that item's recipe ingredients (not just the one that triggered the recompute — an item can depend on several, and one being restocked doesn't mean another isn't still out). Determines the full set of currently-depleted ingredients (`Number(ingredient.stockQty) <= 0`) among that item's recipe, and:
- If the set is empty: sets `outOfStockReason` to `null`.
- If non-empty: sets `outOfStockReason` to `"Out of stock: <comma-joined ingredient names>"`.

Follows the same `Prisma.TransactionClient | PrismaClient` signature convention already established by `deductStockForOrder` in the same file's neighbor — accepts either so it can run atomically inside whichever transaction the caller is already in, or standalone when called directly.

**Wiring** — each of the 4 existing call sites calls `recomputeAvailabilityForIngredient` for the ingredient(s) it just touched, in the same transaction, immediately after the stock/recipe write:
- `ingredient.adjustStock` (manual restock/adjust) — after updating `stockQty`.
- `deductStockForOrder` (payment-time deduction) — after each ingredient's deduction.
- `revertStockForOrder` (order cancel/void) — after each ingredient's stock reversal.
- `ingredient.setRecipe` (recipe created/changed) — after the upsert, recompute for the ingredient just linked (a newly-added recipe row might link an item to an already-depleted ingredient, or change its quantity in a way that doesn't affect the boolean depletion check but should still be re-verified for consistency).

## Display

**`menu.listAvailable`** (customer QR menu, `src/server/trpc/routers/menu.ts`): `where` clause gains `outOfStockReason: null` alongside the existing `available: true`.

**`menu.listAll`**: unchanged filtering (still returns everything), but its Prisma `select`/the hand-written `MenuItemWithCategory` type gains `outOfStockReason: string | null`.

**`/admin/menu` item rows**: the existing "available"/"sold out" label (driven by the raw `available` field, since that's what the adjacent toggle button controls) stays as-is. A new line appears only when `outOfStockReason` is set, in the existing warning-text style (`text-warning`), showing the reason verbatim (e.g. "Out of stock: Coffee Beans"). This means an item can show both "sold out" (manual) and the auto reason simultaneously if both apply, or just one, or neither.

**`/pos` staff order-entry grid**: currently has no availability filtering or display at all — every item, sold-out or not, renders identically and can be added to an order. Fixed: an item card where `effectivelyAvailable` is `false` renders visually muted (reduced opacity, matching the existing disabled-state pattern already used on `Button`'s `disabled:opacity-*` variants) with the reason shown as small text in place of the price, and its "+ Add" button disabled. Manually-sold-out items with no `outOfStockReason` show a generic "Sold out" label in that same spot instead of a specific ingredient reason.

## Testing

- `recomputeAvailabilityForIngredient` tested directly: ingredient hits zero → `outOfStockReason` set with the correct ingredient name; ingredient restocked back above zero → cleared to `null`; an item with two recipe ingredients where only one is depleted → reason names just that one, not both.
- One integration test per wired call site (`adjustStock`, `deductStockForOrder`, `revertStockForOrder`, `setRecipe`) confirming the hook fires end-to-end through the real mutation, not just the standalone function.
- Manual/auto independence: an item manually set `available: false` stays effectively unavailable after its (otherwise fine) ingredients are confirmed in stock — the manual flag isn't touched by any recompute. An item auto-disabled via a depleted ingredient, when that ingredient is restocked, has `outOfStockReason` cleared without its `available` flag being touched (so if `available` was already `true`, the item becomes effectively available again with no staff action needed; if a staff member had *also* manually set `available: false` on it, it correctly stays unavailable since the manual flag is independent and unaffected by the restock).
