# POS App — v1 Basic App Design

**Date**: 2026-08-09
**Status**: Implemented. This doc is kept in sync with the live app; sections below describe current behavior, not the original pre-implementation design (several flows changed shape during build — see inline notes).

## Overview

POS system for a single restaurant/cafe location, supporting dine-in (QR self-order or staff-entered), takeaway, and delivery (order intake only — dispatch out of scope). Cash payments only in v1. Includes ingredient-level inventory tracking with a staged review-and-confirm adjustment flow, live kitchen display, and staff reporting.

## Scope (v1)

**In scope:**
- Single store
- Dine-in via QR self-order and staff entry
  - QR self-order offers two modes: a one-time order (single fire-and-forget submission) or an Open Table session (a running tab the customer can add rounds to across the whole visit, paid once at the end)
- Takeaway and delivery, staff-entered only (delivery dispatch handled outside the system — orders are tagged `DELIVERY` for kitchen/reporting only)
- Cash payments only
- Ingredient-level inventory with recipe-based stock deduction, low-stock flagging, and a staged batch review (change report → confirm) for stock adjustments and restocks
- Kitchen Display System (live ticket screen)
- Staff roles: Admin, Staff, Kitchen
- Reports: daily sales, best-sellers, sales detail, inventory usage, staff/HR (shift) summary

**Out of scope (v1):**
- Multi-store / chain sync
- Card, QRIS, e-wallet, or online payment gateway
- 3rd-party delivery platform API integration (Grab/Gojek/etc.)
- Native mobile apps (web-only, responsive)
- Push/SMS/email low-stock alerts (dashboard indicator only)
- Customer accounts, loyalty points

## Architecture

- **Frontend**: Next.js (App Router), TypeScript. Three surfaces in one app: Staff POS UI (`(staff)` route group), KDS screen, public QR customer-order page (`/order/[tableToken]`).
- **Backend**: tRPC routers within the same Next.js app — `order`, `menu`, `ingredient`, `stockBatch`, `table`, `payment`, `kitchen`, `report`, `auth`.
- **Database**: Postgres via the `postgres` client + Kysely query builder (migrated off Prisma in 2026-09 — Prisma's query engine can't run on Cloudflare Workers with this stack; see `docs/superpowers/specs/2026-09-07-drop-prisma-raw-sql-design.md`). Single source of truth. Flexible fields (e.g. menu modifiers) stored as JSONB columns — no separate NoSQL store.
- **Cache**: Redis — cached daily-sales rollups only (invalidated on payment/cancel), and menu-adjacent reads. Never the source of truth for order/payment/stock state.
- **Realtime**: Ably (managed pub/sub). Server publishes on order create/dispatch/item-status/served/paid/cancelled; KDS and other screens subscribe for live updates. No self-hosted WebSocket server, no polling. Ably is push-only convenience — on reconnect, clients refetch current state via tRPC against Postgres. A publish failure is logged and swallowed, never blocks the underlying mutation.
- **Auth**: Staff PIN login (4–6 digit), JWT cookie session (`session` cookie, 12h maxAge), role embedded and checked per tRPC procedure via `roleProcedure(...role[])`. QR customer flow has no login — every mutation is scoped by the table's QR token instead.

## Data Model

