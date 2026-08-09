import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';
import { ingredientRouter } from './ingredient';
import { tableRouter } from './table';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
  ingredient: ingredientRouter,
  table: tableRouter,
});

export type AppRouter = typeof appRouter;
