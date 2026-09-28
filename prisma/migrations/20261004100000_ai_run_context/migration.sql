
-- AlterTable
ALTER TABLE "ai_runs" ADD COLUMN     "brainVersion" TEXT,
ADD COLUMN     "contextTokens" INTEGER,
ADD COLUMN     "retrievedItems" INTEGER,
ADD COLUMN     "sourceTypes" TEXT[] DEFAULT ARRAY[]::TEXT[];

