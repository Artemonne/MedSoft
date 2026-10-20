import type { RequestHandler } from 'express';
import { ForbiddenError } from '../lib/app-error.js';

export const requireCsrfProtection: RequestHandler = (request, _response, next) => {
  if (request.get('x-csrf-protection') !== '1') {
    next(new ForbiddenError('CSRF protection header is required.'));
    return;
  }
  next();
};
