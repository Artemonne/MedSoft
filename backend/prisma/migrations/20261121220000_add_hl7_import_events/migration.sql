ALTER TABLE "Diagnosis"
ALTER COLUMN "name" TYPE VARCHAR(160);

ALTER TABLE "MedicalRecordEvent"
ALTER COLUMN "workerId" DROP NOT NULL,
ADD COLUMN "serviceAccountId" UUID;

ALTER TABLE "MedicalRecordEvent"
ADD CONSTRAINT "MedicalRecordEvent_serviceAccountId_fkey"
FOREIGN KEY ("serviceAccountId") REFERENCES "ServiceAccount"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MedicalRecordEvent"
ADD CONSTRAINT "MedicalRecordEvent_exactly_one_actor_check"
CHECK (num_nonnulls("workerId", "serviceAccountId") = 1);

CREATE INDEX "MedicalRecordEvent_serviceAccountId_idx"
ON "MedicalRecordEvent"("serviceAccountId");
