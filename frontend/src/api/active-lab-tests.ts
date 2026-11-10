import { apiRequest } from './client';
import type { LabTest } from '../types';

export const activeLabTestsApi = {
  list: () => apiRequest<LabTest[]>('/lab-tests'),
};
