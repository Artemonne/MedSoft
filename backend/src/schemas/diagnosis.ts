import { z } from 'zod';

const diagnosisFields = {
  code: z.string().trim().length(6),
  name: z.string().trim().min(3).max(24),
};

export const createDiagnosisSchema = z.object(diagnosisFields).strict();
export const updateDiagnosisSchema = z.object(diagnosisFields).strict();

export type DiagnosisInput = z.infer<typeof createDiagnosisSchema>;
