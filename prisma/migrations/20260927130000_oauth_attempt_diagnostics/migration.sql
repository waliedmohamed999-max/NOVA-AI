-- OAuth attempt diagnostics (requested vs granted permissions, outcome)
ALTER TABLE "oauth_states" ADD COLUMN "requestedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauth_states" ADD COLUMN "grantedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "oauth_states" ADD COLUMN "outcome" TEXT;
