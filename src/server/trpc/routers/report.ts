import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { noopCache } from '../../cache';

const dateRangeInput = z.object({ from: z.string(), to: z.string() });

export const reportRouter = router({
  dailySales: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    const cache = ctx.cache ?? noopCache;
    const cacheKey = `report:dailySales:${input.from}:${input.to}`;
    const cached = await cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const payments = await ctx.db
      .selectFrom('Payment')
      .selectAll()
      .where('createdAt', '>=', new Date(input.from))
      .where('createdAt', '<=', new Date(input.to))
      .execute();
    const totalRevenue = payments.reduce((s, p) => s + Number(p.amount), 0);
    const result = {
      totalRevenue,
      orderCount: payments.length,
      avgOrderValue: payments.length ? totalRevenue / payments.length : 0,
    };
    await cache.set(cacheKey, JSON.stringify(result), 300);
    return result;
  }),

  bestSellers: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    const db = ctx.db;
    // A paid charge-first order can still be status OPEN (awaiting kitchen
    // dispatch) rather than PAID -- payment existence is the real "counts
    // as a sale" signal, not the status literal.
    const rows = await db
      .selectFrom('OrderItem')
      .innerJoin('Order', 'Order.id', 'OrderItem.orderId')
      .where('Order.createdAt', '>=', new Date(input.from))
      .where('Order.createdAt', '<=', new Date(input.to))
      .where((eb) =>
        eb.exists(eb.selectFrom('Payment').select('Payment.id').whereRef('Payment.orderId', '=', 'Order.id'))
      )
      .groupBy('OrderItem.menuItemId')
      .select(['OrderItem.menuItemId as menuItemId', (eb) => eb.fn.sum('OrderItem.qty').as('qtySold')])
      .execute();

    const menuItemIds = rows.map((r) => r.menuItemId);
    const menuItems = menuItemIds.length === 0 ? [] : await db.selectFrom('MenuItem').selectAll().where('id', 'in', menuItemIds).execute();
    const byId = new Map(menuItems.map((m) => [m.id, m]));
    return rows
      .map((r) => ({ menuItem: byId.get(r.menuItemId), qtySold: Number(r.qtySold ?? 0) }))
      .sort((a, b) => b.qtySold - a.qtySold);
  }),

  salesDetail: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    const db = ctx.db;
    const orders = await db
      .selectFrom('Order')
      .leftJoin('Table', 'Table.id', 'Order.tableId')
      .where('Order.createdAt', '>=', new Date(input.from))
      .where('Order.createdAt', '<=', new Date(input.to))
      .where((eb) =>
        eb.exists(eb.selectFrom('Payment').select('Payment.id').whereRef('Payment.orderId', '=', 'Order.id'))
      )
      .select([
        'Order.id as id', 'Order.type as type', 'Order.source as source', 'Order.total as total', 'Order.createdAt as createdAt',
        'Table.label as tableLabel',
      ])
      .orderBy('Order.createdAt', 'desc')
      .execute();

    const orderIds = orders.map((o) => o.id);
    const items = orderIds.length === 0 ? [] : await db
      .selectFrom('OrderItem')
      .innerJoin('MenuItem', 'MenuItem.id', 'OrderItem.menuItemId')
      .select(['OrderItem.id as id', 'OrderItem.orderId as orderId', 'OrderItem.qty as qty', 'OrderItem.unitPrice as unitPrice', 'MenuItem.name as menuItemName'])
      .where('OrderItem.orderId', 'in', orderIds)
      .execute();
    const itemsByOrder = new Map<string, typeof items>();
    for (const i of items) {
      const list = itemsByOrder.get(i.orderId) ?? [];
      list.push(i);
      itemsByOrder.set(i.orderId, list);
    }

    return orders.map((o) => ({
      id: o.id, type: o.type, source: o.source, total: o.total, createdAt: o.createdAt,
      table: o.tableLabel ? { label: o.tableLabel } : null,
      items: (itemsByOrder.get(o.id) ?? []).map((i) => ({
        id: i.id, qty: i.qty, unitPrice: i.unitPrice, menuItem: { name: i.menuItemName },
      })),
    }));
  }),

  // Sales-driven depletion only -- restocks and manual adjustments aren't
  // sales activity, so they don't belong on the sales report. Summarized
  // per ingredient (one row per unique ingredient), not one row per
  // movement -- this is a summary, not a raw ledger.
  inventoryUsage: roleProcedure('ADMIN').input(dateRangeInput).query(async ({ ctx, input }) => {
    const db = ctx.db;
    const rows = await db
      .selectFrom('StockMovement')
      .where('reason', '=', 'SALE')
      .where('createdAt', '>=', new Date(input.from))
      .where('createdAt', '<=', new Date(input.to))
      .groupBy('ingredientId')
      .select(['ingredientId', (eb) => eb.fn.sum('delta').as('totalDelta')])
      .execute();
    const ingredientIds = rows.map((r) => r.ingredientId);
    const ingredients = ingredientIds.length === 0 ? [] : await db.selectFrom('Ingredient').selectAll().where('id', 'in', ingredientIds).execute();
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const usage = rows
      .map((r) => ({ ingredientId: r.ingredientId, ingredient: byId.get(r.ingredientId), totalDelta: r.totalDelta ?? '0' }))
      .sort((a, b) => Number(a.totalDelta) - Number(b.totalDelta));
    return { usage };
  }),

  shiftSummary: roleProcedure('ADMIN').input(dateRangeInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .selectFrom('Payment')
      .innerJoin('User', 'User.id', 'Payment.receivedById')
      .where('Payment.createdAt', '>=', new Date(input.from))
      .where('Payment.createdAt', '<=', new Date(input.to))
      .select(['Payment.receivedById as receivedById', 'Payment.amount as amount', 'User.name as name'])
      .execute();
    const byStaff = new Map<string, { name: string; orderCount: number; total: number }>();
    for (const p of rows) {
      const entry = byStaff.get(p.receivedById) ?? { name: p.name, orderCount: 0, total: 0 };
      entry.orderCount += 1;
      entry.total += Number(p.amount);
      byStaff.set(p.receivedById, entry);
    }
    return Array.from(byStaff.values());
  }),
});
