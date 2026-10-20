import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import { authService } from '../services/auth.js';

export async function authenticateAccessToken(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const authorization = request.get('authorization');
  const match = authorization?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    throw new UnauthorizedError('Bearer access token is required.');
  }

  request.auth = await authService.authenticateAccessToken(match[1]);
  next();
}
