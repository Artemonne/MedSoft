import type { NextFunction, Request, Response } from 'express';
import { decodeJwt } from 'jose';
import { UnauthorizedError } from '../lib/app-error.js';
import { adminAuthService } from '../services/admin-auth.js';
import { authService } from '../services/auth.js';
import { serviceAuthService } from '../services/service-auth.js';

export async function authenticateAnyAccessToken(
  request: Request,
  _response: Response,
  next: NextFunction,
): Promise<void> {
  const match = request.get('authorization')?.match(/^Bearer ([^\s]+)$/);
  if (!match) {
    throw new UnauthorizedError('Bearer access token is required.');
  }

  const token = match[1];
  let subjectType: unknown;
  try {
    subjectType = decodeJwt(token).subjectType;
  } catch {
    throw new UnauthorizedError('Invalid access token.');
  }

  switch (subjectType) {
    case 'user':
      request.auth = await authService.authenticateAccessToken(token);
      break;
    case 'admin':
      request.auth = await adminAuthService.authenticateAccessToken(token);
      break;
    case 'service':
      request.auth = await serviceAuthService.authenticateAccessToken(token);
      break;
    default:
      throw new UnauthorizedError('Invalid access token.');
  }
  next();
}
