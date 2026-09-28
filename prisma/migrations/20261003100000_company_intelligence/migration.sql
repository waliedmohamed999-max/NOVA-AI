-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "KnowledgeSourceType" ADD VALUE 'STORE';
ALTER TYPE "KnowledgeSourceType" ADD VALUE 'SPREADSHEET';
ALTER TYPE "KnowledgeSourceType" ADD VALUE 'CRM';
ALTER TYPE "KnowledgeSourceType" ADD VALUE 'API';


-- AlterTable
ALTER TABLE "brand_kits" ADD COLUMN     "ctaStyle" TEXT,
ADD COLUMN     "forbiddenClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hashtagRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "seasonalThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "topics" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "company_profiles" ADD COLUMN     "brandPromise" TEXT,
ADD COLUMN     "businessModel" TEXT,
ADD COLUMN     "countries" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "fieldSources" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "mission" TEXT,
ADD COLUMN     "vision" TEXT,
ADD COLUMN     "whyChooseUs" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "knowledge_sources" ADD COLUMN     "language" TEXT,
ADD COLUMN     "lastVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "lastOrderAt" TIMESTAMP(3),
ADD COLUMN     "ordersCount" INTEGER,
ADD COLUMN     "purchaseCategories" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "totalSpendCents" INTEGER;

-- AlterTable
ALTER TABLE "offerings" ADD COLUMN     "benefits" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "caseStudies" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "category" TEXT,
ADD COLUMN     "crossSell" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "deliveryModel" TEXT,
ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "problemSolved" TEXT,
ADD COLUMN     "proofPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "salesCycle" TEXT,
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceKind" TEXT NOT NULL DEFAULT 'manual',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "targetCustomer" TEXT,
ADD COLUMN     "upsell" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "brain_facts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "verifiedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_facts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_faqs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "category" TEXT,
    "audience" TEXT,
    "channel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "sourceKind" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_faqs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_objections" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "objection" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "proof" TEXT,
    "automation" TEXT NOT NULL DEFAULT 'draft_only',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "sourceKind" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_objections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "positioning" TEXT,
    "services" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricing" TEXT,
    "strengths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weaknesses" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contentThemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'manual',
    "sourceId" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_segments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT,
    "criteria" JSONB NOT NULL DEFAULT '{}',
    "size" INTEGER,
    "sizedAt" TIMESTAMP(3),
    "source" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'approved',
    "notes" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideal_customer_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'B2B',
    "name" TEXT NOT NULL,
    "industry" TEXT,
    "companySize" TEXT,
    "location" TEXT,
    "budget" TEXT,
    "painPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "buyingTriggers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decisionMaker" TEXT,
    "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "salesCycle" TEXT,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'approved',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideal_customer_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "objective" TEXT,
    "targetAudience" TEXT,
    "positioning" TEXT,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kpis" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "initiatives" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "risks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "timeline" TEXT,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "generatedBy" TEXT NOT NULL DEFAULT 'manual',
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "strategies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_knowledge" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "playbook" TEXT,
    "qualificationQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discoveryQuestions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "pricingRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discountRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "proposalRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "followUpCadence" TEXT,
    "redFlags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "escalationRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_imports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "title" TEXT NOT NULL,
    "fileId" TEXT,
    "url" TEXT,
    "sourceId" TEXT,
    "preview" JSONB NOT NULL DEFAULT '{}',
    "candidates" JSONB NOT NULL DEFAULT '[]',
    "mapping" JSONB,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdById" TEXT,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brain_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brain_revisions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "sourceKind" TEXT NOT NULL DEFAULT 'manual',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brain_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brain_facts_organizationId_workspaceId_category_idx" ON "brain_facts"("organizationId", "workspaceId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "brain_facts_workspaceId_key_key" ON "brain_facts"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "brain_faqs_organizationId_workspaceId_status_idx" ON "brain_faqs"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "brain_objections_organizationId_workspaceId_idx" ON "brain_objections"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "competitors_organizationId_workspaceId_idx" ON "competitors"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "customer_segments_organizationId_workspaceId_status_idx" ON "customer_segments"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "ideal_customer_profiles_organizationId_workspaceId_idx" ON "ideal_customer_profiles"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "strategies_organizationId_workspaceId_type_idx" ON "strategies"("organizationId", "workspaceId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "sales_knowledge_workspaceId_key" ON "sales_knowledge"("workspaceId");

-- CreateIndex
CREATE INDEX "sales_knowledge_organizationId_idx" ON "sales_knowledge"("organizationId");

-- CreateIndex
CREATE INDEX "brain_imports_organizationId_workspaceId_createdAt_idx" ON "brain_imports"("organizationId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "brain_revisions_organizationId_workspaceId_entityType_entit_idx" ON "brain_revisions"("organizationId", "workspaceId", "entityType", "entityId");

-- CreateIndex
CREATE INDEX "brain_revisions_organizationId_workspaceId_createdAt_idx" ON "brain_revisions"("organizationId", "workspaceId", "createdAt");

