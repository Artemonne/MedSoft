import { ApiError, apiRequest } from './client';
import type { MedicalRecordSummary, Patient, PatientInput } from '../types';

export const patientsApi = {
  list: () => apiRequest<Patient[]>('/patients'),
  get: (id: number) => apiRequest<Patient>(`/patients/${id}`),
  create: (input: PatientInput) =>
    apiRequest<Patient>('/patients', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: PatientInput) =>
    apiRequest<Patient>(`/patients/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: number) => apiRequest<void>(`/patients/${id}`, { method: 'DELETE' }),
  async getMedicalRecord(id: number) {
    try {
      return await apiRequest<MedicalRecordSummary>(`/patients/${id}/medical-record`);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  },
  createMedicalRecord: (id: number) =>
    apiRequest<MedicalRecordSummary>(`/patients/${id}/medical-record`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
};
