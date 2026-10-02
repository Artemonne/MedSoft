import { Router } from 'express';
import { medicalWorkerController } from '../controllers/medical-worker.js';
import { asyncHandler } from '../lib/async-handler.js';

export const medicalWorkersRouter = Router();

medicalWorkersRouter.get('/', asyncHandler(medicalWorkerController.list));
medicalWorkersRouter.get('/:id', asyncHandler(medicalWorkerController.getById));
medicalWorkersRouter.post('/', asyncHandler(medicalWorkerController.create));
medicalWorkersRouter.put('/:id', asyncHandler(medicalWorkerController.update));
medicalWorkersRouter.delete('/:id', asyncHandler(medicalWorkerController.delete));
