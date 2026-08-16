-- CreateEnum
CREATE TYPE "StockBatchStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED');

-- CreateTable
CREATE TABLE "StockAdjustmentBatch" (
    "id" TEXT NOT NULL,
    "status" "StockBatchStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,

    CONSTRAINT "StockAdjustmentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustmentLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "ingredientId" TEXT NOT NULL,
    "delta" DECIMAL(10,3) NOT NULL,
    "reason" "StockReason" NOT NULL,

    CONSTRAINT "StockAdjustmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockAdjustmentLine_batchId_ingredientId_key" ON "StockAdjustmentLine"("batchId", "ingredientId");

-- Ensure at most one PENDING batch exists at a time. Not expressible via
-- Prisma's schema DSL (no partial/filtered unique index support), so this
-- index is added by hand.
CREATE UNIQUE INDEX "one_pending_stock_batch" ON "StockAdjustmentBatch" ((status)) WHERE status = 'PENDING';

-- AddForeignKey
ALTER TABLE "StockAdjustmentBatch" ADD CONSTRAINT "StockAdjustmentBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentBatch" ADD CONSTRAINT "StockAdjustmentBatch_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "StockAdjustmentBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockAdjustmentLine" ADD CONSTRAINT "StockAdjustmentLine_ingredientId_fkey" FOREIGN KEY ("ingredientId") REFERENCES "Ingredient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
