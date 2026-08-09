# POS App — v1 Basic App Design

**Date**: 2026-08-09
**Status**: Approved (design), pending implementation plan

## Overview

POS system for a single restaurant/cafe location, supporting dine-in (QR self-order or staff-entered), takeaway, and delivery (order intake only — dispatch out of scope). Cash payments only in v1. Includes ingredient-level inventory tracking, live kitchen display, and staff reporting.

## Scope (v1)

**In scope:**
- Single store
- Dine-in via QR self-order (open tab, pay at end) and staff entry
- Takeaway and delivery, staff-entered only (delivery dispatch handled outside the system — orders are tagged `delivery` for kitchen/reporting only)
- Cash payments only
- Ingredient-level inventory with recipe-based stock deduction and low-stock flagging
- Kitchen Display System (live ticket screen)
- Staff roles: Admin, Cashier, Waiter, Kitchen
- Reports: daily sales, best-sellers, inventory usage, shift summary

**Out of scope (v1):**
- Multi-store / chain sync
- Card, QRIS, e-wallet, or online payment gateway
- 3rd-party delivery platform API integration (Grab/Gojek/etc.)
- Native mobile apps (web-only, responsive)
- Push/SMS/email low-stock alerts (dashboard indicator only)
- Customer accounts, loyalty points

## Architecture

- **Frontend**: Next.js (App Router), TypeScript. Three surfaces in one app: Staff POS UI, KDS screen, public QR customer-order page.
- **Backend**: tRPC routers within the same Next.js app (orders, menu, inventory, auth, reports).
- **Database**: Postgres via Prisma ORM. Single source of truth. Flexible fields (e.g. menu modifiers) stored as JSONB columns — no separate NoSQL store.
- **Cache**: Redis — menu read cache and cached report rollups only. Never the source of truth for order/payment/stock state.
- **Realtime**: Ably (managed pub/sub). Server publishes on order create/update/status-change; KDS, waiter, and QR customer screens subscribe for live updates. No self-hosted WebSocket server, no polling. Ably is push-only convenience — on reconnect, clients refetch current state via tRPC against Postgres.
- **Auth**: Staff PIN login (4–6 digit), JWT cookie session, role embedded and checked per tRPC procedure. QR customer flow has no login — access is scoped by a per-session table token instead.

## Data Model

- **Store**: single row, name/config (table kept for future multi-store, unused in v1)
- **User**: id, name, PIN hash, role (Admin/Cashier/Kitchen/Waiter), active
- **Table**: id, label (e.g. "T5"), QR token (unique, rotates per new dine-in session)
- **Category**: id, name, sort order
- **MenuItem**: id, name, price, category, available (bool), image, modifiers (JSONB — e.g. size/sugar-level options)
- **Ingredient**: id, name, unit (g/ml/pcs), stock qty, low-stock threshold
- **Recipe**: MenuItem ↔ Ingredient join, qty consumed per sale (bill of materials)
- **Order**: id, type (dine_in/takeaway/delivery), table (nullable), status (open/sent_to_kitchen/ready/served/paid/cancelled), source (staff/qr), created_by (user, nullable if QR), total, created_at
- **OrderItem**: order id, menu item, qty, modifiers chosen, unit price (snapshot at order time), kitchen status (queued/preparing/ready/served)
- **Payment**: order id, amount, method (cash, only method in v1), received_by (user), created_at
- **StockMovement**: ingredient id, delta, reason (sale/manual-adjust/restock), ref order id (nullable), created_at, created_by

## Order Flow

### QR dine-in (customer self-order)
1. Customer scans table QR → loads menu page, table token carried in URL.
2. Adds items to cart, submits → creates Order (type=dine_in, source=qr, status=sent_to_kitchen) with OrderItems.
3. Ably publishes the new order → KDS shows the ticket instantly.
4. Customer may add more items later; new OrderItems append to the same open order (tab stays open through the meal).
5. At meal end, customer requests the bill (flags staff or taps in-app) → Cashier opens the order, confirms cash payment → Order status becomes `paid`.

### Staff-entered order (dine-in / takeaway / delivery)
1. Cashier or Waiter selects order type. For dine-in, assigns a table (or marks walk-in with no table).
2. Builds the cart and submits → same path as above: status=sent_to_kitchen, source=staff.
3. Takeaway/delivery: no table. Payment is typically collected on submit, but the order can be left open if payment happens later (e.g. delivery paid on arrival, outside the system, marked paid in POS once settled).
4. Delivery orders are tagged type=delivery purely for kitchen prioritization and reporting; actual dispatch is out of scope.

### Kitchen (KDS)
- Ticket appears on order submit, grouped by order; each item independently moves queued → preparing → ready.
- When all items on an order are ready, order status becomes `ready` and Ably notifies the waiter/cashier screen.
- Waiter marks the order served (dine-in); the order stays open until paid.

### Payment
- Cash only. Cashier enters amount tendered, system calculates change, records a Payment row, order moves to `paid`.
- On payment, StockMovement rows are written per recipe ingredient × quantity sold, decrementing ingredient stock.
- A low-stock threshold breach surfaces as a dashboard indicator for Admin (no push alerting in v1).

## Roles & Permissions

| Role | Access |
|---|---|
| Admin | Everything: menu/ingredient/recipe management, user management, reports, void/refund orders |
| Cashier | Take orders (all types), process payment, view KDS status. Cannot edit menu/ingredients |
| Waiter | Take dine-in orders, assign tables, mark served, view KDS status. No payment access |
| Kitchen | KDS only — view tickets, update item status. No order creation, no payment, no reports |

- Login is PIN-pad based (no username typing) for fast shift switching on a shared device.
- Session is a JWT cookie with role embedded, checked by middleware on every tRPC procedure.
- The QR customer flow has no login; access is scoped to its own order via the table session token.

## Reports

- **Daily sales**: total revenue, order count, average order value; filterable by date range and order type.
- **Best-sellers**: top menu items by quantity sold / revenue, date-range filterable.
- **Inventory usage**: ingredient consumption over a period (derived from StockMovement), current stock levels, low-stock flags.
- **Shift summary**: per staff member — orders handled, payments collected, with manual cash reconciliation (expected vs. counted) entered at shift close.

All reports are computed server-side via tRPC queries against Postgres — no separate analytics store at this scale. Redis caches expensive daily-rollup queries, invalidated on new payment.

## Error Handling & Edge Cases

- **Ably disconnect** (KDS/waiter screen offline): on reconnect, client refetches current open orders via tRPC. Ably is push-only convenience; Postgres is the source of truth, never a required data path.
- **Concurrent stock deduction** (two orders consuming the same ingredient near-simultaneously): deduction happens inside a DB transaction; stock is allowed to go negative (and flagged) rather than blocking the sale — a running-out-of-stock miscount is recoverable, a blocked sale is not. Admin reconciles later.
- **QR order on stale/invalid table token**: rejected with a "scan again" prompt. Token rotates per new dine-in session, preventing shared/leaked QR replay across sessions.
- **Order cancel / void**: Admin-only, requires a reason (logged via order status=cancelled and StockMovement reason field); stock is reverted if the cancellation happens pre-payment.
- **Menu item goes unavailable mid-order**: existing OrderItems on open orders are unaffected; the item is simply hidden from further ordering.

## Testing

- **Unit**: tRPC procedures — order creation, stock deduction math, payment/change calculation. Vitest.
- **Integration**: full order lifecycle against a test Postgres instance (submit → kitchen → payment → stock deducted).
- **Manual**: QR flow on a real mobile device, PIN login, KDS live-update behavior via Ably.
