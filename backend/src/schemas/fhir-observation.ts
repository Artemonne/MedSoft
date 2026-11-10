import { z } from 'zod';

const identifierSchema = z.object({ system: z.url().max(255), value: z.string().trim().min(1).max(128) }).strict();
const codingSchema = z.object({ system: z.string().trim().min(1), code: z.string().trim().min(1), display: z.string().optional() }).strict();
const referenceSchema = z.object({ reference: z.string().trim().min(1) }).strict();
const quantitySchema = z.object({ value: z.number().finite(), unit: z.string().trim().min(1).max(64).optional(), system: z.literal('http://unitsofmeasure.org'), code: z.string().trim().min(1).max(32) }).strict();

export const fhirObservationCreateSchema = z.object({
  resourceType: z.literal('Observation'),
  identifier: z.array(identifierSchema).length(1),
  status: z.literal('final'),
  category: z.array(z.object({ coding: z.array(codingSchema).min(1) }).strict()).length(1),
  code: z.object({ coding: z.array(codingSchema).length(1) }).strict(),
  subject: referenceSchema,
  basedOn: z.array(referenceSchema).length(1),
  effectiveDateTime: z.string().datetime({ offset: true }),
  valueString: z.string().trim().min(1).max(10_000).optional(),
  valueQuantity: quantitySchema.optional(),
}).strict().superRefine((value, context) => {
  if (Number(Boolean(value.valueString)) + Number(Boolean(value.valueQuantity)) !== 1) context.addIssue({ code: 'custom', message: 'Exactly one supported value[x] is required.' });
  const laboratory = value.category[0]?.coding.some((coding) => coding.system === 'http://terminology.hl7.org/CodeSystem/observation-category' && coding.code === 'laboratory');
  if (!laboratory) context.addIssue({ code: 'custom', path: ['category'], message: 'Laboratory category is required.' });
  if (value.valueQuantity) {
    const decimal = String(value.valueQuantity.value); const [integer, fraction = ''] = decimal.replace('-', '').split('.');
    if (fraction.length > 6 || integer.length > 12) context.addIssue({ code: 'custom', path: ['valueQuantity', 'value'], message: 'Quantity exceeds DECIMAL(18,6) precision.' });
  }
});

export type FhirObservationCreateInput = z.infer<typeof fhirObservationCreateSchema>;
