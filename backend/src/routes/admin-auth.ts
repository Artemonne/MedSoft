import { Router } from 'express';
import { adminAuthController } from '../controllers/admin-auth.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAdminAccessToken } from '../middleware/authenticate-admin.js';
import { requireCsrfProtection } from '../middleware/csrf-protection.js';

export const adminAuthRouter = Router();

adminAuthRouter.get('/bootstrap/status', asyncHandler(adminAuthController.bootstrapStatus));
adminAuthRouter.post('/bootstrap/start', asyncHandler(adminAuthController.startBootstrap));
adminAuthRouter.post('/bootstrap/complete', asyncHandler(adminAuthController.completeBootstrap));
adminAuthRouter.post('/auth/login', asyncHandler(adminAuthController.login));
adminAuthRouter.post(
  '/auth/refresh',
  requireCsrfProtection,
  asyncHandler(adminAuthController.refresh),
);
adminAuthRouter.post(
  '/auth/logout',
  requireCsrfProtection,
  asyncHandler(adminAuthController.logout),
);
adminAuthRouter.get(
  '/auth/me',
  asyncHandler(authenticateAdminAccessToken),
  asyncHandler(adminAuthController.me),
);
