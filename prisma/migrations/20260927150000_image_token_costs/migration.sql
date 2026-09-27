
-- AlterTable
ALTER TABLE "ai_runs" ADD COLUMN     "costBasis" TEXT,
ADD COLUMN     "pricingVersion" TEXT;

-- AlterTable
ALTER TABLE "content_assets" ADD COLUMN     "costBasis" TEXT,
ADD COLUMN     "pricingVersion" TEXT,
ADD COLUMN     "usage" JSONB;

