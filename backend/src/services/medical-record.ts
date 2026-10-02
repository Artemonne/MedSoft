import { randomUUID } from 'node:crypto';
import { MedicalRecordEventType, Prisma } from '@prisma/client';
import { ConflictError, NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type {
  AddDiagnosisInput,
  AddPrescriptionInput,
  EditPrescriptionInput,
} from '../schemas/medical-record.js';
import {
  rebuildMedicalRecord,
  type MedicalRecordState,
} from './medical-record-replay.js';

type StreamOperation<T> = (
  transaction: Prisma.TransactionClient,
  state: MedicalRecordState,
  nextVersion: number,
) => Promise<T>;

async function modifyStream<T>(
  medicalRecordId: number,
  workerId: number,
  operation: StreamOperation<T>,
): Promise<T> {
  return prisma.$transaction(async (transaction) => {
    // This serializes writers that use this service; the unique version constraint
    // remains the database backstop for writes that do not follow this lock protocol.
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(${medicalRecordId})::text`;

    const [medicalRecord, worker, events] = await Promise.all([
      transaction.medicalRecord.findUnique({ where: { id: medicalRecordId } }),
      transaction.medicalWorker.findUnique({ where: { id: workerId } }),
      transaction.medicalRecordEvent.findMany({
        where: { medicalRecordId },
        orderBy: { version: 'asc' },
      }),
    ]);

    if (!medicalRecord) {
      throw new NotFoundError('Medical record');
    }

    if (!worker) {
      throw new NotFoundError('Medical worker');
    }

    if (worker.isDeleted) {
      throw new ConflictError('A deleted medical worker cannot modify a medical record.');
    }

    const state = rebuildMedicalRecord(events);
    const nextVersion = (events.at(-1)?.version ?? 0) + 1;
    return operation(transaction, state, nextVersion);
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
    createdAt: record.createdAt,
    ...rebuildMedicalRecord(events),
  };
}

export const medicalRecordService = {
  async createForPatient(patientId: number) {
    const patient = await prisma.patient.findUnique({
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
      return await prisma.medicalRecord.create({ data: { patientId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictError('Patient already has a medical record.');
      }
      throw error;
    }
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

  addDiagnosis(medicalRecordId: number, input: AddDiagnosisInput) {
    return modifyStream(medicalRecordId, input.workerId, async (transaction, state, version) => {
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
          workerId: input.workerId,
          version,
          type: MedicalRecordEventType.DIAGNOSIS_ADDED,
          payload: snapshot,
        },
      });

      return { diagnosis: snapshot, version };
    });
  },

  removeDiagnosis(medicalRecordId: number, diagnosisId: number, workerId: number) {
    return modifyStream(medicalRecordId, workerId, async (transaction, state, version) => {
      const diagnosis = state.diagnoses.find((item) => item.diagnosisId === diagnosisId);

      if (!diagnosis) {
        throw new ConflictError('Diagnosis is not active in this medical record.');
      }

      await transaction.medicalRecordEvent.create({
        data: {
          medicalRecordId,
          workerId,
          version,
          type: MedicalRecordEventType.DIAGNOSIS_REMOVED,
          payload: diagnosis,
        },
      });

      return { diagnosis, version };
    });
  },

  addPrescription(medicalRecordId: number, input: AddPrescriptionInput) {
    return modifyStream(medicalRecordId, input.workerId, async (transaction, _state, version) => {
      const prescription = { prescriptionId: randomUUID(), text: input.text };
      await transaction.medicalRecordEvent.create({
        data: {
          medicalRecordId,
          workerId: input.workerId,
          version,
          type: MedicalRecordEventType.PRESCRIPTION_ADDED,
          payload: prescription,
        },
      });

      return { ...prescription, version };
    });
  },

  removePrescription(medicalRecordId: number, prescriptionId: string, workerId: number) {
    return modifyStream(medicalRecordId, workerId, async (transaction, state, version) => {
      const prescription = state.prescriptions.find(
        (item) => item.prescriptionId === prescriptionId,
      );

      if (!prescription) {
        throw new ConflictError('Prescription is not active in this medical record.');
      }

      await transaction.medicalRecordEvent.create({
        data: {
          medicalRecordId,
          workerId,
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
  ) {
    return modifyStream(
      medicalRecordId,
      input.workerId,
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
            workerId: input.workerId,
            version,
            type: MedicalRecordEventType.PRESCRIPTION_REMOVED,
            payload: previousPrescription,
          },
        });
        await transaction.medicalRecordEvent.create({
          data: {
            medicalRecordId,
            workerId: input.workerId,
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
