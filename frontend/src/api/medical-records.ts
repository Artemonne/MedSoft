import { apiRequest } from './client';
import type { MedicalRecordEvent, MedicalRecordState } from '../types';

interface WorkerInput {
  workerId: number;
}

interface DiagnosisInput extends WorkerInput {
  diagnosisId: number;
}

interface PrescriptionInput extends WorkerInput {
  text: string;
}

export const medicalRecordsApi = {
  get: (id: number) => apiRequest<MedicalRecordState>(`/medical-records/${id}`),
  getAt: (id: number, datetime: string) =>
    apiRequest<MedicalRecordState>(`/medical-records/${id}?at=${encodeURIComponent(datetime)}`),
  events: (id: number) => apiRequest<MedicalRecordEvent[]>(`/medical-records/${id}/events`),
  addDiagnosis: (id: number, input: DiagnosisInput) =>
    apiRequest<{ diagnosis: MedicalRecordState['diagnoses'][number]; version: number }>(
      `/medical-records/${id}/diagnoses`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  removeDiagnosis: (id: number, diagnosisId: number, input: WorkerInput) =>
    apiRequest<{ diagnosis: MedicalRecordState['diagnoses'][number]; version: number }>(
      `/medical-records/${id}/diagnoses/${diagnosisId}`,
      { method: 'DELETE', body: JSON.stringify(input) },
    ),
  addPrescription: (id: number, input: PrescriptionInput) =>
    apiRequest<{ prescriptionId: string; text: string; version: number }>(
      `/medical-records/${id}/prescriptions`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  editPrescription: (id: number, prescriptionId: string, input: PrescriptionInput) =>
    apiRequest<{ previousPrescriptionId: string; prescriptionId: string; text: string; versions: number[] }>(
      `/medical-records/${id}/prescriptions/${prescriptionId}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
  removePrescription: (id: number, prescriptionId: string, input: WorkerInput) =>
    apiRequest<{ prescription: MedicalRecordState['prescriptions'][number]; version: number }>(
      `/medical-records/${id}/prescriptions/${prescriptionId}`,
      { method: 'DELETE', body: JSON.stringify(input) },
    ),
};
