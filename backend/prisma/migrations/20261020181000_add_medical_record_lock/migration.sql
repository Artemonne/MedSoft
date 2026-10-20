-- Medical records are locked for event-stream modifications until a doctor explicitly unlocks them.
ALTER TABLE "MedicalRecord"
ADD COLUMN "isEditingLocked" BOOLEAN NOT NULL DEFAULT true;
