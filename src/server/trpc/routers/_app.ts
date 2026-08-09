import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';
import { ingredientRouter } from './ingredient';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
  ingredient: ingredientRouter,
});

export type AppRouter = typeof appRouter;
