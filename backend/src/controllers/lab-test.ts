import type { Request, Response } from 'express';
import { idParamsSchema } from '../schemas/common.js';
import { createLabTestSchema, setLabTestActiveSchema, updateLabTestSchema } from '../schemas/lab-test.js';
import { labTestService } from '../services/lab-test.js';

export const labTestController = {
  async list(_request: Request, response: Response) { response.json(await labTestService.list()); },
  async listActive(_request: Request, response: Response) { response.json(await labTestService.listActive()); },
  async getById(request: Request, response: Response) { const { id } = idParamsSchema.parse(request.params); response.json(await labTestService.getById(id)); },
  async create(request: Request, response: Response) { response.status(201).json(await labTestService.create(createLabTestSchema.parse(request.body))); },
  async update(request: Request, response: Response) { const { id } = idParamsSchema.parse(request.params); response.json(await labTestService.update(id, updateLabTestSchema.parse(request.body))); },
  async setActive(request: Request, response: Response) { const { id } = idParamsSchema.parse(request.params); const { isActive } = setLabTestActiveSchema.parse(request.body); response.json(await labTestService.setActive(id, isActive)); },
  async seed(_request: Request, response: Response) { response.json(await labTestService.seed()); },
};
