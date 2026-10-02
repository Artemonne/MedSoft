import { Router } from 'express';
import { diagnosisController } from '../controllers/diagnosis.js';
import { asyncHandler } from '../lib/async-handler.js';

export const diagnosesRouter = Router();

diagnosesRouter.get('/', asyncHandler(diagnosisController.list));
diagnosesRouter.get('/:id', asyncHandler(diagnosisController.getById));
diagnosesRouter.post('/', asyncHandler(diagnosisController.create));
diagnosesRouter.put('/:id', asyncHandler(diagnosisController.update));
diagnosesRouter.delete('/:id', asyncHandler(diagnosisController.delete));
