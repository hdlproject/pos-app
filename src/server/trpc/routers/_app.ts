import { router } from '../trpc';
import { authRouter } from './auth';
import { menuRouter } from './menu';
import { ingredientRouter } from './ingredient';
import { tableRouter } from './table';
import { orderRouter } from './order';
import { kitchenRouter } from './kitchen';
import { paymentRouter } from './payment';
import { reportRouter } from './report';
import { stockBatchRouter } from './stockBatch';

export const appRouter = router({
  auth: authRouter,
  menu: menuRouter,
  ingredient: ingredientRouter,
  table: tableRouter,
  order: orderRouter,
  kitchen: kitchenRouter,
  payment: paymentRouter,
  report: reportRouter,
  stockBatch: stockBatchRouter,
});

export type AppRouter = typeof appRouter;
