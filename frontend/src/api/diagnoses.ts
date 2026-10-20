import { apiRequest, getApiSession } from './client';
import type { Diagnosis, DiagnosisInput } from '../types';

function basePath(): string {
  return getApiSession()?.subjectType === 'admin' ? '/admin/diagnoses' : '/diagnoses';
}

export const diagnosesApi = {
  list: () => apiRequest<Diagnosis[]>(basePath()),
  seed: () => apiRequest<{ created: number; total: number }>(`${basePath()}/seed`, { method: 'POST' }),
  create: (input: DiagnosisInput) =>
    apiRequest<Diagnosis>(basePath(), { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: DiagnosisInput) =>
    apiRequest<Diagnosis>(`${basePath()}/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: number) => apiRequest<void>(`${basePath()}/${id}`, { method: 'DELETE' }),
};
