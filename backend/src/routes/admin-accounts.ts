import { Router } from 'express';
import { adminAccountController } from '../controllers/admin-account.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAdminAccessToken } from '../middleware/authenticate-admin.js';

export const adminAccountsRouter = Router();

adminAccountsRouter.use(asyncHandler(authenticateAdminAccessToken));
adminAccountsRouter.get('/', asyncHandler(adminAccountController.list));
adminAccountsRouter.post('/', asyncHandler(adminAccountController.create));
adminAccountsRouter.post('/:id/password', asyncHandler(adminAccountController.resetPassword));
adminAccountsRouter.patch('/:id/status', asyncHandler(adminAccountController.setActive));
adminAccountsRouter.patch('/:id/role', asyncHandler(adminAccountController.setRole));
