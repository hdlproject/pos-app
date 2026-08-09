import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
});

export type AppRouter = typeof appRouter;
