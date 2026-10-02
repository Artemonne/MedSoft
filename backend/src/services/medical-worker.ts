import { NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { MedicalWorkerInput } from '../schemas/medical-worker.js';

export const medicalWorkerService = {
  list() {
    return prisma.medicalWorker.findMany({
      where: { isDeleted: false },
      orderBy: { id: 'asc' },
    });
  },

  async getById(id: number) {
    const worker = await prisma.medicalWorker.findFirst({
      where: { id, isDeleted: false },
    });

    if (!worker) {
      throw new NotFoundError('Medical worker');
    }

    return worker;
  },

  create(data: MedicalWorkerInput) {
    return prisma.medicalWorker.create({ data });
  },

  async update(id: number, data: MedicalWorkerInput) {
    const result = await prisma.medicalWorker.updateMany({
      where: { id, isDeleted: false },
      data,
    });

    if (result.count === 0) {
      throw new NotFoundError('Medical worker');
    }

    return prisma.medicalWorker.findUniqueOrThrow({ where: { id } });
  },

  async softDelete(id: number) {
    const result = await prisma.medicalWorker.updateMany({
      where: { id, isDeleted: false },
      data: { isDeleted: true },
    });

    if (result.count === 0) {
      throw new NotFoundError('Medical worker');
    }
  },
};
