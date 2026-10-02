import { z } from 'zod';

const positiveId = z.coerce.number().int().positive();

export const patientIdParamsSchema = z.object({ patientId: positiveId }).strict();

export const recordDiagnosisParamsSchema = z
  .object({
    id: positiveId,
    diagnosisId: positiveId,
  })
  .strict();

export const recordPrescriptionParamsSchema = z
  .object({
    id: positiveId,
    prescriptionId: z.string().uuid(),
  })
  .strict();

export const emptyBodySchema = z.object({}).strict();

export const workerActionSchema = z
  .object({
    workerId: positiveId,
  })
  .strict();

export const addDiagnosisSchema = z
  .object({
    workerId: positiveId,
    diagnosisId: positiveId,
  })
  .strict();

const prescriptionFields = {
  workerId: positiveId,
  text: z.string().trim().min(3).max(128),
};

export const addPrescriptionSchema = z.object(prescriptionFields).strict();
export const editPrescriptionSchema = z.object(prescriptionFields).strict();

export const historicalStateQuerySchema = z
  .object({
    at: z.string().datetime({ offset: true }).transform((value) => new Date(value)).optional(),
  })
  .strict();

export type AddDiagnosisInput = z.infer<typeof addDiagnosisSchema>;
export type AddPrescriptionInput = z.infer<typeof addPrescriptionSchema>;
export type EditPrescriptionInput = z.infer<typeof editPrescriptionSchema>;
