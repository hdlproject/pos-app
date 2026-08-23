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

  // Confirms a charge-first order (paid while still OPEN) and dispatches it
  // to the kitchen. Requires an existing payment -- this is the manual
  // stand-in for what a real payment gateway would confirm automatically.
  sendToKitchen: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUniqueOrThrow({ where: { id: input.orderId } });
      if (order.status !== 'OPEN') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is not pending dispatch' });
      }
      const payment = await ctx.db.payment.findFirst({ where: { orderId: order.id } });
      if (!payment) throw new TRPCError({ code: 'BAD_REQUEST', message: 'order has not been paid yet' });

      const updated = await ctx.db.order.update({ where: { id: order.id }, data: { status: 'SENT_TO_KITCHEN' } });
      try {
        await publishOrderEvent('order.dispatched', updated);
      } catch (err) {
        console.error('publishOrderEvent failed for order.dispatched', err);
      }
      return updated;
    }),

  // Charge-first orders (paid, awaiting manual dispatch confirmation).
  listPendingDispatch: roleProcedure('ADMIN', 'STAFF').query(({ ctx }) =>
    ctx.db.order.findMany({
      where: { status: 'OPEN' },
      include: { items: { include: { menuItem: true } }, table: true, payments: true },
      orderBy: { createdAt: 'asc' },
    })
  ),

  createByTable: publicProcedure
    .input(z.object({ tableToken: z.string(), items: z.array(orderItemInput).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const items = await buildOrderItems(ctx.db, input.items);
      const order = await ctx.db.order.create({
        data: {
          type: 'DINE_IN',
          tableId: table.id,
          status: 'SENT_TO_KITCHEN',
          source: 'QR',
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

  appendItems: publicProcedure
    .input(z.object({ orderId: z.string(), items: z.array(orderItemInput).min(1), tableToken: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUnique({ where: { id: input.orderId }, include: { table: true } });
      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });
      if (order.status === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is closed' });
      }
      // A charge-first order (still OPEN, awaiting dispatch) has already
      // collected a fixed cash amount -- status alone can't tell a paid
      // OPEN order from an unpaid one, so check payment existence directly.
      const existingPayment = await ctx.db.payment.findFirst({ where: { orderId: order.id } });
      if (existingPayment) {
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
      try {
        await publishOrderEvent('order.updated', updated);
      } catch (err) {
        console.error('publishOrderEvent failed for order.updated', err);
      }
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

  getOpenOrderByTableToken: publicProcedure
    .input(z.object({ tableToken: z.string() }))
    .query(async ({ ctx, input }) => {
      const table = await ctx.db.table.findUnique({ where: { qrToken: input.tableToken } });
      if (!table) throw new TRPCError({ code: 'NOT_FOUND', message: 'invalid table token' });

      const order = await ctx.db.order.findFirst({
        where: {
          tableId: table.id,
          source: 'QR',
          status: { in: ['SENT_TO_KITCHEN', 'READY', 'SERVED'] },
        },
        include: { items: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      });
      return order ?? null;
    }),

  // OPEN is excluded on purpose: a charge-first order sits at OPEN until
  // sendToKitchen confirms it, and shouldn't be kitchen-visible before
  // that. SERVED is excluded too -- that's the KDS "Bump" action, meant
  // to clear a ticket off the board once delivered, not leave it parked.
  listOpen: roleProcedure('ADMIN', 'STAFF', 'KITCHEN').query(({ ctx }) =>
    ctx.db.order.findMany({
      where: { status: { in: ['SENT_TO_KITCHEN', 'READY'] } },
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
      // A charge-first order can be paid while still OPEN (stock already
      // deducted), not just once it reaches PAID -- payment existence, not
      // status, is what actually determines whether stock needs reverting.
      const existingPayment = await ctx.db.payment.findFirst({ where: { orderId: order.id } });
      await ctx.db.$transaction(async (tx) => {
        await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', cancelReason: input.reason } });
        if (existingPayment) {
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
