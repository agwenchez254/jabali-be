-- VAT included in an order's total, fixed when the order was placed (null when VAT was off).
ALTER TABLE "orders" ADD COLUMN "vatRateBp" INTEGER;
ALTER TABLE "orders" ADD COLUMN "vatAmount" INTEGER;
ALTER TABLE "orders" ADD COLUMN "vatSeller" JSONB;
