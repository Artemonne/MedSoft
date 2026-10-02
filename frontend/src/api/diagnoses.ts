import { apiRequest } from './client';
import type { Diagnosis, DiagnosisInput } from '../types';

export const diagnosesApi = {
  list: () => apiRequest<Diagnosis[]>('/diagnoses'),
  create: (input: DiagnosisInput) =>
    apiRequest<Diagnosis>('/diagnoses', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: DiagnosisInput) =>
    apiRequest<Diagnosis>(`/diagnoses/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: number) => apiRequest<void>(`/diagnoses/${id}`, { method: 'DELETE' }),
};
