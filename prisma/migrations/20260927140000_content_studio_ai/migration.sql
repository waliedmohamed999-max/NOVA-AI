-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('QUEUED', 'GENERATING', 'UPLOADING', 'COMPLETED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AiTaskType" ADD VALUE 'IMAGE_GENERATION';
ALTER TYPE "AiTaskType" ADD VALUE 'IMAGE_EDIT';


-- AlterTable
ALTER TABLE "ai_runs" ADD COLUMN     "promptKey" TEXT,
ADD COLUMN     "promptVersion" TEXT;

-- AlterTable
ALTER TABLE "content_assets" ADD COLUMN     "contentVersion" INTEGER,
ADD COLUMN     "costMicro" BIGINT NOT NULL DEFAULT 0,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "errorCode" TEXT,
ADD COLUMN     "height" INTEGER,
ADD COLUMN     "instruction" TEXT,
ADD COLUMN     "isSelected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mode" TEXT,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "parentAssetId" TEXT,
ADD COLUMN     "preset" TEXT,
ADD COLUMN     "promptKey" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "provider" TEXT,
ADD COLUMN     "quality" TEXT,
ADD COLUMN     "status" "AssetStatus" NOT NULL DEFAULT 'COMPLETED',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "variant" TEXT,
ADD COLUMN     "width" INTEGER;

-- AlterTable
ALTER TABLE "content_items" ADD COLUMN     "derivedFromId" TEXT;

-- AlterTable
ALTER TABLE "content_versions" ADD COLUMN     "platformNotes" TEXT,
ADD COLUMN     "promptVersion" TEXT,
ADD COLUMN     "qualityCheck" JSONB,
ADD COLUMN     "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "source" TEXT,
ADD COLUMN     "visualDirection" TEXT;

-- AlterTable
ALTER TABLE "workspace_settings" ADD COLUMN     "imageMode" TEXT NOT NULL DEFAULT 'brand_template',
ADD COLUMN     "imageQuality" TEXT NOT NULL DEFAULT 'fast';

-- CreateIndex
CREATE INDEX "ai_runs_organizationId_task_createdAt_idx" ON "ai_runs"("organizationId", "task", "createdAt");

-- CreateIndex
CREATE INDEX "content_assets_organizationId_createdAt_idx" ON "content_assets"("organizationId", "createdAt");


-- Existing assets were the single visual of their post: keep them selected.
UPDATE "content_assets" SET "isSelected" = true;
