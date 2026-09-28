
-- AlterTable
ALTER TABLE "ai_runs" ADD COLUMN     "commandExecutionId" TEXT;

-- AlterTable
ALTER TABLE "command_executions" ADD COLUMN     "brainVersion" TEXT,
ADD COLUMN     "cacheHit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "contextTokens" INTEGER,
ADD COLUMN     "costMicro" BIGINT,
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "mode" TEXT,
ADD COLUMN     "outputTokens" INTEGER,
ADD COLUMN     "retrievedItems" INTEGER,
ADD COLUMN     "routing" JSONB;

-- CreateTable
CREATE TABLE "command_cache" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "brainVersion" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "queryKey" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "hits" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "command_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "command_cache_organizationId_workspaceId_createdAt_idx" ON "command_cache"("organizationId", "workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "command_cache_organizationId_workspaceId_brainVersion_inten_key" ON "command_cache"("organizationId", "workspaceId", "brainVersion", "intent", "queryKey", "locale");

-- CreateIndex
CREATE INDEX "command_executions_organizationId_createdAt_idx" ON "command_executions"("organizationId", "createdAt");

