import type { Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from '../lib/auth-cookie.js';
import { loginSchema } from '../schemas/auth.js';
import { authService } from '../services/auth.js';

function tokenResponse(result: Awaited<ReturnType<typeof authService.login>>) {
  return {
    accessToken: result.accessToken,
    accessTokenExpiresIn: result.accessTokenExpiresIn,
    account: result.account,
  };
}

export const authController = {
  async login(request: Request, response: Response) {
    const input = loginSchema.parse(request.body);
    const result = await authService.login(input);
    setRefreshCookie(response, result.refreshToken);
    response.json(tokenResponse(result));
  },

  async refresh(request: Request, response: Response) {
    const refreshToken = readRefreshCookie(request.get('cookie'));
    if (!refreshToken) {
      throw new UnauthorizedError('Refresh token is required.');
    }

    const result = await authService.refresh(refreshToken);
    setRefreshCookie(response, result.refreshToken);
    response.json(tokenResponse(result));
  },

  async logout(request: Request, response: Response) {
    await authService.logout(readRefreshCookie(request.get('cookie')));
    clearRefreshCookie(response);
    response.status(204).send();
  },

  async me(request: Request, response: Response) {
    if (request.auth?.subjectType !== 'user') {
      throw new UnauthorizedError();
    }
    response.json(await authService.currentAccount(request.auth));
  },
};
