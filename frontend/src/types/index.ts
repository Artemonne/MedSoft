export interface MedicalWorker {
  id: number;
  firstName: string;
  lastName: string;
  position: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalWorkerInput {
  firstName: string;
  lastName: string;
  position: string;
}

export interface Diagnosis {
  id: number;
  code: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface DiagnosisInput {
  code: string;
  name: string;
}

export type Sex = 'MALE' | 'FEMALE' | 'UNKNOWN';

export interface Patient {
  id: number;
  firstName: string;
  lastName: string;
  middleName: string | null;
  birthDate: string;
  sex: Sex;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PatientInput {
  firstName: string;
  lastName: string;
  middleName: string | null;
  birthDate: string;
  sex: Sex;
  comment: string | null;
}

export interface MedicalRecordSummary {
  id: number;
  patientId: number;
  createdAt: string;
}

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ path?: string; message?: string }>;
  };
}
