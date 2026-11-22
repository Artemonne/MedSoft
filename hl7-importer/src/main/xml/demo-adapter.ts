import { randomUUID } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import type { ImportPatient, XmlLoadResult } from '../../shared/types.js';
import { ImporterError } from '../errors.js';

export const MAX_XML_BYTES = 2 * 1024 * 1024;
const diagnosisSchema = z.object({
  '@_code': z.string().trim().regex(/^[A-Za-z0-9]{6}$/, 'код должен содержать ровно 6 букв или цифр'),
  '@_name': z.string().trim().min(1).max(160).optional(),
}).strict();
const patientSchema = z.object({
  '@_externalId': z.string().trim().min(1).max(100),
  firstName: z.string().trim().min(1).max(50),
  middleName: z.string().trim().min(1).max(50).optional(),
  lastName: z.string().trim().min(1).max(50),
  birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: z.enum(['MALE', 'FEMALE', 'UNKNOWN']),
  address: z.string().trim().min(1).max(250).optional(),
  phone: z.string().trim().min(1).max(100).optional(),
  diagnoses: z.object({ diagnosis: z.union([diagnosisSchema, z.array(diagnosisSchema).max(100)]) }).strict().optional(),
}).strict().superRefine((value, context) => {
  const date = new Date(`${value.birthDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.birthDate || date > new Date()) context.addIssue({ code: 'custom', path: ['birthDate'], message: 'некорректная или будущая дата' });
});

export class DemoXmlAdapter {
  parse(buffer: Buffer, fileName = 'patients.xml'): XmlLoadResult {
    if (buffer.length > MAX_XML_BYTES) throw new ImporterError('VALIDATION', `XML превышает лимит ${MAX_XML_BYTES / 1024 / 1024} МБ.`);
    let xml: string;
    try { xml = new TextDecoder('utf-8', { fatal: true }).decode(buffer); } catch (error) { throw new ImporterError('VALIDATION', 'XML должен быть корректным UTF-8.', { cause: error }); }
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new ImporterError('VALIDATION', 'DTD и внешние сущности в XML запрещены.');
    const validation = XMLValidator.validate(xml);
    if (validation !== true) throw new ImporterError('VALIDATION', `Некорректный XML: ${validation.err.msg}.`);
    const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', trimValues: true, parseTagValue: false, parseAttributeValue: false }).parse(xml) as Record<string, unknown>;
    const root = parsed['medsoft-demo-patients'];
    if (!root || typeof root !== 'object' || Array.isArray(root)) throw new ImporterError('VALIDATION', 'Не найден демонстрационный корневой элемент medsoft-demo-patients.');
    const raw = (root as Record<string, unknown>).patient;
    const records = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    const patients: ImportPatient[] = [];
    const errors: string[] = [];
    records.forEach((record, index) => {
      const result = patientSchema.safeParse(record);
      if (!result.success) {
        errors.push(`Запись ${index + 1}: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`);
        return;
      }
      const value = result.data;
      const rawDiagnoses = value.diagnoses?.diagnosis;
      const diagnoses = rawDiagnoses ? (Array.isArray(rawDiagnoses) ? rawDiagnoses : [rawDiagnoses]) : [];
      patients.push({
        rowId: randomUUID(), externalId: value['@_externalId'], firstName: value.firstName, middleName: value.middleName ?? null,
        lastName: value.lastName, birthDate: value.birthDate, sex: value.sex, address: value.address ?? null, phone: value.phone ?? null,
        diagnoses: diagnoses.map((diagnosis) => ({ code: diagnosis['@_code'], name: diagnosis['@_name'] ?? null })),
      });
    });
    if (records.length === 0) errors.push('XML не содержит записей patient.');
    return { fileName, patients, errors, demonstrationFormat: true };
  }
}
