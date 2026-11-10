ALTER TABLE "LabResult"
ADD COLUMN "identifierSystem" VARCHAR(255),
ADD COLUMN "identifierValue" VARCHAR(128),
ADD COLUMN "createdByServiceAccountId" UUID;

ALTER TABLE "LabResult"
ADD CONSTRAINT "LabResult_identifier_pair_check" CHECK (
  ("identifierSystem" IS NULL AND "identifierValue" IS NULL)
  OR
  ("identifierSystem" IS NOT NULL AND length(trim("identifierSystem")) > 0 AND "identifierValue" IS NOT NULL AND length(trim("identifierValue")) > 0)
);

CREATE UNIQUE INDEX "LabResult_identifierSystem_identifierValue_key" ON "LabResult"("identifierSystem", "identifierValue");
CREATE INDEX "LabResult_createdByServiceAccountId_idx" ON "LabResult"("createdByServiceAccountId");
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_createdByServiceAccountId_fkey" FOREIGN KEY ("createdByServiceAccountId") REFERENCES "ServiceAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
