import { Sex } from '@prisma/client';
import { z } from 'zod';

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

const birthDateSchema = z
  .string()
  .refine((value) => parseDateOnly(value) !== null, 'Birth date must be a valid YYYY-MM-DD date.')
  .refine((value) => {
    const date = parseDateOnly(value);
    const today = new Date();
    const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    return date !== null && date.getTime() <= todayUtc;
  }, 'Birth date must not be in the future.')
  .transform((value) => new Date(`${value}T00:00:00.000Z`));

const patientFields = {
  firstName: z.string().trim().min(1).max(50),
  lastName: z.string().trim().min(1).max(50),
  middleName: z.string().trim().min(1).max(50).nullable().optional(),
  birthDate: birthDateSchema,
  sex: z.nativeEnum(Sex),
  comment: z.string().trim().max(32).nullable().optional(),
};

export const createPatientSchema = z.object(patientFields).strict();
export const updatePatientSchema = z.object(patientFields).strict();

export type PatientInput = z.infer<typeof createPatientSchema>;
