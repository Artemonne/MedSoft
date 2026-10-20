import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import { adminAuthService } from '../services/admin-auth.js';

export async function authenticateAdminAccessToken(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.get('authorization');
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    throw new UnauthorizedError('Bearer administrator access token is required.');
  }

  request.auth = await adminAuthService.authenticateAccessToken(match[1]);
  next();
}
