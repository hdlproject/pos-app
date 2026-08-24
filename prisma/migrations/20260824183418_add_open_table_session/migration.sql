-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "isOpenTableSession" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "parentOrderId" TEXT,
ADD COLUMN     "sessionFinished" BOOLEAN NOT NULL DEFAULT false;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_parentOrderId_fkey" FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
