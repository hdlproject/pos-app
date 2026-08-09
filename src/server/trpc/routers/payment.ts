import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { deductStockForOrder } from '../../stock/deduct';
import { publishOrderEvent } from '../../ably';

export const paymentRouter = router({
  payCash: roleProcedure('ADMIN', 'CASHIER')
    .input(z.object({ orderId: z.string(), tendered: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.findUniqueOrThrow({ where: { id: input.orderId } });
      if (order.status === 'PAID') throw new TRPCError({ code: 'BAD_REQUEST', message: 'order already paid' });
      if (order.status === 'CANCELLED') throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is cancelled' });

      const total = Number(order.total);
      if (input.tendered < total) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'tendered amount is less than total' });
      }
      const change = input.tendered - total;

      await ctx.db.$transaction([
        ctx.db.payment.create({ data: { orderId: order.id, amount: total, method: 'CASH', receivedById: ctx.user.userId } }),
        ctx.db.order.update({ where: { id: order.id }, data: { status: 'PAID' } }),
      ]);
      await deductStockForOrder(ctx.db, order.id, ctx.user.userId);
      try {
        await publishOrderEvent('order.paid', { orderId: order.id });
      } catch (err) {
        console.error('publishOrderEvent failed for order.paid', err);
      }

      return { change };
    }),
});
