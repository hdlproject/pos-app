import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { router, protectedProcedure, publicProcedure, roleProcedure } from '../trpc';
import { publishOrderEvent } from '../../ably';
import { deductStockForOrder, revertStockForOrder } from '../../stock/deduct';
import { redis } from '../../redis';

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

async function buildOrderItems(
  db: PrismaClient,
  items: z.infer<typeof orderItemInput>[]
): Promise<Prisma.OrderItemUncheckedCreateWithoutOrderInput[]> {
  const menuItems = await db.menuItem.findMany({ where: { id: { in: items.map((i) => i.menuItemId) } } });
  const byId = new Map(menuItems.map((m) => [m.id, m]));
  return items.map((i) => {
    const menuItem = byId.get(i.menuItemId);
    if (!menuItem) throw new TRPCError({ code: 'NOT_FOUND', message: `menu item ${i.menuItemId} not found` });
    if (!menuItem.available || menuItem.outOfStockReason) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: `menu item ${menuItem.name} is not available` });
    }
    return {
      menuItemId: i.menuItemId,
      qty: i.qty,
      modifiers: (i.modifiers ?? {}) as Prisma.InputJsonValue,
      unitPrice: menuItem.price,
    };
  });
}

function calcTotal(items: { qty: number; unitPrice: unknown }[]): number {
  return items.reduce((sum, i) => sum + i.qty * Number(i.unitPrice), 0);
}

