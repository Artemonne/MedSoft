import { Router } from 'express';
import { MedicalWorkerRole } from '@prisma/client';
import { medicalRecordController } from '../controllers/medical-record.js';
import { asyncHandler } from '../lib/async-handler.js';
import { authenticateAccessToken } from '../middleware/authenticate.js';
import { authorizeMedicalWorkerRoles } from '../middleware/authorize-role.js';

export const medicalRecordsRouter = Router();

medicalRecordsRouter.use(asyncHandler(authenticateAccessToken));
medicalRecordsRouter.get('/:id/events', asyncHandler(medicalRecordController.getEvents));
medicalRecordsRouter.get('/:id', asyncHandler(medicalRecordController.getById));
medicalRecordsRouter.post(
  '/:id/unlock',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR),
  asyncHandler(medicalRecordController.unlock),
);
medicalRecordsRouter.post(
  '/:id/diagnoses',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(medicalRecordController.addDiagnosis),
);
medicalRecordsRouter.delete(
  '/:id/diagnoses/:diagnosisId',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(medicalRecordController.removeDiagnosis),
);
medicalRecordsRouter.post(
  '/:id/prescriptions',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(medicalRecordController.addPrescription),
);
medicalRecordsRouter.put(
  '/:id/prescriptions/:prescriptionId',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(medicalRecordController.editPrescription),
);
medicalRecordsRouter.delete(
  '/:id/prescriptions/:prescriptionId',
  authorizeMedicalWorkerRoles(MedicalWorkerRole.DOCTOR, MedicalWorkerRole.NURSE),
  asyncHandler(medicalRecordController.removePrescription),
);
