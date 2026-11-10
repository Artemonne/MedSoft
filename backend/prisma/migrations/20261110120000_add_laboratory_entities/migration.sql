CREATE TYPE "LabResultKind" AS ENUM ('TEXT', 'QUANTITY');

CREATE TABLE "LabTest" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "loincCode" VARCHAR(16) NOT NULL,
    "resultKind" "LabResultKind" NOT NULL,
    "unitCode" VARCHAR(32),
    "unitDisplay" VARCHAR(64),
    "methodDescription" VARCHAR(160),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LabTest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LabTest_result_shape_check" CHECK (
      ("resultKind" = 'TEXT' AND "unitCode" IS NULL AND "unitDisplay" IS NULL)
      OR
      ("resultKind" = 'QUANTITY' AND length(trim("unitCode")) > 0 AND length(trim("unitDisplay")) > 0)
    )
);

CREATE TABLE "LabOrderBatch" (
    "id" UUID NOT NULL,
    "medicalRecordId" INTEGER NOT NULL,
    "requesterId" INTEGER NOT NULL,
    "createdByAccountId" UUID NOT NULL,
    "idempotencyKey" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabOrderBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LabOrder" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "labTestId" INTEGER NOT NULL,
    "testNameSnapshot" VARCHAR(160) NOT NULL,
    "loincCodeSnapshot" VARCHAR(16) NOT NULL,
    "resultKindSnapshot" "LabResultKind" NOT NULL,
    "unitCodeSnapshot" VARCHAR(32),
    "unitDisplaySnapshot" VARCHAR(64),
    "methodDescriptionSnapshot" VARCHAR(160),
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabOrder_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LabResult" (
    "id" UUID NOT NULL,
    "labOrderId" UUID NOT NULL,
    "resultKind" "LabResultKind" NOT NULL,
    "textValue" TEXT,
    "quantityValue" DECIMAL(18,6),
    "unitCode" VARCHAR(32),
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LabResult_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LabResult_value_shape_check" CHECK (
      ("resultKind" = 'TEXT' AND length(trim("textValue")) > 0 AND "quantityValue" IS NULL AND "unitCode" IS NULL)
      OR
      ("resultKind" = 'QUANTITY' AND "textValue" IS NULL AND "quantityValue" IS NOT NULL AND length(trim("unitCode")) > 0)
    )
);

CREATE UNIQUE INDEX "LabTest_loincCode_key" ON "LabTest"("loincCode");
CREATE UNIQUE INDEX "LabOrderBatch_createdByAccountId_idempotencyKey_key" ON "LabOrderBatch"("createdByAccountId", "idempotencyKey");
CREATE INDEX "LabOrderBatch_medicalRecordId_idx" ON "LabOrderBatch"("medicalRecordId");
CREATE INDEX "LabOrderBatch_requesterId_idx" ON "LabOrderBatch"("requesterId");
CREATE INDEX "LabOrder_batchId_idx" ON "LabOrder"("batchId");
CREATE INDEX "LabOrder_labTestId_idx" ON "LabOrder"("labTestId");
CREATE UNIQUE INDEX "LabResult_labOrderId_key" ON "LabResult"("labOrderId");
CREATE INDEX "LabResult_registeredAt_idx" ON "LabResult"("registeredAt");

ALTER TABLE "LabOrderBatch" ADD CONSTRAINT "LabOrderBatch_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrderBatch" ADD CONSTRAINT "LabOrderBatch_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "MedicalWorker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrderBatch" ADD CONSTRAINT "LabOrderBatch_createdByAccountId_fkey" FOREIGN KEY ("createdByAccountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LabOrderBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabOrder" ADD CONSTRAINT "LabOrder_labTestId_fkey" FOREIGN KEY ("labTestId") REFERENCES "LabTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LabResult" ADD CONSTRAINT "LabResult_labOrderId_fkey" FOREIGN KEY ("labOrderId") REFERENCES "LabOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
