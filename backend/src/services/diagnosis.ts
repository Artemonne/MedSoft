import { NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { DiagnosisInput } from '../schemas/diagnosis.js';

const initialDiagnoses: DiagnosisInput[] = [
  { code: 'J00001', name: 'Острый назофарингит' },
  { code: 'I10001', name: 'Гипертензия' },
  { code: 'E11901', name: 'Сахарный диабет' },
  { code: 'K29001', name: 'Гастрит' },
  { code: 'M54501', name: 'Боль в пояснице' },
];

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

  async seed() {
    const result = await prisma.diagnosis.createMany({
      data: initialDiagnoses,
      skipDuplicates: true,
    });

    return { created: result.count, total: initialDiagnoses.length };
  },

  update(id: number, data: DiagnosisInput) {
    return prisma.diagnosis.update({ where: { id }, data });
  },

  async delete(id: number) {
    await prisma.diagnosis.delete({ where: { id } });
  },
};