- **Store**: single row, name (table kept for future multi-store, unused in v1)
- **User**: id, name, PIN hash, role (`ADMIN` / `STAFF` / `KITCHEN`), active. *(`CASHIER` and `WAITER` were merged into a single `STAFF` role after implementation — the two shared nearly every backend permission.)*
- **Table**: id, label (e.g. "T5"), QR token (unique, permanent per table — does **not** rotate per session; a table's URL is stable, and only one active QR Open Table session per table is enforced at the order level, not via token rotation)
- **Category**: id, name, sort order
- **MenuItem**: id, name, price, category, available (bool), outOfStockReason (nullable — auto-set/cleared by recipe stock recomputation, distinct from the manual `available` toggle), image, modifiers (JSONB)
- **Ingredient**: id, name, unit, stock qty (decimal)
- **Recipe**: MenuItem ↔ Ingredient join, qty consumed per sale (bill of materials)
- **Order**: id, type (`DINE_IN`/`TAKEAWAY`/`DELIVERY`), table (nullable — walk-ins have none), status (`OPEN`/`SENT_TO_KITCHEN`/`READY`/`SERVED`/`PAID`/`CANCELLED`), source (`STAFF`/`QR`), cancelReason, createdBy (user, nullable if QR), total, createdAt, plus the Open Table session fields:
  - `isOpenTableSession` (bool) — marks a *parent* order: no items of its own, anchors the session
  - `parentOrderId` (nullable, self-relation `children`) — set on a *child* order (one round of an Open Table session)
  - `sessionFinished` (bool) — customer has requested the bill; only meaningful on a parent
- **OrderItem**: order id, menu item, qty, modifiers chosen, unit price (snapshot at order time), kitchen status (`QUEUED`/`PREPARING`/`READY`/`SERVED`)
- **Payment**: order id, amount, method, received_by (user), created_at — one Payment per billable order (an Open Table parent gets exactly one, covering every dispatched round)
- **StockMovement**: ingredient id, delta, reason (`SALE`/`MANUAL_ADJUST`/`RESTOCK`/`VOID_REVERT`), ref order id (nullable), created_at, created_by — the ground-truth ledger for "was stock actually deducted for this order," used by cancel/void to decide whether a revert is needed (not payment existence, which doesn't line up 1:1 with deduction once Open Table rounds exist)
- **StockAdjustmentBatch**: id, status (`PENDING`/`CONFIRMED`/`CANCELLED`), note, createdBy/createdAt, confirmedBy/confirmedAt — at most one `PENDING` batch exists at a time (enforced by a partial unique index)
- **StockAdjustmentLine**: batch id, ingredient id, delta, reason — one line per ingredient per batch (upserted as staff stages changes)

## Order Flow

### QR dine-in (customer self-order)

The customer page (`/order/[tableToken]`) always opens on a mode-choice screen — **"Open a Table" vs "One-time Order"** — unless it recovers an already-active Open Table session for that table (see below). There is no in-between state: a one-time order is never resumable, and a *finished* Open Table session is never resumable either — both are treated as done from the customer's side the moment they're placed/finished, and the page redirects to `/login` shortly after (a shared success-modal pattern with a checkmark animation, then auto-navigate).

**One-time order:**
1. Customer picks "One-time Order", builds a cart, submits → creates one `Order` (`type=DINE_IN`, `source=QR`, `status=OPEN`, no session flags).
2. Order sits in staff's Pending Purchases queue as a standalone card ("Confirm & send to kitchen"). Nothing is dispatched to the kitchen and no stock is deducted until staff acts on it.
3. Once placed, the order is fire-and-forget: leaving and returning to the page always shows the fresh mode-choice screen again — it is deliberately never recovered, even though it's still `OPEN` server-side awaiting staff.

**Open Table session:**
1. Customer picks "Open a Table" → creates a *parent* `Order` (`isOpenTableSession=true`, no items, `total=0`). Reusing an already-active (unfinished) session for the same table is deduped server-side, so a reload/re-scan doesn't spawn a duplicate.
2. Every cart submission creates a new *child* order (`parentOrderId` = the session) — a "round." Each round sits in staff's Pending Purchases, grouped under one panel per table, each with its own "Send to kitchen" button — dispatched individually and immediately, with no payment of its own.
3. The customer can keep submitting rounds indefinitely, and can open a "My Order" panel at any time to see every round placed so far (items, per-round total, running grand total) without losing their current cart.
4. When done, the customer taps "Finish table" → sets `sessionFinished=true` on the parent. If no round was ever placed, the session is cancelled outright instead (nothing to bill). A success modal shows, then redirects to `/login`.
5. Staff's Pending Purchases panel for that table swaps its footer action to "Confirm payment" once finished — but only once every round in the panel has been resolved (dispatched or cancelled); a still-undispatched round blocks it, both in the UI and server-side. Confirming charges one Payment for the sum of every *dispatched, non-cancelled* round (a round still sitting undispatched, or one that was cancelled, is never billed) and closes the parent (`status=PAID`).
6. Cancelling the parent (before it's dispatched-and-paid) cascades: every non-cancelled round is cancelled with it in the same transaction, reverting stock per-round for whichever were actually dispatched. Once any round has been sent to kitchen, the table-level Cancel action is disabled in the UI (cancel that round individually instead) — enforced both as a disabled button and, for non-admin staff, as a server-side permission check.

### Staff-entered order (dine-in / takeaway / delivery)
1. Staff selects order type. For dine-in, assigns a table (optional — a walk-in can go in with no table).
2. Two submission paths:
   - **Send to kitchen now** (`createStaff`): creates the order already `SENT_TO_KITCHEN`, payment collected later via `payment.payCash` (deducts stock at payment time, whenever that happens).
   - **Charge first** (`createAndCharge`): creates the order, charges it, and deducts stock all in one transaction (`status=OPEN` until staff separately confirms dispatch from Pending Purchases) — used for pay-up-front takeaway/delivery.
3. Delivery orders are tagged `type=DELIVERY` purely for kitchen prioritization and reporting; actual dispatch is out of scope.

### Kitchen (KDS)
- Ticket appears once an order is actually dispatched (`SENT_TO_KITCHEN`), grouped by order; each item independently moves `QUEUED` → `PREPARING` → `READY`/`SERVED`.
- When every item on an order is ready, the order's status becomes `READY` and Ably notifies other screens.
- An order is marked served; it stays open until paid.
- Staff (not just Kitchen) can also update item status and mark orders served — useful when the kitchen display isn't staffed separately.

### Payment
- Cash only, collected in person. Stock deduction timing depends on the flow, always via the same `StockMovement` ledger:
  - **Charge-first staff orders**: deducted at order creation (already paid).
  - **QR one-time orders, staff "send to kitchen now" orders, and Open Table rounds**: deducted when actually dispatched to the kitchen — not at order/round creation, and not at payment time.
  - **Open Table parent**: never deducts anything itself (its rounds already did, individually, on dispatch); its one Payment simply charges the sum of processed rounds.
- `payment.payCash` records a Payment, computes change, and (for orders not already paid via charge-first) deducts stock if it hasn't already been deducted.
- A low-stock threshold breach surfaces as a dashboard indicator for Admin (no push alerting in v1); `outOfStockReason` on a MenuItem is recomputed automatically from recipe stock levels whenever an ingredient's quantity changes (adjustment confirm, sale, or revert).

## Roles & Permissions

| Role | Access |
|---|---|
| Admin | Everything: menu/ingredient/recipe management, stock adjustment batches, table management, user-facing order ops, reports, cancel any order regardless of dispatch state |
| Staff | Take orders (all types), dispatch/confirm Pending Purchases, process payment, update kitchen item status, mark served. Cannot edit menu/ingredients/tables. Can only cancel an order (or an Open Table's rounds) that hasn't been dispatched yet — cancelling a dispatched order/round is admin-only |
| Kitchen | KDS only — view tickets, update item status, mark served. No order creation, no payment, no reports |

*(Staff replaces the original Cashier/Waiter split — both roles worked the same order-entry surface and had near-identical permissions, so they were merged.)*

- Login is PIN-pad based (no username typing) for fast shift switching on a shared device; demo PINs in seed data: Admin `1234`, Staff `2345`, Kitchen `4567`.
- Session is a JWT cookie with role embedded, checked per-procedure via `roleProcedure`.
- The QR customer flow has no login; every mutation is scoped by the table's QR token, validated server-side against the table/session it claims to act on.
- Post-login landing page is role-based: `KITCHEN` → `/kds`, `ADMIN` → `/admin/menu`, `STAFF` → `/pos`.

## Reports

All under `/admin/reports` (Admin-only for inventory usage and staff/HR; Admin+Staff for daily sales/best-sellers/sales detail):

- **Reports hub** (`/admin/reports`): daily sales summary (revenue, order count, avg order value) and best-sellers, both date-range filterable.
- **Sales Detail** (`/admin/reports/sales`): itemized list of every paid order in range, plus inventory usage (sales-driven ingredient depletion over the period, derived from `StockMovement` with `reason=SALE`).
- **Staff / HR** (`/admin/reports/hr`): per-staff-member payments collected and order count in range (shift-style summary; no separate cash-reconciliation entry in v1).

"Counts as a sale" is judged by Payment existence, not order status literal — a charge-first order can be `OPEN` (awaiting dispatch) while already paid, and still needs to count.

All reports are computed server-side via tRPC queries against Postgres. Redis caches the daily-sales rollup only, invalidated on payment or cancellation.

## Error Handling & Edge Cases

- **Ably disconnect**: on reconnect, client refetches current state via tRPC. Postgres is the source of truth, never a required data path.
- **Concurrent stock deduction**: happens inside a DB transaction; stock is allowed to go negative (and availability recomputed accordingly) rather than blocking the sale.
- **QR order on invalid table token**: rejected (`NOT_FOUND`). Tokens are permanent per table, not per-session — the QR itself never needs reprinting, and duplicate/concurrent Open Table starts for the same table are deduped server-side instead of relying on token rotation.
- **Order/round cancel**: requires a reason; whether stock is reverted is decided by actual `StockMovement` existence for that order (`reason=SALE`), not by payment existence or order type — this matters once Open Table rounds can be dispatched (and deduct stock) with no payment of their own. Staff can only cancel an order (or any round in an Open Table's cascade) that's still undispatched; Admin can cancel regardless. Cancelling an Open Table parent cascades to every still-live round.
- **Open Table billing integrity**: an Open Table's bill only ever sums rounds that were actually dispatched and not cancelled — both in the staff UI and enforced server-side on payment confirmation, which rejects the call outright if any round is still undispatched. This closes off a class of bug where a round could be left permanently orphaned (still open, but invisible everywhere once its parent stopped being `OPEN`).
- **Menu item goes unavailable mid-order**: existing OrderItems on open orders are unaffected; the item is simply hidden from further ordering. Availability driven by the ingredient recipe check is tracked separately (`outOfStockReason`) from the manual `available` toggle, so an admin's manual hide/show is never silently overwritten by a stock recompute.
- **Stock adjustments**: staged as a single `PENDING` batch (at most one at a time, server-enforced) that staff builds up line-by-line (`stageChange`, `removeLine`) before reviewing a read-only change report and confirming (`confirm`, which applies every line's delta and writes `StockMovement` rows atomically) or discarding (`cancel`, which deletes the batch outright — cancelled batches aren't kept for accounting review, only confirmed ones show in history).

## Testing

- **Unit/Integration**: Vitest, run against a real test Postgres instance (`pos_test`) rather than mocks — order lifecycle (create → dispatch → payment → stock deducted), Open Table session/round/cascade-cancel behavior, stock adjustment batch staging/confirm/cancel, payment/change calculation.
- **Manual**: QR flow (both modes) on a real mobile device, PIN login, KDS live-update behavior via Ably, staff Pending Purchases grouped-panel flow.
