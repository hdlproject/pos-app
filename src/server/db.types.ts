import type { ColumnType, Generated } from 'kysely';

export type Role = 'ADMIN' | 'STAFF' | 'KITCHEN';
export type OrderType = 'DINE_IN' | 'TAKEAWAY' | 'DELIVERY';
export type OrderSource = 'STAFF' | 'QR';
export type OrderStatus = 'OPEN' | 'SENT_TO_KITCHEN' | 'READY' | 'SERVED' | 'PAID' | 'CANCELLED';
export type ItemStatus = 'QUEUED' | 'PREPARING' | 'READY' | 'SERVED';
export type StockReason = 'SALE' | 'MANUAL_ADJUST' | 'RESTOCK' | 'VOID_REVERT';
export type StockBatchStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

// numeric/decimal columns: postgres.js returns them as strings (confirmed
// empirically this session — SELECT always yields a string), but every
// router/test call site inserts or updates these columns with a plain JS
// number literal (e.g. `stockQty: 1000`, `price: input.price`) — also
// confirmed empirically to work. ColumnType's three type parameters are
// (selected type, insert type, update type), so this is Select=string,
// Insert/Update=string|number — NOT a plain `string` alias, which would
// wrongly reject every numeric literal at every insert/update call site.
type Numeric = ColumnType<string, string | number, string | number>;

export interface StoreTable {
  id: string;
  name: string;
}

export interface UserTable {
  id: string;
  name: string;
  pinHash: string;
  role: Role;
  active: Generated<boolean>;
  createdAt: Generated<Date>;
}

export interface TableTable {
  id: string;
  label: string;
  qrToken: string;
  createdAt: Generated<Date>;
}

export interface CategoryTable {
  id: string;
  name: string;
  sortOrder: Generated<number>;
}

export interface MenuItemTable {
  id: string;
  name: string;
  price: Numeric;
  categoryId: string;
  available: Generated<boolean>;
  outOfStockReason: string | null;
  description: string | null;
  instructions: string | null;
  image: string | null;
  modifiers: unknown | null;
}

export interface IngredientTable {
  id: string;
  name: string;
  unit: string;
  stockQty: Numeric;
}

export interface RecipeTable {
  id: string;
  menuItemId: string;
  ingredientId: string;
  qtyPerUnit: Numeric;
}

export interface OrderTable {
  id: string;
  type: OrderType;
  tableId: string | null;
  status: Generated<OrderStatus>;
  source: OrderSource;
  cancelReason: string | null;
  createdById: string | null;
  total: ColumnType<string, string | number | undefined, string | number>;
  createdAt: Generated<Date>;
  parentOrderId: string | null;
  isOpenTableSession: Generated<boolean>;
  sessionFinished: Generated<boolean>;
}

export interface OrderItemTable {
  id: string;
  orderId: string;
  menuItemId: string;
  qty: number;
  modifiers: unknown | null;
  unitPrice: Numeric;
  kitchenStatus: Generated<ItemStatus>;
}

export interface PaymentTable {
  id: string;
  orderId: string;
  amount: Numeric;
  method: Generated<string>;
  receivedById: string;
  createdAt: Generated<Date>;
}

export interface StockMovementTable {
  id: string;
  ingredientId: string;
  delta: Numeric;
  reason: StockReason;
  refOrderId: string | null;
  createdAt: Generated<Date>;
  createdById: string;
}

export interface StockAdjustmentBatchTable {
  id: string;
  status: Generated<StockBatchStatus>;
  note: string | null;
  createdAt: Generated<Date>;
  createdById: string;
  confirmedAt: Date | null;
  confirmedById: string | null;
}

export interface StockAdjustmentLineTable {
  id: string;
  batchId: string;
  ingredientId: string;
  delta: Numeric;
  reason: StockReason;
}

export interface DB {
  Store: StoreTable;
  User: UserTable;
  Table: TableTable;
  Category: CategoryTable;
  MenuItem: MenuItemTable;
  Ingredient: IngredientTable;
  Recipe: RecipeTable;
  Order: OrderTable;
  OrderItem: OrderItemTable;
  Payment: PaymentTable;
  StockMovement: StockMovementTable;
  StockAdjustmentBatch: StockAdjustmentBatchTable;
  StockAdjustmentLine: StockAdjustmentLineTable;
}
