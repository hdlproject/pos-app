# Menu Expansion & Category Icon System — Design

**Date**: 2026-08-16
**Status**: Approved (design), pending implementation plan

## Overview

Expand the POS app's seed data from 1 menu item to the full 23-item, 5-category "Kopi & Co" menu already established in this session's design mockups, give every item a real recipe (ingredient-based stock deduction), and add a generated category-based icon system so every item has visual identity in the UI even before real photos exist. The `MenuItem.image` field (already in the schema, currently unused) becomes the escape hatch: when set, a real image displays; when absent, a generated icon does. An admin form field is added so real images can be attached later without further code changes.

## Scope

**In scope:**
- Expand `prisma/seed.ts`: 5 categories (Coffee, Tea, Food, Pastry, Snacks), 23 menu items, ~25 ingredients, a full recipe for every item.
- `CategoryIcon` component: category → icon shape + gradient color mapping, with a neutral fallback for unmapped categories.
- `MenuItemThumbnail` component: `item.image` present → real `<img>`; absent → `CategoryIcon`.
- Wire `MenuItemThumbnail` into `/pos`'s item grid, `/order/[tableToken]`'s item list, and `/admin/menu`'s item rows.
- Add an "Image URL" input to the admin menu item creation form (backend already accepts `image?: string`).
- Document the icon pattern (category/icon/color mapping, sizing rules, how to extend) in `docs/menu-item-icons.md`.

**Out of scope:**
- Actual AI-generated or photographed images — the user will attach these manually later via the new admin field.
- Any change to `MenuItem`/`Ingredient`/`Recipe` schema — `image` already exists as `String?`, nothing new needed.
- Image upload/storage (the admin field takes a URL, not a file upload).

## Menu Content

Ported from this session's Staff POS design mockup, unchanged:

| Category | Items |
|---|---|
| Coffee | Espresso, Kopi Susu Gula Aren, Cappuccino, Caffè Latte, Americano, Cold Brew |
| Tea | Teh Tarik, Matcha Latte, Lemon Tea, Chamomile |
| Food | Nasi Goreng Spesial, Mie Ayam, Chicken Katsu Rice, Beef Rendang Rice, Caesar Salad, Club Sandwich |
| Pastry | Butter Croissant, Pain au Chocolat, Cinnamon Roll, Cheesecake Slice |
| Snacks | French Fries, Onion Rings, Chicken Wings |

Prices match the mockup's values (e.g. Espresso 18000, Beef Rendang Rice 58000 — Indonesian Rupiah, consistent with the app's existing `Rp` formatting).

## Ingredients & Recipes

~25 ingredients, shared across items the way a real cafe would (Milk and Coffee Beans span most of Coffee; Rice spans 3 Food items; Chicken Breast spans 3 dishes). Pastry items each use a single pre-made "dough/unit" ingredient (e.g. `Croissant Dough`, unit `pcs`) rather than modeling flour/butter/sugar — realistic for a cafe that buys pastries in rather than bakes from scratch, and keeps the ingredient list from ballooning.

| Ingredient | Unit | Used by |
|---|---|---|
| Milk | ml | Kopi Susu Gula Aren, Cappuccino, Caffè Latte, Teh Tarik, Matcha Latte |
| Coffee Beans | g | Espresso, Kopi Susu Gula Aren, Cappuccino, Caffè Latte, Americano, Cold Brew |
| Palm Sugar Syrup | ml | Kopi Susu Gula Aren |
| Black Tea Leaves | g | Teh Tarik, Lemon Tea |
| Matcha Powder | g | Matcha Latte |
| Chamomile Tea Bag | pcs | Chamomile |
| Lemon | pcs | Lemon Tea |
| Rice | g | Nasi Goreng Spesial, Chicken Katsu Rice, Beef Rendang Rice |
| Egg | pcs | Nasi Goreng Spesial, Club Sandwich |
| Chicken Breast | g | Nasi Goreng Spesial, Mie Ayam, Chicken Katsu Rice, Caesar Salad, Club Sandwich |
| Egg Noodles | g | Mie Ayam |
| Beef Chuck | g | Beef Rendang Rice |
| Coconut Milk | ml | Beef Rendang Rice |
| Rendang Spice Paste | g | Beef Rendang Rice |
| Romaine Lettuce | g | Caesar Salad |
| Parmesan Cheese | g | Caesar Salad |
| Sandwich Bread | pcs | Club Sandwich |
| Bacon | g | Club Sandwich |
| Croissant Dough | pcs | Butter Croissant |
| Pain au Chocolat Dough | pcs | Pain au Chocolat |
| Cinnamon Roll Dough | pcs | Cinnamon Roll |
| Cheesecake Slice (pre-made) | pcs | Cheesecake Slice |
| Potato | g | French Fries |
| Onion Rings (frozen, bulk) | g | Onion Rings |
| Chicken Wings | g | Chicken Wings |

Each menu item's recipe (ingredient → qty per unit sold) is fully specified during implementation from this table — every item gets at least one recipe row, no item ships with an empty recipe. Initial `stockQty`/`lowStockThreshold` per ingredient are set to comfortably cover normal seed-data testing (roughly 25× and 5× a typical single-serving recipe quantity, respectively), following the ratio already established by the existing Milk/Coffee Beans seed rows.

## Category Icon System

**`src/components/ui/CategoryIcon.tsx`** — a small presentational component mapping category name to an icon shape and a two-color gradient, rendered as a rounded box:

| Category | Icon | Gradient (extends the existing mockup tint pairs) |
|---|---|---|
| Coffee | Mug with steam | `#efe3d6` → `#e4d3c0` |
| Tea | Teapot | `#e4ece1` → `#d3e0cf` |
| Food | Plate with utensils | `#f0e2cf` → `#e6d2b6` |
| Pastry | Croissant crescent | `#f2e6dc` → `#ead4c2` |
| Snacks | Fries basket | `#eee0d6` → `#e2ccbe` |
| *(unmapped, fallback)* | Generic dot/star | Neutral `--color-border` tones |

Icons are simple inline SVGs (2-stroke line style, consistent `viewBox`/`stroke-width`), matching the existing design system's restrained aesthetic — not photographic, not skeuomorphic.

**`src/components/ui/MenuItemThumbnail.tsx`** — the single place the image-or-icon decision is made: renders `<img src={item.image}>` when `item.image` is a non-empty string, otherwise renders `<CategoryIcon category={item.category.name} />`. Every page that lists menu items imports this component rather than deciding the fallback logic itself.

**`docs/menu-item-icons.md`** — documents the category/icon/color table above, the sizing/style rules, and instructions for adding a 6th category (pick the next tint pair from the existing palette family, choose a simple 2-stroke icon, add one row to the map) — this is both the spec for `CategoryIcon` and the reference for extending it later.

## Admin Image URL Field

`src/app/(staff)/admin/menu/page.tsx`'s "New Item" form gains one more input: "Image URL (optional)". On submit, it's passed through to `menu.createItem`'s existing `image?: string` parameter — no backend change needed, this is purely wiring up an input that was already accepted but never exposed.

## Testing

No automated tests for the presentational components (pure UI, consistent with how this project verifies its frontend throughout). After running `prisma db seed`, a quick manual check: row counts (5 categories, 23 menu items, ~25 ingredients, one-or-more recipe rows per item), every category renders a distinct icon on `/pos` and the QR customer page, the admin item list shows thumbnails, and the new Image URL field round-trips (set a URL on an item, confirm it displays instead of the generated icon).
