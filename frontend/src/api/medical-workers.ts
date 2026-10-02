import { apiRequest } from './client';
import type { MedicalWorker, MedicalWorkerInput } from '../types';

export const medicalWorkersApi = {
  list: () => apiRequest<MedicalWorker[]>('/medical-workers'),
  create: (input: MedicalWorkerInput) =>
    apiRequest<MedicalWorker>('/medical-workers', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: MedicalWorkerInput) =>
    apiRequest<MedicalWorker>(`/medical-workers/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: number) => apiRequest<void>(`/medical-workers/${id}`, { method: 'DELETE' }),
};
