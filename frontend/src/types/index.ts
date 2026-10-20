export type MedicalWorkerRole = 'doctor' | 'laboratory-technician' | 'nurse' | 'other';

export interface MedicalWorker {
  id: number;
  firstName: string;
  lastName: string;
  position: string;
  role: MedicalWorkerRole;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalWorkerInput {
  firstName: string;
  lastName: string;
  position: string;
  role?: MedicalWorkerRole;
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

export interface MedicalRecordDiagnosis {
  diagnosisId: number;
  code: string;
  name: string;
}

export interface MedicalRecordPrescription {
  prescriptionId: string;
  text: string;
}

export interface MedicalRecordState extends MedicalRecordSummary {
  diagnoses: MedicalRecordDiagnosis[];
  prescriptions: MedicalRecordPrescription[];
}

export interface MedicalRecordEventWorker {
  id: number;
  firstName: string;
  lastName: string;
  position: string;
  isDeleted: boolean;
}

interface MedicalRecordEventBase {
  version: number;
  createdAt: string;
  worker: MedicalRecordEventWorker;
}

export type MedicalRecordEvent =
  | (MedicalRecordEventBase & {
      type: 'DIAGNOSIS_ADDED' | 'DIAGNOSIS_REMOVED';
      payload: MedicalRecordDiagnosis;
    })
  | (MedicalRecordEventBase & {
      type: 'PRESCRIPTION_ADDED' | 'PRESCRIPTION_REMOVED';
      payload: MedicalRecordPrescription;
    });

export interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: Array<{ path?: string; message?: string }>;
  };
}
