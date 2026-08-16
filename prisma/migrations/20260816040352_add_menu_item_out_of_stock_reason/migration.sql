-- Track automatic ingredient-driven sold-out detection separately from the
-- existing manual "available" toggle.
ALTER TABLE "MenuItem" ADD COLUMN "outOfStockReason" TEXT;
