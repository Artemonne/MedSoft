import { ConflictError, NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { PatientInput } from '../schemas/patient.js';
import type { UserAuthContext } from '../types/auth.js';
import { auditService } from './audit.js';

function normalizeOptionalFields(data: PatientInput) {
  return {
    ...data,
    middleName: data.middleName ?? null,
    comment: data.comment ?? null,
  };
}

export const patientService = {
  list() {
    return prisma.patient.findMany({ orderBy: { id: 'asc' } });
  },

  async getById(id: number) {
    const patient = await prisma.patient.findUnique({ where: { id } });

    if (!patient) {
      throw new NotFoundError('Patient');
    }

    return patient;
  },

  create(data: PatientInput, actor: UserAuthContext) {
    return prisma.$transaction(async (transaction) => {
      const patient = await transaction.patient.create({
        data: normalizeOptionalFields(data),
      });
      await auditService.record(transaction, {
        eventType: 'PATIENT_CREATED',
        actor: { type: 'user', accountId: actor.accountId },
        message: 'Patient created.',
        metadata: { patientId: patient.id },
      });
      return patient;
    });
  },

  update(id: number, data: PatientInput, actor: UserAuthContext) {
    return prisma.$transaction(async (transaction) => {
      const patient = await transaction.patient.update({
        where: { id },
        data: normalizeOptionalFields(data),
      });
      await auditService.record(transaction, {
        eventType: 'PATIENT_UPDATED',
        actor: { type: 'user', accountId: actor.accountId },
        message: 'Patient updated.',
        metadata: { patientId: patient.id },
      });
      return patient;
    });
  },

  async delete(id: number, actor: UserAuthContext) {
    await prisma.$transaction(async (transaction) => {
      const patient = await transaction.patient.findUnique({
        where: { id },
        select: {
          id: true,
          medicalRecord: { select: { id: true } },
        },
      });

      if (!patient) {
        throw new NotFoundError('Patient');
      }

      if (patient.medicalRecord) {
        throw new ConflictError('A patient with a medical record cannot be deleted.');
      }

      await transaction.patient.delete({ where: { id } });
      await auditService.record(transaction, {
        eventType: 'PATIENT_DELETED',
        actor: { type: 'user', accountId: actor.accountId },
        message: 'Patient deleted.',
        metadata: { patientId: id },
      });
    });
  },
};
