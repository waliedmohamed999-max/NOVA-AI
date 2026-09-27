-- CreateTable
CREATE TABLE "provider_calls" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" INTEGER,
    "kind" TEXT NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_calls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_calls_createdAt_idx" ON "provider_calls"("createdAt");

-- CreateIndex
CREATE INDEX "provider_calls_host_createdAt_idx" ON "provider_calls"("host", "createdAt");
