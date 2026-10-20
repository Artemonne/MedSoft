import type { Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import {
  clearAdminRefreshCookie,
  readAdminRefreshCookie,
  setAdminRefreshCookie,
} from '../lib/auth-cookie.js';
import {
  adminBootstrapCompleteSchema,
  adminBootstrapStartSchema,
  adminLoginSchema,
} from '../schemas/admin-auth.js';
import { adminAuthService } from '../services/admin-auth.js';

function bootstrapSecret(request: Request): string {
  const secret = request.get('x-admin-bootstrap-secret');
  if (!secret) {
    throw new UnauthorizedError('Invalid bootstrap credentials.');
  }
  return secret;
}

export const adminAuthController = {
  async bootstrapStatus(_request: Request, response: Response) {
    response.json(await adminAuthService.bootstrapStatus());
  },

  async startBootstrap(request: Request, response: Response) {
    const input = adminBootstrapStartSchema.parse(request.body);
    const result = await adminAuthService.startBootstrap(input, bootstrapSecret(request));
    response.status(201).json(result);
  },

  async completeBootstrap(request: Request, response: Response) {
    const { totpCode } = adminBootstrapCompleteSchema.parse(request.body);
    response.json(
      await adminAuthService.completeBootstrap(totpCode, bootstrapSecret(request)),
    );
  },

  async login(request: Request, response: Response) {
    const result = await adminAuthService.login(adminLoginSchema.parse(request.body));
    setAdminRefreshCookie(response, result.refreshToken);
    response.json({
      accessToken: result.accessToken,
      accessTokenExpiresIn: result.accessTokenExpiresIn,
      administrator: result.administrator,
    });
  },

  async refresh(request: Request, response: Response) {
    const refreshToken = readAdminRefreshCookie(request.get('cookie'));
    if (!refreshToken) {
      throw new UnauthorizedError('Administrator refresh token is required.');
    }
    const result = await adminAuthService.refresh(refreshToken);
    setAdminRefreshCookie(response, result.refreshToken);
    response.json({
      accessToken: result.accessToken,
      accessTokenExpiresIn: result.accessTokenExpiresIn,
    });
  },

  async logout(request: Request, response: Response) {
    await adminAuthService.logout(readAdminRefreshCookie(request.get('cookie')));
    clearAdminRefreshCookie(response);
    response.status(204).send();
  },

  async me(request: Request, response: Response) {
    if (request.auth?.subjectType !== 'admin') {
      throw new UnauthorizedError();
    }
    response.json(await adminAuthService.currentAdministrator());
  },
};
