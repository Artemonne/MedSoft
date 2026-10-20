import { Router } from 'express';
import { MedicalWorkerRole } from '@prisma/client';
import { diagnosisController } from '../controllers/diagnosis.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAccessToken } from '../middleware/authenticate.js';
import { authorizeMedicalWorkerRoles } from '../middleware/authorize-role.js';

export const diagnosesRouter = Router();

diagnosesRouter.use(asyncHandler(authenticateAccessToken));
diagnosesRouter.get('/', asyncHandler(diagnosisController.list));
diagnosesRouter.post(
  '/seed',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR),
  asyncHandler(diagnosisController.seed),
);
diagnosesRouter.get('/:id', asyncHandler(diagnosisController.getById));
diagnosesRouter.post(
  '/',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR),
  asyncHandler(diagnosisController.create),
);
diagnosesRouter.put(
  '/:id',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR),
  asyncHandler(diagnosisController.update),
);
diagnosesRouter.delete(
  '/:id',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR),
  asyncHandler(diagnosisController.delete),
);
