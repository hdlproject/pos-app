import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { PrismaClient } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { router, protectedProcedure, publicProcedure, roleProcedure } from '../trpc';
import { publishOrderEvent } from '../../ably';
import { revertStockForOrder } from '../../stock/deduct';

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
  createStaff: roleProcedure('ADMIN', 'CASHIER', 'WAITER')
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
    .input(z.object({ orderId: z.string(), items: z.array(orderItemInput).min(1), tableToken: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUnique({ where: { id: input.orderId }, include: { table: true } });
      if (!order) throw new TRPCError({ code: 'NOT_FOUND' });
      if (order.status === 'PAID' || order.status === 'CANCELLED') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is closed' });
      }
      if (input.tableToken && order.table?.qrToken !== input.tableToken) {
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

  listOpen: roleProcedure('ADMIN', 'CASHIER', 'WAITER', 'KITCHEN').query(({ ctx }) =>
    ctx.db.order.findMany({
      where: { status: { in: ['SENT_TO_KITCHEN', 'READY', 'SERVED'] } },
      include: { items: { include: { menuItem: true } }, table: true },
      orderBy: { createdAt: 'asc' },
    })
  ),

  cancel: roleProcedure('ADMIN')
    .input(z.object({ orderId: z.string(), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUniqueOrThrow({ where: { id: input.orderId } });
      const wasPaid = order.status === 'PAID';
      await ctx.db.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      if (wasPaid) {
        await revertStockForOrder(ctx.db, order.id, ctx.user.userId);
      }
      try {
        await publishOrderEvent('order.cancelled', { orderId: order.id, reason: input.reason });
      } catch (err) {
        console.error('publishOrderEvent failed for order.cancelled', err);
      }
      return { ok: true };
    }),
});
