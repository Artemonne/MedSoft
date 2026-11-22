export type PatientSex = 'MALE' | 'FEMALE' | 'UNKNOWN';
export type ImportStatus = 'PENDING' | 'SENDING' | 'SUCCESS' | 'REJECTED' | 'UNKNOWN';

export interface DiagnosisInput { code: string; name: string | null }
export interface ImportPatient {
  rowId: string;
  externalId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  birthDate: string;
  sex: PatientSex;
  address: string | null;
  phone: string | null;
  diagnoses: DiagnosisInput[];
}

export interface ConnectionSettings {
  hisUrl: string;
  mllpHost: string;
  mllpPort: number;
  tlsServerName: string;
  sourceSystemId: string;
  clientCertificatePath: string;
  clientKeyPath: string;
  caCertificatePath: string;
  timeoutMs: number;
}
export interface ConnectionInput extends ConnectionSettings { apiKey: string }

export interface CertificateDetails {
  subject: string;
  commonName: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  serialNumber: string;
  fingerprintSha256: string;
  authorized: boolean;
}
export interface ChannelCheck { ok: boolean; message: string }
export interface ConnectionCheckResult {
  ok: boolean;
  api: ChannelCheck;
  mllp: ChannelCheck;
  certificate: CertificateDetails | null;
}
export interface XmlLoadResult {
  fileName: string;
  patients: ImportPatient[];
  errors: string[];
  demonstrationFormat: boolean;
}
export interface PatientImportResult {
  rowId: string;
  status: Exclude<ImportStatus, 'PENDING' | 'SENDING'>;
  hisPatientId: string | null;
  message: string;
}
export interface ImportProgress {
  rowId: string;
  status: ImportStatus;
  completed: number;
  total: number;
  result?: PatientImportResult;
}

export interface Hl7ImporterApi {
  getSettings(): Promise<ConnectionSettings | null>;
  chooseFile(kind: 'clientCertificate' | 'clientKey' | 'caCertificate'): Promise<string | null>;
  testConnection(input: ConnectionInput): Promise<ConnectionCheckResult>;
  chooseXml(): Promise<XmlLoadResult | null>;
  importPatients(): Promise<PatientImportResult[]>;
  onImportProgress(listener: (progress: ImportProgress) => void): () => void;
}

export const IPC = {
  settings: 'hl7-importer:settings',
  chooseFile: 'hl7-importer:choose-file',
  testConnection: 'hl7-importer:test-connection',
  chooseXml: 'hl7-importer:choose-xml',
  importPatients: 'hl7-importer:import-patients',
  progress: 'hl7-importer:progress',
} as const;
