-- CreateTable
CREATE TABLE "command_executions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "intent" TEXT,
    "kind" TEXT,
    "entities" JSONB NOT NULL DEFAULT '{}',
    "action" TEXT,
    "status" TEXT NOT NULL,
    "response" JSONB NOT NULL DEFAULT '{}',
    "plan" JSONB,
    "receipt" JSONB,
    "runId" TEXT,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "approvalRequired" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "errorDetail" TEXT,
    "latencyMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "command_executions_organizationId_workspaceId_userId_create_idx" ON "command_executions"("organizationId", "workspaceId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "command_executions_organizationId_userId_idempotencyKey_key" ON "command_executions"("organizationId", "userId", "idempotencyKey");

