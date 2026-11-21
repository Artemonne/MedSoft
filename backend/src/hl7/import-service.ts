import { MedicalRecordEventType, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import type { ServiceAuthContext } from '../types/auth.js';
import { auditService, type AuditActor } from '../services/audit.js';
import type { ClientCertificateIdentity, ParsedAdtA28 } from './types.js';

export type Hl7ImportErrorCode = 'DUPLICATE_EXTERNAL_ID' | 'DIAGNOSIS_NAME_REQUIRED' | 'IMPORT_FAILED';

export class Hl7ImportError extends Error {
  constructor(public readonly code: Hl7ImportErrorCode, message: string) {
    super(message);
    this.name = 'Hl7ImportError';
  }
}

function certificateMetadata(certificate: ClientCertificateIdentity): Prisma.InputJsonObject {
  return {
    fingerprintSha256: certificate.fingerprintSha256,
    subject: certificate.subject,
    issuer: certificate.issuer,
    serialNumber: certificate.serialNumber,
    validFrom: certificate.validFrom,
    validTo: certificate.validTo,
  };
}

export async function recordHl7ImportFailure(input: {
  actor: AuditActor;
  controlId: string;
  errorCode: string;
  errorMessage: string;
  certificate: ClientCertificateIdentity;
}): Promise<void> {
  await auditService.recordStandalone({
    eventType: 'HL7_PATIENT_IMPORT_FAILED',
    actor: input.actor,
    message: 'HL7 patient import failed.',
    metadata: {
      operation: 'ADT_A28_IMPORT',
      messageControlId: input.controlId,
      result: 'FAILED',
      errorCode: input.errorCode,
      errorMessage: input.errorMessage,
      certificate: certificateMetadata(input.certificate),
    },
  });
}

export async function importHl7Patient(
  message: ParsedAdtA28,
  actor: ServiceAuthContext,
  certificate: ClientCertificateIdentity,
): Promise<number> {
  try {
    return await prisma.$transaction(async (transaction) => {
      const duplicate = await transaction.patient.findUnique({
        where: {
          externalIdSource_externalIdValue: {
            externalIdSource: message.patient.externalIdSource,
            externalIdValue: message.patient.externalIdValue,
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new Hl7ImportError('DUPLICATE_EXTERNAL_ID', 'A patient with this external identifier already exists.');
      }

      const patient = await transaction.patient.create({
        data: {
          firstName: message.patient.firstName,
          middleName: message.patient.middleName,
          lastName: message.patient.lastName,
          birthDate: message.patient.birthDate,
          sex: message.patient.sex,
          comment: null,
          externalIdSource: message.patient.externalIdSource,
          externalIdValue: message.patient.externalIdValue,
        },
      });
      const medicalRecord = await transaction.medicalRecord.create({ data: { patientId: patient.id } });

      for (const [index, input] of message.patient.diagnoses.entries()) {
        let diagnosis = await transaction.diagnosis.findUnique({ where: { code: input.code } });
        if (!diagnosis) {
          if (!input.name) {
            throw new Hl7ImportError('DIAGNOSIS_NAME_REQUIRED', `Diagnosis ${input.code} requires a name.`);
          }
          diagnosis = await transaction.diagnosis.upsert({
            where: { code: input.code },
            update: {},
            create: { code: input.code, name: input.name },
          });
        }
        await transaction.medicalRecordEvent.create({
          data: {
            medicalRecordId: medicalRecord.id,
            serviceAccountId: actor.serviceAccountId,
            version: index + 1,
            type: MedicalRecordEventType.DIAGNOSIS_ADDED,
            payload: { diagnosisId: diagnosis.id, code: diagnosis.code, name: diagnosis.name },
          },
        });
      }

      await auditService.record(transaction, {
        eventType: 'HL7_PATIENT_IMPORTED',
        actor: { type: 'service', serviceAccountId: actor.serviceAccountId },
        message: 'Patient imported through HL7 ADT A28.',
        metadata: {
          operation: 'ADT_A28_IMPORT',
          messageControlId: message.header.controlId,
          result: 'SUCCESS',
          patientId: patient.id,
          medicalRecordId: medicalRecord.id,
          certificate: certificateMetadata(certificate),
        },
      });
      return patient.id;
    });
  } catch (error) {
    if (error instanceof Hl7ImportError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Hl7ImportError('DUPLICATE_EXTERNAL_ID', 'A patient with this external identifier already exists.');
    }
    throw new Hl7ImportError('IMPORT_FAILED', 'Patient import failed.');
  }
}
