import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { router, publicProcedure, roleProcedure } from '../trpc';

const menuItemInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string(),
  available: z.boolean().default(true),
  image: z.string().optional(),
  modifiers: z.record(z.string(), z.any()).optional(),
});

// Hand-written (non-generic) shape for MenuItem + Category, used instead of
// Prisma.MenuItemGetPayload<...> to keep the type tRPC infers on the client
// cheap to instantiate (see TS2589 investigation in the build-fix task).
type MenuItemWithCategory = {
  id: string;
  name: string;
  price: Prisma.Decimal;
  categoryId: string;
  available: boolean;
  image: string | null;
  modifiers: Prisma.JsonValue;
  category: {
    id: string;
    name: string;
    sortOrder: number;
  };
};

export const menuRouter = router({
  listAvailable: publicProcedure.query(
    ({ ctx }): Promise<MenuItemWithCategory[]> =>
      ctx.db.menuItem.findMany({
        where: { available: true },
        include: { category: true },
        orderBy: { category: { sortOrder: 'asc' } },
      })
  ),

  listAll: roleProcedure('ADMIN', 'CASHIER', 'WAITER').query(
    ({ ctx }): Promise<MenuItemWithCategory[]> => ctx.db.menuItem.findMany({ include: { category: true } })
  ),

  createCategory: roleProcedure('ADMIN')
    .input(z.object({ name: z.string().min(1), sortOrder: z.number().default(0) }))
    .mutation(({ ctx, input }) => ctx.db.category.create({ data: input })),

  createItem: roleProcedure('ADMIN')
    .input(menuItemInput)
    .mutation(({ ctx, input }) => {
      const data: Prisma.MenuItemUncheckedCreateInput = {
        ...input,
        modifiers: input.modifiers as Prisma.InputJsonValue | undefined,
      };
      return ctx.db.menuItem.create({ data });
    }),

  updateItem: roleProcedure('ADMIN')
    .input(menuItemInput.partial().extend({ id: z.string() }))
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      const data: Prisma.MenuItemUncheckedUpdateInput = {
        ...rest,
        modifiers: rest.modifiers as Prisma.InputJsonValue | undefined,
      };
      return ctx.db.menuItem.update({ where: { id }, data });
    }),
});
