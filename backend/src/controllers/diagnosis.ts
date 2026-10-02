import type { Request, Response } from 'express';
import { idParamsSchema } from '../schemas/common.js';
import { createDiagnosisSchema, updateDiagnosisSchema } from '../schemas/diagnosis.js';
import { diagnosisService } from '../services/diagnosis.js';

export const diagnosisController = {
  async list(_request: Request, response: Response) {
    response.json(await diagnosisService.list());
  },

  async getById(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    response.json(await diagnosisService.getById(id));
  },

  async create(request: Request, response: Response) {
    const data = createDiagnosisSchema.parse(request.body);
    response.status(201).json(await diagnosisService.create(data));
  },

  async update(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const data = updateDiagnosisSchema.parse(request.body);
    response.json(await diagnosisService.update(id, data));
  },

  async delete(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    await diagnosisService.delete(id);
    response.status(204).send();
  },
};
