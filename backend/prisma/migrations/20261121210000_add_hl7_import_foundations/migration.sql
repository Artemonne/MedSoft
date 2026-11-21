ALTER TYPE "ServiceAccountRole" ADD VALUE 'HL7_IMPORT';

ALTER TABLE "Patient"
ADD COLUMN "externalIdSource" VARCHAR(100),
ADD COLUMN "externalIdValue" VARCHAR(100);

ALTER TABLE "Patient"
ADD CONSTRAINT "Patient_external_id_complete_check"
CHECK (
  ("externalIdSource" IS NULL AND "externalIdValue" IS NULL)
  OR
  ("externalIdSource" IS NOT NULL AND "externalIdValue" IS NOT NULL)
);

CREATE UNIQUE INDEX "Patient_externalIdSource_externalIdValue_key"
ON "Patient"("externalIdSource", "externalIdValue");
