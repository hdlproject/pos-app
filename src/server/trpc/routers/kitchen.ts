import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { publishOrderEvent } from '../../ably';

const ITEM_STATUSES = ['QUEUED', 'PREPARING', 'READY', 'SERVED'] as const;

export const kitchenRouter = router({
  updateItemStatus: roleProcedure('ADMIN', 'KITCHEN', 'WAITER')
    .input(z.object({ orderItemId: z.string(), status: z.enum(ITEM_STATUSES) }))
    .mutation(async ({ ctx, input }) => {
      const item = await ctx.db.orderItem.update({
        where: { id: input.orderItemId },
        data: { kitchenStatus: input.status },
      });

      const siblings = await ctx.db.orderItem.findMany({ where: { orderId: item.orderId } });
      const allReady = siblings.every((s) => s.kitchenStatus === 'READY' || s.kitchenStatus === 'SERVED');
      if (allReady) {
        await ctx.db.order.update({ where: { id: item.orderId }, data: { status: 'READY' } });
      }

      try {
        await publishOrderEvent('order.itemStatus', { orderId: item.orderId, orderItemId: item.id, status: item.kitchenStatus });
      } catch (err) {
        console.error('publishOrderEvent failed for order.itemStatus', err);
      }
      return item;
    }),

  markServed: roleProcedure('ADMIN', 'WAITER', 'CASHIER')
    .input(z.object({ orderId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const order = await ctx.db.order.update({ where: { id: input.orderId }, data: { status: 'SERVED' } });
      try {
        await publishOrderEvent('order.served', { orderId: order.id });
      } catch (err) {
        console.error('publishOrderEvent failed for order.served', err);
      }
      return order;
    }),
});
