import { apiRequest } from './client';
import type { MedicalRecordEvent, MedicalRecordLabOrder, MedicalRecordState } from '../types';

interface DiagnosisInput {
  diagnosisId: number;
}

interface PrescriptionInput {
  text: string;
}

export const medicalRecordsApi = {
  get: (id: number) => apiRequest<MedicalRecordState>(`/medical-records/${id}`),
  getAt: (id: number, datetime: string) =>
    apiRequest<MedicalRecordState>(`/medical-records/${id}?at=${encodeURIComponent(datetime)}`),
  events: (id: number) => apiRequest<MedicalRecordEvent[]>(`/medical-records/${id}/events`),
  labOrders: (id: number, at?: string) => apiRequest<MedicalRecordLabOrder[]>(
    `/medical-records/${id}/lab-orders${at ? `?at=${encodeURIComponent(at)}` : ''}`,
  ),
  createLabOrders: (id: number, labTestIds: number[], clientRequestId: string) =>
    apiRequest(`/medical-records/${id}/lab-orders`, {
      method: 'POST', body: JSON.stringify({ labTestIds, clientRequestId }),
    }),
  unlock: (id: number) => apiRequest<MedicalRecordState>(`/medical-records/${id}/unlock`, {
    method: 'POST', body: JSON.stringify({}),
  }),
  addDiagnosis: (id: number, input: DiagnosisInput) =>
    apiRequest<{ diagnosis: MedicalRecordState['diagnoses'][number]; version: number }>(
      `/medical-records/${id}/diagnoses`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  removeDiagnosis: (id: number, diagnosisId: number) =>
    apiRequest<{ diagnosis: MedicalRecordState['diagnoses'][number]; version: number }>(
      `/medical-records/${id}/diagnoses/${diagnosisId}`,
      { method: 'DELETE', body: JSON.stringify({}) },
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
  removePrescription: (id: number, prescriptionId: string) =>
    apiRequest<{ prescription: MedicalRecordState['prescriptions'][number]; version: number }>(
      `/medical-records/${id}/prescriptions/${prescriptionId}`,
      { method: 'DELETE', body: JSON.stringify({}) },
    ),
};
