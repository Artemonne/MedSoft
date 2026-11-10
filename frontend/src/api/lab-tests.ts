import { apiRequest } from './client';
import type { LabTest, LabTestInput } from '../types';

const basePath = '/admin/lab-tests';
export const labTestsApi = {
  list: () => apiRequest<LabTest[]>(basePath),
  seed: () => apiRequest<{ created: number; total: number }>(`${basePath}/seed`, { method: 'POST' }),
  create: (input: LabTestInput) => apiRequest<LabTest>(basePath, { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: LabTestInput) => apiRequest<LabTest>(`${basePath}/${id}`, { method: 'PUT', body: JSON.stringify(input) }),
  setActive: (id: number, isActive: boolean) => apiRequest<LabTest>(`${basePath}/${id}/active`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
};
