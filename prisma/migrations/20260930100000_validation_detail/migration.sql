-- AlterTable
ALTER TABLE "provider_validations" ADD COLUMN "httpStatus" INTEGER,
ADD COLUMN "errorCode" TEXT,
ADD COLUMN "durationMs" INTEGER,
ADD COLUMN "meta" JSONB NOT NULL DEFAULT '{}';
