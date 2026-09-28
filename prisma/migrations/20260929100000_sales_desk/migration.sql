-- AlterEnum
ALTER TYPE "LeadEventType" ADD VALUE 'OPPORTUNITY';
ALTER TYPE "LeadEventType" ADD VALUE 'QUOTE';
ALTER TYPE "LeadEventType" ADD VALUE 'IMPORTED';

-- CreateEnum
CREATE TYPE "QuoteStatus" AS ENUM ('DRAFT', 'NEEDS_APPROVAL', 'SENT', 'VIEWED', 'ACCEPTED', 'REJECTED', 'EXPIRED');

-- AlterTable
ALTER TABLE "sales_opportunities" ALTER COLUMN "valueCents" DROP NOT NULL,
ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'DEAL',
ADD COLUMN "industry" TEXT,
ADD COLUMN "need" TEXT,
ADD COLUMN "decisionMaker" TEXT,
ADD COLUMN "nextStep" TEXT,
ADD COLUMN "nextStepAt" TIMESTAMP(3),
ADD COLUMN "ownerId" TEXT,
ADD COLUMN "source" TEXT,
ADD COLUMN "summary" TEXT,
ADD COLUMN "qualificationQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "sales_activities" ADD COLUMN "pausedAt" TIMESTAMP(3),
ADD COLUMN "channel" "Channel";

-- CreateTable
CREATE TABLE "quotes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "opportunityId" TEXT,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "subtotalCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "terms" TEXT,
    "status" "QuoteStatus" NOT NULL DEFAULT 'DRAFT',
    "validUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByAgent" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "sentVia" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quotes_organizationId_workspaceId_status_idx" ON "quotes"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "quotes_leadId_idx" ON "quotes"("leadId");
