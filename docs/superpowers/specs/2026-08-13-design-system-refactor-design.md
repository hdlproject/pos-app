# Design System Refactor — Design

**Date**: 2026-08-13
**Status**: Approved (design), pending implementation plan

## Overview

Restyle all 7 existing frontend pages (login, staff POS, KDS, QR customer menu, and the 4 admin pages) to match a design system the user provided as 5 interactive HTML mockups in `/design/*.dc.html` (a "Kopi & Co" branded cafe POS, built in a proprietary prototyping DSL — reference material only, not literal code). This is a **visual and layout** refactor: same tRPC procedures, same data, same functionality as today. No new features, no backend changes.

## Scope

**In scope:**
- Tailwind CSS setup with a theme extension matching the mockups' design tokens.
- Shared UI primitives (`Button`, `Card`, `Chip`, `PageHeader`, admin sidebar layout).
- Restyling and, where the mockups show a materially different structure, re-laying-out all 7 existing pages to match the mockups' visual language.
- A new login page design (no mockup exists for it — designed to match the rest of the system).
- A shared `AdminLayout` (Next.js nested layout) providing the sidebar nav across all 4 admin pages, replacing 4 independently unstyled pages.
- Manual browser verification of every page after restyling (the final review on the previous work flagged that this was skipped originally and let two real bugs through).

**Out of scope (explicitly deferred, mockups show these but they require new backend work):**
- "Ask AI" assistant / insights (appears on 3 of the 5 mockups) — no AI backend exists.
- Tax calculation (mockups show a 10% "PB1" tax line) — spec is cash-only, no tax field in the data model.
- Item photo placeholders — `MenuItem.image` exists in the schema but is unused; adding real image upload/display is separate scope.
- The in-page cash payment modal shown in the Staff POS mockup — closing the "no cashier UI" gap is a separate, already-identified follow-up task, not bundled into this visual refactor.
- Item badges ("Popular", "Low stock" computed dynamically in the mockup) — decorative, not backed by real logic.

## Design Tokens

Extracted from the mockups' inline styles. Two palettes — light for customer/staff-facing screens, dark for the always-on Kitchen Display (intentional in the source design, not a mistake).

### Light palette (Login, Staff POS, QR Menu, Admin)

| Token | Value | Use |
|---|---|---|
| `bg` | `#f3ede3` | Page background |
| `surface` | `#fffdf9` | Cards, panels, headers |
| `surface-input` | `#faf6ef` | Form inputs |
| `border` | `#e9e0d2` | Default border |
| `border-strong` | `#e6dccb` | Input borders |
| `text` | `#2a241d` | Primary text |
| `text-muted` | `#a9997f` | Secondary text |
| `text-muted-2` | `#8a7c66` | Tertiary/label text |
| `accent` | `#c65d3b` | Brand accent, primary actions |
| `accent-hover` | `#a94a2c` | Accent hover/active |
| `accent-tint-text` | `#8a5a3c` | Accent-colored text on tinted bg |
| `success` | `#0e8a6a` | Confirm/positive actions |
| `warning` | `#c0492c` | Low-stock/error text |
| `dark-ui` | `#2a241d` | Dark buttons (e.g. "Add") |

QR Menu uses a slightly different page background (`#ded2c0`, radial gradient to `#d3c6b3`) and a hero header gradient (`#c65d3b` → `#a94a2c`) — page-specific, not part of the shared token set.

### Dark palette (Kitchen Display only)

| Token | Value | Use |
|---|---|---|
| `kds-bg` | `#1a1712` | Page background |
| `kds-header` | `#211d16` | Header bar |
| `kds-card` | `#241f18` | Ticket cards |
| `kds-card-header` | `#26211a` | Ticket card header strip |
| `kds-border` | `#322b21` | Default border |
| `kds-text` | `#f2e9dc` | Primary text |
| `kds-text-muted` | `#8a7c66` | Secondary text |
| `kds-text-muted-2` | `#b8ab95` | Tertiary text |
| `status-queued` | `#7d7364` | Queued item state |
| `status-preparing` | `#e0a86a` | Preparing item state |
| `status-ready` | `#5fbf7f` | Ready item state |

