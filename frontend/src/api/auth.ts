import { apiRequest, setApiSession, type SessionSubject } from './client';
import type { AdministratorIdentity, UserAccountIdentity } from '../types';

interface TokenResponse {
  accessToken: string;
  accessTokenExpiresIn: number;
}

export type BootstrapStatus = 'NOT_CONFIGURED' | 'SETUP_IN_PROGRESS' | 'CONFIGURED';

export interface BootstrapSetup {
  status: 'TOTP_SETUP_REQUIRED';
  manualSecret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

function rememberToken(subjectType: SessionSubject, response: TokenResponse): void {
  setApiSession(subjectType, response.accessToken, response.accessTokenExpiresIn);
}

export const authApi = {
  bootstrapStatus: () =>
    apiRequest<{ status: BootstrapStatus }>('/admin/bootstrap/status', { authenticate: false }),

  startBootstrap: (input: {
    bootstrapSecret: string;
    password: string;
    passwordConfirmation: string;
  }) => apiRequest<BootstrapSetup>('/admin/bootstrap/start', {
    method: 'POST',
    authenticate: false,
    headers: { 'X-Admin-Bootstrap-Secret': input.bootstrapSecret },
    body: JSON.stringify({ password: input.password, passwordConfirmation: input.passwordConfirmation }),
  }),

  completeBootstrap: (bootstrapSecret: string, totpCode: string) =>
    apiRequest<Omit<AdministratorIdentity, 'subjectType'>>('/admin/bootstrap/complete', {
      method: 'POST',
      authenticate: false,
      headers: { 'X-Admin-Bootstrap-Secret': bootstrapSecret },
      body: JSON.stringify({ totpCode }),
    }),

  async loginUser(username: string, password: string) {
    const response = await apiRequest<TokenResponse & { account: Omit<UserAccountIdentity, 'subjectType'> }>(
      '/auth/login',
      { method: 'POST', authenticate: false, body: JSON.stringify({ username, password }) },
    );
    rememberToken('user', response);
    return { ...response.account, subjectType: 'user' } as UserAccountIdentity;
  },

  async loginAdmin(password: string, totpCode: string) {
    const response = await apiRequest<TokenResponse & { administrator: Omit<AdministratorIdentity, 'subjectType'> }>(
      '/admin/auth/login',
      { method: 'POST', authenticate: false, body: JSON.stringify({ password, totpCode }) },
    );
    rememberToken('admin', response);
    return { ...response.administrator, subjectType: 'admin' } as AdministratorIdentity;
  },

  currentUser: () => apiRequest<Omit<UserAccountIdentity, 'subjectType'>>('/auth/me'),
  currentAdmin: () => apiRequest<Omit<AdministratorIdentity, 'subjectType'>>('/admin/auth/me'),
};
