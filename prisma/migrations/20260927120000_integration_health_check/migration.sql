-- Connection health checks (integrations.health_check job)
ALTER TABLE "integrations" ADD COLUMN "lastCheckedAt" TIMESTAMP(3);
