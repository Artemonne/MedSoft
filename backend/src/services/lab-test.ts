import { LabResultKind, Prisma } from '@prisma/client';
import { NotFoundError } from '../lib/app-error.js';
import { prisma } from '../lib/prisma.js';
import type { LabTestInput } from '../schemas/lab-test.js';
import { auditService } from './audit.js';

export const initialLabTests: LabTestInput[] = [
  { name: 'Глюкоза в сыворотке или плазме', loincCode: '2345-7', resultKind: LabResultKind.QUANTITY, unitCode: 'mg/dL', unitDisplay: 'мг/дл', methodDescription: null },
  { name: 'Yersinia pestis в биоматериале', loincCode: '33685-9', resultKind: LabResultKind.TEXT, unitCode: null, unitDisplay: null, methodDescription: 'Организм-специфический посев' },
  { name: 'Гемоглобин в крови', loincCode: '718-7', resultKind: LabResultKind.QUANTITY, unitCode: 'g/dL', unitDisplay: 'г/дл', methodDescription: null },
  { name: 'ВИЧ 1/2 антитела и антиген p24', loincCode: '56888-1', resultKind: LabResultKind.TEXT, unitCode: null, unitDisplay: null, methodDescription: 'Иммуноанализ' },
  { name: 'Поверхностный антиген вируса гепатита B', loincCode: '5196-1', resultKind: LabResultKind.TEXT, unitCode: null, unitDisplay: null, methodDescription: 'Иммуноанализ' },
  { name: 'Антитела к вирусу гепатита C', loincCode: '13955-0', resultKind: LabResultKind.TEXT, unitCode: null, unitDisplay: null, methodDescription: 'Иммуноанализ' },
  { name: 'Антитела к Treponema pallidum', loincCode: '24110-9', resultKind: LabResultKind.TEXT, unitCode: null, unitDisplay: null, methodDescription: 'Иммуноанализ' },
];

async function requireLabTest(id: number) {
  const item = await prisma.labTest.findUnique({ where: { id } });
  if (!item) throw new NotFoundError('Lab test');
  return item;
}

export const labTestService = {
  list() { return prisma.labTest.findMany({ orderBy: { id: 'asc' } }); },
  getById: requireLabTest,
  async create(data: LabTestInput) {
    return prisma.$transaction(async (transaction) => {
      const item = await transaction.labTest.create({ data });
      await auditService.record(transaction, { eventType: 'LAB_TEST_CREATED', actor: { type: 'admin', administratorId: 1 }, message: `Laboratory test ${item.loincCode} created.`, metadata: { labTestId: item.id, loincCode: item.loincCode } });
      return item;
    });
  },
  async update(id: number, data: LabTestInput) {
    await requireLabTest(id);
    return prisma.$transaction(async (transaction) => {
      const item = await transaction.labTest.update({ where: { id }, data });
      await auditService.record(transaction, { eventType: 'LAB_TEST_UPDATED', actor: { type: 'admin', administratorId: 1 }, message: `Laboratory test ${item.loincCode} updated.`, metadata: { labTestId: item.id, loincCode: item.loincCode } });
      return item;
    });
  },
  async setActive(id: number, isActive: boolean) {
    await requireLabTest(id);
    return prisma.$transaction(async (transaction) => {
      const item = await transaction.labTest.update({ where: { id }, data: { isActive } });
      await auditService.record(transaction, { eventType: 'LAB_TEST_ACTIVATION_CHANGED', actor: { type: 'admin', administratorId: 1 }, message: `Laboratory test ${item.loincCode} ${isActive ? 'activated' : 'deactivated'}.`, metadata: { labTestId: item.id, loincCode: item.loincCode, isActive } });
      return item;
    });
  },
  async seed() {
    return prisma.$transaction(async (transaction) => {
      const existing = await transaction.labTest.count({ where: { loincCode: { in: initialLabTests.map((item) => item.loincCode) } } });
      for (const item of initialLabTests) {
        await transaction.labTest.upsert({ where: { loincCode: item.loincCode }, create: item, update: { ...item, isActive: true } });
      }
      await auditService.record(transaction, { eventType: 'LAB_TESTS_SEEDED', actor: { type: 'admin', administratorId: 1 }, message: 'Initial laboratory test catalog synchronized.', metadata: { total: initialLabTests.length, created: initialLabTests.length - existing } as Prisma.InputJsonObject });
      return { created: initialLabTests.length - existing, total: initialLabTests.length };
    });
  },
};
