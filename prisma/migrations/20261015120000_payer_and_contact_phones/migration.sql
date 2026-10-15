-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "contactPhone" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "payerPhone" TEXT;
