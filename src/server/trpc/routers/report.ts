import { z } from 'zod';
import { router, roleProcedure } from '../trpc';
import { redis } from '../../redis';

const dateRangeInput = z.object({ from: z.string(), to: z.string() });

export const reportRouter = router({
  dailySales: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    const cacheKey = `report:dailySales:${input.from}:${input.to}`;
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const payments = await ctx.db.payment.findMany({
      where: { createdAt: { gte: new Date(input.from), lte: new Date(input.to) } },
    });
    const totalRevenue = payments.reduce((s, p) => s + Number(p.amount), 0);
    const result = {
      totalRevenue,
      orderCount: payments.length,
      avgOrderValue: payments.length ? totalRevenue / payments.length : 0,
    };
    await redis.set(cacheKey, JSON.stringify(result), 'EX', 300);
    return result;
  }),

  bestSellers: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    // A paid charge-first order can still be status OPEN (awaiting kitchen
    // dispatch) rather than PAID -- payment existence is the real "counts
    // as a sale" signal, not the status literal.
    const rows = await ctx.db.orderItem.groupBy({
      by: ['menuItemId'],
      where: { order: { createdAt: { gte: new Date(input.from), lte: new Date(input.to) }, payments: { some: {} } } },
      _sum: { qty: true },
    });
    const menuItems = await ctx.db.menuItem.findMany({ where: { id: { in: rows.map((r) => r.menuItemId) } } });
    const byId = new Map(menuItems.map((m) => [m.id, m]));
    return rows
      .map((r) => ({ menuItem: byId.get(r.menuItemId), qtySold: r._sum.qty ?? 0 }))
      .sort((a, b) => b.qtySold - a.qtySold);
  }),

  salesDetail: roleProcedure('ADMIN', 'STAFF').input(dateRangeInput).query(async ({ ctx, input }) => {
    return ctx.db.order.findMany({
      where: { payments: { some: {} }, createdAt: { gte: new Date(input.from), lte: new Date(input.to) } },
      select: {
        id: true,
        type: true,
        source: true,
        total: true,
        createdAt: true,
        table: { select: { label: true } },
        items: {
          select: {
            id: true,
            qty: true,
            unitPrice: true,
            menuItem: { select: { name: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }),

  // Sales-driven depletion only -- restocks and manual adjustments aren't
  // sales activity, so they don't belong on the sales report. Summarized
  // per ingredient (one row per unique ingredient), not one row per
  // movement -- this is a summary, not a raw ledger.
  inventoryUsage: roleProcedure('ADMIN').input(dateRangeInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db.stockMovement.groupBy({
      by: ['ingredientId'],
      where: { reason: 'SALE', createdAt: { gte: new Date(input.from), lte: new Date(input.to) } },
      _sum: { delta: true },
    });
    const ingredients = await ctx.db.ingredient.findMany({ where: { id: { in: rows.map((r) => r.ingredientId) } } });
    const byId = new Map(ingredients.map((i) => [i.id, i]));
    const usage = rows
      .map((r) => ({ ingredientId: r.ingredientId, ingredient: byId.get(r.ingredientId), totalDelta: r._sum.delta ?? 0 }))
      .sort((a, b) => Number(a.totalDelta) - Number(b.totalDelta));
    return { usage };
  }),

  shiftSummary: roleProcedure('ADMIN').input(dateRangeInput).query(async ({ ctx, input }) => {
    const payments = await ctx.db.payment.findMany({
      where: { createdAt: { gte: new Date(input.from), lte: new Date(input.to) } },
      include: { receivedBy: true },
    });
    const byStaff = new Map<string, { name: string; orderCount: number; total: number }>();
    for (const p of payments) {
      const entry = byStaff.get(p.receivedById) ?? { name: p.receivedBy.name, orderCount: 0, total: 0 };
      entry.orderCount += 1;
      entry.total += Number(p.amount);
      byStaff.set(p.receivedById, entry);
    }
    return Array.from(byStaff.values());
  }),
});
