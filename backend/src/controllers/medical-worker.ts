import type { Request, Response } from 'express';
import { idParamsSchema } from '../schemas/common.js';
import {
  createMedicalWorkerSchema,
  updateMedicalWorkerSchema,
} from '../schemas/medical-worker.js';
import { medicalWorkerService } from '../services/medical-worker.js';

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
    response.status(201).json(await medicalWorkerService.create(data));
  },

  async update(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const data = updateMedicalWorkerSchema.parse(request.body);
    response.json(await medicalWorkerService.update(id, data));
  },

  async delete(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    await medicalWorkerService.softDelete(id);
    response.status(204).send();
  },
};
