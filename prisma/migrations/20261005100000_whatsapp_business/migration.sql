-- WhatsApp Business: numbers health, contact opt-out/consent, delivery states, WhatsApp campaigns
-- (recipients over the CRM), templates and a suppression list. Hand-checked: keeps the vector index.

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'social',
ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "sendStartedAt" TIMESTAMP(3),
ADD COLUMN     "waAudience" JSONB,
ADD COLUMN     "waNumberId" TEXT,
ADD COLUMN     "waState" TEXT,
ADD COLUMN     "waTemplateId" TEXT,
ADD COLUMN     "waVariables" JSONB;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "needsHuman" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "unreadCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "whatsappNumberId" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "phoneDigits" TEXT,
ADD COLUMN     "whatsappConsent" BOOLEAN,
ADD COLUMN     "whatsappOptOut" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsappOptOutAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ADD COLUMN     "failedReason" TEXT,
ADD COLUMN     "intent" TEXT,
ADD COLUMN     "mediaFileId" TEXT,
ADD COLUMN     "mediaMime" TEXT,
ADD COLUMN     "messageType" TEXT NOT NULL DEFAULT 'text',
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "templateName" TEXT;

-- AlterTable
ALTER TABLE "whatsapp_numbers" ADD COLUMN     "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "integrationId" TEXT,
ADD COLUMN     "lastSendAt" TIMESTAMP(3),
ADD COLUMN     "lastWebhookAt" TIMESTAMP(3),
ADD COLUMN     "messagingLimit" TEXT,
ADD COLUMN     "qualityRating" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'connected';

-- AlterTable
ALTER TABLE "workspace_settings" ADD COLUMN     "whatsappAutoReply" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "whatsappConfig" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "campaign_recipients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "variables" JSONB NOT NULL DEFAULT '[]',
    "messageId" TEXT,
    "externalId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "header" TEXT,
    "body" TEXT NOT NULL,
    "footer" TEXT,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "variables" JSONB NOT NULL DEFAULT '{}',
    "externalId" TEXT,
    "rejectedReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_suppressions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_recipients_campaignId_status_idx" ON "campaign_recipients"("campaignId", "status");

-- CreateIndex
CREATE INDEX "campaign_recipients_organizationId_externalId_idx" ON "campaign_recipients"("organizationId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipients_campaignId_leadId_key" ON "campaign_recipients"("campaignId", "leadId");

-- CreateIndex
CREATE INDEX "whatsapp_templates_organizationId_workspaceId_status_idx" ON "whatsapp_templates"("organizationId", "workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_workspaceId_name_language_key" ON "whatsapp_templates"("workspaceId", "name", "language");

-- CreateIndex
CREATE INDEX "whatsapp_suppressions_organizationId_idx" ON "whatsapp_suppressions"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_suppressions_workspaceId_phone_key" ON "whatsapp_suppressions"("workspaceId", "phone");

-- CreateIndex
CREATE INDEX "leads_workspaceId_phoneDigits_idx" ON "leads"("workspaceId", "phoneDigits");

-- CreateIndex
CREATE INDEX "messages_organizationId_externalId_idx" ON "messages"("organizationId", "externalId");

-- Backfill: digits-only phone for existing leads (WhatsApp contact matching).
UPDATE "leads" SET "phoneDigits" = NULLIF(regexp_replace("phone", '[^0-9]', '', 'g'), '') WHERE "phone" IS NOT NULL;

-- Backfill: last customer message per conversation (24h customer-service window).
UPDATE "conversations" c SET "lastInboundAt" = m.at
FROM (SELECT "conversationId", MAX(COALESCE("sentAt", "createdAt")) AS at FROM "messages" WHERE "direction" = 'INBOUND' GROUP BY "conversationId") m
WHERE m."conversationId" = c."id";

-- phoneDigits is maintained by the database on every write of "phone" (imports, forms, CRM, WhatsApp).
CREATE OR REPLACE FUNCTION leads_phone_digits() RETURNS trigger AS $$
BEGIN
  NEW."phoneDigits" := NULLIF(regexp_replace(COALESCE(NEW."phone", ''), '[^0-9]', '', 'g'), '');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leads_phone_digits_trg BEFORE INSERT OR UPDATE OF "phone" ON "leads"
  FOR EACH ROW EXECUTE FUNCTION leads_phone_digits();
