import { Router } from 'express';
import { asyncHandler } from '../lib/async-handler.js';
import { UnauthorizedError } from '../lib/app-error.js';
import { authenticateAnyAccessToken } from '../middleware/authenticate-any.js';

export const testConnectionRouter = Router();

testConnectionRouter.get('/', asyncHandler(authenticateAnyAccessToken), (request, response) => {
  if (!request.auth) {
    throw new UnauthorizedError();
  }
  const role = request.auth.subjectType === 'admin'
    ? 'ADMIN'
    : request.auth.subjectType === 'service'
      ? request.auth.role
      : request.auth.medicalWorker.role;
  response.json({ status: 'connected', role });
});
