import { apiRequest } from './client';
export interface ManagedServiceAccount { id: string; name: string; role: 'LIS'; isActive: boolean; keyIdentifier: string; keyVersion: number; rotatedAt: string; lastUsedAt: string | null; createdAt: string; updatedAt: string; }
interface ChangeResult { account: ManagedServiceAccount; revokedRefreshTokens: number; requiresKeyRotation?: boolean; }
export const serviceAccountsApi = {
  list: () => apiRequest<ManagedServiceAccount[]>('/admin/service-accounts'),
  create: (name: string) => apiRequest<{ account: ManagedServiceAccount; apiKey: string }>('/admin/service-accounts', { method: 'POST', body: JSON.stringify({ name }) }),
  setActive: (id: string, isActive: boolean) => apiRequest<ChangeResult>(`/admin/service-accounts/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }),
  rotate: (id: string) => apiRequest<ChangeResult & { apiKey: string }>(`/admin/service-accounts/${id}/rotate-key`, { method: 'POST' }),
};
