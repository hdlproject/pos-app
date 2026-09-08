import { z } from 'zod';
import type { Kysely } from 'kysely';
import type { DB } from '../../db.types';
import { router, publicProcedure, roleProcedure } from '../trpc';
import { createId } from '../../id';

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

type MenuItemWithCategory = {
  id: string;
  name: string;
  price: string;
  categoryId: string;
  available: boolean;
  outOfStockReason: string | null;
  image: string | null;
  modifiers: unknown;
  category: {
    id: string;
    name: string;
    sortOrder: number;
  };
};

async function listMenuItems(db: Kysely<DB>, onlyAvailable: boolean): Promise<MenuItemWithCategory[]> {
  let query = db
    .selectFrom('MenuItem')
    .innerJoin('Category', 'Category.id', 'MenuItem.categoryId')
    .select([
      'MenuItem.id as id',
      'MenuItem.name as name',
      'MenuItem.price as price',
      'MenuItem.categoryId as categoryId',
      'MenuItem.available as available',
      'MenuItem.outOfStockReason as outOfStockReason',
      'MenuItem.image as image',
      'MenuItem.modifiers as modifiers',
      'Category.id as category_id',
      'Category.name as category_name',
      'Category.sortOrder as category_sortOrder',
    ]);
  if (onlyAvailable) {
    query = query.where('MenuItem.available', '=', true).where('MenuItem.outOfStockReason', 'is', null);
  }
  const rows = await query.orderBy('Category.sortOrder', 'asc').orderBy('MenuItem.name', 'asc').execute();
  return rows.map((r) => ({
    id: r.id, name: r.name, price: r.price, categoryId: r.categoryId, available: r.available,
    outOfStockReason: r.outOfStockReason, image: r.image, modifiers: r.modifiers,
    category: { id: r.category_id, name: r.category_name, sortOrder: r.category_sortOrder },
  }));
}

export const menuRouter = router({
  listAvailable: publicProcedure.query(({ ctx }) => listMenuItems(ctx.db, true)),

  listAll: roleProcedure('ADMIN', 'STAFF').query(({ ctx }) => listMenuItems(ctx.db, false)),

  listCategories: roleProcedure('ADMIN').query(({ ctx }) =>
    ctx.db.selectFrom('Category').selectAll().orderBy('sortOrder', 'asc').execute()
  ),

  createCategory: roleProcedure('ADMIN')
    .input(z.object({ name: z.string().min(1), sortOrder: z.number().default(0) }))
    .mutation(({ ctx, input }) =>
      ctx.db.insertInto('Category')
        .values({ id: createId(), name: input.name, sortOrder: input.sortOrder })
        .returningAll()
        .executeTakeFirstOrThrow()
    ),

  deleteCategory: roleProcedure('ADMIN')
    .input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) =>
      ctx.db.deleteFrom('Category').where('id', '=', input.id).returningAll().executeTakeFirstOrThrow()
    ),

  createItem: roleProcedure('ADMIN')
    .input(menuItemInput)
    .mutation(({ ctx, input }) =>
      ctx.db.insertInto('MenuItem')
        .values({
          id: createId(),
          name: input.name,
          price: input.price,
          categoryId: input.categoryId,
          available: input.available,
          image: input.image ?? null,
          modifiers: input.modifiers ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow()
    ),

  updateItem: roleProcedure('ADMIN')
    .input(updateItemInput)
    .mutation(({ ctx, input }) => {
      const { id, ...rest } = input;
      // Kysely's .set() automatically drops keys whose value is `undefined`
      // (verified this session), matching Prisma's update() semantics — a
      // field the caller omitted is left untouched, not set to NULL. But if
      // every field is omitted, .set() would emit an empty SET list, which
      // Postgres rejects as a syntax error — Prisma treated that case as a
      // no-op returning the unchanged row, so we do too.
      if (Object.values(rest).every((v) => v === undefined)) {
        return ctx.db.selectFrom('MenuItem').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
      }
      return ctx.db.updateTable('MenuItem').set(rest).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
    }),
});
