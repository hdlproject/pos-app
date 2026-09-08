import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { sql, type Kysely, type Transaction } from 'kysely';
import { router, protectedProcedure, publicProcedure, roleProcedure } from '../trpc';
import { publishOrderEvent } from '../../ably';
import { deductStockForOrder, revertStockForOrder } from '../../stock/deduct';
import { noopCache } from '../../cache';
import { createId } from '../../id';
import type { DB } from '../../db.types';

const orderItemInput = z.object({
  menuItemId: z.string(),
  qty: z.number().int().positive(),
  modifiers: z.record(z.string(), z.any()).optional(),
});

const createOrderInput = z.object({
  type: z.enum(['DINE_IN', 'TAKEAWAY', 'DELIVERY']),
  tableId: z.string().optional(),
  items: z.array(orderItemInput).min(1),
});

type BuiltOrderItem = { id: string; menuItemId: string; qty: number; modifiers: unknown; unitPrice: string };

async function buildOrderItems(
  db: Kysely<DB> | Transaction<DB>,
  items: z.infer<typeof orderItemInput>[]
): Promise<BuiltOrderItem[]> {
  const menuItemIds = items.map((i) => i.menuItemId);
  const menuItems = await db.selectFrom('MenuItem').selectAll().where('id', 'in', menuItemIds).execute();
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  return items.map((i) => {
    const menuItem = byId.get(i.menuItemId);
    if (!menuItem) throw new TRPCError({ code: 'NOT_FOUND', message: `menu item ${i.menuItemId} not found` });
    if (!menuItem.available || menuItem.outOfStockReason) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `menu item ${menuItem.name} is not available` });
    }
    return {
      id: createId(),
      menuItemId: i.menuItemId,
      qty: i.qty,
      modifiers: i.modifiers ?? {},
      unitPrice: menuItem.price,
    };
  });
}

function calcTotal(items: { qty: number; unitPrice: unknown }[]): number {
  return items.reduce((sum, i) => sum + i.qty * Number(i.unitPrice), 0);
}

type OrderItemWithMenuItem = {
  id: string; orderId: string; menuItemId: string; qty: number; modifiers: unknown; unitPrice: string; kitchenStatus: string;
  menuItem: { id: string; name: string; price: string; image: string | null };
};

async function loadItemsWithMenuItem(db: Kysely<DB> | Transaction<DB>, orderIds: string[]): Promise<Map<string, OrderItemWithMenuItem[]>> {
  const map = new Map<string, OrderItemWithMenuItem[]>();
  if (orderIds.length === 0) return map;
  const rows = await db
    .selectFrom('OrderItem')
    .innerJoin('MenuItem', 'MenuItem.id', 'OrderItem.menuItemId')
    .select([
      'OrderItem.id as id', 'OrderItem.orderId as orderId', 'OrderItem.menuItemId as menuItemId',
      'OrderItem.qty as qty', 'OrderItem.modifiers as modifiers', 'OrderItem.unitPrice as unitPrice',
      'OrderItem.kitchenStatus as kitchenStatus',
      'MenuItem.id as menuItem_id', 'MenuItem.name as menuItem_name', 'MenuItem.price as menuItem_price', 'MenuItem.image as menuItem_image',
    ])
    .where('OrderItem.orderId', 'in', orderIds)
    .execute();
  for (const r of rows) {
    const item: OrderItemWithMenuItem = {
      id: r.id, orderId: r.orderId, menuItemId: r.menuItemId, qty: r.qty, modifiers: r.modifiers,
      unitPrice: r.unitPrice, kitchenStatus: r.kitchenStatus,
      menuItem: { id: r.menuItem_id, name: r.menuItem_name, price: r.menuItem_price, image: r.menuItem_image },
    };
    const list = map.get(r.orderId) ?? [];
    list.push(item);
    map.set(r.orderId, list);
  }
  return map;
}

