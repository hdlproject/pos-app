import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { deductStockForOrder } from '../../stock/deduct';
import { publishOrderEvent } from '../../ably';
import { redis } from '../../redis';

export const paymentRouter = router({
  payCash: roleProcedure('ADMIN', 'STAFF')
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

      await ctx.db.$transaction(async (tx) => {
        await tx.payment.create({ data: { orderId: order.id, amount: total, method: 'CASH', receivedById: ctx.user.userId } });
        await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
        await deductStockForOrder(tx, order.id, ctx.user.userId);
      });
      try {
        await publishOrderEvent('order.paid', { orderId: order.id });
      } catch (err) {
        console.error('publishOrderEvent failed for order.paid', err);
      }
      try {
        const keys = await redis.keys('report:dailySales:*');
        if (keys.length) await redis.del(...keys);
      } catch (err) {
        console.error('dailySales cache invalidation failed after payment.payCash', err);
      }

      return { change };
    }),
});
