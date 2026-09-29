-- Worker liveness for /api/ready (additive, no data changes).
CREATE TABLE "worker_heartbeats" (
    "workerId" TEXT NOT NULL,
    "host" TEXT,
    "pid" INTEGER,
    "inline" BOOLEAN NOT NULL DEFAULT false,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "worker_heartbeats_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "worker_heartbeats_lastSeenAt_idx" ON "worker_heartbeats"("lastSeenAt");
