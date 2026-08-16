-- Remove lowStockThreshold: sold-out detection is driven by stockQty <= 0, not a threshold.
ALTER TABLE "Ingredient" DROP COLUMN "lowStockThreshold";
