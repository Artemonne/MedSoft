ALTER TABLE "AuditEvent"
ADD COLUMN "eventType" VARCHAR(64) NOT NULL DEFAULT 'LEGACY',
ADD COLUMN "metadata" JSONB;

DROP INDEX "AuditEvent_occurredAt_idx";
CREATE INDEX "AuditEvent_occurredAt_id_idx" ON "AuditEvent"("occurredAt", "id");
