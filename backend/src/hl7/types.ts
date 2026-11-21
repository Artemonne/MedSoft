import type { Sex } from '@prisma/client';

export interface Hl7Delimiters {
  field: string;
  component: string;
  repetition: string;
  escape: string;
  subcomponent: string;
}

export interface Hl7Header {
  sendingApplication: string;
  sendingFacility: string;
  receivingApplication: string;
  receivingFacility: string;
  messageTime: string;
  messageType: string;
  triggerEvent: string;
  structure: string;
  controlId: string;
  delimiters: Hl7Delimiters;
}

export interface Hl7DiagnosisInput {
  code: string;
  name: string | null;
  codingSystem: '99MEDSOFT-DIAGNOSIS';
}

export interface Hl7PatientInput {
  externalIdSource: string;
  externalIdValue: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  birthDate: Date;
  sex: Sex;
  address: string | null;
  phone: string | null;
  diagnoses: Hl7DiagnosisInput[];
}

export interface ParsedAdtA28 {
  kind: 'patient-import';
  header: Hl7Header;
  accessToken: string;
  patient: Hl7PatientInput;
}

export interface ParsedConnectionTest {
  kind: 'connection-test';
  header: Hl7Header;
  accessToken: string;
  queryTag: string;
}

export type ParsedHl7Message = ParsedAdtA28 | ParsedConnectionTest;

export interface ClientCertificateIdentity {
  fingerprintSha256: string;
  subject: string;
  issuer: string;
  serialNumber: string;
  validFrom: string;
  validTo: string;
}
