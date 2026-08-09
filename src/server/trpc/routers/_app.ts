import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';
import { ingredientRouter } from './ingredient';
import { tableRouter } from './table';
import { orderRouter } from './order';
import { kitchenRouter } from './kitchen';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
  ingredient: ingredientRouter,
  table: tableRouter,
  order: orderRouter,
  kitchen: kitchenRouter,
});

export type AppRouter = typeof appRouter;
