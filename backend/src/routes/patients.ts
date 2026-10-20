import { Router } from 'express';
import { MedicalWorkerRole } from '@prisma/client';
import { patientController } from '../controllers/patient.js';
import { medicalRecordController } from '../controllers/medical-record.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAccessToken } from '../middleware/authenticate.js';
import { authorizeMedicalWorkerRoles } from '../middleware/authorize-role.js';

export const patientsRouter = Router();

patientsRouter.use(asyncHandler(authenticateAccessToken));
patientsRouter.get('/', asyncHandler(patientController.list));
patientsRouter.post(
  '/:patientId/medical-record',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(medicalRecordController.createForPatient),
);
patientsRouter.get(
  '/:patientId/medical-record',
  asyncHandler(medicalRecordController.getForPatient),
);
patientsRouter.get('/:id', asyncHandler(patientController.getById));
patientsRouter.post(
  '/',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(patientController.create),
);
patientsRouter.put(
  '/:id',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(patientController.update),
);
patientsRouter.delete(
  '/:id',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR),
  asyncHandler(patientController.delete),
);
