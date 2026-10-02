import { Router } from 'express';
import { medicalRecordController } from '../controllers/medical-record.js';
import { asyncHandler } from '../lib/async-handler.js';

export const medicalRecordsRouter = Router();

medicalRecordsRouter.get('/:id/events', asyncHandler(medicalRecordController.getEvents));
medicalRecordsRouter.get('/:id', asyncHandler(medicalRecordController.getById));
medicalRecordsRouter.post('/:id/diagnoses', asyncHandler(medicalRecordController.addDiagnosis));
medicalRecordsRouter.delete(
  '/:id/diagnoses/:diagnosisId',
  asyncHandler(medicalRecordController.removeDiagnosis),
);
medicalRecordsRouter.post(
  '/:id/prescriptions',
  asyncHandler(medicalRecordController.addPrescription),
);
medicalRecordsRouter.put(
  '/:id/prescriptions/:prescriptionId',
  asyncHandler(medicalRecordController.editPrescription),
);
medicalRecordsRouter.delete(
  '/:id/prescriptions/:prescriptionId',
  asyncHandler(medicalRecordController.removePrescription),
);
