import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { publishOrderEvent } from '../../ably';

const ITEM_STATUSES = ['QUEUED', 'PREPARING', 'READY', 'SERVED'] as const;

export const kitchenRouter = router({
  updateItemStatus: roleProcedure('ADMIN', 'KITCHEN', 'STAFF')
    .input(z.object({ orderItemId: z.string(), status: z.enum(ITEM_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const kdb = ctx.kdb!;
      const item = await kdb
        .updateTable('OrderItem')
        .set({ kitchenStatus: input.status })
        .where('id', '=', input.orderItemId)
        .returningAll()
        .executeTakeFirstOrThrow();

      const siblings = await kdb.selectFrom('OrderItem').selectAll().where('orderId', '=', item.orderId).execute();
      const allReady = siblings.every((s) => s.kitchenStatus === 'READY' || s.kitchenStatus === 'SERVED');
      if (allReady) {
        await kdb.updateTable('Order').set({ status: 'READY' }).where('id', '=', item.orderId).execute();
      }

      try {
        await publishOrderEvent('order.itemStatus', { orderId: item.orderId, orderItemId: item.id, status: item.kitchenStatus });
      } catch (err) {
        console.error('publishOrderEvent failed for order.itemStatus', err);
      }
      return item;
    }),

  markServed: roleProcedure('ADMIN', 'STAFF', 'KITCHEN')
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.kdb!
        .updateTable('Order')
        .set({ status: 'SERVED' })
        .where('id', '=', input.orderId)
        .returningAll()
        .executeTakeFirstOrThrow();
      try {
        await publishOrderEvent('order.served', { orderId: order.id });
      } catch (err) {
        console.error('publishOrderEvent failed for order.served', err);
      }
      return order;
    }),
});
