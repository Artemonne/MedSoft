import { Router } from 'express';
import { auditController } from '../controllers/audit.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAdminAccessToken } from '../middleware/authenticate-admin.js';

export const auditRouter = Router();

auditRouter.use(asyncHandler(authenticateAdminAccessToken));
auditRouter.get('/', asyncHandler(auditController.list));
auditRouter.get('/checkpoint', asyncHandler(auditController.checkpoint));
auditRouter.get('/changes', asyncHandler(auditController.changes));
