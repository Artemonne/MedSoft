import { Router } from 'express';
import { labTestController } from '../controllers/lab-test.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAdminAccessToken } from '../middleware/authenticate-admin.js';

export const adminLabTestsRouter = Router();
adminLabTestsRouter.use(asyncHandler(authenticateAdminAccessToken));
adminLabTestsRouter.get('/', asyncHandler(labTestController.list));
adminLabTestsRouter.post('/seed', asyncHandler(labTestController.seed));
adminLabTestsRouter.get('/:id', asyncHandler(labTestController.getById));
adminLabTestsRouter.post('/', asyncHandler(labTestController.create));
adminLabTestsRouter.put('/:id', asyncHandler(labTestController.update));
adminLabTestsRouter.patch('/:id/active', asyncHandler(labTestController.setActive));
