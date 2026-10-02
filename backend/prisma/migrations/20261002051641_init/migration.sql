-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MedicalRecordEventType" AS ENUM ('DIAGNOSIS_ADDED', 'DIAGNOSIS_REMOVED', 'PRESCRIPTION_ADDED', 'PRESCRIPTION_REMOVED');

-- CreateTable
CREATE TABLE "MedicalWorker" (
    "id" SERIAL NOT NULL,
    "firstName" VARCHAR(24) NOT NULL,
    "lastName" VARCHAR(24) NOT NULL,
    "position" VARCHAR(24) NOT NULL,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalWorker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Diagnosis" (
    "id" SERIAL NOT NULL,
    "code" CHAR(6) NOT NULL,
    "name" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Diagnosis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" SERIAL NOT NULL,
    "firstName" VARCHAR(50) NOT NULL,
    "lastName" VARCHAR(50) NOT NULL,
    "middleName" VARCHAR(50),
    "birthDate" DATE NOT NULL,
    "sex" "Sex" NOT NULL DEFAULT 'UNKNOWN',
    "comment" VARCHAR(32),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecord" (
    "id" SERIAL NOT NULL,
    "patientId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecordEvent" (
    "id" SERIAL NOT NULL,
    "medicalRecordId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "workerId" INTEGER NOT NULL,
    "type" "MedicalRecordEventType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MedicalRecordEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Diagnosis_code_key" ON "Diagnosis"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Diagnosis_name_key" ON "Diagnosis"("name");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalRecord_patientId_key" ON "MedicalRecord"("patientId");

-- CreateIndex
CREATE INDEX "MedicalRecordEvent_workerId_idx" ON "MedicalRecordEvent"("workerId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalRecordEvent_medicalRecordId_version_key" ON "MedicalRecordEvent"("medicalRecordId", "version");

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordEvent" ADD CONSTRAINT "MedicalRecordEvent_medicalRecordId_fkey" FOREIGN KEY ("medicalRecordId") REFERENCES "MedicalRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecordEvent" ADD CONSTRAINT "MedicalRecordEvent_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "MedicalWorker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
