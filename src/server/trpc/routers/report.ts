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
    const rows = await ctx.db.orderItem.groupBy({
      by: ['menuItemId'],
      where: { order: { createdAt: { gte: new Date(input.from), lte: new Date(input.to) }, status: 'PAID' } },
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
      where: { status: 'PAID', createdAt: { gte: new Date(input.from), lte: new Date(input.to) } },
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

  inventoryUsage: roleProcedure('ADMIN').input(dateRangeInput).query(async ({ ctx, input }) => {
    const usage = await ctx.db.stockMovement.findMany({
      where: { createdAt: { gte: new Date(input.from), lte: new Date(input.to) } },
      include: { ingredient: true },
    });
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
