import type { Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import { serviceRefreshSchema, serviceTokenSchema } from '../schemas/service-auth.js';
import { serviceAuthService } from '../services/service-auth.js';
export const serviceAuthController = {
  async token(request: Request, response: Response) { const { apiKey } = serviceTokenSchema.parse(request.body); response.json(await serviceAuthService.exchangeApiKey(apiKey, request.requestId)); },
  async refresh(request: Request, response: Response) { const { refreshToken } = serviceRefreshSchema.parse(request.body); response.json(await serviceAuthService.refresh(refreshToken)); },
  async logout(request: Request, response: Response) { if (request.auth?.subjectType !== 'service') throw new UnauthorizedError(); await serviceAuthService.logout(request.auth); response.status(204).send(); },
  async testConnection(request: Request, response: Response) { if (request.auth?.subjectType !== 'service') throw new UnauthorizedError(); response.json({ status: 'connected', role: request.auth.role }); },
};
