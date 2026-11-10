import { z } from 'zod';

export const createLabOrderBatchSchema = z.object({
  medicalRecordId: z.number().int().positive(),
  labTestIds: z.array(z.number().int().positive()).min(1).max(50),
  idempotencyKey: z.uuid(),
}).strict();

export const createTextLabResultSchema = z.object({
  resultKind: z.literal('TEXT'),
  textValue: z.string().trim().min(1).max(10_000),
  effectiveAt: z.coerce.date(),
}).strict();

export const createQuantityLabResultSchema = z.object({
  resultKind: z.literal('QUANTITY'),
  quantityValue: z.union([z.string().regex(/^-?\d+(?:\.\d{1,6})?$/), z.number().finite()]),
  unitCode: z.string().trim().min(1).max(32),
  effectiveAt: z.coerce.date(),
}).strict();

export const createLabResultSchema = z.discriminatedUnion('resultKind', [createTextLabResultSchema, createQuantityLabResultSchema]);
export type CreateLabOrderBatchInput = z.infer<typeof createLabOrderBatchSchema>;
export type CreateLabResultInput = z.infer<typeof createLabResultSchema>;
