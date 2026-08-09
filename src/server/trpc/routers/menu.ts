import { z } from 'zod';
import { router, publicProcedure, roleProcedure } from '../trpc';

const menuItemInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string(),
  available: z.boolean().default(true),
  image: z.string().optional(),
  modifiers: z.record(z.any()).optional(),
});

export const menuRouter = router({
  listAvailable: publicProcedure.query(({ ctx }) =>
    ctx.db.menuItem.findMany({
      where: { available: true },
      include: { category: true },
      orderBy: { category: { sortOrder: 'asc' } },
    })
  ),

  listAll: roleProcedure('ADMIN', 'CASHIER', 'WAITER').query(({ ctx }) =>
    ctx.db.menuItem.findMany({ include: { category: true } })
  ),

  createCategory: roleProcedure('ADMIN')
    .input(z.object({ name: z.string().min(1), sortOrder: z.number().default(0) }))
    .mutation(({ ctx, input }) => ctx.db.category.create({ data: input })),

  createItem: roleProcedure('ADMIN')
    .input(menuItemInput)
    .mutation(({ ctx, input }) => ctx.db.menuItem.create({ data: input })),

  updateItem: roleProcedure('ADMIN')
    .input(menuItemInput.partial().extend({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const { id, ...data } = input;
      return ctx.db.menuItem.update({ where: { id }, data });
    }),
});
