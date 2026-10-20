import { randomUUID } from 'node:crypto';
import { MedicalRecordEventType, MedicalWorkerRole, Prisma } from '@prisma/client';
import { ConflictError, ForbiddenError, NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type {
  AddDiagnosisInput,
  AddPrescriptionInput,
  EditPrescriptionInput,
} from '../schemas/medical-record.js';
import type { UserAuthContext } from '../types/auth.js';
import {
  rebuildMedicalRecord,
  type MedicalRecordState,
} from './medical-record-replay.js';
import { auditService, type AuditEventType } from './audit.js';

type StreamOperation<T> = (
  transaction: Prisma.TransactionClient,
  state: MedicalRecordState,
  nextVersion: number,
) => Promise<T>;

async function lockWorker(
  transaction: Prisma.TransactionClient,
  workerId: number,
) {
  const workers = await transaction.$queryRaw<Array<{ id: number }>>(Prisma.sql`
    SELECT "id"
    FROM "MedicalWorker"
    WHERE "id" = ${workerId}
    FOR SHARE
  `);
  if (workers.length !== 1) {
    throw new NotFoundError('Medical worker');
  }
  const worker = await transaction.medicalWorker.findUniqueOrThrow({
    where: { id: workerId },
  });
  if (worker.isDeleted) {
    throw new ConflictError('A deleted medical worker cannot modify a medical record.');
  }
  return worker;
}

async function modifyStream<T>(
  medicalRecordId: number,
  actor: UserAuthContext,
  audit: { eventType: AuditEventType; message: string },
  operation: StreamOperation<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    // This serializes writers that use this service; the unique version constraint
    // remains the database backstop for writes that do not follow this lock protocol.
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${medicalRecordId})::text`;
    const worker = await lockWorker(transaction, actor.medicalWorker.id);
    if (
      worker.role !== MedicalWorkerRole.DOCTOR &&
      worker.role !== MedicalWorkerRole.NURSE
    ) {
      throw new ForbiddenError('Insufficient permissions.');
    }

    const [medicalRecord, events] = await Promise.all([
      transaction.medicalRecord.findUnique({ where: { id: medicalRecordId } }),
      transaction.medicalRecordEvent.findMany({
        where: { medicalRecordId },
        orderBy: { version: 'asc' },
      }),
    ]);

    if (!medicalRecord) {
      throw new NotFoundError('Medical record');
    }

    if (medicalRecord.isEditingLocked) {
      throw new ConflictError('Medical record is locked for editing.');
    }

    const state = rebuildMedicalRecord(events);
    const nextVersion = (events.at(-1)?.version ?? 0) + 1;
    const result = await operation(transaction, state, nextVersion);
    await transaction.medicalRecord.update({
      where: { id: medicalRecordId },
      data: { isEditingLocked: true },
    });
    await auditService.record(transaction, {
      eventType: audit.eventType,
      actor: { type: 'user', accountId: actor.accountId },
      message: audit.message,
      metadata: { medicalRecordId, firstVersion: nextVersion, editingLocked: true },
    });
    return result;
  });
}

async function findRecord(id: number) {
  const record = await prisma.medicalRecord.findUnique({ where: { id } });

  if (!record) {
    throw new NotFoundError('Medical record');
  }

  return record;
}

async function reconstructRecord(id: number, at?: Date) {
  const record = await findRecord(id);
  const events = await prisma.medicalRecordEvent.findMany({
    where: {
      medicalRecordId: id,
      ...(at ? { createdAt: { lte: at } } : {}),
    },
    orderBy: { version: 'asc' },
  });

  return {
    id: record.id,
    patientId: record.patientId,
    isEditingLocked: record.isEditingLocked,
    createdAt: record.createdAt,
    ...rebuildMedicalRecord(events),
  };
}

export const medicalRecordService = {
  async createForPatient(patientId: number, actor: UserAuthContext) {
    return prisma.$transaction(async (transaction) => {
      const patient = await transaction.patient.findUnique({
        where: { id: patientId },
        select: { id: true, medicalRecord: { select: { id: true } } },
      });

      if (!patient) {
        throw new NotFoundError('Patient');
      }

      if (patient.medicalRecord) {
        throw new ConflictError('Patient already has a medical record.');
      }

      try {
        const medicalRecord = await transaction.medicalRecord.create({ data: { patientId } });
        await auditService.record(transaction, {
          eventType: 'MEDICAL_RECORD_CREATED',
          actor: { type: 'user', accountId: actor.accountId },
          message: 'Medical record created.',
          metadata: { medicalRecordId: medicalRecord.id, patientId },
        });
        return medicalRecord;
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictError('Patient already has a medical record.');
        }
        throw error;
      }
    });
  },

  async getForPatient(patientId: number) {
    const patient = await prisma.patient.findUnique({
      where: { id: patientId },
      select: { medicalRecord: { select: { id: true } } },
    });

    if (!patient) {
      throw new NotFoundError('Patient');
    }

    if (!patient.medicalRecord) {
      throw new NotFoundError('Medical record');
    }

    return reconstructRecord(patient.medicalRecord.id);
  },

  getById(id: number, at?: Date) {
    return reconstructRecord(id, at);
  },

  async unlock(id: number, actor: UserAuthContext) {
    return prisma.$transaction(async (transaction) => {
      const worker = await lockWorker(transaction, actor.medicalWorker.id);
      if (worker.role !== MedicalWorkerRole.DOCTOR) {
        throw new ForbiddenError('Insufficient permissions.');
      }
      const result = await transaction.medicalRecord.updateMany({
        where: { id, isEditingLocked: true },
        data: { isEditingLocked: false },
      });
      if (result.count === 0) {
        const existing = await transaction.medicalRecord.findUnique({ where: { id } });
        if (!existing) {
          throw new NotFoundError('Medical record');
        }
      }
      await auditService.record(transaction, {
        eventType: 'MEDICAL_RECORD_UNLOCKED',
        actor: { type: 'user', accountId: actor.accountId },
        message: 'Medical record unlocked for editing.',
        metadata: { medicalRecordId: id },
      });
      return transaction.medicalRecord.findUniqueOrThrow({ where: { id } });
    });
  },

  async getEvents(id: number) {
    await findRecord(id);
    return prisma.medicalRecordEvent.findMany({
      where: { medicalRecordId: id },
      orderBy: { version: 'asc' },
      select: {
        version: true,
        type: true,
        payload: true,
        createdAt: true,
        worker: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            position: true,
            isDeleted: true,
          },
        },
      },
    });
  },

  addDiagnosis(medicalRecordId: number, input: AddDiagnosisInput, actor: UserAuthContext) {
    return modifyStream(medicalRecordId, actor, {
      eventType: 'MEDICAL_RECORD_DIAGNOSIS_ADDED',
      message: 'Diagnosis added to medical record.',
    }, async (transaction, state, version) => {
      if (state.diagnoses.some((item) => item.diagnosisId === input.diagnosisId)) {
        throw new ConflictError('Diagnosis is already active in this medical record.');
      }

      const diagnosis = await transaction.diagnosis.findUnique({
        where: { id: input.diagnosisId },
      });

      if (!diagnosis) {
        throw new NotFoundError('Diagnosis');
      }

      const snapshot = {
        diagnosisId: diagnosis.id,
        code: diagnosis.code,
        name: diagnosis.name,
      };

      await transaction.medicalRecordEvent.create({
        data: {
          medicalRecordId,
          workerId: actor.medicalWorker.id,
          version,
          type: MedicalRecordEventType.DIAGNOSIS_ADDED,
          payload: snapshot,
        },
      });

      return { diagnosis: snapshot, version };
    });
  },

  removeDiagnosis(medicalRecordId: number, diagnosisId: number, actor: UserAuthContext) {
    return modifyStream(medicalRecordId, actor, {
      eventType: 'MEDICAL_RECORD_DIAGNOSIS_REMOVED',
      message: 'Diagnosis removed from medical record.',
    }, async (transaction, state, version) => {
      const diagnosis = state.diagnoses.find((item) => item.diagnosisId === diagnosisId);

      if (!diagnosis) {
        throw new ConflictError('Diagnosis is not active in this medical record.');
      }

      await transaction.medicalRecordEvent.create({
        data: {
          medicalRecordId,
          workerId: actor.medicalWorker.id,
          version,
          type: MedicalRecordEventType.DIAGNOSIS_REMOVED,
          payload: diagnosis,
        },
      });

      return { diagnosis, version };
    });
  },

  addPrescription(medicalRecordId: number, input: AddPrescriptionInput, actor: UserAuthContext) {
    return modifyStream(medicalRecordId, actor, {
      eventType: 'MEDICAL_RECORD_PRESCRIPTION_ADDED',
      message: 'Prescription added to medical record.',
    }, async (transaction, _state, version) => {
      const prescription = { prescriptionId: randomUUID(), text: input.text };
      await transaction.medicalRecordEvent.create({
        data: {
          medicalRecordId,
          workerId: actor.medicalWorker.id,
          version,
          type: MedicalRecordEventType.PRESCRIPTION_ADDED,
          payload: prescription,
        },
      });

      return { ...prescription, version };
    });
  },

  removePrescription(medicalRecordId: number, prescriptionId: string, actor: UserAuthContext) {
    return modifyStream(medicalRecordId, actor, {
      eventType: 'MEDICAL_RECORD_PRESCRIPTION_REMOVED',
      message: 'Prescription removed from medical record.',
    }, async (transaction, state, version) => {
      const prescription = state.prescriptions.find(
        (item) => item.prescriptionId === prescriptionId,
      );

      if (!prescription) {
        throw new ConflictError('Prescription is not active in this medical record.');
      }

      await transaction.medicalRecordEvent.create({
        data: {
          medicalRecordId,
          workerId: actor.medicalWorker.id,
          version,
          type: MedicalRecordEventType.PRESCRIPTION_REMOVED,
          payload: prescription,
        },
      });

      return { prescription, version };
    });
  },

  editPrescription(
    medicalRecordId: number,
    prescriptionId: string,
    input: EditPrescriptionInput,
    actor: UserAuthContext,
  ) {
    return modifyStream(
      medicalRecordId,
      actor,
      {
        eventType: 'MEDICAL_RECORD_PRESCRIPTION_EDITED',
        message: 'Prescription edited in medical record.',
      },
      async (transaction, state, version) => {
        const previousPrescription = state.prescriptions.find(
          (item) => item.prescriptionId === prescriptionId,
        );

        if (!previousPrescription) {
          throw new ConflictError('Prescription is not active in this medical record.');
        }

        const prescription = { prescriptionId: randomUUID(), text: input.text };

        await transaction.medicalRecordEvent.create({
          data: {
            medicalRecordId,
            workerId: actor.medicalWorker.id,
            version,
            type: MedicalRecordEventType.PRESCRIPTION_REMOVED,
            payload: previousPrescription,
          },
        });
        await transaction.medicalRecordEvent.create({
          data: {
            medicalRecordId,
            workerId: actor.medicalWorker.id,
            version: version + 1,
            type: MedicalRecordEventType.PRESCRIPTION_ADDED,
            payload: prescription,
          },
        });

        return {
          previousPrescriptionId: previousPrescription.prescriptionId,
          prescriptionId: prescription.prescriptionId,
          text: prescription.text,
          versions: [version, version + 1],
        };
      },
    );
  },
};
