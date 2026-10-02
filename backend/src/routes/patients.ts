import { Router } from 'express';
import { patientController } from '../controllers/patient.js';
import { asyncHandler } from '../lib/async-handler.js';

export const patientsRouter = Router();

patientsRouter.get('/', asyncHandler(patientController.list));
patientsRouter.get('/:id', asyncHandler(patientController.getById));
patientsRouter.post('/', asyncHandler(patientController.create));
patientsRouter.put('/:id', asyncHandler(patientController.update));
patientsRouter.delete('/:id', asyncHandler(patientController.delete));
