-- AlterTable
ALTER TABLE "customer_accounts" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifyAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifyCodeHash" TEXT,
ADD COLUMN     "verifyExpiresAt" TIMESTAMP(3),
ADD COLUMN     "verifySendsThisHour" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "verifySentAt" TIMESTAMP(3),
ADD COLUMN     "verifyWindowStart" TIMESTAMP(3);

