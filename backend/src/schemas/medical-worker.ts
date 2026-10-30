import { z } from 'zod';

const medicalWorkerFields = {
  firstName: z.string().trim().min(1).max(24),
  middleName: z.string().trim().max(24).transform((value) => value || null).nullable().optional(),
  lastName: z.string().trim().min(1).max(24),
  position: z.string().trim().min(3).max(24),
  role: z.enum(['doctor', 'laboratory-technician', 'nurse', 'other']).optional(),
};

export const createMedicalWorkerSchema = z.object(medicalWorkerFields).strict();
export const updateMedicalWorkerSchema = z.object(medicalWorkerFields).strict();

export type MedicalWorkerInput = z.infer<typeof createMedicalWorkerSchema>;
