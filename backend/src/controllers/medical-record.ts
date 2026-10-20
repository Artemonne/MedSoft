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
} from '../schemas/medical-record.js';
import { medicalRecordService } from '../services/medical-record.js';
import { UnauthorizedError } from '../lib/app-error.js';

function authenticatedWorkerId(request: Request): number {
  if (request.auth?.subjectType !== 'user') {
    throw new UnauthorizedError();
  }
  return request.auth.medicalWorker.id;
}

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

  async unlock(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    response.json(await medicalRecordService.unlock(id, authenticatedWorkerId(request)));
  },

  async addDiagnosis(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const input = addDiagnosisSchema.parse(request.body);
    response
      .status(201)
      .json(await medicalRecordService.addDiagnosis(id, input, authenticatedWorkerId(request)));
  },

  async removeDiagnosis(request: Request, response: Response) {
    const { id, diagnosisId } = recordDiagnosisParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    response.json(
      await medicalRecordService.removeDiagnosis(
        id,
        diagnosisId,
        authenticatedWorkerId(request),
      ),
    );
  },

  async addPrescription(request: Request, response: Response) {
    const { id } = idParamsSchema.parse(request.params);
    const input = addPrescriptionSchema.parse(request.body);
    response
      .status(201)
      .json(await medicalRecordService.addPrescription(id, input, authenticatedWorkerId(request)));
  },

  async removePrescription(request: Request, response: Response) {
    const { id, prescriptionId } = recordPrescriptionParamsSchema.parse(request.params);
    emptyBodySchema.parse(request.body ?? {});
    response.json(
      await medicalRecordService.removePrescription(
        id,
        prescriptionId,
        authenticatedWorkerId(request),
      ),
    );
  },

  async editPrescription(request: Request, response: Response) {
    const { id, prescriptionId } = recordPrescriptionParamsSchema.parse(request.params);
    const input = editPrescriptionSchema.parse(request.body);
    response.json(
      await medicalRecordService.editPrescription(
        id,
        prescriptionId,
        input,
        authenticatedWorkerId(request),
      ),
    );
  },
};