Brand accent (`#c65d3b`) is shared across both palettes.

### Typography

- **Manrope** (weights 400, 500, 600, 700, 800) — all UI text. Loaded via `next/font/google`.
- **DM Serif Display** — logo wordmark and page headings only.

### Shape

- `rounded-lg`/`rounded-xl` (9–12px) — buttons, inputs, chips.
- `rounded-2xl` (15–17px) — cards, panels.
- Soft, warm-tinted shadows (`rgba(120,90,50,...)` on light surfaces, `rgba(50,34,18,...)` on dark modals/overlays) — used sparingly, mockups are mostly flat with border-based separation.

## Architecture

- Add `tailwindcss` + its PostCSS plugin to the project (currently has none — `create-next-app` was scaffolded with `--no-tailwind`).
- `tailwind.config.ts` theme extension encodes the token tables above as named colors (e.g. `accent`, `kds-bg`) so pages reference `bg-accent` rather than repeating hex values.
- `src/components/ui/`: `Button.tsx` (variants: `primary`, `dark`, `outline`, `success`, with disabled states), `Card.tsx`, `Chip.tsx` (active/inactive pill), `PageHeader.tsx` (sticky top bar pattern, palette passed as a prop for the KDS dark variant).
- `src/app/(staff)/admin/layout.tsx`: new Next.js nested layout providing the sidebar nav (logo, nav links, user chip) around all 4 existing admin pages — replaces 4 independently-styled page shells with one shared one.
- No new tRPC procedures, no new dependencies beyond Tailwind itself, no schema changes.

## Per-Page Changes

Every page keeps its existing tRPC calls, mutations, and component logic (cart state, form state, etc.) exactly as-is — only markup/styling and, where noted, layout structure change.

- **Login** (`/login`): new design — centered card, PIN input, wordmark, primary button. No mockup existed; designed to match the rest of the system.
- **Staff POS** (`/pos`): category `Chip` row built from real `menu.listAll` categories (with counts), item grid (name/price/Add — no photos, no badges), cart panel with qty steppers, order-type tabs, table select. No search, no AI drawer, no tax line, no payment modal.
- **Kitchen Display** (`/kds`): dark kanban board, one card per open order, item rows with status pills, advance action wired to `kitchen.updateItemStatus`. Closest match to its mockup already.
- **QR Customer Menu** (`/order/[tableToken]`): mobile phone-frame-style layout, hero header with table number, category tabs, item list with qty steppers, floating cart bar. No search, no AI strip, no photos.
- **Admin — Menu** (`/admin/menu`): inside `AdminLayout`, category/item creation forms, item list with availability toggle. No KPI cards, no AI banner (not real data).
- **Admin — Ingredients** (`/admin/ingredients`): inside `AdminLayout`, ingredient list with low-stock red-highlight, create form, restock action.
- **Admin — Tables** (`/admin/tables`): inside `AdminLayout`, table list with QR path, create form, rotate-token action.
- **Admin — Reports** (`/admin/reports`): inside `AdminLayout`, KPI-tile treatment for `dailySales`, list sections for best-sellers/inventory-usage/shift-summary. No AI insight banner.

## Testing

No automated tests (pure UI/styling — consistent with how the original 5 frontend page tasks in the v1 plan were verified). Per page:

- `npm run build` stays clean (the real gate, established during the v1 implementation after a build-breaking regression went undetected for several tasks).
- Manual browser verification of every page after restyling — the v1 final review found that skipping this let two real bugs through the original build (a menu-category bootstrap bug, a QR-page duplicate-order bug), both invisible to `npm run build`/`tsc`/curl smoke tests. This refactor does a proper click-through pass instead of relying on build-clean alone.