export const orderRouter = router({
  createStaff: roleProcedure('ADMIN', 'STAFF')
    .input(createOrderInput)
    .mutation(async ({ ctx, input }) => {
      const items = await buildOrderItems(ctx.db, input.items);
      const order = await ctx.db.order.create({
        data: {
          type: input.type,
          tableId: input.tableId,
          status: 'SENT_TO_KITCHEN',
          source: 'STAFF',
          createdById: ctx.user.userId,
          total: calcTotal(items),
          items: { create: items },
        },
        include: { items: true },
      });
      try {
        await publishOrderEvent('order.created', order);
      } catch (err) {
        console.error('publishOrderEvent failed for order.created', err);
      }
      return order;
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
      const items = await buildOrderItems(ctx.db, input.items);
      const total = calcTotal(items);
      const order = await ctx.db.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            type: input.type,
            tableId: input.tableId,
            status: 'OPEN',
            source: 'STAFF',
            createdById: ctx.user.userId,
            total,
            items: { create: items },
          },
        });
        await tx.payment.create({
          data: { orderId: created.id, amount: total, method: 'ONLINE', receivedById: ctx.user.userId },
        });
        await deductStockForOrder(tx, created.id, ctx.user.userId);
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
      const order = await ctx.db.order.findUniqueOrThrow({ where: { id: input.orderId } });
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is not pending dispatch' });
      }

      if (order.isOpenTableSession) {
        if (!order.sessionFinished) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'table has not been finished by the customer yet' });
        }
        const children = await ctx.db.order.findMany({ where: { parentOrderId: order.id } });
        const total = children.reduce((sum, c) => sum + Number(c.total), 0);
        return ctx.db.$transaction(async (tx) => {
          await tx.payment.create({
            data: { orderId: order.id, amount: total, method: 'CASH', receivedById: ctx.user.userId },
          });
          return tx.order.update({ where: { id: order.id }, data: { status: 'PAID', total } });
        });
      }

      if (order.parentOrderId) {
        const updated = await ctx.db.$transaction(async (tx) => {
          await deductStockForOrder(tx, order.id, ctx.user.userId);
          return tx.order.update({ where: { id: order.id }, data: { status: 'SENT_TO_KITCHEN' } });
        });
        try {
          await publishOrderEvent('order.dispatched', updated);
        } catch (err) {
          console.error('publishOrderEvent failed for order.dispatched', err);
        }
        return updated;
      }

      const payment = await ctx.db.payment.findFirst({ where: { orderId: order.id } });
      const updated = await ctx.db.$transaction(async (tx) => {
        if (!payment) {
          await tx.payment.create({
            data: { orderId: order.id, amount: order.total, method: 'CASH', receivedById: ctx.user.userId },
          });
          await deductStockForOrder(tx, order.id, ctx.user.userId);
        }
        return tx.order.update({ where: { id: order.id }, data: { status: 'SENT_TO_KITCHEN' } });
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
  listPendingDispatch: roleProcedure('ADMIN', 'STAFF').query(({ ctx }) =>
    ctx.db.order.findMany({
      where: {
        status: 'OPEN',
        OR: [
          { isOpenTableSession: false, parentOrderId: null },
          { parentOrderId: { not: null } },
          { isOpenTableSession: true, sessionFinished: true },
        ],
      },
      include: { items: { include: { menuItem: true } }, table: true, payments: true, children: true },
      orderBy: { createdAt: 'asc' },
    })
  ),

  // Starts an open-table session: a parent order with no items of its own,
  // anchoring every round the customer submits from here on. Reuses an
  // already-active session for the table instead of creating a duplicate
  // (e.g. a reload racing the recovery query).
  startTableSession: publicProcedure
    .input(z.object({ tableToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const existing = await ctx.db.order.findFirst({
        where: { tableId: table.id, source: 'QR', isOpenTableSession: true, status: 'OPEN' },
      });
      if (existing) return existing;

      return ctx.db.order.create({
        data: {
          type: 'DINE_IN',
          tableId: table.id,
          status: 'OPEN',
          source: 'QR',
          isOpenTableSession: true,
          total: 0,
        },
      });
    }),

  // Customer-initiated: "I'm done ordering, bring the bill." Doesn't charge
  // anything itself (a customer has no business authorizing their own
  // charge) -- just flags the session so Pending Purchases swaps that
  // parent's action from nothing to Confirm payment.
  finishTableSession: publicProcedure
    .input(z.object({ tableToken: z.string(), orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUnique({ where: { id: input.orderId }, include: { table: true } });
      if (!order || !order.isOpenTableSession) throw new TRPCError({ code: 'NOT_FOUND' });
      if (order.table?.qrToken !== input.tableToken) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'table token mismatch' });
      }
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'session is already closed' });
      }
      return ctx.db.order.update({ where: { id: order.id }, data: { sessionFinished: true } });
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
      const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      if (input.parentOrderId) {
        const parent = await ctx.db.order.findUnique({ where: { id: input.parentOrderId } });
        if (!parent || !parent.isOpenTableSession || parent.tableId !== table.id) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table session' });
        }
        if (parent.status !== 'OPEN' || parent.sessionFinished) {
          throw new TRPCError({ code: 'BAD_REQUEST', message: 'table session is closed' });
        }
      }

      const items = await buildOrderItems(ctx.db, input.items);
      const order = await ctx.db.order.create({
        data: {
          type: 'DINE_IN',
          tableId: table.id,
          status: 'OPEN',
          source: 'QR',
          parentOrderId: input.parentOrderId,
          total: calcTotal(items),
          items: { create: items },
        },
        include: { items: true },
      });
      // Not kitchen-relevant yet -- sendToKitchen publishes the dispatch
      // event once staff actually confirms it.
      return order;
    }),

  // Only for a still-OPEN (not yet confirmed) ordinary order -- adding
  // more before staff has dispatched/charged it. Open-table rounds never
  // call this; each round is its own child order via createByTable.
  appendItems: publicProcedure
    .input(z.object({ orderId: z.string(), items: z.array(orderItemInput).min(1), tableToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUnique({ where: { id: input.orderId }, include: { table: true } });
      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });
      // status !== OPEN alone covers every "closed" case now (cancelled,
      // dispatched, paid) -- payment and dispatch always happen together
      // in the same transaction, so there's no longer a state where an
      // order is OPEN but already charged.
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is closed' });
      }
      if (order.table?.qrToken !== input.tableToken) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'table token mismatch' });
      }

      const newItems = await buildOrderItems(ctx.db, input.items);
      const updated = await ctx.db.order.update({
        where: { id: order.id },
        data: { total: { increment: calcTotal(newItems) }, items: { create: newItems } },
        include: { items: true },
      });
      // Still OPEN (unconfirmed) -- not kitchen-relevant yet, so no publish.
      return updated;
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(({ ctx, input }) =>
      ctx.db.order.findUniqueOrThrow({
        where: { id: input.id },
        include: { items: { include: { menuItem: true } }, table: true },
      })
    ),

  // Only an open-table session is ever recovered here -- it's a real
  // ongoing tab, meant to survive a reload/re-scan. A one-time (ordinary)
  // order is deliberately fire-and-forget: once placed, it's done from
  // the customer's side, so leaving and coming back always starts fresh
  // at the mode choice rather than resuming or silently appending to it.
  // status: 'OPEN' alone is right for the session parent (it never leaves
  // OPEN until PAID closes it out, whether the session is still ongoing
  // or finished and just awaiting staff's payment confirmation).
  getOpenOrderByTableToken: publicProcedure
    .input(z.object({ tableToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const session = await ctx.db.order.findFirst({
        where: { tableId: table.id, source: 'QR', isOpenTableSession: true, status: 'OPEN' },
        include: { children: { include: { items: true } } },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      return session ? { mode: 'OPEN_TABLE' as const, session } : null;
    }),

  // OPEN is excluded on purpose: a charge-first order sits at OPEN until
  // sendToKitchen confirms it, and shouldn't be kitchen-visible before
  // that. SERVED (bumped/delivered) is included but bounded to the last
  // few hours -- the KDS's Delivered/All filters need some recent history,
  // but a full unbounded log would grow forever over a day's service.
  listOpen: roleProcedure('ADMIN', 'STAFF', 'KITCHEN').query(({ ctx }) =>
    ctx.db.order.findMany({
      where: {
        OR: [
          { status: { in: ['SENT_TO_KITCHEN', 'READY'] } },
          { status: 'SERVED', createdAt: { gte: new Date(Date.now() - 4 * 60 * 60 * 1000) } },
        ],
      },
      include: { items: { include: { menuItem: true } }, table: true },
      orderBy: { createdAt: 'asc' },
    })
  ),

  // STAFF may only cancel a still-OPEN (pending, not yet dispatched) order
  // -- e.g. from the Pending Purchases list. Cancelling anything already
  // dispatched/served/paid is a refund-level decision and stays ADMIN-only.
  cancel: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUniqueOrThrow({ where: { id: input.orderId } });
      if (order.status === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order already cancelled' });
      }
      if (ctx.user.role === 'STAFF' && order.status !== 'OPEN') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'only an admin can cancel an order that has already been dispatched' });
      }
      // Whether stock needs reverting depends on whether it was actually
      // deducted, not on payment existence -- those used to always happen
      // together, but an open-table child order deducts stock at dispatch
      // with no payment of its own (the parent settles the bill later), so
      // payment-existence alone would miss it. StockMovement is the direct
      // signal either way.
      const wasDeducted = await ctx.db.stockMovement.findFirst({ where: { refOrderId: order.id, reason: 'SALE' } });
      await ctx.db.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelReason: input.reason } });
        if (wasDeducted) {
          await revertStockForOrder(tx, order.id, ctx.user.userId);
        }
      });
      try {
        await publishOrderEvent('order.cancelled', { orderId: order.id, reason: input.reason });
      } catch (err) {
        console.error('publishOrderEvent failed for order.cancelled', err);
      }
      try {
        const keys = await redis.keys('report:dailySales:*');
        if (keys.length) await redis.del(...keys);
      } catch (err) {
        console.error('dailySales cache invalidation failed after order.cancel', err);
      }
      return { ok: true };
    }),
});
