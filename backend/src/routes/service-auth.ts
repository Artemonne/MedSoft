import { Router } from 'express';
import { serviceAuthController } from '../controllers/service-auth.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateServiceAccessToken } from '../middleware/authenticate-service.js';
export const serviceAuthRouter = Router();
serviceAuthRouter.post('/token', asyncHandler(serviceAuthController.token));
serviceAuthRouter.post('/refresh', asyncHandler(serviceAuthController.refresh));
serviceAuthRouter.post('/logout', asyncHandler(authenticateServiceAccessToken), asyncHandler(serviceAuthController.logout));
serviceAuthRouter.get('/test-connection', asyncHandler(authenticateServiceAccessToken), asyncHandler(serviceAuthController.testConnection));