export const orderRouter = router({
  createStaff: roleProcedure('ADMIN', 'STAFF')
    .input(createOrderInput)
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const builtItems = await buildOrderItems(kdb, input.items);
      const order = await kdb.transaction().execute(async (trx) => {
        const created = await trx.insertInto('Order')
          .values({
            id: createId(), type: input.type, tableId: input.tableId ?? null, status: 'SENT_TO_KITCHEN',
            source: 'STAFF', createdById: ctx.user.userId, total: calcTotal(builtItems),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.insertInto('OrderItem')
          .values(builtItems.map((i) => ({ ...i, orderId: created.id })))
          .execute();
        return created;
      });
      const items = (await loadItemsWithMenuItem(kdb, [order.id])).get(order.id) ?? [];
      const result = { ...order, items };
      try {
        await publishOrderEvent('order.created', result);
      } catch (err) {
        console.error('publishOrderEvent failed for order.created', err);
      }
      return result;
    }),

  // The charge-first cart flow: creates the order (OPEN, paid before
  // dispatch) and charges it in one transaction. Order creation and
  // payment used to be two separate calls (create, then payment.payCash)
  // -- a failure between them left an OPEN order with no payment, which
  // sendToKitchen's payment-existence guard would then reject forever with
  // no way to recover except cancelling it. Atomic here: either both
  // happen or neither does.
  createAndCharge: roleProcedure('ADMIN', 'STAFF')
    .input(createOrderInput)
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const builtItems = await buildOrderItems(kdb, input.items);
      const total = calcTotal(builtItems);
      const order = await kdb.transaction().execute(async (trx) => {
        const created = await trx.insertInto('Order')
          .values({
            id: createId(), type: input.type, tableId: input.tableId ?? null, status: 'OPEN',
            source: 'STAFF', createdById: ctx.user.userId, total,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.insertInto('OrderItem').values(builtItems.map((i) => ({ ...i, orderId: created.id }))).execute();
        await trx.insertInto('Payment')
          .values({ id: createId(), orderId: created.id, amount: total, method: 'ONLINE', receivedById: ctx.user.userId })
          .execute();
        await deductStockForOrder(trx, created.id, ctx.user.userId);
        return created;
      });
      // Not kitchen-relevant yet -- sendToKitchen publishes the dispatch
      // event once someone actually confirms it from Pending Purchases.
      return order;
    }),

  // The one staff action for every pending order, but it means something
  // different depending on what the order is:
  // - Open-table parent: has no items of its own, only reachable once the
  //   customer finished the session. This is the "Confirm payment" action
  //   -- charges the sum of every child round's total in one Payment and
  //   closes the session (PAID). Never dispatches (nothing to dispatch).
  // - Open-table child (one round): dispatch only, no payment -- the
  //   parent settles the whole bill once the session ends.
  // - Ordinary order (staff charge-first or customer QR, no session):
  //   charges it if unpaid (customer QR orders never pre-pay), then
  //   dispatches. Unchanged from before parent/child orders existed.
  sendToKitchen: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb.selectFrom('Order').selectAll().where('id', '=', input.orderId).executeTakeFirstOrThrow();
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is not pending dispatch' });
      }

      if (order.isOpenTableSession) {
        if (!order.sessionFinished) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'table has not been finished by the customer yet' });
        }
        // Only rounds actually sent to the kitchen are billable -- a round
        // still sitting undispatched was never cooked, and a cancelled
        // round was voided outright, so neither belongs in the total. A
        // still-OPEN round has to be resolved (dispatched or cancelled)
        // first, or paying now strands it forever: still undispatched,
        // parentless in every sense that matters, and invisible on this
        // same queue since it's excluded once the parent isn't OPEN.
        const children = await kdb.selectFrom('Order').selectAll().where('parentOrderId', '=', order.id).execute();
        if (children.some((c) => c.status === 'OPEN')) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'every round must be sent to the kitchen or cancelled before confirming payment' });
        }
        const processed = children.filter((c) => c.status !== 'CANCELLED');
        const total = processed.reduce((sum, c) => sum + Number(c.total), 0);
        return kdb.transaction().execute(async (trx) => {
          await trx.insertInto('Payment')
            .values({ id: createId(), orderId: order.id, amount: total, method: 'CASH', receivedById: ctx.user.userId })
            .execute();
          return trx.updateTable('Order').set({ status: 'PAID', total }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
        });
      }

      if (order.parentOrderId) {
        const updated = await kdb.transaction().execute(async (trx) => {
          await deductStockForOrder(trx, order.id, ctx.user.userId);
          return trx.updateTable('Order').set({ status: 'SENT_TO_KITCHEN' }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
        });
        try {
          await publishOrderEvent('order.dispatched', updated);
        } catch (err) {
          console.error('publishOrderEvent failed for order.dispatched', err);
        }
        return updated;
      }

      const payment = await kdb.selectFrom('Payment').selectAll().where('orderId', '=', order.id).executeTakeFirst();
      const updated = await kdb.transaction().execute(async (trx) => {
        if (!payment) {
          await trx.insertInto('Payment')
            .values({ id: createId(), orderId: order.id, amount: order.total, method: 'CASH', receivedById: ctx.user.userId })
            .execute();
          await deductStockForOrder(trx, order.id, ctx.user.userId);
        }
        return trx.updateTable('Order').set({ status: 'SENT_TO_KITCHEN' }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
      });
      try {
        await publishOrderEvent('order.dispatched', updated);
      } catch (err) {
        console.error('publishOrderEvent failed for order.dispatched', err);
      }
      return updated;
    }),

  // Ordinary orders, open-table rounds (children), and finished open-table
  // sessions (parents, ready for their one closing payment) -- everything
  // a staff member might need to act on from this one queue. A parent
  // that isn't finished yet is deliberately excluded: nothing to do with
  // it until the customer ends the session.
  // The parent row is included whenever it has at least one round -- not
  // only once finished -- so the client can group an in-progress table's
  // rounds under it too, not just a closed-out bill awaiting payment.
  listPendingDispatch: roleProcedure('ADMIN', 'STAFF').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const orders = await kdb
      .selectFrom('Order')
      .leftJoin('Table', 'Table.id', 'Order.tableId')
      .where('Order.status', '=', 'OPEN')
      .where((eb) =>
        eb.or([
          eb.and([eb('Order.isOpenTableSession', '=', false), eb('Order.parentOrderId', 'is', null)]),
          eb('Order.parentOrderId', 'is not', null),
          eb.and([
            eb('Order.isOpenTableSession', '=', true),
            eb.exists(eb.selectFrom('Order as Child').select('Child.id').whereRef('Child.parentOrderId', '=', 'Order.id')),
          ]),
        ])
      )
      .selectAll('Order')
      .select(['Table.id as table_id', 'Table.label as table_label', 'Table.qrToken as table_qrToken'])
      .orderBy('Order.createdAt', 'asc')
      .execute();

    const orderIds = orders.map((o) => o.id);
    const [itemsByOrder, payments, children] = await Promise.all([
      loadItemsWithMenuItem(kdb, orderIds),
      orderIds.length ? kdb.selectFrom('Payment').selectAll().where('orderId', 'in', orderIds).execute() : Promise.resolve([]),
      orderIds.length ? kdb.selectFrom('Order').selectAll().where('parentOrderId', 'in', orderIds).execute() : Promise.resolve([]),
    ]);
    const paymentsByOrder = new Map<string, typeof payments>();
    for (const p of payments) {
      const list = paymentsByOrder.get(p.orderId) ?? [];
      list.push(p);
      paymentsByOrder.set(p.orderId, list);
    }
    const childrenByOrder = new Map<string, typeof children>();
    for (const c of children) {
      const list = childrenByOrder.get(c.parentOrderId!) ?? [];
      list.push(c);
      childrenByOrder.set(c.parentOrderId!, list);
    }

    return orders.map((o) => ({
      ...o,
      table: o.table_id ? { id: o.table_id, label: o.table_label, qrToken: o.table_qrToken } : null,
      items: itemsByOrder.get(o.id) ?? [],
      payments: paymentsByOrder.get(o.id) ?? [],
      children: childrenByOrder.get(o.id) ?? [],
    }));
  }),

  // Starts an open-table session: a parent order with no items of its own,
  // anchoring every round the customer submits from here on. Reuses an
  // already-active session for the table instead of creating a duplicate
  // (e.g. a reload racing the recovery query).
  startTableSession: publicProcedure
    .input(z.object({ tableToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const existing = await kdb.selectFrom('Order').selectAll()
        .where('tableId', '=', table.id).where('source', '=', 'QR').where('isOpenTableSession', '=', true)
        .where('status', '=', 'OPEN').where('sessionFinished', '=', false)
        .executeTakeFirst();
      if (existing) return existing;

      return kdb.insertInto('Order')
        .values({ id: createId(), type: 'DINE_IN', tableId: table.id, status: 'OPEN', source: 'QR', isOpenTableSession: true, total: 0 })
        .returningAll()
        .executeTakeFirstOrThrow();
    }),

  // Customer-initiated: "I'm done ordering, bring the bill." Doesn't charge
  // anything itself (a customer has no business authorizing their own
  // charge) -- just flags the session so Pending Purchases swaps that
  // parent's action from nothing to Confirm payment. A session nobody ever
  // ordered a round on has nothing to bill -- cancel it outright instead
  // of flagging it finished, so it never shows up asking staff to confirm
  // a Rp 0 payment.
  finishTableSession: publicProcedure
    .input(z.object({ tableToken: z.string(), orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb
        .selectFrom('Order')
        .leftJoin('Table', 'Table.id', 'Order.tableId')
        .selectAll('Order')
        .select(['Table.qrToken as table_qrToken'])
        .where('Order.id', '=', input.orderId)
        .executeTakeFirst();
      if (!order || !order.isOpenTableSession) throw new TRPCError({ code: 'NOT_FOUND' });
      if (order.table_qrToken !== input.tableToken) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'table token mismatch' });
      }
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'session is already closed' });
      }
      const childCount = await kdb.selectFrom('Order').select(({ fn }) => fn.countAll().as('count')).where('parentOrderId', '=', order.id).executeTakeFirstOrThrow();
      if (Number(childCount.count) === 0) {
        return kdb.updateTable('Order')
          .set({ status: 'CANCELLED', cancelReason: 'table finished with no orders placed' })
          .where('id', '=', order.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }
      return kdb.updateTable('Order').set({ sessionFinished: true }).where('id', '=', order.id).returningAll().executeTakeFirstOrThrow();
    }),

  // Same charge-first shape as the staff cart's createAndCharge, minus the
  // payment: a customer submitting via QR doesn't pay through this app,
  // staff collects it in person and confirms from Pending Purchases
  // (sendToKitchen), which is what actually dispatches to the kitchen.
  //
  // With parentOrderId, this instead creates one round of an open-table
  // session -- a plain child order (still dispatched + no payment exactly
  // like above), just linked to the session so its total counts toward
  // the parent's eventual one-time bill.
  createByTable: publicProcedure
    .input(z.object({ tableToken: z.string(), items: z.array(orderItemInput).min(1), parentOrderId: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      if (input.parentOrderId) {
        const parent = await kdb.selectFrom('Order').selectAll().where('id', '=', input.parentOrderId).executeTakeFirst();
        if (!parent || !parent.isOpenTableSession || parent.tableId !== table.id) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table session' });
        }
        if (parent.status !== 'OPEN' || parent.sessionFinished) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'table session is closed' });
        }
      }

      const builtItems = await buildOrderItems(kdb, input.items);
      const order = await kdb.transaction().execute(async (trx) => {
        const created = await trx.insertInto('Order')
          .values({
            id: createId(), type: 'DINE_IN', tableId: table.id, status: 'OPEN', source: 'QR',
            parentOrderId: input.parentOrderId ?? null, total: calcTotal(builtItems),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await trx.insertInto('OrderItem').values(builtItems.map((i) => ({ ...i, orderId: created.id }))).execute();
        return created;
      });
      const items = (await loadItemsWithMenuItem(kdb, [order.id])).get(order.id) ?? [];
      return { ...order, items };
    }),

  // Only for a still-OPEN (not yet confirmed) ordinary order -- adding
  // more before staff has dispatched/charged it. Open-table rounds never
  // call this; each round is its own child order via createByTable.
  appendItems: publicProcedure
    .input(z.object({ orderId: z.string(), items: z.array(orderItemInput).min(1), tableToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb
        .selectFrom('Order')
        .leftJoin('Table', 'Table.id', 'Order.tableId')
        .selectAll('Order')
        .select(['Table.qrToken as table_qrToken'])
        .where('Order.id', '=', input.orderId)
        .executeTakeFirst();
      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });
      // status !== OPEN alone covers every "closed" case now (cancelled,
      // dispatched, paid) -- payment and dispatch always happen together
      // in the same transaction, so there's no longer a state where an
      // order is OPEN but already charged.
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is closed' });
      }
      if (order.table_qrToken !== input.tableToken) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'table token mismatch' });
      }

      const newItems = await buildOrderItems(kdb, input.items);
      const updated = await kdb.transaction().execute(async (trx) => {
        await trx.insertInto('OrderItem').values(newItems.map((i) => ({ ...i, orderId: order.id }))).execute();
        return trx.updateTable('Order')
          .set({ total: sql`"total" + ${calcTotal(newItems)}` })
          .where('id', '=', order.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      });
      // Still OPEN (unconfirmed) -- not kitchen-relevant yet, so no publish.
      const items = (await loadItemsWithMenuItem(kdb, [updated.id])).get(updated.id) ?? [];
      return { ...updated, items };
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb
        .selectFrom('Order')
        .leftJoin('Table', 'Table.id', 'Order.tableId')
        .selectAll('Order')
        .select(['Table.id as table_id', 'Table.label as table_label', 'Table.qrToken as table_qrToken'])
        .where('Order.id', '=', input.id)
        .executeTakeFirstOrThrow();
      const items = (await loadItemsWithMenuItem(kdb, [order.id])).get(order.id) ?? [];
      return {
        ...order,
        table: order.table_id ? { id: order.table_id, label: order.table_label, qrToken: order.table_qrToken } : null,
        items,
      };
    }),

  // Only a still-active open-table session is ever recovered here -- it's
  // a real ongoing tab, meant to survive a reload/re-scan. A one-time
  // (ordinary) order is deliberately fire-and-forget: once placed, it's
  // done from the customer's side, so leaving and coming back always
  // starts fresh at the mode choice rather than resuming or silently
  // appending to it. A *finished* session is fire-and-forget too, the
  // moment the customer hits Done -- it lingers server-side, OPEN, purely
  // so staff can still confirm payment on it (see listPendingDispatch),
  // but the customer is done with it and must get the fresh mode choice
  // on their next visit, same as an ordinary order.
  getOpenOrderByTableToken: publicProcedure
    .input(z.object({ tableToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const table = await kdb.selectFrom('Table').selectAll().where('qrToken', '=', input.tableToken).executeTakeFirst();
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const session = await kdb.selectFrom('Order').selectAll()
        .where('tableId', '=', table.id).where('source', '=', 'QR').where('isOpenTableSession', '=', true)
        .where('status', '=', 'OPEN').where('sessionFinished', '=', false)
        .orderBy('createdAt', 'desc')
        .executeTakeFirst();
      if (!session) return null;

      const children = await kdb.selectFrom('Order').selectAll().where('parentOrderId', '=', session.id).orderBy('createdAt', 'asc').execute();
      const childIds = children.map((c) => c.id);
      const itemsByOrder = await loadItemsWithMenuItem(kdb, childIds);
      return {
        mode: 'OPEN_TABLE' as const,
        session: { ...session, children: children.map((c) => ({ ...c, items: itemsByOrder.get(c.id) ?? [] })) },
      };
    }),

  // OPEN is excluded on purpose: a charge-first order sits at OPEN until
  // sendToKitchen confirms it, and shouldn't be kitchen-visible before
  // that. SERVED (bumped/delivered) is included but bounded to the last
  // few hours -- the KDS's Delivered/All filters need some recent history,
  // but a full unbounded log would grow forever over a day's service.
  listOpen: roleProcedure('ADMIN', 'STAFF', 'KITCHEN').query(async ({ ctx }) => {
    const kdb = ctx.kdb!;
    const orders = await kdb
      .selectFrom('Order')
      .leftJoin('Table', 'Table.id', 'Order.tableId')
      .where((eb) =>
        eb.or([
          eb('Order.status', 'in', ['SENT_TO_KITCHEN', 'READY']),
          eb.and([eb('Order.status', '=', 'SERVED'), eb('Order.createdAt', '>=', new Date(Date.now() - 4 * 60 * 60 * 1000))]),
        ])
      )
      .selectAll('Order')
      .select(['Table.id as table_id', 'Table.label as table_label', 'Table.qrToken as table_qrToken'])
      .orderBy('Order.createdAt', 'asc')
      .execute();
    const itemsByOrder = await loadItemsWithMenuItem(kdb, orders.map((o) => o.id));
    return orders.map((o) => ({
      ...o,
      table: o.table_id ? { id: o.table_id, label: o.table_label, qrToken: o.table_qrToken } : null,
      items: itemsByOrder.get(o.id) ?? [],
    }));
  }),

  // STAFF may only cancel a still-OPEN (pending, not yet dispatched) order
  // -- e.g. from the Pending Purchases list. Cancelling anything already
  // dispatched/served/paid is a refund-level decision and stays ADMIN-only.
  cancel: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb.selectFrom('Order').selectAll().where('id', '=', input.orderId).executeTakeFirstOrThrow();
      if (order.status === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order already cancelled' });
      }
      if (ctx.user.role === 'STAFF' && order.status !== 'OPEN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only an admin can cancel an order that has already been dispatched' });
      }

      // Cancelling a parent takes every still-live round with it -- there's
      // no such thing as a bill for a session that no longer exists. Each
      // round is cancelled individually (its own stock revert, its own
      // dispatch event) rather than left dangling under a cancelled parent.
      const children = order.isOpenTableSession
        ? await kdb.selectFrom('Order').selectAll().where('parentOrderId', '=', order.id).where('status', '!=', 'CANCELLED').execute()
        : [];
      if (ctx.user.role === 'STAFF' && children.some((c) => c.status !== 'OPEN')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only an admin can cancel a table with rounds already dispatched' });
      }
      const ordersToCancel = [order, ...children];
      const ordersToCancelIds = ordersToCancel.map((o) => o.id);

      // Whether stock needs reverting depends on whether it was actually
      // deducted, not on payment existence -- those used to always happen
      // together, but an open-table child order deducts stock at dispatch
      // with no payment of its own (the parent settles the bill later), so
      // payment-existence alone would miss it. StockMovement is the direct
      // signal either way.
      const deductedIds = new Set(
        (
          await kdb.selectFrom('StockMovement').select('refOrderId')
            .where('refOrderId', 'in', ordersToCancelIds).where('reason', '=', 'SALE').execute()
        ).map((m) => m.refOrderId)
      );
      await kdb.transaction().execute(async (trx) => {
        for (const o of ordersToCancel) {
          await trx.updateTable('Order').set({ status: 'CANCELLED', cancelReason: input.reason }).where('id', '=', o.id).execute();
          if (deductedIds.has(o.id)) {
            await revertStockForOrder(trx, o.id, ctx.user.userId);
          }
        }
      });
      try {
        for (const o of ordersToCancel) {
          await publishOrderEvent('order.cancelled', { orderId: o.id, reason: input.reason });
        }
      } catch (err) {
        console.error('publishOrderEvent failed for order.cancelled', err);
      }
      try {
        await (ctx.cache ?? noopCache).deleteByPrefix('report:dailySales:');
      } catch (err) {
        console.error('dailySales cache invalidation failed after order.cancel', err);
      }
      return { ok: true };
    }),
});
