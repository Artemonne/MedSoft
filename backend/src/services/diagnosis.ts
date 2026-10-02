import { NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { DiagnosisInput } from '../schemas/diagnosis.js';

export const diagnosisService = {
  list() {
    return prisma.diagnosis.findMany({ orderBy: { id: 'asc' } });
  },

  async getById(id: number) {
    const diagnosis = await prisma.diagnosis.findUnique({ where: { id } });

    if (!diagnosis) {
      throw new NotFoundError('Diagnosis');
    }

    return diagnosis;
  },

  create(data: DiagnosisInput) {
    return prisma.diagnosis.create({ data });
  },

  update(id: number, data: DiagnosisInput) {
    return prisma.diagnosis.update({ where: { id }, data });
  },

  async delete(id: number) {
    await prisma.diagnosis.delete({ where: { id } });
  },
};
