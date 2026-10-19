-- AI usage limits in tokens per organization (plan allowance + purchased extra tokens). Additive.
ALTER TABLE "ai_budgets" ADD COLUMN "monthlyTokens" BIGINT NOT NULL DEFAULT 2000000;
ALTER TABLE "ai_budgets" ADD COLUMN "extraTokens" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "ai_budgets" ADD COLUMN "exhaustedNotifiedFor" TEXT;

-- Existing organizations get their plan's monthly tokens (STARTER is the column default).
UPDATE "ai_budgets" b SET "monthlyTokens" = CASE s."plan"
    WHEN 'GROWTH' THEN 7500000
    WHEN 'SCALE' THEN 25000000
    ELSE 2000000 END
FROM "subscriptions" s WHERE s."organizationId" = b."organizationId";

CREATE TABLE "ai_token_grants" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "tokens" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "amountCents" INTEGER,
    "currency" TEXT,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_token_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_token_grants_externalId_key" ON "ai_token_grants"("externalId");
CREATE INDEX "ai_token_grants_organizationId_createdAt_idx" ON "ai_token_grants"("organizationId", "createdAt");
