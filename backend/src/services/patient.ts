import { ConflictError, NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { PatientInput } from '../schemas/patient.js';

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

  create(data: PatientInput) {
    return prisma.patient.create({ data: normalizeOptionalFields(data) });
  },

  update(id: number, data: PatientInput) {
    return prisma.patient.update({
      where: { id },
      data: normalizeOptionalFields(data),
    });
  },

  async delete(id: number) {
    const patient = await prisma.patient.findUnique({
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

    await prisma.patient.delete({ where: { id } });
  },
};
