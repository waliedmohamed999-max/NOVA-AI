CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MEMBER', 'VIEWER');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET', 'MAGIC_LINK');

-- CreateEnum
CREATE TYPE "OnboardingStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'ANALYZING', 'COMPLETED');

-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('STARTER', 'GROWTH', 'SCALE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'INCOMPLETE');

-- CreateEnum
CREATE TYPE "KnowledgeSourceType" AS ENUM ('WEBSITE', 'DOCUMENT', 'MANUAL', 'FAQ', 'PRODUCT', 'SERVICE', 'PRICING', 'POLICY', 'CASE_STUDY');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "OfferingType" AS ENUM ('PRODUCT', 'SERVICE');

-- CreateEnum
CREATE TYPE "AssetKind" AS ENUM ('LOGO', 'IMAGE', 'VIDEO', 'FONT', 'TEMPLATE', 'DOCUMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "DesignFormat" AS ENUM ('SQUARE', 'PORTRAIT', 'STORY', 'CAROUSEL', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "AgentKey" AS ENUM ('SOCIAL_MANAGER', 'CONTENT_STRATEGIST', 'DESIGNER', 'PERFORMANCE_ANALYST', 'SALES_AGENT', 'SALES_ASSISTANT');

-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('WORKING', 'WAITING_APPROVAL', 'MONITORING', 'IDLE', 'PAUSED');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TIKTOK', 'X', 'YOUTUBE', 'PINTEREST', 'EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "IntegrationStatus" AS ENUM ('CONNECTED', 'ACTION_REQUIRED', 'EXPIRED', 'ERROR', 'DISCONNECTED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'TIKTOK', 'X', 'YOUTUBE', 'PINTEREST');

-- CreateEnum
CREATE TYPE "ContentFormat" AS ENUM ('POST', 'CAROUSEL', 'STORY', 'REEL', 'SHORT_VIDEO', 'LINKEDIN_POST');

-- CreateEnum
CREATE TYPE "ContentStatus" AS ENUM ('IDEA', 'DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalAction" AS ENUM ('APPROVED', 'REJECTED', 'CHANGES_REQUESTED', 'COMMENTED', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('PENDING', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "LeadTemperature" AS ENUM ('HOT', 'WARM', 'COLD');

-- CreateEnum
CREATE TYPE "LeadEventType" AS ENUM ('CREATED', 'FORM_SUBMITTED', 'MESSAGE_RECEIVED', 'MESSAGE_SENT', 'AI_ANALYSIS', 'HUMAN_REPLY', 'FOLLOW_UP', 'MEETING', 'PROPOSAL', 'STATUS_CHANGE', 'SCORE_CHANGE', 'NOTE');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AGENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('WEBSITE', 'EMAIL', 'INSTAGRAM_DM', 'FACEBOOK_DM', 'LINKEDIN', 'WHATSAPP', 'PHONE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SENT', 'FAILED', 'RECEIVED');

-- CreateEnum
CREATE TYPE "OpportunityStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "SalesActivityType" AS ENUM ('FOLLOW_UP', 'CALL', 'EMAIL', 'MEETING', 'TASK', 'PROPOSAL');

-- CreateEnum
CREATE TYPE "SalesAutonomy" AS ENUM ('ASSIST', 'COPILOT', 'AUTOPILOT');

-- CreateEnum
CREATE TYPE "ApprovalCategory" AS ENUM ('CONTENT', 'PUBLISHING', 'SALES', 'PRICING', 'CAMPAIGNS');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPROVAL_NEEDED', 'POST_PUBLISHED', 'PUBLISHING_FAILED', 'LEAD_QUALIFIED', 'HOT_OPPORTUNITY', 'FOLLOW_UP_DUE', 'MEETING_BOOKED', 'INTEGRATION_DISCONNECTED', 'AI_RECOMMENDATION', 'REPORT_READY', 'USAGE_LIMIT');

-- CreateEnum
CREATE TYPE "AiTaskType" AS ENUM ('COPYWRITING', 'ANALYSIS', 'CLASSIFICATION', 'SUMMARIZATION', 'STRATEGY', 'SALES', 'EXTRACTION', 'VISION', 'STRUCTURED', 'EMBEDDING');

-- CreateEnum
CREATE TYPE "AiRunStatus" AS ENUM ('SUCCESS', 'ERROR', 'BLOCKED');

-- CreateEnum
CREATE TYPE "InsightScope" AS ENUM ('POST', 'CAMPAIGN', 'ACCOUNT', 'CONTENT_CATEGORY', 'FORMAT', 'LEADS', 'PIPELINE', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "InsightStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('DAILY_BRIEF', 'WEEKLY_REPORT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD');

-- CreateEnum
CREATE TYPE "AuditCategory" AS ENUM ('BUSINESS', 'SECURITY');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMP(3),
    "locale" TEXT NOT NULL DEFAULT 'en',
    "avatarUrl" TEXT,
    "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "activeOrganizationId" TEXT,
    "userAgent" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowEnd" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "industry" TEXT,
    "website" TEXT,
    "onboardingStatus" "OnboardingStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "onboardingData" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspaces" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_settings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "salesAutonomy" "SalesAutonomy" NOT NULL DEFAULT 'COPILOT',
    "autopilotAllowedTasks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requireContentApproval" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "dailyBriefHour" INTEGER NOT NULL DEFAULT 8,
    "weeklyReportDay" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "plan" "PlanTier" NOT NULL DEFAULT 'STARTER',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "billingProvider" TEXT,
    "providerCustomerId" TEXT,
    "providerSubscriptionId" TEXT,
    "trialEndsAt" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "metric" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_budgets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monthlyAllowanceMicro" BIGINT NOT NULL DEFAULT 20000000,
    "softLimitPercent" INTEGER NOT NULL DEFAULT 80,
    "hardLimitEnabled" BOOLEAN NOT NULL DEFAULT true,
    "softLimitNotifiedFor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT,
    "description" TEXT,
    "website" TEXT,
    "industry" TEXT,
    "markets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" JSONB NOT NULL DEFAULT '[]',
    "valueProps" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "differentiators" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competitors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "primaryGoal" TEXT,
    "contentPillars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "strategy" JSONB,
    "discoveries" JSONB,
    "summary" TEXT,
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offerings" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "OfferingType" NOT NULL DEFAULT 'SERVICE',
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceText" TEXT,
    "priceCents" INTEGER,
    "currency" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_kits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "logoAssetId" TEXT,
    "primaryColors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "secondaryColors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "headingFont" TEXT,
    "bodyFont" TEXT,
    "tone" TEXT,
    "voiceTraits" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "doSay" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dontSay" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "imageStyle" TEXT,
    "layoutRules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "forbiddenStyles" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brand_kits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_objects" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "storageKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brand_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "fileId" TEXT,
    "url" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brand_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "design_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "format" "DesignFormat" NOT NULL,
    "spec" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "design_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_sources" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "KnowledgeSourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "url" TEXT,
    "fileId" TEXT,
    "rawText" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_documents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "embedding" vector(1536),
    "embeddingModel" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" "AgentKey" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "AgentStatus" NOT NULL DEFAULT 'IDLE',
    "currentTask" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "lastActiveAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT,
    "kind" TEXT NOT NULL,
    "input" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'QUEUED',
    "steps" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB,
    "error" TEXT,
    "requestedById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_tasks" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "runId" TEXT,
    "title" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'OPEN',
    "entityType" TEXT,
    "entityId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integrations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "status" "IntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "statusMessage" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSyncAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "platform" "SocialPlatform",
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "avatarUrl" TEXT,
    "accountType" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_credentials" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "accountId" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenType" TEXT,
    "expiresAt" TIMESTAMP(3),
    "refreshExpiresAt" TIMESTAMP(3),
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "id" TEXT NOT NULL,
    "stateHash" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "codeVerifierEnc" TEXT,
    "redirectTo" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "audience" TEXT,
    "offer" TEXT,
    "channels" "SocialPlatform"[] DEFAULT ARRAY[]::"SocialPlatform"[],
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "budgetCents" INTEGER,
    "currency" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "plan" JSONB,
    "createdByAgent" "AgentKey",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "format" "ContentFormat" NOT NULL DEFAULT 'POST',
    "status" "ContentStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "pillar" TEXT,
    "hook" TEXT,
    "caption" TEXT NOT NULL,
    "cta" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "designBrief" JSONB,
    "aiRationale" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "authorAgent" "AgentKey",
    "authorUserId" TEXT,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "hook" TEXT,
    "caption" TEXT NOT NULL,
    "cta" TEXT,
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "designBrief" JSONB,
    "changeNote" TEXT,
    "createdByAgent" "AgentKey",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_assets" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "kind" "AssetKind" NOT NULL DEFAULT 'IMAGE',
    "fileId" TEXT,
    "url" TEXT,
    "altText" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "generatedBy" TEXT,
    "prompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "userId" TEXT,
    "version" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationAccountId" TEXT,
    "contentItemId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "permalink" TEXT,
    "format" "ContentFormat",
    "caption" TEXT,
    "mediaUrl" TEXT,
    "pillar" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_publications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "integrationAccountId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "socialPostId" TEXT,
    "jobId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_metrics" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "reach" INTEGER,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "videoViews" INTEGER,
    "followersGained" INTEGER,
    "leads" INTEGER,
    "conversions" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_metric_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "socialPostId" TEXT NOT NULL,
    "reach" INTEGER,
    "impressions" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "clicks" INTEGER,
    "videoViews" INTEGER,
    "followersGained" INTEGER,
    "leads" INTEGER,
    "conversions" INTEGER,
    "engagementRate" DOUBLE PRECISION,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_metric_snapshots" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "integrationAccountId" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "date" DATE NOT NULL,
    "followers" INTEGER,
    "reach" INTEGER,
    "impressions" INTEGER,
    "profileViews" INTEGER,
    "raw" JSONB NOT NULL DEFAULT '{}',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_metric_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "channel" "Channel" NOT NULL DEFAULT 'MANUAL',
    "source" TEXT,
    "campaignId" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "score" INTEGER NOT NULL DEFAULT 0,
    "temperature" "LeadTemperature" NOT NULL DEFAULT 'COLD',
    "estimatedValueCents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ownerId" TEXT,
    "lastContactAt" TIMESTAMP(3),
    "nextAction" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT,
    "intent" TEXT,
    "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiInsight" TEXT,
    "stageChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "LeadEventType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actorType" "ActorType" NOT NULL DEFAULT 'SYSTEM',
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_scores" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "temperature" "LeadTemperature" NOT NULL,
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "method" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_notes" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_capture_forms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "successMessage" TEXT,
    "campaignId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "submissions" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lead_capture_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT,
    "channel" "Channel" NOT NULL,
    "subject" TEXT,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "externalThreadId" TEXT,
    "summary" TEXT,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_participants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" "ActorType" NOT NULL,
    "name" TEXT,
    "handle" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "authorType" "ActorType" NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "externalId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "stage" "LeadStage" NOT NULL,
    "label" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_opportunities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "valueCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "OpportunityStatus" NOT NULL DEFAULT 'OPEN',
    "expectedCloseAt" TIMESTAMP(3),
    "proposal" JSONB,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_activities" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "SalesActivityType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "dueAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "assignedToId" TEXT,
    "createdByAgent" "AgentKey",
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "category" "ApprovalCategory" NOT NULL,
    "action" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "reason" TEXT,
    "impact" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "requestedByAgent" "AgentKey",
    "requestedById" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "agentKey" "AgentKey",
    "agentRunId" TEXT,
    "task" "AiTaskType" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicro" BIGINT NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "status" "AiRunStatus" NOT NULL,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "agentKey" TEXT NOT NULL DEFAULT 'none',
    "requests" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" BIGINT NOT NULL DEFAULT 0,
    "outputTokens" BIGINT NOT NULL DEFAULT 0,
    "costMicro" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_usage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_insights" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" "InsightScope" NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "confidence" DOUBLE PRECISION,
    "status" "InsightStatus" NOT NULL DEFAULT 'ACTIVE',
    "supersededById" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "generatedBy" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "narrative" TEXT,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "result" JSONB,
    "dedupeKey" TEXT,
    "organizationId" TEXT,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "status" "JobStatus" NOT NULL,
    "error" TEXT,
    "durationMs" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_jobs" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "intervalSeconds" INTEGER NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "organizationId" TEXT,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "workspaceId" TEXT,
    "category" "AuditCategory" NOT NULL DEFAULT 'BUSINESS',
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "summary" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "fileId" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "verification_tokens_tokenHash_key" ON "verification_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "verification_tokens_email_purpose_idx" ON "verification_tokens"("email", "purpose");

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key" ON "oauth_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_windowEnd_idx" ON "rate_limit_buckets"("windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE INDEX "organization_members_userId_idx" ON "organization_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organizationId_userId_key" ON "organization_members"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "invitations_tokenHash_key" ON "invitations"("tokenHash");

-- CreateIndex
CREATE INDEX "invitations_organizationId_idx" ON "invitations"("organizationId");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "invitations"("email");

-- CreateIndex
CREATE INDEX "workspaces_organizationId_idx" ON "workspaces"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "workspaces_organizationId_slug_key" ON "workspaces"("organizationId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_settings_workspaceId_key" ON "workspace_settings"("workspaceId");

-- CreateIndex
CREATE INDEX "workspace_settings_organizationId_idx" ON "workspace_settings"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organizationId_key" ON "subscriptions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_providerSubscriptionId_key" ON "subscriptions"("providerSubscriptionId");

-- CreateIndex
CREATE INDEX "usage_records_organizationId_metric_periodStart_idx" ON "usage_records"("organizationId", "metric", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "ai_budgets_organizationId_key" ON "ai_budgets"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_workspaceId_key" ON "company_profiles"("workspaceId");

-- CreateIndex
CREATE INDEX "company_profiles_organizationId_idx" ON "company_profiles"("organizationId");

-- CreateIndex
CREATE INDEX "offerings_organizationId_workspaceId_idx" ON "offerings"("organizationId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "brand_kits_workspaceId_key" ON "brand_kits"("workspaceId");

-- CreateIndex
CREATE INDEX "brand_kits_organizationId_idx" ON "brand_kits"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "file_objects_storageKey_key" ON "file_objects"("storageKey");

-- CreateIndex
CREATE INDEX "file_objects_organizationId_idx" ON "file_objects"("organizationId");

-- CreateIndex
CREATE INDEX "brand_assets_organizationId_workspaceId_idx" ON "brand_assets"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "design_templates_organizationId_workspaceId_idx" ON "design_templates"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "knowledge_sources_organizationId_workspaceId_type_idx" ON "knowledge_sources"("organizationId", "workspaceId", "type");

-- CreateIndex
CREATE INDEX "knowledge_documents_organizationId_workspaceId_idx" ON "knowledge_documents"("organizationId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_documents_sourceId_contentHash_key" ON "knowledge_documents"("sourceId", "contentHash");

-- CreateIndex
CREATE INDEX "knowledge_chunks_organizationId_workspaceId_idx" ON "knowledge_chunks"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "knowledge_chunks_sourceId_idx" ON "knowledge_chunks"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_documentId_index_key" ON "knowledge_chunks"("documentId", "index");

-- CreateIndex
CREATE INDEX "agents_organizationId_idx" ON "agents"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "agents_workspaceId_key_key" ON "agents"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "agent_runs_organizationId_workspaceId_createdAt_idx" ON "agent_runs"("organizationId", "workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_tasks_organizationId_workspaceId_agentId_createdAt_idx" ON "agent_tasks"("organizationId", "workspaceId", "agentId", "createdAt");

-- CreateIndex
CREATE INDEX "integrations_organizationId_idx" ON "integrations"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "integrations_workspaceId_provider_key" ON "integrations"("workspaceId", "provider");

-- CreateIndex
CREATE INDEX "integration_accounts_organizationId_workspaceId_idx" ON "integration_accounts"("organizationId", "workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "integration_accounts_integrationId_externalId_key" ON "integration_accounts"("integrationId", "externalId");

-- CreateIndex
CREATE INDEX "integration_credentials_organizationId_idx" ON "integration_credentials"("organizationId");

-- CreateIndex
CREATE INDEX "integration_credentials_expiresAt_idx" ON "integration_credentials"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "integration_credentials_integrationId_accountId_key" ON "integration_credentials"("integrationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_states_stateHash_key" ON "oauth_states"("stateHash");

-- CreateIndex
CREATE INDEX "oauth_states_expiresAt_idx" ON "oauth_states"("expiresAt");

-- CreateIndex
CREATE INDEX "campaigns_organizationId_workspaceId_status_idx" ON "campaigns"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "content_items_organizationId_workspaceId_status_idx" ON "content_items"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "content_items_workspaceId_scheduledAt_idx" ON "content_items"("workspaceId", "scheduledAt");

-- CreateIndex
CREATE INDEX "content_items_campaignId_idx" ON "content_items"("campaignId");

-- CreateIndex
CREATE INDEX "content_versions_organizationId_idx" ON "content_versions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_contentItemId_version_key" ON "content_versions"("contentItemId", "version");

-- CreateIndex
CREATE INDEX "content_assets_organizationId_contentItemId_idx" ON "content_assets"("organizationId", "contentItemId");

-- CreateIndex
CREATE INDEX "content_approvals_organizationId_contentItemId_idx" ON "content_approvals"("organizationId", "contentItemId");

-- CreateIndex
CREATE INDEX "social_posts_organizationId_workspaceId_publishedAt_idx" ON "social_posts"("organizationId", "workspaceId", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "social_posts_workspaceId_platform_externalId_key" ON "social_posts"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "social_publications_organizationId_workspaceId_status_idx" ON "social_publications"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "social_publications_scheduledFor_idx" ON "social_publications"("scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "social_metrics_socialPostId_key" ON "social_metrics"("socialPostId");

-- CreateIndex
CREATE INDEX "social_metrics_organizationId_workspaceId_idx" ON "social_metrics"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "social_metric_snapshots_socialPostId_capturedAt_idx" ON "social_metric_snapshots"("socialPostId", "capturedAt");

-- CreateIndex
CREATE INDEX "social_metric_snapshots_organizationId_idx" ON "social_metric_snapshots"("organizationId");

-- CreateIndex
CREATE INDEX "account_metric_snapshots_organizationId_idx" ON "account_metric_snapshots"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "account_metric_snapshots_workspaceId_platform_date_key" ON "account_metric_snapshots"("workspaceId", "platform", "date");

-- CreateIndex
CREATE INDEX "leads_organizationId_workspaceId_stage_idx" ON "leads"("organizationId", "workspaceId", "stage");

-- CreateIndex
CREATE INDEX "leads_workspaceId_temperature_idx" ON "leads"("workspaceId", "temperature");

-- CreateIndex
CREATE INDEX "leads_workspaceId_email_idx" ON "leads"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "lead_events_leadId_createdAt_idx" ON "lead_events"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "lead_events_organizationId_idx" ON "lead_events"("organizationId");

-- CreateIndex
CREATE INDEX "lead_scores_leadId_createdAt_idx" ON "lead_scores"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "lead_scores_organizationId_idx" ON "lead_scores"("organizationId");

-- CreateIndex
CREATE INDEX "lead_notes_leadId_idx" ON "lead_notes"("leadId");

-- CreateIndex
CREATE INDEX "lead_notes_organizationId_idx" ON "lead_notes"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_capture_forms_publicKey_key" ON "lead_capture_forms"("publicKey");

-- CreateIndex
CREATE INDEX "lead_capture_forms_organizationId_workspaceId_idx" ON "lead_capture_forms"("organizationId", "workspaceId");

-- CreateIndex
CREATE INDEX "conversations_organizationId_workspaceId_lastMessageAt_idx" ON "conversations"("organizationId", "workspaceId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "conversations_leadId_idx" ON "conversations"("leadId");

-- CreateIndex
CREATE INDEX "conversation_participants_conversationId_idx" ON "conversation_participants"("conversationId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_organizationId_idx" ON "messages"("organizationId");

-- CreateIndex
CREATE INDEX "pipeline_stages_organizationId_idx" ON "pipeline_stages"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_workspaceId_stage_key" ON "pipeline_stages"("workspaceId", "stage");

-- CreateIndex
CREATE INDEX "sales_opportunities_organizationId_workspaceId_status_idx" ON "sales_opportunities"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE INDEX "sales_activities_organizationId_workspaceId_dueAt_idx" ON "sales_activities"("organizationId", "workspaceId", "dueAt");

-- CreateIndex
CREATE INDEX "sales_activities_leadId_idx" ON "sales_activities"("leadId");

-- CreateIndex
CREATE INDEX "approvals_organizationId_workspaceId_status_category_idx" ON "approvals"("organizationId", "workspaceId", "status", "category");

-- CreateIndex
CREATE INDEX "approvals_entityType_entityId_idx" ON "approvals"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "approval_policies_organizationId_idx" ON "approval_policies"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "approval_policies_workspaceId_action_key" ON "approval_policies"("workspaceId", "action");

-- CreateIndex
CREATE INDEX "notifications_userId_organizationId_readAt_idx" ON "notifications"("userId", "organizationId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_organizationId_idx" ON "notifications"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_organizationId_userId_type_key" ON "notification_preferences"("organizationId", "userId", "type");

-- CreateIndex
CREATE INDEX "ai_runs_organizationId_createdAt_idx" ON "ai_runs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_runs_organizationId_agentKey_idx" ON "ai_runs"("organizationId", "agentKey");

-- CreateIndex
CREATE UNIQUE INDEX "ai_usage_organizationId_period_agentKey_key" ON "ai_usage"("organizationId", "period", "agentKey");

-- CreateIndex
CREATE INDEX "ai_insights_organizationId_workspaceId_scope_status_idx" ON "ai_insights"("organizationId", "workspaceId", "scope", "status");

-- CreateIndex
CREATE INDEX "ai_insights_subjectType_subjectId_idx" ON "ai_insights"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "reports_organizationId_idx" ON "reports"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "reports_workspaceId_kind_periodStart_key" ON "reports"("workspaceId", "kind", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_dedupeKey_key" ON "jobs"("dedupeKey");

-- CreateIndex
CREATE INDEX "jobs_status_runAt_priority_idx" ON "jobs"("status", "runAt", "priority");

-- CreateIndex
CREATE INDEX "jobs_organizationId_createdAt_idx" ON "jobs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "job_runs_jobId_idx" ON "job_runs"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_jobs_key_key" ON "scheduled_jobs"("key");

-- CreateIndex
CREATE INDEX "scheduled_jobs_enabled_nextRunAt_idx" ON "scheduled_jobs"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_category_createdAt_idx" ON "audit_logs"("category", "createdAt");

-- CreateIndex
CREATE INDEX "data_exports_organizationId_idx" ON "data_exports"("organizationId");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_budgets" ADD CONSTRAINT "ai_budgets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_documents" ADD CONSTRAINT "knowledge_documents_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "knowledge_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "knowledge_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agent_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_accounts" ADD CONSTRAINT "integration_accounts_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "integration_credentials" ADD CONSTRAINT "integration_credentials_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "integrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_approvals" ADD CONSTRAINT "content_approvals_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_posts" ADD CONSTRAINT "social_posts_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_publications" ADD CONSTRAINT "social_publications_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_metrics" ADD CONSTRAINT "social_metrics_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_metric_snapshots" ADD CONSTRAINT "social_metric_snapshots_socialPostId_fkey" FOREIGN KEY ("socialPostId") REFERENCES "social_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_scores" ADD CONSTRAINT "lead_scores_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lead_notes" ADD CONSTRAINT "lead_notes_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_participants" ADD CONSTRAINT "conversation_participants_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_opportunities" ADD CONSTRAINT "sales_opportunities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_activities" ADD CONSTRAINT "sales_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ───────────── NOVA hardening (hand-written) ─────────────

-- Append-only history: audit logs, lead timelines and metric snapshots may be
-- inserted and (via tenant deletion) removed, but never rewritten.
CREATE OR REPLACE FUNCTION nova_forbid_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION nova_forbid_update();
CREATE TRIGGER lead_events_append_only BEFORE UPDATE ON "lead_events"
  FOR EACH ROW EXECUTE FUNCTION nova_forbid_update();
CREATE TRIGGER social_metric_snapshots_append_only BEFORE UPDATE ON "social_metric_snapshots"
  FOR EACH ROW EXECUTE FUNCTION nova_forbid_update();

-- Retrieval: keyword search always available, vector search when embeddings exist.
CREATE INDEX knowledge_chunks_fts_idx ON "knowledge_chunks"
  USING GIN (to_tsvector('simple', "content"));
CREATE INDEX knowledge_chunks_embedding_idx ON "knowledge_chunks"
  USING hnsw ("embedding" vector_cosine_ops);
