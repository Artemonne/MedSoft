import type { Request, Response } from 'express';
import { idParamsSchema } from '../schemas/common.js';
import {
  addDiagnosisSchema,
  addPrescriptionSchema,
  editPrescriptionSchema,
  emptyBodySchema,
  historicalStateQuerySchema,
  patientIdParamsSchema,
  recordDiagnosisParamsSchema,
  recordPrescriptionParamsSchema,
  workerActionSchema,
} from '../schemas/medical-record.js';
import { medicalRecordService } from '../services/medical-record.js';

export const medicalRecordController = {
  async createForPatient(request: Request, response: Response) {
    const { patientId } = patientIdParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    response.status(201).json(await medicalRecordService.createForPatient(patientId));
  },

  async getForPatient(request: Request, response: Response) {
    const { patientId } = patientIdParamsSchema.parse(request.params);
    response.json(await medicalRecordService.getForPatient(patientId));
  },

  async getById(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const { at } = historicalStateQuerySchema.parse(request.query);
    response.json(await medicalRecordService.getById(id, at));
  },

  async getEvents(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    response.json(await medicalRecordService.getEvents(id));
  },

  async addDiagnosis(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const input = addDiagnosisSchema.parse(request.body);
    response.status(201).json(await medicalRecordService.addDiagnosis(id, input));
  },

  async removeDiagnosis(request: Request, response: Response) {
    const { id, diagnosisId } = recordDiagnosisParamsSchema.parse(request.params);
    const { workerId } = workerActionSchema.parse(request.body);
    response.json(await medicalRecordService.removeDiagnosis(id, diagnosisId, workerId));
  },

  async addPrescription(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const input = addPrescriptionSchema.parse(request.body);
    response.status(201).json(await medicalRecordService.addPrescription(id, input));
  },

  async removePrescription(request: Request, response: Response) {
    const { id, prescriptionId } = recordPrescriptionParamsSchema.parse(request.params);
    const { workerId } = workerActionSchema.parse(request.body);
    response.json(
      await medicalRecordService.removePrescription(id, prescriptionId, workerId),
    );
  },

  async editPrescription(request: Request, response: Response) {
    const { id, prescriptionId } = recordPrescriptionParamsSchema.parse(request.params);
    const input = editPrescriptionSchema.parse(request.body);
    response.json(await medicalRecordService.editPrescription(id, prescriptionId, input));
  },
};
