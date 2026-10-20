import type { Request, Response } from 'express';
import { UnauthorizedError } from '../lib/app-error.js';
import { idParamsSchema } from '../schemas/common.js';
import {
  createMedicalWorkerSchema,
  updateMedicalWorkerSchema,
} from '../schemas/medical-worker.js';
import { medicalWorkerService } from '../services/medical-worker.js';

function administratorId(request: Request): 1 {
  if (request.auth?.subjectType !== 'admin') {
    throw new UnauthorizedError();
  }
  return request.auth.administratorId;
}

export const medicalWorkerController = {
  async list(_request: Request, response: Response) {
    response.json(await medicalWorkerService.list());
  },

  async getById(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    response.json(await medicalWorkerService.getById(id));
  },

  async create(request: Request, response: Response) {
    const data = createMedicalWorkerSchema.parse(request.body);
    response
      .status(201)
      .json(await medicalWorkerService.create(data, administratorId(request)));
  },

  async update(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const data = updateMedicalWorkerSchema.parse(request.body);
    response.json(await medicalWorkerService.update(id, data, administratorId(request)));
  },

  async delete(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    await medicalWorkerService.softDelete(id, administratorId(request));
    response.status(204).send();
  },
};
