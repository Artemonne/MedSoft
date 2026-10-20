import { Router } from 'express';
import { diagnosisController } from '../controllers/diagnosis.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAdminAccessToken } from '../middleware/authenticate-admin.js';

export const adminDiagnosesRouter = Router();

adminDiagnosesRouter.use(asyncHandler(authenticateAdminAccessToken));
adminDiagnosesRouter.get('/', asyncHandler(diagnosisController.list));
adminDiagnosesRouter.post('/seed', asyncHandler(diagnosisController.seed));
adminDiagnosesRouter.get('/:id', asyncHandler(diagnosisController.getById));
adminDiagnosesRouter.post('/', asyncHandler(diagnosisController.create));
adminDiagnosesRouter.put('/:id', asyncHandler(diagnosisController.update));
adminDiagnosesRouter.delete('/:id', asyncHandler(diagnosisController.delete));
