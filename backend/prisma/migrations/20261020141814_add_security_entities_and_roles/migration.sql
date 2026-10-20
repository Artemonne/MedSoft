-- CreateEnum
CREATE TYPE "MedicalWorkerRole" AS ENUM ('doctor', 'laboratory-technician', 'nurse', 'other');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('ADMIN', 'USER', 'ANONYMOUS', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AdministratorSetupState" AS ENUM ('PASSWORD_SETUP_REQUIRED', 'TOTP_SETUP_REQUIRED', 'ACTIVE');

-- CreateEnum
CREATE TYPE "RefreshSessionSubjectType" AS ENUM ('ADMIN', 'USER');

-- AlterTable
ALTER TABLE "MedicalWorker" ADD COLUMN     "role" "MedicalWorkerRole" NOT NULL DEFAULT 'other';

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "username" VARCHAR(16) NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "medicalWorkerId" INTEGER,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Account"
ADD CONSTRAINT "Account_username_length_check"
CHECK (char_length("username") BETWEEN 3 AND 16);

-- CreateTable
CREATE TABLE "SystemAdministrator" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "passwordHash" TEXT,
    "totpSecret" TEXT,
    "setupState" "AdministratorSetupState" NOT NULL DEFAULT 'PASSWORD_SETUP_REQUIRED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemAdministrator_pkey" PRIMARY KEY ("id")
);

-- A fixed primary-key value makes the singleton invariant enforceable by PostgreSQL.
ALTER TABLE "SystemAdministrator"
ADD CONSTRAINT "SystemAdministrator_singleton_check"
CHECK ("id" = 1);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorType" "AuditActorType" NOT NULL,
    "actorIdentifier" VARCHAR(128) NOT NULL,
    "message" TEXT NOT NULL,
    "accountId" UUID,
    "systemAdministratorId" INTEGER,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AuditEvent"
ADD CONSTRAINT "AuditEvent_actor_identifier_check"
CHECK (char_length("actorIdentifier") > 0),
ADD CONSTRAINT "AuditEvent_message_check"
CHECK (char_length("message") > 0),
ADD CONSTRAINT "AuditEvent_actor_reference_check"
CHECK (
    ("actorType" = 'USER' AND "accountId" IS NOT NULL AND "systemAdministratorId" IS NULL)
    OR ("actorType" = 'ADMIN' AND "accountId" IS NULL AND "systemAdministratorId" IS NOT NULL)
    OR ("actorType" IN ('ANONYMOUS', 'SYSTEM') AND "accountId" IS NULL AND "systemAdministratorId" IS NULL)
);

-- CreateTable
CREATE TABLE "RefreshSession" (
    "id" UUID NOT NULL,
    "subjectType" "RefreshSessionSubjectType" NOT NULL,
    "accountId" UUID,
    "systemAdministratorId" INTEGER,
    "tokenHash" TEXT NOT NULL,
    "familyId" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revocationReason" VARCHAR(128),
    "replacedById" UUID,

    CONSTRAINT "RefreshSession_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RefreshSession"
ADD CONSTRAINT "RefreshSession_subject_reference_check"
CHECK (
    ("subjectType" = 'USER' AND "accountId" IS NOT NULL AND "systemAdministratorId" IS NULL)
    OR ("subjectType" = 'ADMIN' AND "accountId" IS NULL AND "systemAdministratorId" IS NOT NULL)
),
ADD CONSTRAINT "RefreshSession_expiry_check"
CHECK ("expiresAt" > "issuedAt"),
ADD CONSTRAINT "RefreshSession_rotation_check"
CHECK ("replacedById" IS NULL OR "replacedById" <> "id");

-- CreateIndex
CREATE UNIQUE INDEX "Account_username_key" ON "Account"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Account_medicalWorkerId_key" ON "Account"("medicalWorkerId");

-- CreateIndex
CREATE INDEX "AuditEvent_occurredAt_idx" ON "AuditEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "AuditEvent_actorType_actorIdentifier_idx" ON "AuditEvent"("actorType", "actorIdentifier");

-- CreateIndex
CREATE INDEX "AuditEvent_accountId_idx" ON "AuditEvent"("accountId");

-- CreateIndex
CREATE INDEX "AuditEvent_systemAdministratorId_idx" ON "AuditEvent"("systemAdministratorId");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_tokenHash_key" ON "RefreshSession"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshSession_replacedById_key" ON "RefreshSession"("replacedById");

-- CreateIndex
CREATE INDEX "RefreshSession_accountId_idx" ON "RefreshSession"("accountId");

-- CreateIndex
CREATE INDEX "RefreshSession_systemAdministratorId_idx" ON "RefreshSession"("systemAdministratorId");

-- CreateIndex
CREATE INDEX "RefreshSession_familyId_idx" ON "RefreshSession"("familyId");

-- CreateIndex
CREATE INDEX "RefreshSession_revokedAt_idx" ON "RefreshSession"("revokedAt");

-- CreateIndex
CREATE INDEX "RefreshSession_expiresAt_idx" ON "RefreshSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_medicalWorkerId_fkey" FOREIGN KEY ("medicalWorkerId") REFERENCES "MedicalWorker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_systemAdministratorId_fkey" FOREIGN KEY ("systemAdministratorId") REFERENCES "SystemAdministrator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_systemAdministratorId_fkey" FOREIGN KEY ("systemAdministratorId") REFERENCES "SystemAdministrator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefreshSession" ADD CONSTRAINT "RefreshSession_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "RefreshSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
