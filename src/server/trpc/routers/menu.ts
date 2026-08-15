import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { router, publicProcedure, roleProcedure } from '../trpc';

const menuItemInput = z.object({
  name: z.string().min(1),
  price: z.number().positive(),
  categoryId: z.string(),
  available: z.boolean().default(true),
  image: z.string().nullable().optional(),
  modifiers: z.record(z.string(), z.any()).optional(),
});

// Deliberately NOT `menuItemInput.partial()`: `.partial()` only makes fields
// optional to provide, it does not remove `available`'s `.default(true)` —
// Zod still fills in `available: true` when the caller omits it, which would
// silently flip a sold-out item back to available on any update that isn't
// explicitly touching `available` (e.g. changing just the photo). This
// schema has no default on `available`, so it only changes when the caller
// explicitly includes it.
const updateItemInput = z.object({
  id: z.string(),
  name: z.string().min(1).optional(),
  price: z.number().positive().optional(),
  categoryId: z.string().optional(),
  available: z.boolean().optional(),
  image: z.string().nullable().optional(),
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

  listAll: roleProcedure('ADMIN', 'STAFF').query(
    ({ ctx }): Promise<MenuItemWithCategory[]> =>
      ctx.db.menuItem.findMany({
        include: { category: true },
        orderBy: { category: { sortOrder: 'asc' } },
      })
  ),

  listCategories: roleProcedure('ADMIN').query(({ ctx }) =>
    ctx.db.category.findMany({ orderBy: { sortOrder: 'asc' } })
  ),

  createCategory: roleProcedure('ADMIN')
    .input(z.object({ name: z.string().min(1), sortOrder: z.number().default(0) }))
    .mutation(({ ctx, input }) => ctx.db.category.create({ data: input })),

  deleteCategory: roleProcedure('ADMIN')
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => ctx.db.category.delete({ where: { id: input.id } })),

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
    .input(updateItemInput)
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      const data: Prisma.MenuItemUncheckedUpdateInput = {
        ...rest,
        modifiers: rest.modifiers as Prisma.InputJsonValue | undefined,
      };
      return ctx.db.menuItem.update({ where: { id }, data });
    }),
});
