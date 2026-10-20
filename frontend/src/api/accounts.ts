import { apiRequest } from './client';
import type { MedicalWorkerRole } from '../types';

export interface ManagedAccount {
  id: string;
  username: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  medicalWorker: {
    id: number;
    firstName: string;
    lastName: string;
    position: string;
    role: MedicalWorkerRole;
    isDeleted: boolean;
  } | null;
}

interface AccountChangeResult {
  account: ManagedAccount;
  revokedRefreshTokens: number;
}

export const accountsApi = {
  list: () => apiRequest<ManagedAccount[]>('/admin/accounts'),
  create: (username: string, medicalWorkerId: number) =>
    apiRequest<{ account: ManagedAccount; generatedPassword: string }>('/admin/accounts', {
      method: 'POST',
      body: JSON.stringify({ username, medicalWorkerId }),
    }),
  resetPassword: (id: string) =>
    apiRequest<AccountChangeResult & { generatedPassword: string }>(`/admin/accounts/${id}/password`, {
      method: 'POST',
    }),
  setActive: (id: string, isActive: boolean) =>
    apiRequest<AccountChangeResult>(`/admin/accounts/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),
  setRole: (id: string, role: MedicalWorkerRole) =>
    apiRequest<AccountChangeResult>(`/admin/accounts/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
};
