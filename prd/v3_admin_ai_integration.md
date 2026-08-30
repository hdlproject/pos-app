# POS App — v3 Admin AI Menu Creation Design

**Date**: 2026-08-31
**Status**: Approved (design), pending implementation plan
**Depends on**: v1 (`prd/v1_basic_app.md`) — base data model (MenuItem, Ingredient, Recipe, reports). v2 (`prd/v2_customer_ai_integration.md`, implemented) — this reuses its server-only OpenAI client (`src/server/ai/openaiClient.ts`) rather than duplicating it, and follows the same self-consistency-validation lesson learned from a real bug there (see Architecture).

## Overview

An AI-powered new-menu-item generator for admin. Instead of picking from the existing menu (v2's customer-facing feature), this suggests a brand-new dish concept — name, description, cooking instructions, and a full ingredient list — driven by best-seller sales data and current ingredient stock (prioritizing ingredients running low, so new dishes help use them up before they're depleted or wasted). Admin can steer it with optional cuisine/category/notes input, edit the AI's draft freely, then Approve (creates the real menu item, any new ingredients, and the recipe) or Reject (discards it, no server writes).

## Scope (v3)

**In scope:**
- Admin-only "Suggest new item" entry point on `/admin/menu`
- One AI-generated draft per request: name, price, category, description, cooking instructions, ingredient list (existing ingredients cross-referenced by real id; new ones flagged), and a short rationale tying it to sales/stock data
- Optional steering input: cuisine chips, category hint, free-text notes — all skippable, falls back to pure sales+inventory-driven suggestion
- Fully editable draft before commit — every field the AI proposed can be changed
- Approve creates the real `MenuItem` + any new `Ingredient` rows (at 0 stock) + `Recipe` rows in one transaction; Reject writes nothing
- Two new nullable `MenuItem` columns: `description`, `instructions` (didn't exist before this feature)

**Out of scope (v3):**
- Any use of this feature from the customer-facing surfaces
- Multi-suggestion batching (v2 later grew a "send several requests together" flow for comparing existing items across types; this generates one strong concept per request — "Suggest another" just re-rolls)
- A persisted "pending draft" record (unlike the ingredient stock-adjustment batch flow) — the draft is ephemeral client state until Approve, matching v2's philosophy
- Rate-limiting/cooldown on the suggestion endpoint (see Architecture — different threat model than v2)
- Enforcing menu-item name uniqueness (soft concern only, see Error Handling)
- Automatically discounting/adjusting prices of existing items, or any other menu-wide optimization — this only ever proposes one new item at a time

## Architecture

- **Schema**: `MenuItem` gains two nullable columns, `description String?` and `instructions String?` — additive migration, safe. No other schema changes; ingredients created via this flow are ordinary `Ingredient` rows (start at `stockQty: 0`), nothing new needed there.
- **New router**: `aiMenuSuggestion`, both procedures `roleProcedure('ADMIN')`.
  - `suggestNewItem({ cuisine?, categoryHint?, notes? })`: gathers best-sellers (last 30 days, same query shape as `report.bestSellers`), every ingredient sorted by `stockQty` ascending (lowest-stock ones called out in the prompt as priorities to use up), and existing menu item names (so the model steers away from near-duplicates). Builds a prompt and calls the **same** `fetchChatCompletion` from v2's `openaiClient.ts` — reused, not duplicated — in JSON mode. Returns a structured draft (see Data Flow below).
  - `createFromSuggestion(draft)`: takes the admin-edited draft and, in one transaction, creates any ingredient not matched to a real id (at `stockQty: 0`), creates or reuses the category, creates the `MenuItem` (with `description`/`instructions`), creates `Recipe` rows, then runs the existing `recomputeAvailabilityForMenuItem` so the item's initial `outOfStockReason` is correct immediately (out-of-stock if it needed a fresh-at-zero ingredient, orderable right away otherwise).
- **No cooldown guard**, unlike v2. v2's Redis cooldown exists because that endpoint is `publicProcedure` — reachable by any anonymous customer, at volume, with no natural rate limit. This feature is `roleProcedure('ADMIN')`: an authenticated, low-frequency, single-operator curation action. The threat model that justified a cooldown doesn't apply the same way; no guard is added here.
- **Self-consistency validation**: the same defensive pattern that fixed a real v2 bug (a suggestion whose displayed item didn't match its own description, because the model returned a valid id but wrote text for a different item). Every ingredient the AI claims is "existing" is cross-checked by name (case/whitespace-insensitive) against the real ingredient list pulled for this request; only a genuine match is treated as existing (carrying its real id and unit forward), anything else is treated as new regardless of what the model labeled it.

## Data Model

Migration: `MenuItem.description String?`, `MenuItem.instructions String?` (both nullable, no default needed — existing rows simply have `null`).

No new tables. The draft returned by `suggestNewItem` and edited client-side has this shape (not persisted until Approve):

```
{
  name: string
  price: number
  category: { existingId: string } | { newName: string }
  description: string
  instructions: string
  ingredients: {
    name: string
    unit: string
    qtyPerUnit: number
    existingIngredientId: string | null   // null = will be created fresh on Approve
  }[]
  reasoning: string   // read-only in the UI, not sent back on Approve
}
```

## UX Flow

1. Admin taps "✨ Suggest new item" on `/admin/menu` → opens an overlay panel (same visual pattern as v2's chat panel — modal card, not a new route).
2. Optional, all-skippable steering: a small fixed cuisine chip set (Indonesian, Italian, Korean, Japanese, Western, Fusion), a category hint (the live category list, or "let AI decide"), and a free-text notes field. One AI call per tap of "Suggest" — no multi-request batching.
3. Response renders as an **editable form**: Name, Price (required, since `MenuItem.price` is non-nullable), Category (existing dropdown or type a new one), Description, Instructions, and an ingredient list where each row's quantity/unit can be adjusted — existing ingredients render normally, ones that will be freshly created are visually flagged. The AI's short rationale shows read-only, for context only.
4. **Reject**: discards the draft entirely, no server writes. Panel stays open for another "Suggest" if desired.
5. **Approve**: submits the (possibly edited) draft to `createFromSuggestion`. New item appears immediately on `/admin/menu` — out-of-stock if it needed a new ingredient (admin restocks it via the existing stock-batch flow to make it orderable), available right away if built entirely from ingredients already in stock.

## Error Handling & Edge Cases

- **OpenAI call fails or times out**: same handling as v2 (20s timeout + token cap on the shared client) — inline retry, steering selections preserved.
- **Malformed AI response**: treated as a call failure, same as v2.
- **Self-inconsistent ingredient** (name doesn't match the id/existing-match it claims): that ingredient is silently reclassified as new rather than trusted, per Architecture above — never surfaced as a broken row.
- **No sensible suggestion possible** (near-empty menu or inventory): the model is instructed to say so explicitly rather than force a bad match; the panel shows that message instead of a broken draft.
- **Approve-time validation**: name, price (> 0), category, and at least one ingredient are required before Approve is enabled — reusing the same validation the admin menu page already applies to manual item creation, not a duplicate implementation.
- **Duplicate item names**: soft concern only. No unique constraint on `MenuItem.name` today, and this feature doesn't add one; the model is instructed to avoid near-duplicates of existing items, but Approve is never hard-blocked on a name collision.

## Testing

- **Unit**: prompt-building, response-parsing, and the ingredient existing/new cross-check (mirroring v2's `suggestion.ts` test style) — the OpenAI call itself mocked, no real API calls in the suite.
- **Integration**: `createFromSuggestion` covering both the all-existing-ingredients path and the new-ingredient-at-zero-stock path — verifying the resulting `MenuItem`/`Ingredient`/`Recipe` rows and the item's correct initial `outOfStockReason`.
- **Manual**: full suggest → edit → approve flow on `/admin/menu`, both with and without steering input.
