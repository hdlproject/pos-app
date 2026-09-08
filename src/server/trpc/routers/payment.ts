import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { router, roleProcedure } from '../trpc';
import { createId } from '../../id';
import { deductStockForOrder } from '../../stock/deduct';
import { publishOrderEvent } from '../../ably';
import { noopCache } from '../../cache';

export const paymentRouter = router({
  payCash: roleProcedure('ADMIN', 'STAFF')
    .input(z.object({ orderId: z.string(), tendered: z.number().positive() }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const order = await kdb.selectFrom('Order').selectAll().where('id', '=', input.orderId).executeTakeFirstOrThrow();
      if (order.status === 'CANCELLED') throw new TRPCError({ code: 'BAD_REQUEST', message: 'order is cancelled' });
      const existingPayment = await kdb.selectFrom('Payment').selectAll().where('orderId', '=', order.id).executeTakeFirst();
      if (existingPayment) throw new TRPCError({ code: 'BAD_REQUEST', message: 'order already paid' });

      const total = Number(order.total);
      if (input.tendered < total) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'tendered amount is less than total' });
      }
      const change = input.tendered - total;

      await kdb.transaction().execute(async (trx) => {
        await trx.insertInto('Payment')
          .values({ id: createId(), orderId: order.id, amount: total, method: 'ONLINE', receivedById: ctx.user.userId })
          .execute();
        // OPEN means the cart-side "Charge Cash" flow paid before dispatching to
        // the kitchen -- leave status as OPEN so it stays off the KDS board until
        // order.sendToKitchen confirms it. Every other flow pays after the order
        // is already SENT_TO_KITCHEN/READY/SERVED, where PAID is the correct
        // terminal status (unchanged from before).
        if (order.status !== 'OPEN') {
          await trx.updateTable('Order').set({ status: 'PAID' }).where('id', '=', order.id).execute();
        }
        await deductStockForOrder(trx, order.id, ctx.user.userId);
      });
      try {
        await publishOrderEvent('order.paid', { orderId: order.id });
      } catch (err) {
        console.error('publishOrderEvent failed for order.paid', err);
      }
      try {
        await (ctx.cache ?? noopCache).deleteByPrefix('report:dailySales:');
      } catch (err) {
        console.error('dailySales cache invalidation failed after payment.payCash', err);
      }

      return { change };
    }),
});
