CREATE TABLE "ServiceAccount" (
  "id" UUID NOT NULL, "name" VARCHAR(100) NOT NULL, "keyId" VARCHAR(32) NOT NULL,
  "apiKeyHash" CHAR(43) NOT NULL, "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "role" "ServiceAccountRole" NOT NULL DEFAULT 'LIS', "isActive" BOOLEAN NOT NULL DEFAULT true,
  "rotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceAccount_name_check" CHECK (char_length(trim("name")) BETWEEN 3 AND 100),
  CONSTRAINT "ServiceAccount_key_version_check" CHECK ("keyVersion" > 0)
);
CREATE UNIQUE INDEX "ServiceAccount_name_key" ON "ServiceAccount"("name");
CREATE UNIQUE INDEX "ServiceAccount_keyId_key" ON "ServiceAccount"("keyId");
ALTER TABLE "RefreshSession" ADD COLUMN "serviceAccountId" UUID;
ALTER TABLE "AuditEvent" ADD COLUMN "serviceAccountId" UUID;
ALTER TABLE "RefreshSession" DROP CONSTRAINT "RefreshSession_subject_reference_check";
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_subject_reference_check" CHECK (
  ("subjectType" = 'USER' AND "accountId" IS NOT NULL AND "systemAdministratorId" IS NULL AND "serviceAccountId" IS NULL)
  OR ("subjectType" = 'ADMIN' AND "accountId" IS NULL AND "systemAdministratorId" IS NOT NULL AND "serviceAccountId" IS NULL)
  OR ("subjectType" = 'SERVICE' AND "accountId" IS NULL AND "systemAdministratorId" IS NULL AND "serviceAccountId" IS NOT NULL)
);
ALTER TABLE "AuditEvent" DROP CONSTRAINT "AuditEvent_actor_reference_check";
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actor_reference_check" CHECK (
  ("actorType" = 'USER' AND "accountId" IS NOT NULL AND "systemAdministratorId" IS NULL AND "serviceAccountId" IS NULL)
  OR ("actorType" = 'ADMIN' AND "accountId" IS NULL AND "systemAdministratorId" IS NOT NULL AND "serviceAccountId" IS NULL)
  OR ("actorType" = 'SERVICE' AND "accountId" IS NULL AND "systemAdministratorId" IS NULL AND "serviceAccountId" IS NOT NULL)
  OR ("actorType" IN ('ANONYMOUS', 'SYSTEM') AND "accountId" IS NULL AND "systemAdministratorId" IS NULL AND "serviceAccountId" IS NULL)
);
CREATE INDEX "RefreshSession_serviceAccountId_idx" ON "RefreshSession"("serviceAccountId");
CREATE INDEX "AuditEvent_serviceAccountId_idx" ON "AuditEvent"("serviceAccountId");
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_serviceAccountId_fkey" FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
