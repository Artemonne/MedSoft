import { LabResultKind } from '@prisma/client';
import { z } from 'zod';

const baseFields = {
  name: z.string().trim().min(3).max(160),
  loincCode: z.string().trim().regex(/^\d{1,5}-\d$/, 'Invalid LOINC code format.'),
  resultKind: z.enum(LabResultKind),
  unitCode: z.string().trim().min(1).max(32).nullable(),
  unitDisplay: z.string().trim().min(1).max(64).nullable(),
  methodDescription: z.string().trim().min(3).max(160).nullable(),
};

function validateResultShape(
  value: { resultKind: LabResultKind; unitCode: string | null; unitDisplay: string | null },
  context: z.RefinementCtx,
) {
  if (value.resultKind === LabResultKind.QUANTITY && (!value.unitCode || !value.unitDisplay)) {
    context.addIssue({ code: 'custom', path: ['unitCode'], message: 'Quantity results require UCUM unit code and display.' });
  }
  if (value.resultKind === LabResultKind.TEXT && (value.unitCode || value.unitDisplay)) {
    context.addIssue({ code: 'custom', path: ['unitCode'], message: 'Text results must not define a measurement unit.' });
  }
}

export const createLabTestSchema = z.object(baseFields).strict().superRefine(validateResultShape);
export const updateLabTestSchema = createLabTestSchema;
export const setLabTestActiveSchema = z.object({ isActive: z.boolean() }).strict();

export type LabTestInput = z.infer<typeof createLabTestSchema>;
