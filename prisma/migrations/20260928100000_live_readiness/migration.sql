-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('PROPOSED', 'BOOKED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "Provider" ADD VALUE 'GOOGLE';
ALTER TYPE "Provider" ADD VALUE 'MICROSOFT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SocialPlatform" ADD VALUE 'GOOGLE';
ALTER TYPE "SocialPlatform" ADD VALUE 'MICROSOFT';
ALTER TYPE "SocialPlatform" ADD VALUE 'WHATSAPP';


-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "contentItemId" TEXT,
ADD COLUMN     "landingUrl" TEXT,
ADD COLUMN     "medium" TEXT,
ADD COLUMN     "socialPostId" TEXT,
ADD COLUMN     "utmCampaign" TEXT,
ADD COLUMN     "utmContent" TEXT,
ADD COLUMN     "utmSource" TEXT;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "deliveryStatus" TEXT;

-- AlterTable
ALTER TABLE "workspace_settings" ADD COLUMN     "policies" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "meetings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "integrationId" TEXT,
    "provider" TEXT,
    "externalEventId" TEXT,
    "joinUrl" TEXT,
    "title" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "proposedSlots" JSONB NOT NULL DEFAULT '[]',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "attendeeEmail" TEXT,
    "status" "MeetingStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "carousel_slides" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "headline" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "visualDirection" TEXT,
    "assetId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "history" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carousel_slides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_validations" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "check" TEXT NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "live" BOOLEAN NOT NULL DEFAULT true,
    "detail" TEXT,
    "costMicro" BIGINT NOT NULL DEFAULT 0,
    "organizationId" TEXT,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_validations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "meetings_organizationId_workspaceId_leadId_idx" ON "meetings"("organizationId", "workspaceId", "leadId");

-- CreateIndex
CREATE INDEX "carousel_slides_organizationId_contentItemId_idx" ON "carousel_slides"("organizationId", "contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "carousel_slides_contentItemId_position_key" ON "carousel_slides"("contentItemId", "position");

-- CreateIndex
CREATE INDEX "provider_validations_provider_createdAt_idx" ON "provider_validations"("provider", "createdAt");

