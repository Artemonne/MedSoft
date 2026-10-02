import type { Request, Response } from 'express';
import { idParamsSchema } from '../schemas/common.js';
import { createPatientSchema, updatePatientSchema } from '../schemas/patient.js';
import { patientService } from '../services/patient.js';

export const patientController = {
  async list(_request: Request, response: Response) {
    response.json(await patientService.list());
  },

  async getById(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    response.json(await patientService.getById(id));
  },

  async create(request: Request, response: Response) {
    const data = createPatientSchema.parse(request.body);
    response.status(201).json(await patientService.create(data));
  },

  async update(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const data = updatePatientSchema.parse(request.body);
    response.json(await patientService.update(id, data));
  },

  async delete(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    await patientService.delete(id);
    response.status(204).send();
  },
};
